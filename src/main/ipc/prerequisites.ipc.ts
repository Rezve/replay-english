import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, DEFAULT_SETTINGS } from '../../shared/constants';
import { checkPrerequisites, checkModelStatus } from '../services/prerequisites.service';
import { downloadModel, downloadWhisperBinary, checkGpu, listDownloadedModels } from '../services/whisper.service';
import { pullModel } from '../services/ollama.service';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import type { WhisperBinaryVariant } from '../../shared/types';

function sendDownloadProgress(mainWindow: BrowserWindow, downloaded: number, total: number) {
  const percentage = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  mainWindow.webContents.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, {
    downloaded,
    total,
    percentage,
  });
}

async function getSettingsModels(): Promise<{ whisperModel: string; ollamaModel: string }> {
  const db = getDb();
  const rows = await db.select().from(schema.settings).all();
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return {
    whisperModel: map['whisperModel'] || DEFAULT_SETTINGS.whisperModel,
    ollamaModel: map['ollamaModel'] || DEFAULT_SETTINGS.ollamaModel,
  };
}

export function registerPrerequisitesHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle(IPC_CHANNELS.CHECK_PREREQUISITES, async () => {
    const { whisperModel, ollamaModel } = await getSettingsModels();
    return await checkPrerequisites(whisperModel, ollamaModel);
  });

  ipcMain.handle(
    IPC_CHANNELS.CHECK_MODEL_STATUS,
    async (_event, whisperModel: string, ollamaModel: string) => {
      return await checkModelStatus(whisperModel, ollamaModel);
    }
  );

  ipcMain.handle(IPC_CHANNELS.LIST_WHISPER_MODELS, () => listDownloadedModels());

  ipcMain.handle(IPC_CHANNELS.CHECK_GPU, async () => {
    return await checkGpu();
  });

  ipcMain.handle(
    IPC_CHANNELS.DOWNLOAD_WHISPER_MODEL,
    async (_event, modelName?: string) => {
      const finalModel = modelName || (await getSettingsModels()).whisperModel;
      return await downloadModel(finalModel, (downloaded, total) => {
        sendDownloadProgress(mainWindow, downloaded, total);
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.DOWNLOAD_WHISPER_BINARY,
    async (_event, variant: WhisperBinaryVariant) => {
      return await downloadWhisperBinary(variant, (downloaded, total) => {
        sendDownloadProgress(mainWindow, downloaded, total);
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PULL_OLLAMA_MODEL,
    async (_event, modelName: string) => {
      return await pullModel(modelName);
    }
  );
}
