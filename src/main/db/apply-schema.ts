import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { ERROR_CATEGORIES, GRAMMAR_RULES, categorySlug } from '../../shared/constants';

/**
 * Bumping this drops and recreates every content table. The app is pre-release
 * with no production data, so a clean rebuild beats a chain of ALTERs — but any
 * bump after release would need real migrations instead.
 */
export const TARGET_SCHEMA_VERSION = 2;

/**
 * Brings an open database up to TARGET_SCHEMA_VERSION. Kept free of electron
 * imports so it can be exercised against a temporary file.
 */
export function applySchema(sqlite: Database.Database): { reset: boolean } {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const currentVersion = (sqlite.pragma('user_version', { simple: true }) as number) ?? 0;
  // Version 0 is either a brand-new file or a pre-versioning database. Tell
  // them apart by whether any table exists.
  const hasExistingTables = !!sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='meetings'`)
    .get();
  const needsReset = currentVersion < TARGET_SCHEMA_VERSION && hasExistingTables;

  if (needsReset) {
    console.warn(
      `Database schema v${currentVersion} predates v${TARGET_SCHEMA_VERSION}; rebuilding recordings and analysis data.`
    );
    sqlite.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS mistakes;
      DROP TABLE IF EXISTS sentences;
      DROP TABLE IF EXISTS patterns;
      DROP TABLE IF EXISTS rules;
      DROP TABLE IF EXISTS meeting_analyses;
      DROP TABLE IF EXISTS transcript_chunks;
      DROP TABLE IF EXISTS transcript_segments;
      DROP TABLE IF EXISTS meetings;
      DROP TABLE IF EXISTS error_categories;
      DROP TABLE IF EXISTS profiles;
      PRAGMA foreign_keys = ON;
    `);
    // 'settings' is deliberately kept: re-picking models and re-downloading
    // them is expensive, and nothing in it depends on the dropped tables.
  }

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
      recording_mode TEXT NOT NULL DEFAULT 'meeting',
      topic TEXT,
      grammar_mode TEXT NOT NULL DEFAULT 'professional',
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_seconds INTEGER,
      status TEXT NOT NULL,
      total_segments INTEGER NOT NULL DEFAULT 0,
      total_mistakes INTEGER NOT NULL DEFAULT 0,
      sentences_total INTEGER NOT NULL DEFAULT 0,
      sentences_clean INTEGER NOT NULL DEFAULT 0,
      sentences_failed INTEGER NOT NULL DEFAULT 0,
      clean_sentence_rate REAL,
      analysis_state TEXT NOT NULL DEFAULT 'none',
      sentence_split_version INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      transcript TEXT
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      text TEXT NOT NULL,
      translated_text TEXT,
      confidence REAL
    );

    -- Added after release without a version bump: a new table needs no reset,
    -- and IF NOT EXISTS creates it on existing databases.
    CREATE TABLE IF NOT EXISTS transcript_chunks (
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      source_file TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      duration_seconds REAL NOT NULL,
      whisper_model TEXT NOT NULL,
      segment_count INTEGER NOT NULL DEFAULT 0,
      transcribed_at INTEGER NOT NULL,
      PRIMARY KEY (meeting_id, chunk_index)
    );

    CREATE TABLE IF NOT EXISTS sentences (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      segment_id TEXT NOT NULL REFERENCES transcript_segments(id) ON DELETE CASCADE,
      sentence_index INTEGER NOT NULL,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL,
      text TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      word_count INTEGER NOT NULL,
      counts_toward_rate INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unanalyzed',
      failure_reason TEXT,
      analyzed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS error_categories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      parent_category TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rules (
      key TEXT PRIMARY KEY,
      category_slug TEXT NOT NULL,
      label TEXT NOT NULL,
      hint TEXT NOT NULL,
      example_wrong TEXT,
      example_right TEXT,
      default_severity TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      rule_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'new',
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      meeting_count INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      last_meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
      clean_run_streak INTEGER NOT NULL DEFAULT 0,
      mastered_at INTEGER,
      relapse_count INTEGER NOT NULL DEFAULT 0,
      ignored_at INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mistakes (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      sentence_id TEXT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
      segment_id TEXT NOT NULL REFERENCES transcript_segments(id) ON DELETE CASCADE,
      original_text TEXT NOT NULL,
      corrected_text TEXT NOT NULL,
      explanation TEXT NOT NULL,
      alternatives TEXT,
      category_id TEXT REFERENCES error_categories(id),
      severity TEXT NOT NULL,
      pattern_id TEXT REFERENCES patterns(id) ON DELETE SET NULL,
      rule_key TEXT,
      raw_rule_key TEXT,
      normalized_text TEXT NOT NULL DEFAULT '',
      span_start INTEGER,
      span_end INTEGER,
      span_match TEXT NOT NULL DEFAULT 'none',
      occurrence_state TEXT NOT NULL DEFAULT 'new',
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_analyses (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      error_message TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // The old schema had no indexes; the review queue and analytics queries below
  // scan these columns on every load.
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_segments_meeting ON transcript_segments(meeting_id, segment_index);
    CREATE INDEX IF NOT EXISTS idx_sentences_meeting ON sentences(meeting_id, sentence_index);
    CREATE INDEX IF NOT EXISTS idx_sentences_status ON sentences(status);
    CREATE INDEX IF NOT EXISTS idx_mistakes_meeting ON mistakes(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_mistakes_sentence ON mistakes(sentence_id);
    CREATE INDEX IF NOT EXISTS idx_mistakes_pattern ON mistakes(pattern_id);
    CREATE INDEX IF NOT EXISTS idx_mistakes_created ON mistakes(created_at);
    CREATE INDEX IF NOT EXISTS idx_meetings_started ON meetings(started_at);
    CREATE INDEX IF NOT EXISTS idx_analyses_meeting ON meeting_analyses(meeting_id, type);
  `);

  seedErrorCategories(sqlite);
  seedRules(sqlite);

  sqlite.pragma(`user_version = ${TARGET_SCHEMA_VERSION}`);

  return { reset: needsReset };
}

/**
 * Upserts on the stable slug rather than skipping when the table is non-empty,
 * so adding a category to the shared constants backfills on the next launch.
 */
function seedErrorCategories(sqlite: Database.Database) {
  const insert = sqlite.prepare(`
    INSERT INTO error_categories (id, slug, name, description, parent_category, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      parent_category = excluded.parent_category,
      sort_order = excluded.sort_order
  `);

  sqlite.transaction(() => {
    let order = 0;
    for (const [parent, categories] of Object.entries(ERROR_CATEGORIES)) {
      for (const category of categories) {
        insert.run(uuidv4(), categorySlug(category), category, null, parent, order++);
      }
    }
  })();
}

function seedRules(sqlite: Database.Database) {
  const insert = sqlite.prepare(`
    INSERT INTO rules (key, category_slug, label, hint, example_wrong, example_right, default_severity, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      category_slug = excluded.category_slug,
      label = excluded.label,
      hint = excluded.hint,
      example_wrong = excluded.example_wrong,
      example_right = excluded.example_right,
      default_severity = excluded.default_severity,
      sort_order = excluded.sort_order
  `);

  sqlite.transaction(() => {
    GRAMMAR_RULES.forEach((rule, index) => {
      insert.run(
        rule.key,
        rule.categorySlug,
        rule.label,
        rule.hint,
        rule.exampleWrong ?? null,
        rule.exampleRight ?? null,
        rule.defaultSeverity ?? null,
        index
      );
    });
  })();
}
