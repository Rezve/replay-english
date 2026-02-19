import { ipcMain, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { IPC_CHANNELS, DEFAULT_SETTINGS } from '../../shared/constants';
import { transcribeWav } from '../services/whisper.service';
import { convertToWav } from '../services/audio.service';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import type { TranscriptSegment } from '../../shared/types';

async function getWhisperModel(): Promise<string> {
  const db = getDb();
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, 'whisperModel')).get();
  return row?.value || DEFAULT_SETTINGS.whisperModel;
}

async function getTranscriptionLanguage(): Promise<string> {
  const db = getDb();
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, 'transcriptionLanguage')).get();
  return row?.value || DEFAULT_SETTINGS.transcriptionLanguage;
}

export function registerTranscriptionHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle(
    IPC_CHANNELS.TRANSCRIBE_CHUNK,
    async (_event, wavPath: string): Promise<TranscriptSegment[]> => {
      const whisperModel = await getWhisperModel();
      const language = await getTranscriptionLanguage();
      const segments = await transcribeWav(wavPath, whisperModel, language);
      let translatedSegments: Awaited<ReturnType<typeof transcribeWav>> = [];
      if (language !== 'en') {
        translatedSegments = await transcribeWav(wavPath, whisperModel, language, true);
      }
      return segments.map((seg, index) => ({
        id: uuidv4(),
        meetingId: '',
        chunkIndex: 0,
        segmentIndex: index,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: seg.text,
        translatedText: translatedSegments[index]?.text ?? null,
        confidence: seg.confidence,
      }));
    }
  );

  // Full pipeline: convert all chunks and transcribe
  ipcMain.handle(
    'pipeline:transcribe-meeting',
    async (_event, meetingId: string, chunkPaths: string[]) => {
      const db = getDb();
      const whisperModel = await getWhisperModel();
      const language = await getTranscriptionLanguage();
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
        const segments = await transcribeWav(wavPath, whisperModel, language);
        let translatedSegments: Awaited<ReturnType<typeof transcribeWav>> = [];
        if (language !== 'en') {
          translatedSegments = await transcribeWav(wavPath, whisperModel, language, true);
        }

        // Save segments to DB
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const segment: TranscriptSegment = {
            id: uuidv4(),
            meetingId,
            chunkIndex,
            segmentIndex: globalSegmentIndex++,
            startTime: seg.startTime + chunkOffset,
            endTime: seg.endTime + chunkOffset,
            text: seg.text,
            translatedText: translatedSegments[i]?.text ?? null,
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
