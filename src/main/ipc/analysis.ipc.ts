import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { analyzeTranscript } from '../services/analysis.service';
import type { TranscriptSegment } from '../../shared/types';

export function registerAnalysisHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle(
    IPC_CHANNELS.ANALYZE_TRANSCRIPT,
    async (_event, meetingId: string, segments: TranscriptSegment[]) => {
      return await analyzeTranscript(
        meetingId,
        segments,
        'qwen2.5:7b',
        (current, total) => {
          mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
            stage: 'analyzing',
            current,
            total,
            message: `Analyzing batch ${current} of ${total}...`,
          });
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
      const dbSchema = await import('../db/schema');

      const db = getDb();
      const allSegments: TranscriptSegment[] = [];
      let globalSegmentIndex = 0;

      // Get chunk paths automatically if not provided
      const paths = chunkPaths && chunkPaths.length > 0 ? chunkPaths : getChunkPaths(meetingId);

      if (paths.length === 0) {
        throw new Error('No audio chunks found for this meeting. The recording may not have been saved properly.');
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
        const segments = await transcribeWav(wavPath);

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
          await db.insert(dbSchema.transcriptSegments).values(segment);
          allSegments.push(segment);
        }
      }

      // Update segment count
      await db.update(dbSchema.meetings)
        .set({ totalSegments: allSegments.length, status: 'analyzing' })
        .where(require('drizzle-orm').eq(dbSchema.meetings.id, meetingId));

      // Phase 2: Analysis
      const mistakes = await analyzeTranscript(
        meetingId,
        allSegments,
        'qwen2.5:7b',
        (current, total) => {
          mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
            stage: 'analyzing',
            current,
            total,
            message: `Analyzing batch ${current} of ${total}...`,
          });
        }
      );

      return { segments: allSegments, mistakes };
    }
  );
}
