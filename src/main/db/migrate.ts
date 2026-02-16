import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { ERROR_CATEGORIES } from '../../shared/constants';

export function runMigrations() {
  const dbPath = path.join(app.getPath('userData'), 'mempill.db');
  const sqlite = new Database(dbPath);

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Create tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_seconds INTEGER,
      status TEXT NOT NULL,
      total_segments INTEGER NOT NULL DEFAULT 0,
      total_mistakes INTEGER NOT NULL DEFAULT 0,
      overall_score REAL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      text TEXT NOT NULL,
      confidence REAL
    );

    CREATE TABLE IF NOT EXISTS error_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      parent_category TEXT
    );

    CREATE TABLE IF NOT EXISTS mistakes (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      segment_id TEXT NOT NULL REFERENCES transcript_segments(id) ON DELETE CASCADE,
      original_text TEXT NOT NULL,
      corrected_text TEXT NOT NULL,
      explanation TEXT NOT NULL,
      alternatives TEXT,
      category_id TEXT REFERENCES error_categories(id),
      severity TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed error categories if empty
  const count = sqlite.prepare('SELECT COUNT(*) as cnt FROM error_categories').get() as { cnt: number };
  if (count.cnt === 0) {
    const insert = sqlite.prepare(
      'INSERT INTO error_categories (id, name, description, parent_category) VALUES (?, ?, ?, ?)'
    );

    const insertMany = sqlite.transaction(() => {
      for (const [parent, categories] of Object.entries(ERROR_CATEGORIES)) {
        for (const category of categories) {
          insert.run(uuidv4(), category, null, parent);
        }
      }
    });

    insertMany();
  }

  sqlite.close();
}
