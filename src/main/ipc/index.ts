import { BrowserWindow } from 'electron';
import { registerDatabaseHandlers } from './database.ipc';
import { registerSettingsHandlers } from './settings.ipc';
import { registerAudioHandlers } from './audio.ipc';
import { registerTranscriptionHandlers } from './transcription.ipc';
import { registerAnalysisHandlers } from './analysis.ipc';
import { registerPatternHandlers } from './patterns.ipc';
import { registerPrerequisitesHandlers } from './prerequisites.ipc';
import { registerWindowHandlers } from './window.ipc';
import { registerUpdateHandlers } from './update.ipc';

export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  registerDatabaseHandlers();
  registerSettingsHandlers();
  registerAudioHandlers();
  registerTranscriptionHandlers(mainWindow);
  registerAnalysisHandlers(mainWindow);
  registerPatternHandlers();
  registerPrerequisitesHandlers(mainWindow);
  registerWindowHandlers(mainWindow);
  registerUpdateHandlers(mainWindow);
}
