import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { saveAudioChunk, convertToWav } from '../services/audio.service';

export function registerAudioHandlers() {
  ipcMain.handle(
    IPC_CHANNELS.SAVE_AUDIO_CHUNK,
    async (_event, meetingId: string, chunkIndex: number, buffer: ArrayBuffer, prefix?: string) => {
      return await saveAudioChunk(meetingId, chunkIndex, buffer, prefix);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.CONVERT_TO_WAV,
    async (_event, inputPath: string) => {
      return await convertToWav(inputPath);
    }
  );
}
