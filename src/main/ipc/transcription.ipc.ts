import { ipcMain, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { IPC_CHANNELS, DEFAULT_SETTINGS } from '../../shared/constants';
import { transcribeWav } from '../services/whisper.service';
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

export function registerTranscriptionHandlers(_mainWindow: BrowserWindow) {
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
}
