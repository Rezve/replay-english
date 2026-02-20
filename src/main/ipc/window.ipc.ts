import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';

export function registerWindowHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => mainWindow.minimize());
  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => mainWindow.close());
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => mainWindow.isMaximized());
}
