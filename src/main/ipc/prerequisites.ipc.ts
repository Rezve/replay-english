import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { checkPrerequisites } from '../services/prerequisites.service';
import { downloadModel } from '../services/whisper.service';

export function registerPrerequisitesHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle(IPC_CHANNELS.CHECK_PREREQUISITES, async () => {
    return await checkPrerequisites();
  });

  ipcMain.handle(
    IPC_CHANNELS.DOWNLOAD_WHISPER_MODEL,
    async (_event, modelName?: string) => {
      return await downloadModel(modelName || 'ggml-base.en.bin', (downloaded, total) => {
        const percentage = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        mainWindow.webContents.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, {
          downloaded,
          total,
          percentage,
        });
      });
    }
  );
}
