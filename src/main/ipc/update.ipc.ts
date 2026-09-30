import { app, ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { initAutoUpdater, checkForUpdates, installUpdate, getUpdateStatus } from '../services/update.service';

export function registerUpdateHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.GET_APP_VERSION, () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS.CHECK_FOR_UPDATES, () => checkForUpdates());
  ipcMain.handle(IPC_CHANNELS.INSTALL_UPDATE, () => installUpdate());
  ipcMain.handle(IPC_CHANNELS.GET_UPDATE_STATUS, () => getUpdateStatus());

  // Start checking once the UI can receive status events.
  mainWindow.webContents.once('did-finish-load', () => initAutoUpdater(mainWindow));
}
