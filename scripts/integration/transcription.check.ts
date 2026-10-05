/**
 * Checks chunk-by-chunk transcription: that one bad chunk costs only itself,
 * that resuming redoes just the failed chunks, and that timestamps stay
 * absolute when a retried chunk turns out a different length.
 */
import { app } from 'electron';
import Database from 'better-sqlite3';
import path from 'node:path';
import { check, section, finish, makeTempDir } from './harness';
import type { ChunkTranscriber, ChunkTranscription } from '../../src/main/services/transcription.service';

const tmp = makeTempDir('replay-transcription-');
app.setPath('userData', tmp);
const dbPath = path.join(tmp, 'replay.db');

const PATHS = ['/rec/mic_chunk_0.webm', '/rec/mic_chunk_1.webm', '/rec/mic_chunk_2.webm'];

/** Two 10-second segments per chunk, labelled by chunk. */
function speech(name: string, durationSeconds: number | null): ChunkTranscription {
  return {
    segments: [
      { startTime: 0, endTime: 10, text: `${name} a`, translatedText: null, confidence: null },
      { startTime: 10, endTime: 20, text: `${name} b`, translatedText: null, confidence: null },
    ],
    durationSeconds,
  };
}

async function main() {
  const { applySchema } = await import('../../src/main/db/apply-schema');
  const setup = new Database(dbPath);
  applySchema(setup);
  setup.prepare(`INSERT INTO meetings (id,title,recording_mode,grammar_mode,started_at,status) VALUES ('m1','T','meeting','professional',1,'transcribing')`).run();
  setup.close();

  const svc = await import('../../src/main/services/transcription.service');
  const raw = new Database(dbPath);

  const segments = () => raw.prepare(
    `SELECT chunk_index, segment_index, start_time, text FROM transcript_segments WHERE meeting_id='m1' ORDER BY segment_index`
  ).all() as { chunk_index: number; segment_index: number; start_time: number; text: string }[];

  const base = { fallbackChunkSeconds: 300, whisperModel: 'ggml-base.en.bin' };

  section('a chunk that fails');
  const calls: string[] = [];
  const breaksChunk1: ChunkTranscriber = async p => {
    const name = path.basename(p, '.webm');
    calls.push(name);
    if (name === 'mic_chunk_1') throw new svc.ChunkTranscriptionError('whisper timed out', 30);
    return speech(name, 30);
  };
  let result = await svc.transcribeChunks('m1', PATHS, { ...base, resume: false, transcribe: breaksChunk1 });

  check('does not stop the run', result.chunks.map(c => c.status), ['ok', 'failed', 'ok']);
  check('is attempted twice before giving up', calls.filter(c => c === 'mic_chunk_1').length, 2);
  check('keeps its error for the report', result.chunks[1].errorMessage, 'whisper timed out');
  check('still keeps the length the audio had', result.chunks[1].durationSeconds, 30);
  check('leaves the other chunks transcribed', result.segments.length, 4);
  // Chunk 2 starts after chunks 0 and 1, failed or not: 30 + 30.
  check('offsets later chunks past it', segments().map(s => s.start_time), [0, 10, 60, 70]);
  check('numbers segments contiguously', segments().map(s => s.segment_index), [0, 1, 2, 3]);

  section('resuming');
  calls.length = 0;
  // This time the retried chunk is measured at 40s, not the 30s stored.
  const fixed: ChunkTranscriber = async p => {
    const name = path.basename(p, '.webm');
    calls.push(name);
    return speech(name, name === 'mic_chunk_1' ? 40 : 30);
  };
  result = await svc.transcribeChunks('m1', PATHS, {
    ...base,
    whisperModel: 'ggml-small.en.bin',
    resume: true,
    transcribe: fixed,
  });

  check('redoes only the failed chunk', calls, ['mic_chunk_1']);
  check('reports how many it attempted', result.attempted, 1);
  check('leaves every chunk ok', result.chunks.map(c => c.status), ['ok', 'ok', 'ok']);
  check('records the model per chunk', result.chunks.map(c => c.whisperModel), [
    'ggml-base.en.bin', 'ggml-small.en.bin', 'ggml-base.en.bin',
  ]);
  check('puts the chunk back in recording order', segments().map(s => s.text), [
    'mic_chunk_0 a', 'mic_chunk_0 b', 'mic_chunk_1 a', 'mic_chunk_1 b', 'mic_chunk_2 a', 'mic_chunk_2 b',
  ]);
  // Chunk 1 moved from a 30s to a 40s length, so chunk 2 slides by 10.
  check('shifts later chunks by the corrected length', segments().map(s => s.start_time), [0, 10, 30, 40, 70, 80]);
  check('renumbers segments across the meeting', segments().map(s => s.segment_index), [0, 1, 2, 3, 4, 5]);

  section('resuming with nothing left to do');
  calls.length = 0;
  result = await svc.transcribeChunks('m1', PATHS, { ...base, resume: true, transcribe: fixed });
  check('transcribes nothing', calls, []);
  check('keeps the transcript', result.segments.length, 6);

  section('a transient failure');
  let flaky = 0;
  const failsOnce: ChunkTranscriber = async p => {
    if (path.basename(p) === 'mic_chunk_0.webm' && flaky++ === 0) throw new Error('ffmpeg hiccup');
    return speech(path.basename(p, '.webm'), 30);
  };
  result = await svc.transcribeChunks('m1', PATHS, { ...base, resume: false, transcribe: failsOnce });
  check('recovers on the second attempt', result.chunks[0].status, 'ok');

  section('a chunk whose audio cannot be read');
  const unreadable: ChunkTranscriber = async p => {
    if (path.basename(p) === 'mic_chunk_0.webm') throw new Error('Invalid data found when processing input');
    return speech(path.basename(p, '.webm'), 30);
  };
  result = await svc.transcribeChunks('m1', PATHS, { ...base, resume: false, transcribe: unreadable });
  check('is given the configured length', result.chunks[0].durationSeconds, 300);
  check('so the next chunk starts after it', segments()[0].start_time, 300);

  section('starting over');
  result = await svc.transcribeChunks('m1', PATHS.slice(0, 2), { ...base, resume: false, transcribe: fixed });
  check('replaces every chunk row', result.chunks.length, 2);
  check('replaces the transcript', segments().length, 4);

  section('streaming each chunk as it lands');
  const seenMidRun: string[][] = [];
  const reported: string[] = [];
  await svc.transcribeChunks('m1', PATHS, {
    ...base,
    resume: false,
    transcribe: fixed,
    onChunkDone: async (chunk, done, total) => {
      reported.push(`${chunk.chunkIndex}:${chunk.status} ${done}/${total}`);
      seenMidRun.push((await svc.loadSegments('m1')).map(s => s.text));
    },
  });
  check('reports every chunk once, in order', reported, ['0:ok 1/3', '1:ok 2/3', '2:ok 3/3']);
  // The report reloads on each event, before the final renumbering.
  check('has the chunk committed when it reports', seenMidRun[0], ['mic_chunk_0 a', 'mic_chunk_0 b']);
  check('reads back in recording order mid-run', seenMidRun[1], [
    'mic_chunk_0 a', 'mic_chunk_0 b', 'mic_chunk_1 a', 'mic_chunk_1 b',
  ]);

  section('stopping mid-run');
  calls.length = 0;
  // Chunk 1 hangs like a slow whisper until it is killed by the abort.
  const hangsOnChunk1: ChunkTranscriber = (p, signal) => {
    const name = path.basename(p, '.webm');
    calls.push(name);
    if (name !== 'mic_chunk_1') return Promise.resolve(speech(name, 30));
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('whisper killed')));
      setTimeout(() => svc.cancelTranscription('m1'), 10);
    });
  };
  result = await svc.transcribeChunks('m1', PATHS, { ...base, resume: false, transcribe: hangsOnChunk1 });
  check('reports the run as cancelled', result.cancelled, true);
  check('kills the chunk in progress instead of retrying it', calls, ['mic_chunk_0', 'mic_chunk_1']);
  // No 'failed' row: a stop is not a failure, and a resume must redo it.
  check('keeps only what finished', result.chunks.map(c => `${c.chunkIndex}:${c.status}`), ['0:ok']);
  check('keeps the finished text', result.segments.length, 2);
  check('has nothing left to cancel', svc.cancelTranscription('m1'), false);

  calls.length = 0;
  result = await svc.transcribeChunks('m1', PATHS, {
    ...base,
    whisperModel: 'ggml-small.en.bin',
    resume: true,
    transcribe: fixed,
  });
  check('resumes from the stopped chunk', calls, ['mic_chunk_1', 'mic_chunk_2']);
  check('finishes the transcript', result.chunks.map(c => c.status), ['ok', 'ok', 'ok']);
  check('with the newly chosen model for the rest', result.chunks.map(c => c.whisperModel), [
    'ggml-base.en.bin', 'ggml-small.en.bin', 'ggml-small.en.bin',
  ]);

  section('a second run on the same meeting');
  let release: () => void = () => undefined;
  const slow: ChunkTranscriber = p => new Promise(resolve => {
    release = () => resolve(speech(path.basename(p, '.webm'), 30));
  });
  const first = svc.transcribeChunks('m1', PATHS.slice(0, 1), { ...base, resume: false, transcribe: slow });
  const second = await svc.transcribeChunks('m1', PATHS.slice(0, 1), { ...base, resume: false, transcribe: fixed })
    .then(() => 'ran', (err: Error) => err.message);
  check('is refused while the first is running', second, 'This recording is already being transcribed.');
  await new Promise(r => setTimeout(r, 0));
  release();
  check('leaves the first to finish', (await first).chunks.map(c => c.status), ['ok']);

  section('cascades');
  raw.pragma('foreign_keys = ON');
  raw.prepare(`DELETE FROM meetings WHERE id='m1'`).run();
  check('deleting a meeting clears its chunk rows',
    (raw.prepare('SELECT COUNT(*) c FROM transcript_chunks').get() as { c: number }).c, 0);

  raw.close();
  const { closeDb } = await import('../../src/main/db/connection');
  closeDb();
  finish('transcription');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
