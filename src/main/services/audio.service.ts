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

/**
 * Duration of a WAV produced by convertToWav, read straight from the RIFF
 * header. Chunk files drift from the configured chunk duration (pause/resume,
 * rotation timing, a short final chunk), so segment timestamps have to be
 * stamped from measured lengths rather than an assumed 5 minutes.
 */
export function getWavDurationSeconds(wavPath: string): number | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(wavPath, 'r');
    // Walk the chunk list rather than assuming a 44-byte canonical header;
    // ffmpeg can emit a LIST/INFO chunk before 'data'.
    const header = Buffer.alloc(12);
    if (fs.readSync(fd, header, 0, 12, 0) < 12) return null;
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      return null;
    }

    let byteRate = 0;
    let offset = 12;
    const chunkHeader = Buffer.alloc(8);
    const fileSize = fs.fstatSync(fd).size;

    while (offset + 8 <= fileSize) {
      if (fs.readSync(fd, chunkHeader, 0, 8, offset) < 8) break;
      const id = chunkHeader.toString('ascii', 0, 4);
      const size = chunkHeader.readUInt32LE(4);

      if (id === 'fmt ') {
        const fmt = Buffer.alloc(16);
        if (fs.readSync(fd, fmt, 0, 16, offset + 8) < 16) break;
        byteRate = fmt.readUInt32LE(8);
      } else if (id === 'data') {
        if (!byteRate) break;
        return size / byteRate;
      }

      // Chunks are word-aligned, so an odd size is followed by a pad byte.
      offset += 8 + size + (size % 2);
    }
    return null;
  } catch (error) {
    console.warn(`Could not read WAV duration for ${wavPath}:`, error);
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export async function convertToWav(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.wav');
  const ffmpegPath = getFFmpegPath();

  await execFileAsync(ffmpegPath, [
    '-i', inputPath,
    '-af', 'highpass=f=80,dynaudnorm=f=150:g=15', // drop rumble, even out quiet mic levels
    '-ar', '16000',   // 16kHz sample rate (Whisper requirement)
    '-ac', '1',        // mono
    '-f', 'wav',
    '-y',              // overwrite
    outputPath,
  ]);

  return outputPath;
}

/**
 * Removes recording folders with no meeting row left to play them. A schema
 * reset drops the meeting rows but not their audio, which would otherwise sit
 * in userData forever.
 */
export function cleanupOrphanAudio(knownMeetingIds: string[]): number {
  const known = new Set(knownMeetingIds);
  let removed = 0;

  for (const folder of ['recordings', 'temp']) {
    const root = path.join(app.getPath('userData'), folder);
    if (!fs.existsSync(root)) continue;

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || known.has(entry.name)) continue;
      try {
        fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
        removed++;
      } catch (error) {
        console.warn(`Could not remove orphaned audio for ${entry.name}:`, error);
      }
    }
  }

  return removed;
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
