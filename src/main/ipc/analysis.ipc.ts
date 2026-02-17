import { ipcMain, BrowserWindow } from 'electron';
import { eq } from 'drizzle-orm';
import { IPC_CHANNELS, DEFAULT_SETTINGS } from '../../shared/constants';
import { getDb } from '../db/connection';
import * as dbSchema from '../db/schema';
import { analyzeTranscript, runContextAnalyses, cancelAnalysis } from '../services/analysis.service';
import type { TranscriptSegment, AnalysisBatchEvent, ContextAnalysisType } from '../../shared/types';

async function getSettingsMap(): Promise<Record<string, string>> {
  const db = getDb();
  const rows = await db.select().from(dbSchema.settings).all();
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

async function getSettingsModels(): Promise<{ whisperModel: string; ollamaModel: string }> {
  const map = await getSettingsMap();
  return {
    whisperModel: map['whisperModel'] || DEFAULT_SETTINGS.whisperModel,
    ollamaModel: map['ollamaModel'] || DEFAULT_SETTINGS.ollamaModel,
  };
}

function getEnabledAnalysisTypes(settingsMap: Record<string, string>): ContextAnalysisType[] {
  const all: ContextAnalysisType[] = ['grammar_full', 'summary', 'action_items', 'vocabulary', 'fluency'];
  return all.filter(t => {
    const key = `analysis${t.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('')}`;
    return settingsMap[key] !== 'false';
  });
}

export function registerAnalysisHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle(
    IPC_CHANNELS.ANALYZE_TRANSCRIPT,
    async (_event, meetingId: string, segments: TranscriptSegment[]) => {
      const { ollamaModel } = await getSettingsModels();
      return await analyzeTranscript(
        meetingId,
        segments,
        ollamaModel,
        (current, total) => {
          mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
            stage: 'analyzing',
            current,
            total,
            message: `Analyzing batch ${current} of ${total}...`,
          });
        },
        (mistakes, batchIndex, totalBatches, done) => {
          const event: AnalysisBatchEvent = { meetingId, mistakes, batchIndex, totalBatches, done };
          mainWindow.webContents.send(IPC_CHANNELS.ANALYSIS_BATCH_READY, event);
        }
      );
    }
  );

  // Full pipeline: transcribe + analyze
  ipcMain.handle(
    'pipeline:process-meeting',
    async (_event, meetingId: string, chunkPaths?: string[]) => {
      // This will be called from the renderer after recording stops
      // It handles the full pipeline: convert -> transcribe -> analyze
      const { convertToWav, getChunkPaths } = await import('../services/audio.service');
      const { transcribeWav } = await import('../services/whisper.service');
      const { v4: uuidv4 } = await import('uuid');
      const { getDb } = await import('../db/connection');
      const pipelineSchema = await import('../db/schema');

      const settingsMap = await getSettingsMap();
      const whisperModel = settingsMap['whisperModel'] || DEFAULT_SETTINGS.whisperModel;
      const pipelineOllamaModel = settingsMap['ollamaModel'] || DEFAULT_SETTINGS.ollamaModel;
      const db = getDb();
      const allSegments: TranscriptSegment[] = [];
      let globalSegmentIndex = 0;

      // Get chunk paths automatically if not provided
      // Use mic-only chunks for grammar analysis (user's speech only)
      const paths = chunkPaths && chunkPaths.length > 0 ? chunkPaths : getChunkPaths(meetingId, 'mic');

      if (paths.length === 0) {
        // Fallback to regular chunks for backward compatibility
        const fallbackPaths = getChunkPaths(meetingId);
        if (fallbackPaths.length === 0) {
          throw new Error('No audio chunks found for this meeting. The recording may not have been saved properly.');
        }
        paths.push(...fallbackPaths);
      }

      // Phase 1: Transcription
      for (let i = 0; i < paths.length; i++) {
        mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
          stage: 'transcribing',
          current: i + 1,
          total: paths.length,
          message: `Converting and transcribing chunk ${i + 1} of ${paths.length}...`,
        });

        const wavPath = await convertToWav(paths[i]);
        const chunkOffset = i * 300;
        const segments = await transcribeWav(wavPath, whisperModel);

        for (const seg of segments) {
          const segment: TranscriptSegment = {
            id: uuidv4(),
            meetingId,
            chunkIndex: i,
            segmentIndex: globalSegmentIndex++,
            startTime: seg.startTime + chunkOffset,
            endTime: seg.endTime + chunkOffset,
            text: seg.text,
            confidence: seg.confidence,
          };
          await db.insert(pipelineSchema.transcriptSegments).values(segment);
          allSegments.push(segment);
        }
      }

      // Update segment count
      await db.update(pipelineSchema.meetings)
        .set({ totalSegments: allSegments.length, status: 'analyzing' })
        .where(require('drizzle-orm').eq(pipelineSchema.meetings.id, meetingId));

      // Phase 2: Analysis
      const mistakes = await analyzeTranscript(
        meetingId,
        allSegments,
        pipelineOllamaModel,
        (current, total) => {
          mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
            stage: 'analyzing',
            current,
            total,
            message: `Analyzing batch ${current} of ${total}...`,
          });
        },
        (batchMistakes, batchIndex, totalBatches, done) => {
          const event: AnalysisBatchEvent = { meetingId, mistakes: batchMistakes, batchIndex, totalBatches, done };
          mainWindow.webContents.send(IPC_CHANNELS.ANALYSIS_BATCH_READY, event);
        }
      );

      // Check if analysis was cancelled — if so, return early
      const { isAnalysisCancelled } = await import('../services/analysis.service');
      const meetingAfterAnalysis = await db.select().from(pipelineSchema.meetings).where(require('drizzle-orm').eq(pipelineSchema.meetings.id, meetingId)).get();
      if (meetingAfterAnalysis?.status === 'transcribed' || isAnalysisCancelled(meetingId)) {
        return { segments: allSegments, mistakes };
      }

      // Phase 3: Context analyses
      const enabledTypes = getEnabledAnalysisTypes(settingsMap);
      if (enabledTypes.length > 0) {
        await runContextAnalyses(
          meetingId,
          allSegments,
          pipelineOllamaModel,
          enabledTypes,
          (type, done) => {
            mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
              stage: 'context-analyzing',
              current: done ? 1 : 0,
              total: 1,
              message: done ? `${type} complete` : `Running ${type}...`,
            });
          }
        );
      }

      return { segments: allSegments, mistakes };
    }
  );

  // Re-analyze: clear old mistakes, re-run analysis on existing segments
  ipcMain.handle(
    IPC_CHANNELS.RE_ANALYZE_MEETING,
    async (_event, meetingId: string) => {
      const db = getDb();

      // Fetch existing segments
      const segments = await db.select().from(dbSchema.transcriptSegments)
        .where(eq(dbSchema.transcriptSegments.meetingId, meetingId))
        .orderBy(dbSchema.transcriptSegments.segmentIndex)
        .all();

      if (segments.length === 0) {
        throw new Error('No transcript segments found. The meeting must be transcribed first.');
      }

      // Delete old mistakes
      await db.delete(dbSchema.mistakes).where(eq(dbSchema.mistakes.meetingId, meetingId));

      // Set status to analyzing
      await db.update(dbSchema.meetings)
        .set({ status: 'analyzing', totalMistakes: 0, overallScore: null })
        .where(eq(dbSchema.meetings.id, meetingId));

      // Re-run analysis
      const settingsMap = await getSettingsMap();
      const reAnalyzeModel = settingsMap['ollamaModel'] || DEFAULT_SETTINGS.ollamaModel;
      const mistakes = await analyzeTranscript(
        meetingId,
        segments,
        reAnalyzeModel,
        (current, total) => {
          mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
            stage: 'analyzing',
            current,
            total,
            message: `Analyzing batch ${current} of ${total}...`,
          });
        },
        (batchMistakes, batchIndex, totalBatches, done) => {
          const event: AnalysisBatchEvent = { meetingId, mistakes: batchMistakes, batchIndex, totalBatches, done };
          mainWindow.webContents.send(IPC_CHANNELS.ANALYSIS_BATCH_READY, event);
        }
      );

      // Re-run context analyses
      const enabledTypes = getEnabledAnalysisTypes(settingsMap);
      if (enabledTypes.length > 0) {
        await runContextAnalyses(
          meetingId,
          segments,
          reAnalyzeModel,
          enabledTypes,
          (type, done) => {
            mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
              stage: 'context-analyzing',
              current: done ? 1 : 0,
              total: 1,
              message: done ? `${type} complete` : `Running ${type}...`,
            });
          }
        );
      }

      return mistakes;
    }
  );

  // Run only context analyses (without re-transcribing or re-running line-by-line)
  ipcMain.handle(
    IPC_CHANNELS.RUN_CONTEXT_ANALYSES,
    async (_event, meetingId: string) => {
      const db = getDb();

      const segments = await db.select().from(dbSchema.transcriptSegments)
        .where(eq(dbSchema.transcriptSegments.meetingId, meetingId))
        .orderBy(dbSchema.transcriptSegments.segmentIndex)
        .all();

      if (segments.length === 0) {
        throw new Error('No transcript segments found.');
      }

      const settingsMap = await getSettingsMap();
      const ollamaModel = settingsMap['ollamaModel'] || DEFAULT_SETTINGS.ollamaModel;
      const enabledTypes = getEnabledAnalysisTypes(settingsMap);

      return await runContextAnalyses(
        meetingId,
        segments,
        ollamaModel,
        enabledTypes,
        (type, done) => {
          mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
            stage: 'context-analyzing',
            current: done ? 1 : 0,
            total: 1,
            message: done ? `${type} complete` : `Running ${type}...`,
          });
        }
      );
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

      const segments = await db.select().from(dbSchema.transcriptSegments)
        .where(eq(dbSchema.transcriptSegments.meetingId, meetingId))
        .orderBy(dbSchema.transcriptSegments.segmentIndex)
        .all();

      if (segments.length === 0) {
        throw new Error('No transcript segments found. The meeting must be transcribed first.');
      }

      // Delete any existing partial mistakes
      await db.delete(dbSchema.mistakes).where(eq(dbSchema.mistakes.meetingId, meetingId));

      // Set status to analyzing
      await db.update(dbSchema.meetings)
        .set({ status: 'analyzing', totalMistakes: 0, overallScore: null })
        .where(eq(dbSchema.meetings.id, meetingId));

      const settingsMap = await getSettingsMap();
      const ollamaModel = settingsMap['ollamaModel'] || DEFAULT_SETTINGS.ollamaModel;

      const mistakes = await analyzeTranscript(
        meetingId,
        segments,
        ollamaModel,
        (current, total) => {
          mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
            stage: 'analyzing',
            current,
            total,
            message: `Analyzing batch ${current} of ${total}...`,
          });
        },
        (batchMistakes, batchIndex, totalBatches, done) => {
          const event: AnalysisBatchEvent = { meetingId, mistakes: batchMistakes, batchIndex, totalBatches, done };
          mainWindow.webContents.send(IPC_CHANNELS.ANALYSIS_BATCH_READY, event);
        }
      );

      // If analysis was cancelled mid-way, don't run context analyses
      const meeting = await db.select().from(dbSchema.meetings).where(eq(dbSchema.meetings.id, meetingId)).get();
      if (meeting?.status !== 'analyzing') {
        return mistakes;
      }

      // Run context analyses
      const enabledTypes = getEnabledAnalysisTypes(settingsMap);
      if (enabledTypes.length > 0) {
        await runContextAnalyses(
          meetingId,
          segments,
          ollamaModel,
          enabledTypes,
          (type, done) => {
            mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
              stage: 'context-analyzing',
              current: done ? 1 : 0,
              total: 1,
              message: done ? `${type} complete` : `Running ${type}...`,
            });
          }
        );
      }

      return mistakes;
    }
  );
}
