/**
 * Checks the database schema and its seeding, including the destructive
 * upgrade path that a `TARGET_SCHEMA_VERSION` bump triggers.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { applySchema, TARGET_SCHEMA_VERSION } from '../../src/main/db/apply-schema';
import { check, section, finish, makeTempDir } from './harness';

const tmp = makeTempDir('replay-schema-');
const count = (db: Database.Database, sql: string) =>
  (db.prepare(sql).get() as { c: number }).c;

section('a fresh database');
{
  const db = new Database(path.join(tmp, 'fresh.db'));
  const result = applySchema(db);

  check('is not reported as a reset', result.reset, false);
  check('is stamped with the target version', db.pragma('user_version', { simple: true }), TARGET_SCHEMA_VERSION);

  const tables = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all() as { name: string }[])
    .map(t => t.name)
    .filter(n => !n.startsWith('sqlite_'));
  check('creates every table', tables, [
    'error_categories', 'meeting_analyses', 'meetings', 'mistakes', 'patterns',
    'profiles', 'rules', 'sentences', 'settings', 'transcript_chunks', 'transcript_segments',
  ]);

  const indexes = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
  ).all() as { name: string }[]).length;
  check('creates the query indexes', indexes, 9);

  section('seeding');
  check('seeds all 17 categories', count(db, 'SELECT COUNT(*) c FROM error_categories'), 17);
  check('seeds Run-on Sentence', !!db.prepare("SELECT 1 FROM error_categories WHERE name='Run-on Sentence'").get(), true);
  check('seeds the rule vocabulary', count(db, 'SELECT COUNT(*) c FROM rules') > 40, true);
  check(
    'maps every rule to a seeded category',
    count(db, 'SELECT COUNT(*) c FROM rules r LEFT JOIN error_categories c ON r.category_slug = c.slug WHERE c.slug IS NULL'),
    0
  );
  check(
    'gives every category an ".other" rule',
    count(db, "SELECT COUNT(*) c FROM error_categories c WHERE NOT EXISTS (SELECT 1 FROM rules r WHERE r.key = c.slug || '.other')"),
    0
  );

  section('the row graph');
  db.prepare(`INSERT INTO meetings (id,title,recording_mode,grammar_mode,started_at,status) VALUES ('m1','T','solo','professional',1,'completed')`).run();
  db.prepare(`INSERT INTO transcript_segments (id,meeting_id,chunk_index,segment_index,start_time,end_time,text) VALUES ('g1','m1',0,0,0,1,'I has three cats')`).run();
  db.prepare(`INSERT INTO sentences (id,meeting_id,segment_id,sentence_index,char_start,char_end,text,start_time,end_time,word_count) VALUES ('s1','m1','g1',0,0,16,'I has three cats',0,1,4)`).run();
  db.prepare(`INSERT INTO patterns (id,rule_key,first_seen_at,last_seen_at,updated_at) VALUES ('p1','sva.third-person-s',1,1,1)`).run();
  db.prepare(`INSERT INTO mistakes (id,meeting_id,sentence_id,segment_id,original_text,corrected_text,explanation,severity,normalized_text,pattern_id,rule_key,created_at) VALUES ('x1','m1','s1','g1','has','have','sv','moderate','has','p1','sva.third-person-s',1)`).run();
  db.prepare(`INSERT INTO meeting_analyses (id,meeting_id,type,status,content,created_at) VALUES ('a1','m1','summary','failed','null',1)`).run();

  check('accepts a full insert chain', count(db, 'SELECT COUNT(*) c FROM mistakes'), 1);
  check(
    'applies the mistake defaults',
    db.prepare("SELECT span_match, occurrence_state FROM mistakes WHERE id='x1'").get(),
    { span_match: 'none', occurrence_state: 'new' }
  );
  check('rejects a duplicate pattern rule_key', (() => {
    try {
      db.prepare(`INSERT INTO patterns (id,rule_key,first_seen_at,last_seen_at,updated_at) VALUES ('p2','sva.third-person-s',1,1,1)`).run();
      return 'inserted';
    } catch {
      return 'rejected';
    }
  })(), 'rejected');

  section('cascades');
  db.pragma('foreign_keys = ON');
  db.prepare(`DELETE FROM meetings WHERE id='m1'`).run();
  check('deleting a meeting clears its sentences', count(db, 'SELECT COUNT(*) c FROM sentences'), 0);
  check('deleting a meeting clears its mistakes', count(db, 'SELECT COUNT(*) c FROM mistakes'), 0);
  check('deleting a meeting clears its analyses', count(db, 'SELECT COUNT(*) c FROM meeting_analyses'), 0);
  // Patterns outlive the recordings they came from; that is the point of them.
  check('the pattern survives its meeting', count(db, 'SELECT COUNT(*) c FROM patterns'), 1);

  section('running again');
  check('reports no reset', applySchema(db).reset, false);
  check('does not duplicate the categories', count(db, 'SELECT COUNT(*) c FROM error_categories'), 17);
  db.close();
}

section('a pre-versioning database');
{
  const db = new Database(path.join(tmp, 'old.db'));
  db.exec(`
    CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, started_at INTEGER NOT NULL, status TEXT NOT NULL, overall_score REAL, total_mistakes INTEGER NOT NULL DEFAULT 0, total_segments INTEGER NOT NULL DEFAULT 0, notes TEXT);
    CREATE TABLE error_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, parent_category TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.prepare(`INSERT INTO meetings (id,title,started_at,status) VALUES ('old1','Old one',1,'completed')`).run();
  db.prepare(`INSERT INTO settings (key,value) VALUES ('ollamaModel','qwen2.5:7b')`).run();
  db.prepare(`INSERT INTO error_categories (id,name) VALUES ('c1','Hallucinated Category')`).run();

  check('starts at version 0', db.pragma('user_version', { simple: true }), 0);

  const result = applySchema(db);
  check('is reported as a reset', result.reset, true);
  check('is stamped with the target version', db.pragma('user_version', { simple: true }), TARGET_SCHEMA_VERSION);
  check('drops the old recordings', count(db, 'SELECT COUNT(*) c FROM meetings'), 0);
  // Re-picking and re-downloading models is expensive, so settings are kept.
  check('PRESERVES the settings', db.prepare("SELECT value FROM settings WHERE key='ollamaModel'").get(), { value: 'qwen2.5:7b' });
  check('reseeds the categories cleanly', count(db, 'SELECT COUNT(*) c FROM error_categories'), 17);
  check('clears categories the model had invented', db.prepare("SELECT 1 FROM error_categories WHERE name='Hallucinated Category'").get(), undefined);
  check('adds the new meeting columns', !!db.prepare('SELECT recording_mode, clean_sentence_rate, analysis_state FROM meetings LIMIT 1').columns(), true);
  db.close();
}

section('a current-version database from before transcript_chunks');
{
  const db = new Database(path.join(tmp, 'v2.db'));
  applySchema(db);
  db.prepare(`INSERT INTO meetings (id,title,recording_mode,grammar_mode,started_at,status) VALUES ('keep','Kept','solo','professional',1,'completed')`).run();
  db.exec('DROP TABLE transcript_chunks');

  const result = applySchema(db);
  // Adding a table must not cost released users their recordings.
  check('is not reset', result.reset, false);
  check('keeps its recordings', count(db, 'SELECT COUNT(*) c FROM meetings'), 1);
  check('gains the table', !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='transcript_chunks'").get(), true);
  db.close();
}

finish('schema');
