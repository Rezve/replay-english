import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import type { TranscriptChunk, TranscriptSegment } from '../../shared/types';

export interface ChunkTranscription {
  segments: {
    startTime: number; // relative to the chunk
    endTime: number;
    text: string;
    translatedText: string | null;
    confidence: number | null;
  }[];
  /** Measured from the audio; null when the header could not be read. */
  durationSeconds: number | null;
}

/**
 * A chunk failure that still knows how long the audio was — whisper timing
 * out on a decodable chunk, say — so later chunks keep accurate timestamps.
 */
export class ChunkTranscriptionError extends Error {
  constructor(message: string, readonly durationSeconds: number | null) {
    super(message);
  }
}

/**
 * Converts and transcribes one chunk file. Injected so checks need no whisper.
 * Must stop promptly (killing whisper) when `signal` aborts.
 */
export type ChunkTranscriber = (chunkPath: string, signal: AbortSignal) => Promise<ChunkTranscription>;

export interface TranscribeChunksOptions {
  whisperModel: string;
  /** Keep 'ok' chunks and redo only the rest, instead of starting over. */
  resume: boolean;
  transcribe: ChunkTranscriber;
  /** Used as a chunk's length when the audio could not be measured. */
  fallbackChunkSeconds: number;
  onProgress?: (done: number, total: number, chunkIndex: number) => void;
  /** After each chunk is committed, so its text can be shown straight away. */
  onChunkDone?: (chunk: TranscriptChunk, done: number, total: number) => void;
}

export interface TranscribeChunksResult {
  chunks: TranscriptChunk[];
  segments: TranscriptSegment[];
  /** Chunks attempted by this call, so the caller can tell "nothing to do". */
  attempted: number;
  /** Stopped by cancelTranscription; chunks not reached have no row. */
  cancelled: boolean;
}

const ATTEMPTS_PER_CHUNK = 2;

// One controller per meeting being transcribed, so Stop can kill whisper mid-chunk.
const activeRuns = new Map<string, AbortController>();

/**
 * Stops a meeting's transcription. Chunks already done are kept; the one in
 * progress is abandoned without a row, so a resume picks it up again.
 * Returns false when nothing was running.
 */
export function cancelTranscription(meetingId: string): boolean {
  const run = activeRuns.get(meetingId);
  if (!run) return false;
  run.abort();
  return true;
}

export async function loadTranscriptChunks(meetingId: string): Promise<TranscriptChunk[]> {
  return getDb().select().from(schema.transcriptChunks)
    .where(eq(schema.transcriptChunks.meetingId, meetingId))
    .orderBy(schema.transcriptChunks.chunkIndex)
    .all();
}

/**
 * Ordered by chunk first: mid-run, a freshly inserted chunk carries provisional
 * indices until renumberSegments, and this order is what renumbering produces.
 */
export async function loadSegments(meetingId: string): Promise<TranscriptSegment[]> {
  return getDb().select().from(schema.transcriptSegments)
    .where(eq(schema.transcriptSegments.meetingId, meetingId))
    .orderBy(schema.transcriptSegments.chunkIndex, schema.transcriptSegments.segmentIndex)
    .all();
}

/**
 * Transcribes a meeting one chunk at a time, recording each chunk's outcome.
 *
 * A failing chunk no longer aborts the run: it is stored as 'failed' and the
 * rest carry on, so a long meeting with one bad chunk still yields a
 * transcript, and `resume` later redoes just that chunk — with a different
 * model if wanted. Timestamps stay absolute: each chunk is offset by the
 * stored lengths of the chunks before it.
 */
