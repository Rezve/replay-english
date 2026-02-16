import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function getFFmpegPath(): string {
  try {
    // ffmpeg-static provides the binary path
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegPath = require('ffmpeg-static');
    return ffmpegPath;
  } catch {
    return 'ffmpeg'; // fallback to system ffmpeg
  }
}

function getTempDir(meetingId: string): string {
  const dir = path.join(app.getPath('userData'), 'temp', meetingId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveAudioChunk(
  meetingId: string,
  chunkIndex: number,
  buffer: ArrayBuffer,
  prefix?: string
): Promise<string> {
  const dir = getTempDir(meetingId);
  const fileName = prefix ? `${prefix}_chunk_${chunkIndex}.webm` : `chunk_${chunkIndex}.webm`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
}

export async function convertToWav(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.wav');
  const ffmpegPath = getFFmpegPath();

  await execFileAsync(ffmpegPath, [
    '-i', inputPath,
    '-ar', '16000',    // 16kHz sample rate (Whisper requirement)
    '-ac', '1',        // mono
    '-f', 'wav',
    '-y',              // overwrite
    outputPath,
  ]);

  return outputPath;
}

export function cleanupMeetingTemp(meetingId: string): void {
  const dir = path.join(app.getPath('userData'), 'temp', meetingId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function getChunkPaths(meetingId: string, prefix?: string): string[] {
  const dir = path.join(app.getPath('userData'), 'temp', meetingId);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => {
      if (!f.endsWith('.webm')) return false;
      // If prefix specified, only return files with that prefix
      if (prefix) return f.startsWith(`${prefix}_`);
      // If no prefix, return files WITHOUT 'mic_' prefix (backward compatibility)
      return !f.startsWith('mic_');
    })
    .sort((a, b) => a.localeCompare(b))
    .map(f => path.join(dir, f));
}
