import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { checkPrerequisites } from '../services/prerequisites.service';
import { downloadModel, downloadWhisperBinary, checkGpu } from '../services/whisper.service';
import type { WhisperBinaryVariant } from '../../shared/types';

function sendDownloadProgress(mainWindow: BrowserWindow, downloaded: number, total: number) {
  const percentage = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  mainWindow.webContents.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, {
    downloaded,
    total,
    percentage,
  });
}

export function registerPrerequisitesHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle(IPC_CHANNELS.CHECK_PREREQUISITES, async () => {
    return await checkPrerequisites();
  });

  ipcMain.handle(IPC_CHANNELS.CHECK_GPU, async () => {
    return await checkGpu();
  });

  ipcMain.handle(
    IPC_CHANNELS.DOWNLOAD_WHISPER_MODEL,
    async (_event, modelName?: string) => {
      return await downloadModel(modelName || 'ggml-base.en.bin', (downloaded, total) => {
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
}
