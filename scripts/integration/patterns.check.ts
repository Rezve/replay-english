/**
 * Checks the pattern engine: that the same habit in different words collapses
 * into one tracked item, and that the mastery state machine behaves.
 */
import { app } from 'electron';
import Database from 'better-sqlite3';
import path from 'node:path';
import { check, section, finish, makeTempDir } from './harness';

// Point the app's database at a throwaway file before anything opens it.
const tmp = makeTempDir('replay-patterns-');
app.setPath('userData', tmp);
const dbPath = path.join(tmp, 'replay.db');

async function main() {
  const { applySchema } = await import('../../src/main/db/apply-schema');
  const setup = new Database(dbPath);
  applySchema(setup);
  setup.close();

  const raw = new Database(dbPath);
  const patterns = await import('../../src/main/services/patterns.service');
  const row = (sql: string, ...args: unknown[]) => raw.prepare(sql).get(...args) as never;

  section('resolving the rule key the model returned');
  check('a known key passes through',
    await patterns.resolveRuleKey('sva.third-person-s', 'Subject-Verb Agreement'), 'sva.third-person-s');
  check('case is normalized',
    await patterns.resolveRuleKey('SVA.Third-Person-S', 'Subject-Verb Agreement'), 'sva.third-person-s');
  // Local models invent keys; junk patterns would make the queue useless.
  check('an invented key falls back to the category bucket',
    await patterns.resolveRuleKey('made.up.nonsense', 'Article Usage'), 'article-usage.other');
  check('a label instead of a key falls back too',
    await patterns.resolveRuleKey('missing third person s', 'Subject-Verb Agreement'), 'subject-verb-agreement.other');
  check('nothing usable yields no pattern',
    await patterns.resolveRuleKey('garbage', undefined), null);
  check('a category with a slash resolves',
    await patterns.resolveRuleKey('x', 'Plural/Singular'), 'plural-singular.other');

  let seq = 0;
  const seen = new Set<string>();
  /** Records one occurrence of a rule in a meeting, creating the meeting if new. */
  async function record(meetingId: string, ruleKey: string, startedAt: number) {
    const n = seq++;
    if (!seen.has(meetingId)) {
      seen.add(meetingId);
      raw.prepare(`INSERT INTO meetings (id,title,recording_mode,grammar_mode,started_at,status) VALUES (?,?,'solo','professional',?,'completed')`).run(meetingId, meetingId, startedAt);
      raw.prepare(`INSERT INTO transcript_segments (id,meeting_id,chunk_index,segment_index,start_time,end_time,text) VALUES (?,?,0,?,0,1,'t')`).run('g' + meetingId, meetingId, n);
      raw.prepare(`INSERT INTO sentences (id,meeting_id,segment_id,sentence_index,char_start,char_end,text,start_time,end_time,word_count,status) VALUES (?,?,?,?,0,1,'t',0,1,5,'has_mistake')`).run('s' + meetingId, meetingId, 'g' + meetingId, n);
    }
    const patternId = await patterns.assignPattern(ruleKey, meetingId);
    raw.prepare(`INSERT INTO mistakes (id,meeting_id,sentence_id,segment_id,original_text,corrected_text,explanation,severity,normalized_text,pattern_id,rule_key,created_at) VALUES (?,?,?,?,'has','have','x','moderate','has',?,?,?)`)
      .run('x' + n, meetingId, 's' + meetingId, 'g' + meetingId, patternId, ruleKey, startedAt);
    return { patternId: patternId!, mistakeId: 'x' + n };
  }

  section('one habit, however it is worded');
  // The whole thesis: "I has three" and "he have two" are one pattern, where
  // the old exact-text matching saw two unrelated items.
  const first = await record('m1', 'sva.third-person-s', 1000);
  const second = await record('m2', 'sva.third-person-s', 2000);
  check('the same rule in two recordings is one pattern', first.patternId === second.patternId, true);

  await patterns.recomputePatternCounters('m2');
  check('counts the occurrences', row(`SELECT occurrence_count c FROM patterns WHERE id=?`, first.patternId), { c: 2 });
  check('counts the recordings', row(`SELECT meeting_count c FROM patterns WHERE id=?`, first.patternId), { c: 2 });
  check('promotes new to learning at two occurrences', row(`SELECT state s FROM patterns WHERE id=?`, first.patternId), { s: 'learning' });
  check('creates no second row', row('SELECT COUNT(*) c FROM patterns'), { c: 1 });

  section('mastery');
  await patterns.setPatternState(first.patternId, 'mastered');
  check('marks it mastered', row(`SELECT state s FROM patterns WHERE id=?`, first.patternId), { s: 'mastered' });
  check('timestamps the mastery', (row(`SELECT mastered_at m FROM patterns WHERE id=?`, first.patternId) as { m: number }).m > 0, true);

  await record('m3', 'sva.third-person-s', 3000);
  await patterns.recomputePatternCounters('m3');
  // A mastered habit coming back is what makes mastery mean anything.
  check('a relapse reopens it as learning', row(`SELECT state s FROM patterns WHERE id=?`, first.patternId), { s: 'learning' });
  check('a relapse is counted', row(`SELECT relapse_count c FROM patterns WHERE id=?`, first.patternId), { c: 1 });
  check('a relapse clears the mastery timestamp', row(`SELECT mastered_at m FROM patterns WHERE id=?`, first.patternId), { m: null });

  section('clean runs');
  const other = await record('m4', 'tense.past-form', 4000);
  await patterns.recomputePatternCounters('m4');
  check('a recording without the habit grows its streak', row(`SELECT clean_run_streak c FROM patterns WHERE id=?`, first.patternId), { c: 1 });
  await patterns.recomputePatternCounters('m4');
  check('the streak keeps growing', row(`SELECT clean_run_streak c FROM patterns WHERE id=?`, first.patternId), { c: 2 });

  section('ignoring');
  await patterns.setPatternState(other.patternId, 'ignored');
  await patterns.recomputePatternCounters('m1');
  check('ignored stays ignored', row(`SELECT state s FROM patterns WHERE id=?`, other.patternId), { s: 'ignored' });
  check('ignored accrues no streak', row(`SELECT clean_run_streak c FROM patterns WHERE id=?`, other.patternId), { c: 0 });

  section('dismissing a false positive');
  const result = await patterns.setOccurrenceState(second.mistakeId, 'rejected');
  check('reports which recording to recount', result?.meetingId, 'm2');
  // The sentence had only that one mistake, so it is correct again.
  check('the sentence becomes clean again', row(`SELECT status s FROM sentences WHERE id='sm2'`), { s: 'clean' });

  await patterns.recomputePatternCounters(null);
  check('the occurrence count drops', row(`SELECT occurrence_count c FROM patterns WHERE id=?`, first.patternId), { c: 2 });
  check('the recording count drops', row(`SELECT meeting_count c FROM patterns WHERE id=?`, first.patternId), { c: 2 });

  section('the review summary');
  const summary = await patterns.getReviewSummary();
  check('counts what is active', summary.active, 1);
  check('counts what is ignored', summary.ignored, 1);
  check('counts what came back', summary.relapsed, 1);

  section('listing occurrences');
  const occurrences = await patterns.getPatternOccurrences(first.patternId);
  check('lists them newest first', occurrences.map(o => o.meetingId), ['m3', 'm2', 'm1']);
  check('carries the recording title', occurrences[0].meetingTitle, 'm3');
  check('carries a timestamp to play from', typeof occurrences[0].startTime, 'number');

  raw.close();
  const { closeDb } = await import('../../src/main/db/connection');
  closeDb();
  finish('patterns');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
