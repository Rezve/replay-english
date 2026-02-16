import { BrowserWindow } from 'electron';
import { registerDatabaseHandlers } from './database.ipc';
import { registerSettingsHandlers } from './settings.ipc';
import { registerAudioHandlers } from './audio.ipc';
import { registerTranscriptionHandlers } from './transcription.ipc';
import { registerAnalysisHandlers } from './analysis.ipc';
import { registerPrerequisitesHandlers } from './prerequisites.ipc';

export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  registerDatabaseHandlers();
  registerSettingsHandlers();
  registerAudioHandlers();
  registerTranscriptionHandlers(mainWindow);
  registerAnalysisHandlers(mainWindow);
  registerPrerequisitesHandlers();
}
