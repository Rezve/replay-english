/**
 * Checks how a meeting's clean-sentence rate and status are derived from the
 * sentence rows — above all, that a failed analysis can never read as a good one.
 */
import { app } from 'electron';
import Database from 'better-sqlite3';
import path from 'node:path';
import { check, section, finish, makeTempDir } from './harness';

const tmp = makeTempDir('mempill-metrics-');
app.setPath('userData', tmp);
const dbPath = path.join(tmp, 'mempill.db');

async function main() {
  const { applySchema } = await import('../../src/main/db/apply-schema');
  const setup = new Database(dbPath);
  applySchema(setup);
  setup.close();

  const raw = new Database(dbPath);
  const analysis = await import('../../src/main/services/analysis.service');

  /** A meeting whose sentences have the given statuses. */
  function seed(id: string, statuses: string[], meetingStatus = 'analyzing', countsToward = 1) {
    raw.prepare(`INSERT INTO meetings (id,title,recording_mode,grammar_mode,started_at,status,ended_at) VALUES (?,?,'solo','professional',1,?,500)`)
      .run(id, id, meetingStatus);
    raw.prepare(`INSERT INTO transcript_segments (id,meeting_id,chunk_index,segment_index,start_time,end_time,text) VALUES (?,?,0,0,0,1,'t')`)
      .run('g' + id, id);
    statuses.forEach((status, i) => {
      raw.prepare(`INSERT INTO sentences (id,meeting_id,segment_id,sentence_index,char_start,char_end,text,start_time,end_time,word_count,counts_toward_rate,status) VALUES (?,?,?,?,0,1,'t',0,1,5,?,?)`)
        .run(`${id}s${i}`, id, 'g' + id, i, countsToward, status);
    });
  }

  const meeting = (id: string) => raw.prepare(
    'SELECT status, analysis_state, clean_sentence_rate, sentences_clean, sentences_failed, sentences_total, ended_at FROM meetings WHERE id=?'
  ).get(id) as Record<string, unknown>;

  const finishedRun = (cancelled = false) =>
    ({ lineByLine: true, contextTypes: [], failedContextTypes: [], cancelled });

  section('the rate denominates on what was checked');
  seed('m1', ['clean', 'clean', 'clean', 'has_mistake', 'failed']);
  let tally = await analysis.recalculateMeetingMetrics('m1', finishedRun());
  // Three clean out of four checked; the failed one is not in the denominator.
  check('excludes unchecked sentences from the rate', tally.cleanSentenceRate, 75);
  check('counts them separately instead', tally.sentencesFailed, 1);
  check('reports the run as partial', tally.analysisState, 'partial');
  check('completes the meeting', meeting('m1').status, 'completed');

  section('a failed analysis never looks flawless');
  seed('m2', ['failed', 'failed', 'failed']);
  tally = await analysis.recalculateMeetingMetrics('m2', finishedRun());
  // This is the property the whole change set exists for: with Ollama down,
  // there is no number at all rather than a perfect one.
  check('produces no rate whatsoever', tally.cleanSentenceRate, null);
  check('reports the run as failed', tally.analysisState, 'failed');
  check('marks the meeting failed', meeting('m2').status, 'failed');

  section('a genuinely clean run');
  seed('m3', ['clean', 'clean']);
  tally = await analysis.recalculateMeetingMetrics('m3', finishedRun());
  check('reports 100', tally.cleanSentenceRate, 100);
  check('reports the run as complete', tally.analysisState, 'complete');

  section('filler-only sentences');
  seed('m4', ['clean', 'clean'], 'analyzing', 0);
  tally = await analysis.recalculateMeetingMetrics('m4', finishedRun());
  check('stay out of the total', tally.sentencesTotal, 0);
  check('leave nothing to rate', tally.cleanSentenceRate, null);

  section('a run stopped partway');
  seed('m5', ['clean', 'failed', 'failed'], 'transcribed');
  tally = await analysis.recalculateMeetingMetrics('m5', finishedRun(true));
  check('reports what was checked as partial', tally.analysisState, 'partial');
  // STOP_ANALYSIS parks the meeting at 'transcribed' so the UI can offer to
  // start again; concluding the run here would take that away.
  check('leaves the status alone', meeting('m5').status, 'transcribed');
  check('leaves the end time alone', meeting('m5').ended_at, 500);

  section('a plain recount');
  seed('m6', ['clean', 'has_mistake'], 'transcribed');
  await analysis.recalculateMeetingMetrics('m6');
  // Dismissing a false positive must not promote a stopped meeting.
  check('does not change the status', meeting('m6').status, 'transcribed');
  check('does not change the end time', meeting('m6').ended_at, 500);
  check('still updates the numbers', meeting('m6').sentences_clean, 1);

  raw.close();
  const { closeDb } = await import('../../src/main/db/connection');
  closeDb();
  finish('metrics');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
