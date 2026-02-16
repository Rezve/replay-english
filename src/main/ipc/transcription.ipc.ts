import { ipcMain, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { IPC_CHANNELS } from '../../shared/constants';
import { transcribeWav } from '../services/whisper.service';
import { convertToWav } from '../services/audio.service';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import type { TranscriptSegment } from '../../shared/types';

export function registerTranscriptionHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle(
    IPC_CHANNELS.TRANSCRIBE_CHUNK,
    async (_event, wavPath: string): Promise<TranscriptSegment[]> => {
      const segments = await transcribeWav(wavPath);
      return segments.map((seg, index) => ({
        id: uuidv4(),
        meetingId: '',
        chunkIndex: 0,
        segmentIndex: index,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: seg.text,
        confidence: seg.confidence,
      }));
    }
  );

  // Full pipeline: convert all chunks and transcribe
  ipcMain.handle(
    'pipeline:transcribe-meeting',
    async (_event, meetingId: string, chunkPaths: string[]) => {
      const db = getDb();
      const allSegments: TranscriptSegment[] = [];
      let globalSegmentIndex = 0;

      for (let chunkIndex = 0; chunkIndex < chunkPaths.length; chunkIndex++) {
        // Send progress
        mainWindow.webContents.send(IPC_CHANNELS.PROGRESS, {
          stage: 'transcribing',
          current: chunkIndex + 1,
          total: chunkPaths.length,
          message: `Transcribing chunk ${chunkIndex + 1} of ${chunkPaths.length}...`,
        });

        // Convert to WAV
        const wavPath = await convertToWav(chunkPaths[chunkIndex]);

        // Transcribe
        const chunkOffset = chunkIndex * 300; // 5 min offset per chunk
        const segments = await transcribeWav(wavPath);

        // Save segments to DB
        for (const seg of segments) {
          const segment: TranscriptSegment = {
            id: uuidv4(),
            meetingId,
            chunkIndex,
            segmentIndex: globalSegmentIndex++,
            startTime: seg.startTime + chunkOffset,
            endTime: seg.endTime + chunkOffset,
            text: seg.text,
            confidence: seg.confidence,
          };
          await db.insert(schema.transcriptSegments).values(segment);
          allSegments.push(segment);
        }
      }

      // Update meeting segment count
      await db.update(schema.meetings)
        .set({ totalSegments: allSegments.length })
        .where(eq(schema.meetings.id, meetingId));

      return allSegments;
    }
  );
}