export async function transcribeChunks(
  meetingId: string,
  chunkPaths: string[],
  opts: TranscribeChunksOptions
): Promise<TranscribeChunksResult> {
  const db = getDb();
  const chunkTable = schema.transcriptChunks;
  const segmentTable = schema.transcriptSegments;

  if (!opts.resume) {
    // Segments cascade to sentences and mistakes.
    db.transaction(tx => {
      tx.delete(segmentTable).where(eq(segmentTable.meetingId, meetingId)).run();
      tx.delete(chunkTable).where(eq(chunkTable.meetingId, meetingId)).run();
    });
  } else {
    // Rows past the end belong to files that no longer exist.
    db.transaction(tx => {
      tx.delete(segmentTable)
        .where(and(eq(segmentTable.meetingId, meetingId), gte(segmentTable.chunkIndex, chunkPaths.length)))
        .run();
      tx.delete(chunkTable)
        .where(and(eq(chunkTable.meetingId, meetingId), gte(chunkTable.chunkIndex, chunkPaths.length)))
        .run();
    });
  }

  // Two runs on one meeting would transcribe the same chunks and race on
  // their rows; the IPC layer joins duplicate requests, so this is a bug.
  if (activeRuns.has(meetingId)) {
    throw new Error('This recording is already being transcribed.');
  }
  const controller = new AbortController();
  activeRuns.set(meetingId, controller);
  const { signal } = controller;

  const rows = new Map<number, TranscriptChunk>();
  for (const row of await loadTranscriptChunks(meetingId)) rows.set(row.chunkIndex, row);

  // A row for a different file than now sits at that index is stale.
  const todo = chunkPaths
    .map((p, i) => ({ path: p, index: i }))
    .filter(({ path: p, index }) => {
      const row = rows.get(index);
      return !(row && row.status === 'ok' && row.sourceFile === path.basename(p));
    });

  try {
    for (let n = 0; n < todo.length; n++) {
      if (signal.aborted) break;
      const { path: chunkPath, index } = todo[n];
      opts.onProgress?.(n + 1, todo.length, index);

      let offset = 0;
      for (let j = 0; j < index; j++) {
        offset += rows.get(j)?.durationSeconds ?? opts.fallbackChunkSeconds;
      }

      let result: ChunkTranscription | null = null;
      let failure: unknown = null;
      for (let attempt = 1; attempt <= ATTEMPTS_PER_CHUNK; attempt++) {
        try {
          result = await opts.transcribe(chunkPath, signal);
          break;
        } catch (err) {
          // A killed whisper is not a failed chunk: leave it for the resume.
          if (signal.aborted) break;
          failure = err;
          console.warn(`Chunk ${index + 1} failed (attempt ${attempt} of ${ATTEMPTS_PER_CHUNK}):`, (err as Error)?.message);
        }
      }

      if (signal.aborted && !result) break;

      const durationSeconds = result
        ? result.durationSeconds
          ?? (result.segments.length > 0 ? result.segments[result.segments.length - 1].endTime : opts.fallbackChunkSeconds)
        : (failure instanceof ChunkTranscriptionError ? failure.durationSeconds : null) ?? opts.fallbackChunkSeconds;

      const row: TranscriptChunk = {
        meetingId,
        chunkIndex: index,
        sourceFile: path.basename(chunkPath),
        status: result ? 'ok' : 'failed',
        errorMessage: result ? null : describeError(failure),
        durationSeconds,
        whisperModel: opts.whisperModel,
        segmentCount: result?.segments.length ?? 0,
        transcribedAt: Date.now(),
      };

      // Segments and the row land together, so an 'ok' row never lacks its text.
      const previousDuration = rows.get(index)?.durationSeconds;
      db.transaction(tx => {
        tx.delete(segmentTable)
          .where(and(eq(segmentTable.meetingId, meetingId), eq(segmentTable.chunkIndex, index)))
          .run();

        result?.segments.forEach((seg, s) => {
          tx.insert(segmentTable).values({
            id: uuidv4(),
            meetingId,
            chunkIndex: index,
            // Provisional; renumbered across the meeting below.
            segmentIndex: s,
            startTime: seg.startTime + offset,
            endTime: seg.endTime + offset,
            text: seg.text,
            translatedText: seg.translatedText,
            confidence: seg.confidence,
          }).run();
        });

        tx.insert(chunkTable).values(row)
          .onConflictDoUpdate({ target: [chunkTable.meetingId, chunkTable.chunkIndex], set: row })
          .run();

        // A retried chunk can measure differently from its earlier guess; move
        // everything after it so playback still lines up.
        const shift = previousDuration === undefined ? 0 : durationSeconds - previousDuration;
        if (shift !== 0) {
          tx.update(segmentTable)
            .set({
              startTime: sql`${segmentTable.startTime} + ${shift}`,
              endTime: sql`${segmentTable.endTime} + ${shift}`,
            })
            .where(and(eq(segmentTable.meetingId, meetingId), gt(segmentTable.chunkIndex, index)))
            .run();
        }
      });
      rows.set(index, row);
      opts.onChunkDone?.(row, n + 1, todo.length);
    }
  } finally {
    activeRuns.delete(meetingId);
  }

  renumberSegments(meetingId);

  return {
    chunks: await loadTranscriptChunks(meetingId),
    segments: await loadSegments(meetingId),
    attempted: todo.length,
    cancelled: signal.aborted,
  };
}

/** Gives segments one meeting-wide order: by chunk, then by position within it. */
function renumberSegments(meetingId: string) {
  const db = getDb();
  const segmentTable = schema.transcriptSegments;
  const ordered = db.select({ id: segmentTable.id }).from(segmentTable)
    .where(eq(segmentTable.meetingId, meetingId))
    .orderBy(segmentTable.chunkIndex, segmentTable.segmentIndex)
    .all();

  db.transaction(tx => {
    ordered.forEach((seg, i) => {
      tx.update(segmentTable).set({ segmentIndex: i }).where(eq(segmentTable.id, seg.id)).run();
    });
  });
}

function describeError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err ?? 'Unknown error');
  // whisper's stderr can run to pages; the report only needs the gist.
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}
