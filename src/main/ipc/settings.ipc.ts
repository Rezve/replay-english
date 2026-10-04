import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getSettings, updateSettings } from '../services/settings.service';
import type { AppSettings } from '../../shared/types';

export function registerSettingsHandlers() {
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => getSettings());

  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, async (_event, updates: Partial<AppSettings>) => {
    await updateSettings(updates);
  });
}
