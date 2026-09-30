import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function getFFmpegPath(): string {
  try {
    // ffmpeg-static provides the binary path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegPath = require('ffmpeg-static');
    // Executables cannot run from inside app.asar; forge unpacks ffmpeg-static beside it.
    return String(ffmpegPath).replace('app.asar', 'app.asar.unpacked');
  } catch {
    return 'ffmpeg'; // fallback to system ffmpeg
  }
}

function getRecordingsDir(meetingId: string): string {
  const dir = path.join(app.getPath('userData'), 'recordings', meetingId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve the audio directory for a meeting — checks both
 * `recordings/` (new) and `temp/` (legacy) locations.
 */
function resolveAudioDir(meetingId: string): string | null {
  const recordings = path.join(app.getPath('userData'), 'recordings', meetingId);
  if (fs.existsSync(recordings)) return recordings;
  const temp = path.join(app.getPath('userData'), 'temp', meetingId);
  if (fs.existsSync(temp)) return temp;
  return null;
}

export async function saveAudioChunk(
  meetingId: string,
  chunkIndex: number,
  buffer: ArrayBuffer,
  prefix?: string
): Promise<string> {
  const dir = getRecordingsDir(meetingId);
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

export function cleanupMeetingAudio(meetingId: string): void {
  // Clean both possible locations
  for (const folder of ['recordings', 'temp']) {
    const dir = path.join(app.getPath('userData'), folder, meetingId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

export function getChunkPaths(meetingId: string, prefix?: string): string[] {
  const dir = resolveAudioDir(meetingId);
  if (!dir) return [];

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

export interface AudioChunkInfo {
  filename: string;
  size: number;
}

export function getAudioChunks(meetingId: string): AudioChunkInfo[] {
  const dir = resolveAudioDir(meetingId);
  if (!dir) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.webm') && !f.startsWith('mic_'))
    .sort((a, b) => a.localeCompare(b))
    .map(f => ({
      filename: f,
      size: fs.statSync(path.join(dir, f)).size,
    }));
}

export function readAudioChunk(meetingId: string, filename: string): Buffer | null {
  const dir = resolveAudioDir(meetingId);
  if (!dir) return null;

  // Prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(dir, safe);
  if (!fs.existsSync(filePath)) return null;

  return fs.readFileSync(filePath);
}

/**
 * Migrate audio files from legacy `temp/` to `recordings/`.
 * Called once on app startup.
 */
export function migrateAudioStorage(): void {
  const tempBase = path.join(app.getPath('userData'), 'temp');
  const recordingsBase = path.join(app.getPath('userData'), 'recordings');

  if (!fs.existsSync(tempBase)) return;

  const entries = fs.readdirSync(tempBase, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const srcDir = path.join(tempBase, entry.name);
    const destDir = path.join(recordingsBase, entry.name);

    // Skip if already migrated
    if (fs.existsSync(destDir)) continue;

    // Check if this directory has audio files
    const files = fs.readdirSync(srcDir);
    const hasAudio = files.some(f => f.endsWith('.webm'));
    if (!hasAudio) continue;

    // Move the directory
    fs.mkdirSync(recordingsBase, { recursive: true });
    fs.renameSync(srcDir, destDir);
    console.log(`Migrated audio: temp/${entry.name} → recordings/${entry.name}`);
  }
}
