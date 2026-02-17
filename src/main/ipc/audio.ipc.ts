import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { saveAudioChunk, convertToWav, getAudioChunks, readAudioChunk } from '../services/audio.service';

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

  ipcMain.handle(
    IPC_CHANNELS.GET_AUDIO_CHUNKS,
    async (_event, meetingId: string) => {
      return getAudioChunks(meetingId);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.READ_AUDIO_CHUNK,
    async (_event, meetingId: string, filename: string) => {
      const buffer = readAudioChunk(meetingId, filename);
      return buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : null;
    }
  );
}
