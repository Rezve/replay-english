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
import {
  transcribeChunks,
  cancelTranscription,
  loadTranscriptChunks,
  loadSegments,
  ChunkTranscriptionError,
  type ChunkTranscriber,
  type TranscribeChunksResult,
} from '../services/transcription.service';
import { buildTranscriptParagraphs } from '../../shared/transcript';
import { dropHallucinations } from '../../shared/hallucinations';
import type { TranscriptSegment, AnalysisBatchEvent, TranscriptChunkEvent, ContextAnalysisType, ProcessMeetingOptions } from '../../shared/types';

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

  // Full pipeline: transcribe + analyze. Also serves "retranscribe" (optionally
  // with another whisper model) and "resume", which keeps the chunks already
  // transcribed and redoes only the failed or unreached ones.
  async function processMeeting(meetingId: string, options: ProcessMeetingOptions) {
    const { convertToWav, getChunkPaths, getWavDurationSeconds } = await import('../services/audio.service');
    const {
      transcribeWav,
      isModelAvailable,
      isWhisperAvailable,
      getWhisperBinaryPath,
      ensureVadModel,
    } = await import('../services/whisper.service');

    const settings = await getSettings();
    const db = getDb();
    const whisperModel = options.whisperModel || settings.whisperModel;
    const resume = !!options.resume;
    const language = settings.transcriptionLanguage;

    // Checked before anything is cleared: a missing model used to wipe a
    // good transcript and then fail every chunk.
    if (!isWhisperAvailable()) {
      throw new Error(`Whisper binary not found at: ${getWhisperBinaryPath()}`);
    }
    if (!isModelAvailable(whisperModel)) {
      throw new Error(`Whisper model ${whisperModel} is not downloaded. Download it from the Setup page first.`);
    }

    const meetingRow = await db.select({ recordingMode: dbSchema.meetings.recordingMode })
      .from(dbSchema.meetings)
      .where(eq(dbSchema.meetings.id, meetingId))
      .get();
    const isSolo = meetingRow?.recordingMode === 'solo';

    // Solo recordings have one unprefixed track; meetings have a mixed track
    // for playback plus a 'mic_' track that is the only thing analysed. A
    // resume stays on whichever track the transcript was started from.
    const existingChunks = resume ? await loadTranscriptChunks(meetingId) : [];
    const startedOnMixed = !isSolo && existingChunks.length > 0 && !existingChunks[0].sourceFile.startsWith('mic_');
    let paths = getChunkPaths(meetingId, isSolo || startedOnMixed ? undefined : 'mic');
    if (paths.length === 0) {
      // Fallback to regular chunks for backward compatibility
      paths = getChunkPaths(meetingId);
    }
    if (paths.length === 0) {
      throw new Error('No audio chunks found for this meeting. The recording may not have been saved properly.');
    }

    // Analysis results describe the old transcript, which is about to change.
    await db.delete(dbSchema.mistakes).where(eq(dbSchema.mistakes.meetingId, meetingId));
    await db.delete(dbSchema.meetingAnalyses).where(eq(dbSchema.meetingAnalyses.meetingId, meetingId));
    await db.delete(dbSchema.sentences).where(eq(dbSchema.sentences.meetingId, meetingId));
    await db.update(dbSchema.meetings)
      .set({ status: 'transcribing', totalSegments: 0, transcript: null, ...CLEARED_METRICS })
      .where(eq(dbSchema.meetings.id, meetingId));

    // Without VAD, silence comes back as walls of "You". Best effort: a
    // failed download still transcribes, and dropHallucinations still runs.
    await ensureVadModel();

    const transcribe: ChunkTranscriber = async (chunkPath, signal) => {
      const wavPath = await convertToWav(chunkPath, signal);
      const durationSeconds = getWavDurationSeconds(wavPath);
      // Larger models on CPU run slower than real time; a flat 10 minutes
      // failed long chunks that were still making progress.
      // Rounded: the measured duration is fractional, and execFile rejects a
      // non-integer timeout before whisper even starts.
      const timeoutMs = Math.max(10 * 60_000, Math.ceil((durationSeconds ?? settings.chunkDurationSeconds) * 6_000));
      try {
        const segments = await transcribeWav(wavPath, whisperModel, language, false, timeoutMs, signal);
        const translated = language !== 'en'
          ? await transcribeWav(wavPath, whisperModel, language, true, timeoutMs, signal)
          : [];
        // Filtered after pairing, so a dropped line takes its translation with it.
        const paired = segments.map((seg, s) => ({ ...seg, translatedText: translated[s]?.text ?? null }));
        return { segments: dropHallucinations(paired), durationSeconds };
      } catch (err: any) {
        throw new ChunkTranscriptionError(err?.message || String(err), durationSeconds);
      }
    };

    const runChunks = (chunkList: string[], resumeRun: boolean) =>
      transcribeChunks(meetingId, chunkList, {
        whisperModel,
        resume: resumeRun,
        transcribe,
        fallbackChunkSeconds: settings.chunkDurationSeconds,
        onProgress: (done, total, chunkIndex) => {
          mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
            stage: 'transcribing',
            current: done,
            total,
            message: total < chunkList.length
              ? `Transcribing part ${chunkIndex + 1} of ${chunkList.length} (${done} of ${total} remaining)...`
              : `Transcribing part ${chunkIndex + 1} of ${chunkList.length}...`,
          });
        },
        onChunkDone: (chunk, done, total) => {
          const event: TranscriptChunkEvent = { meetingId, chunk, done, total };
          mainWindow.webContents.send(IPC_CHANNELS.TRANSCRIPT_CHUNK_READY, event);
        },
      });

    let outcome: TranscribeChunksResult;
    try {
      outcome = await runChunks(paths, resume);

      // Stopped by the user. Not an error: park the meeting where Retry or
      // another model can resume it, with the parts done so far readable.
      if (outcome.cancelled) {
        await db.update(dbSchema.meetings)
          .set({
            status: 'failed',
            totalSegments: outcome.segments.length,
            transcript: outcome.segments.length > 0 ? buildTranscriptParagraphs(outcome.segments) : null,
          })
          .where(eq(dbSchema.meetings.id, meetingId));
        return { segments: outcome.segments, mistakes: [], cancelled: true };
      }

      // The mic-only track can come out silent (wrong input device, mic
      // captured nothing) while the mixed track still has audio — fall back
      // to it. Only when every chunk succeeded: a failure is not silence.
      // Solo recordings have no second track to fall back to.
      const silent = outcome.segments.length === 0 && outcome.chunks.every(c => c.status === 'ok');
      if (silent && !isSolo && !startedOnMixed) {
        const mixedPaths = getChunkPaths(meetingId);
        if (mixedPaths.length > 0 && mixedPaths.join() !== paths.join()) {
          console.warn('Mic-only track had no speech; falling back to the mixed recording');
          outcome = await runChunks(mixedPaths, false);
          if (outcome.cancelled) {
            await db.update(dbSchema.meetings)
              .set({ status: 'failed' })
              .where(eq(dbSchema.meetings.id, meetingId));
            return { segments: outcome.segments, mistakes: [], cancelled: true };
          }
        }
      }

      if (outcome.segments.length === 0) {
        const failed = outcome.chunks.filter(c => c.status === 'failed');
        throw new Error(failed.length > 0
          ? `None of the ${outcome.chunks.length} parts could be transcribed. ${failed[0].errorMessage ?? ''}`.trim()
          : 'No speech was detected in the recording. Check that the correct microphone is selected and the level meter moves while you speak, then record again.');
      }
    } catch (err) {
      await db.update(dbSchema.meetings)
        .set({ status: 'failed' })
        .where(eq(dbSchema.meetings.id, meetingId));
      throw err;
    }

    // Some parts failing is not fatal: the rest is analysed, and the report
    // offers to retry just those parts from their transcript_chunks rows.
    const allSegments = outcome.segments;

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

  // One run per meeting. Reopening a report whose meeting is still
  // 'transcribing' auto-starts processing; without this it started a second
  // run beside the first, and both transcribed the same unfinished chunk.
  const inFlight = new Map<string, ReturnType<typeof processMeeting>>();

  ipcMain.handle(
    IPC_CHANNELS.PROCESS_MEETING,
    (_event, meetingId: string, options: ProcessMeetingOptions = {}) => {
      const running = inFlight.get(meetingId);
      if (running) return running;
      const run = processMeeting(meetingId, options).finally(() => inFlight.delete(meetingId));
      inFlight.set(meetingId, run);
      return run;
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

  // Stop transcription. The run itself parks the meeting once whisper dies;
  // with no run in this process (a stale 'transcribing' left by a crash), park
  // it here so the report offers Retry instead of spinning forever.
  ipcMain.handle(
    IPC_CHANNELS.STOP_TRANSCRIPTION,
    async (_event, meetingId: string) => {
      if (cancelTranscription(meetingId)) return;
      await getDb().update(dbSchema.meetings)
        .set({ status: 'failed' })
        .where(eq(dbSchema.meetings.id, meetingId));
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
