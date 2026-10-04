import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILENAME } from './db/connection';

// The app was renamed from "MemPill Language" to "Replay English". productName decides the
// userData folder, so without this an upgraded install would start with no data at all.
const LEGACY_USER_DATA_DIR = 'MemPill Language';
const LEGACY_DB_FILENAME = 'mempill.db';

// Everything the app itself keeps in userData. Chromium's own files (cache, Local Storage,
// Preferences) are left behind: the new folder already has fresh copies by the time we run.
const MOVES: Array<[from: string, to: string]> = [
  [LEGACY_DB_FILENAME, DB_FILENAME],
  [`${LEGACY_DB_FILENAME}-wal`, `${DB_FILENAME}-wal`],
  [`${LEGACY_DB_FILENAME}-shm`, `${DB_FILENAME}-shm`],
  ['recordings', 'recordings'],
  ['temp', 'temp'],
  ['models', 'models'],
  ['whisper', 'whisper'],
];

/**
 * One-time move of the pre-rename userData contents into the current folder. Must run
 * before anything opens the database. Skipped once the new database exists, so a fresh
 * recording in the new folder is never overwritten.
 */
export function migrateLegacyUserData(): void {
  const legacyDir = path.join(app.getPath('appData'), LEGACY_USER_DATA_DIR);
  const userData = app.getPath('userData');
  if (legacyDir === userData) return;
  if (!fs.existsSync(path.join(legacyDir, LEGACY_DB_FILENAME))) return;
  if (fs.existsSync(path.join(userData, DB_FILENAME))) return;

  fs.mkdirSync(userData, { recursive: true });
  for (const [from, to] of MOVES) {
    const src = path.join(legacyDir, from);
    const dest = path.join(userData, to);
    if (!fs.existsSync(src) || fs.existsSync(dest)) continue;
    try {
      fs.renameSync(src, dest);
    } catch (err) {
      console.warn(`Could not move ${src} to ${dest}:`, err);
    }
  }
  console.log(`Moved data from ${legacyDir} to ${userData}.`);
}
