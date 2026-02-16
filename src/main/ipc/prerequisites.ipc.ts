import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { checkPrerequisites } from '../services/prerequisites.service';

export function registerPrerequisitesHandlers() {
  ipcMain.handle(IPC_CHANNELS.CHECK_PREREQUISITES, async () => {
    return await checkPrerequisites();
  });
}
