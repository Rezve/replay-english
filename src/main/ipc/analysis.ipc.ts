import { ipcMain, BrowserWindow } from 'electron';
import { eq } from 'drizzle-orm';
import { IPC_CHANNELS, DEFAULT_SETTINGS } from '../../shared/constants';
import { getDb } from '../db/connection';
import * as dbSchema from '../db/schema';
import { analyzeTranscript } from '../services/analysis.service';
import type { TranscriptSegment, AnalysisBatchEvent } from '../../shared/types';

async function getSettingsModels(): Promise<{ whisperModel: string; ollamaModel: string }> {
  const db = getDb();
  const rows = await db.select().from(dbSchema.settings).all();
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return {
    whisperModel: map['whisperModel'] || DEFAULT_SETTINGS.whisperModel,
    ollamaModel: map['ollamaModel'] || DEFAULT_SETTINGS.ollamaModel,
  };
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

      const { whisperModel, ollamaModel: pipelineOllamaModel } = await getSettingsModels();
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
      const { ollamaModel: reAnalyzeModel } = await getSettingsModels();
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

      return mistakes;
    }
  );
}
