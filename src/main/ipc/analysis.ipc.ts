import { ipcMain, BrowserWindow } from 'electron';
import { eq } from 'drizzle-orm';
import { IPC_CHANNELS } from '../../shared/constants';
import { getDb } from '../db/connection';
import * as dbSchema from '../db/schema';
import {
  runAnalysis,
  runContextAnalyses,
  retryFailedSentences,
  deriveSentences,
  cancelAnalysis,
  type AnalysisRunOptions,
} from '../services/analysis.service';
import { getSettings, analysesFor, grammarModeFor } from '../services/settings.service';
import { buildTranscriptParagraphs } from '../../shared/transcript';
import type { TranscriptSegment, AnalysisBatchEvent, ContextAnalysisType } from '../../shared/types';

/**
 * Everything derived from an analysis run, cleared before re-running so a stale
 * clean rate is never shown beside fresh results.
 */
const CLEARED_METRICS = {
  totalMistakes: 0,
  sentencesTotal: 0,
  sentencesClean: 0,
  sentencesFailed: 0,
  cleanSentenceRate: null,
  analysisState: 'none',
} as const;

export function registerAnalysisHandlers(mainWindow: BrowserWindow) {
  /** Progress + streaming callbacks, shared by every path that analyses. */
  function progressCallbacks(meetingId: string): Pick<
    AnalysisRunOptions,
    'onLineProgress' | 'onBatchComplete' | 'onContextProgress'
  > {
    return {
      onLineProgress: (current, total) => {
        mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
          stage: 'analyzing',
          current,
          total,
          message: `Analyzing batch ${current} of ${total}...`,
        });
      },
      onBatchComplete: (mistakes, batchIndex, totalBatches, done) => {
        const event: AnalysisBatchEvent = { meetingId, mistakes, batchIndex, totalBatches, done };
        mainWindow.webContents.send(IPC_CHANNELS.ANALYSIS_BATCH_READY, event);
      },
      onContextProgress: (type, done) => {
        mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
          stage: 'context-analyzing',
          current: done ? 1 : 0,
          total: 1,
          message: done ? `${type} complete` : `Running ${type}...`,
        });
      },
    };
  }

  async function loadSegments(meetingId: string): Promise<TranscriptSegment[]> {
    const db = getDb();
    return db.select().from(dbSchema.transcriptSegments)
      .where(eq(dbSchema.transcriptSegments.meetingId, meetingId))
      .orderBy(dbSchema.transcriptSegments.segmentIndex)
      .all();
  }

  /**
   * The options for a full run. Which analyses run and how strictly depends on
   * the recording's own mode, so a solo practice session is judged by the solo
   * standard even if the default has since changed.
   */
  async function runOptions(meetingId: string): Promise<AnalysisRunOptions> {
    const settings = await getSettings();
    const meeting = await getDb().select({
      recordingMode: dbSchema.meetings.recordingMode,
      grammarMode: dbSchema.meetings.grammarMode,
    })
      .from(dbSchema.meetings)
      .where(eq(dbSchema.meetings.id, meetingId))
      .get();

    const recordingMode = meeting?.recordingMode ?? 'meeting';
    const { lineByLine, contextTypes } = analysesFor(settings, recordingMode);

    return {
      modelName: settings.ollamaModel,
      // The standard stamped on the recording wins; fall back to the setting.
      mode: meeting?.grammarMode ?? grammarModeFor(settings, recordingMode),
      lineByLine,
      contextTypes,
      ...progressCallbacks(meetingId),
    };
  }

  ipcMain.handle(
    IPC_CHANNELS.ANALYZE_TRANSCRIPT,
    async (_event, meetingId: string, segments: TranscriptSegment[]) => {
      const opts = await runOptions(meetingId);
      if (!opts.lineByLine) return [];
      const result = await runAnalysis(meetingId, segments, { ...opts, contextTypes: [] });
      return result.mistakes;
    }
  );

  // Full pipeline: transcribe + analyze
  ipcMain.handle(
    IPC_CHANNELS.PROCESS_MEETING,
    async (_event, meetingId: string, chunkPaths?: string[]) => {
      // Called from the renderer after recording stops: convert -> transcribe -> analyze
      const { convertToWav, getChunkPaths, getWavDurationSeconds } = await import('../services/audio.service');
      const { transcribeWav } = await import('../services/whisper.service');
      const { v4: uuidv4 } = await import('uuid');

      const settings = await getSettings();
      const db = getDb();
      const allSegments: TranscriptSegment[] = [];
      let globalSegmentIndex = 0;

      const meetingRow = await db.select({ recordingMode: dbSchema.meetings.recordingMode })
        .from(dbSchema.meetings)
        .where(eq(dbSchema.meetings.id, meetingId))
        .get();
      const isSolo = meetingRow?.recordingMode === 'solo';

      // Solo recordings have one unprefixed track; meetings have a mixed track
      // for playback plus a 'mic_' track that is the only thing analysed.
      const paths = chunkPaths && chunkPaths.length > 0
        ? chunkPaths
        : getChunkPaths(meetingId, isSolo ? undefined : 'mic');

      if (paths.length === 0) {
        // Fallback to regular chunks for backward compatibility
        const fallbackPaths = getChunkPaths(meetingId);
        if (fallbackPaths.length === 0) {
          throw new Error('No audio chunks found for this meeting. The recording may not have been saved properly.');
        }
        paths.push(...fallbackPaths);
      }

      // Phase 1: Transcription. Clear anything from a previous (failed or
      // unsatisfactory) run first so this handler doubles as "retranscribe".
      await db.delete(dbSchema.mistakes).where(eq(dbSchema.mistakes.meetingId, meetingId));
      await db.delete(dbSchema.meetingAnalyses).where(eq(dbSchema.meetingAnalyses.meetingId, meetingId));
      await db.delete(dbSchema.transcriptSegments).where(eq(dbSchema.transcriptSegments.meetingId, meetingId));
      await db.update(dbSchema.meetings)
        .set({ status: 'transcribing', totalSegments: 0, transcript: null, ...CLEARED_METRICS })
        .where(eq(dbSchema.meetings.id, meetingId));

      const language = settings.transcriptionLanguage;

      const transcribePaths = async (chunkList: string[]) => {
        // Timestamps accumulate from measured chunk lengths — the configured
        // chunk duration is only a target and real chunks drift from it.
        let cumulativeOffset = 0;

        for (let i = 0; i < chunkList.length; i++) {
          mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
            stage: 'transcribing',
            current: i + 1,
            total: chunkList.length,
            message: `Converting and transcribing chunk ${i + 1} of ${chunkList.length}...`,
          });

          const chunkOffset = cumulativeOffset;
          // Retry once per chunk — transient ffmpeg/whisper failures are common
          let segments: Awaited<ReturnType<typeof transcribeWav>> = [];
          let translated: typeof segments = [];
          let chunkDuration: number | null = null;
          for (let attempt = 1; ; attempt++) {
            try {
              const wavPath = await convertToWav(chunkList[i]);
              segments = await transcribeWav(wavPath, settings.whisperModel, language);
              if (language !== 'en') {
                translated = await transcribeWav(wavPath, settings.whisperModel, language, true);
              }
              chunkDuration = getWavDurationSeconds(wavPath);
              break;
            } catch (err: any) {
              if (attempt >= 2) {
                throw new Error(`Chunk ${i + 1} of ${chunkList.length} failed: ${err?.message || err}`);
              }
              console.warn(`Chunk ${i + 1} failed (attempt ${attempt}), retrying:`, err?.message);
            }
          }

          for (let s = 0; s < segments.length; s++) {
            const seg = segments[s];
            const segment: TranscriptSegment = {
              id: uuidv4(),
              meetingId,
              chunkIndex: i,
              segmentIndex: globalSegmentIndex++,
              startTime: seg.startTime + chunkOffset,
              endTime: seg.endTime + chunkOffset,
              text: seg.text,
              translatedText: translated[s]?.text ?? null,
              confidence: seg.confidence,
            };
            await db.insert(dbSchema.transcriptSegments).values(segment);
            allSegments.push(segment);
          }

          // Fall back to the last segment's end time if the header was unreadable.
          cumulativeOffset += chunkDuration
            ?? (segments.length > 0 ? segments[segments.length - 1].endTime : settings.chunkDurationSeconds);
        }
      };

      try {
        await transcribePaths(paths);

        // The mic-only track can come out silent (wrong input device, mic
        // captured nothing) while the mixed track still has audio — fall back to
        // it. Solo recordings have no second track to fall back to.
        if (allSegments.length === 0 && !isSolo && !(chunkPaths && chunkPaths.length > 0)) {
          const mixedPaths = getChunkPaths(meetingId);
          if (mixedPaths.length > 0 && mixedPaths.join() !== paths.join()) {
            console.warn('Mic-only track had no speech; falling back to the mixed recording');
            globalSegmentIndex = 0;
            await transcribePaths(mixedPaths);
          }
        }

        if (allSegments.length === 0) {
          throw new Error('No speech was detected in the recording. Check that the correct microphone is selected and the level meter moves while you speak, then record again.');
        }
      } catch (err) {
        await db.update(dbSchema.meetings)
          .set({ status: 'failed' })
          .where(eq(dbSchema.meetings.id, meetingId));
        throw err;
      }

      // Sentences are derived once here, right after transcription, so the
      // transcript and the clean-rate denominator exist even if analysis never
      // runs or is stopped partway.
      const derived = await deriveSentences(meetingId, allSegments);

      const opts = await runOptions(meetingId);
      const hasAnyAnalysis = opts.lineByLine || opts.contextTypes.length > 0;

      // Update segment count and set status
      await db.update(dbSchema.meetings)
        .set({
          totalSegments: allSegments.length,
          sentencesTotal: derived.filter(s => s.countsTowardRate).length,
          transcript: buildTranscriptParagraphs(allSegments),
          status: hasAnyAnalysis ? 'analyzing' : 'completed',
          ...(!hasAnyAnalysis ? { endedAt: Date.now() } : {}),
        })
        .where(eq(dbSchema.meetings.id, meetingId));

      if (!hasAnyAnalysis) {
        return { segments: allSegments, mistakes: [] };
      }

      // Phases 2 and 3: line-by-line, then context analyses
      const result = await runAnalysis(meetingId, allSegments, opts);
      return { segments: allSegments, mistakes: result.mistakes };
    }
  );

  // Re-analyze: clear old line-by-line mistakes, re-run line-by-line grammar analysis only.
  // Context analyses (grammar_full, summary, etc.) have their own Re-run buttons on their tabs.
  ipcMain.handle(
    IPC_CHANNELS.RE_ANALYZE_MEETING,
    async (_event, meetingId: string) => {
      const db = getDb();
      const segments = await loadSegments(meetingId);

      if (segments.length === 0) {
        throw new Error('No transcript segments found. The meeting must be transcribed first.');
      }

      await db.update(dbSchema.meetings)
        .set({ status: 'analyzing', ...CLEARED_METRICS })
        .where(eq(dbSchema.meetings.id, meetingId));
      await db.delete(dbSchema.mistakes).where(eq(dbSchema.mistakes.meetingId, meetingId));

      const opts = await runOptions(meetingId);
      const result = await runAnalysis(meetingId, segments, {
        ...opts,
        lineByLine: true,
        contextTypes: [],
      });
      return result.mistakes;
    }
  );

  // Run only context analyses (without re-transcribing or re-running line-by-line)
  ipcMain.handle(
    IPC_CHANNELS.RUN_CONTEXT_ANALYSES,
    async (_event, meetingId: string) => {
      const segments = await loadSegments(meetingId);
      if (segments.length === 0) throw new Error('No transcript segments found.');

      const opts = await runOptions(meetingId);
      const { results } = await runContextAnalyses(
        meetingId,
        segments,
        opts.modelName,
        opts.contextTypes,
        opts.mode,
        opts.onContextProgress
      );
      return results;
    }
  );

  // Run a single context analysis type
  ipcMain.handle(
    IPC_CHANNELS.RUN_SINGLE_CONTEXT_ANALYSIS,
    async (_event, meetingId: string, type: string) => {
      const segments = await loadSegments(meetingId);
      if (segments.length === 0) throw new Error('No transcript segments found.');

      const opts = await runOptions(meetingId);
      const validType = type as ContextAnalysisType;

      const { results, failedTypes } = await runContextAnalyses(
        meetingId,
        segments,
        opts.modelName,
        [validType],
        opts.mode,
        opts.onContextProgress
      );

      // Surface the failure instead of returning null, which the tab would
      // render as "nothing found".
      if (failedTypes.length > 0) {
        throw new Error(`${validType} analysis could not be completed. Check that Ollama is running, then try again.`);
      }

      return results[0] ?? null;
    }
  );

  // Re-check only the sentences that were never successfully analysed, so a
  // recovered Ollama does not mean re-running the whole recording.
  ipcMain.handle(
    IPC_CHANNELS.RETRY_FAILED_SENTENCES,
    async (_event, meetingId: string) => {
      const opts = await runOptions(meetingId);
      const result = await retryFailedSentences(meetingId, { ...opts, lineByLine: true, contextTypes: [] });
      return result.mistakes;
    }
  );

  // Stop ongoing analysis — sets cancellation flag and updates status to 'transcribed'
  ipcMain.handle(
    IPC_CHANNELS.STOP_ANALYSIS,
    async (_event, meetingId: string) => {
      cancelAnalysis(meetingId);
      const db = getDb();
      await db.update(dbSchema.meetings)
        .set({ status: 'transcribed' })
        .where(eq(dbSchema.meetings.id, meetingId));
    }
  );

  // Start analysis on a meeting that has transcription but analysis was stopped or never ran
  ipcMain.handle(
    IPC_CHANNELS.START_ANALYSIS,
    async (_event, meetingId: string) => {
      const db = getDb();
      const segments = await loadSegments(meetingId);

      if (segments.length === 0) {
        throw new Error('No transcript segments found. The meeting must be transcribed first.');
      }

      // Delete any existing partial mistakes
      await db.delete(dbSchema.mistakes).where(eq(dbSchema.mistakes.meetingId, meetingId));

      const opts = await runOptions(meetingId);
      const hasAnyAnalysis = opts.lineByLine || opts.contextTypes.length > 0;

      await db.update(dbSchema.meetings)
        .set({
          status: hasAnyAnalysis ? 'analyzing' : 'completed',
          ...CLEARED_METRICS,
        })
        .where(eq(dbSchema.meetings.id, meetingId));

      if (!hasAnyAnalysis) return [];

      const result = await runAnalysis(meetingId, segments, opts);
      return result.mistakes;
    }
  );
}
