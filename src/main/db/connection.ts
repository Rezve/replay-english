import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import * as schema from './schema';

export const DB_FILENAME = 'replay.db';

let db: ReturnType<typeof drizzle> | null = null;
let sqlite: Database.Database | null = null;

export function getDb() {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), DB_FILENAME);
    sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite, { schema });
  }
  return db;
}

export function closeDb() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}
