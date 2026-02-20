import { ipcMain } from 'electron';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import { IPC_CHANNELS, DEFAULT_SETTINGS } from '../../shared/constants';
import type { AppSettings } from '../../shared/types';

export function registerSettingsHandlers() {
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
    const db = getDb();
    const rows = await db.select().from(schema.settings).all();

    const settingsMap: Record<string, string> = {};
    for (const row of rows) {
      settingsMap[row.key] = row.value;
    }

    return {
      whisperModel: settingsMap['whisperModel'] || DEFAULT_SETTINGS.whisperModel,
      ollamaModel: settingsMap['ollamaModel'] || DEFAULT_SETTINGS.ollamaModel,
      transcriptionLanguage: settingsMap['transcriptionLanguage'] || DEFAULT_SETTINGS.transcriptionLanguage,
      chunkDurationSeconds: parseInt(settingsMap['chunkDurationSeconds'] || String(DEFAULT_SETTINGS.chunkDurationSeconds), 10),
      dataPath: settingsMap['dataPath'] || '',
      analysisLineByLine: settingsMap['analysisLineByLine'] !== 'false',
      analysisGrammarFull: settingsMap['analysisGrammarFull'] !== 'false',
      analysisSummary: settingsMap['analysisSummary'] !== 'false',
      analysisActionItems: settingsMap['analysisActionItems'] !== 'false',
      analysisVocabulary: settingsMap['analysisVocabulary'] !== 'false',
      analysisFluency: settingsMap['analysisFluency'] !== 'false',
      grammarMode: (settingsMap['grammarMode'] === 'conversational' ? 'conversational' : 'professional') as AppSettings['grammarMode'],
    } as AppSettings;
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, async (_event, updates: Partial<AppSettings>) => {
    const db = getDb();
    for (const [key, value] of Object.entries(updates)) {
      const stringValue = String(value);
      const existing = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
      if (existing) {
        await db.update(schema.settings).set({ value: stringValue }).where(eq(schema.settings.key, key));
      } else {
        await db.insert(schema.settings).values({ key, value: stringValue });
      }
    }
  });
}
