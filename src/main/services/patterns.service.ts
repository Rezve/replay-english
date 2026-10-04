import { v4 as uuidv4 } from 'uuid';
import { eq, and, ne, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import { categorySlug } from '../../shared/constants';
import type { PatternState, MistakeSeverity } from '../../shared/types';

/**
 * Resolves a model-supplied rule key against the seeded vocabulary.
 *
 * The prompt gives the model a closed list, but local models still invent keys
 * or answer with a label. Rather than letting those create junk patterns, each
 * one falls back to its category's '.other' bucket — and the raw value is kept
 * on the occurrence so the vocabulary can be tuned against reality.
 */
export async function resolveRuleKey(
  rawRuleKey: string,
  categoryName: string | undefined
): Promise<string | null> {
  const db = getDb();
  const known = await db.select({ key: schema.rules.key }).from(schema.rules).all();
  const keys = new Set(known.map(r => r.key));

  const candidate = rawRuleKey.trim().toLowerCase();
  if (candidate && keys.has(candidate)) return candidate;

  if (!categoryName) return null;
  const fallback = `${categorySlug(categoryName)}.other`;
  return keys.has(fallback) ? fallback : null;
}

/**
 * Finds or creates the pattern for a rule and records that it just occurred.
 * Counters are recomputed in one pass at the end of a run, so this only has to
 * establish the row and its last-seen position.
 */
export async function assignPattern(ruleKey: string, meetingId: string): Promise<string | null> {
  const db = getDb();
  const now = Date.now();

  const existing = await db.select().from(schema.patterns)
    .where(eq(schema.patterns.ruleKey, ruleKey))
    .get();

  if (existing) {
    await db.update(schema.patterns)
      .set({ lastSeenAt: now, lastMeetingId: meetingId, updatedAt: now })
      .where(eq(schema.patterns.id, existing.id));
    return existing.id;
  }

  const id = uuidv4();
  try {
    await db.insert(schema.patterns).values({
      id,
      ruleKey,
      state: 'new',
      firstSeenAt: now,
      lastSeenAt: now,
      lastMeetingId: meetingId,
      updatedAt: now,
    });
    return id;
  } catch {
    // rule_key is UNIQUE — another write won the race.
    const row = await db.select({ id: schema.patterns.id }).from(schema.patterns)
      .where(eq(schema.patterns.ruleKey, ruleKey))
      .get();
    return row?.id ?? null;
  }
}

/**
 * Rebuilds every active pattern's counters from the mistakes actually stored,
 * then advances the mastery state machine.
 *
 * Recomputing rather than incrementing means rejecting an occurrence, deleting a
 * meeting, or re-analysing can never leave a pattern's count overstating what
 * the database holds.
 */
export async function recomputePatternCounters(meetingId: string | null): Promise<void> {
  const db = getDb();
  const now = Date.now();

  // Occurrence totals per pattern, excluding rejected ones.
  const tallies = await db.select({
    patternId: schema.mistakes.patternId,
    occurrences: sql<number>`count(*)`,
    meetings: sql<number>`count(distinct ${schema.mistakes.meetingId})`,
    lastSeen: sql<number>`max(${schema.mistakes.createdAt})`,
  })
    .from(schema.mistakes)
    .where(ne(schema.mistakes.occurrenceState, 'rejected'))
    .groupBy(schema.mistakes.patternId)
    .all();

  const byPattern = new Map(
    tallies.filter(t => t.patternId).map(t => [t.patternId as string, t])
  );

  // Which patterns showed up in the run that just finished.
  const occurredNow = new Set<string>();
  if (meetingId) {
    const rows = await db.select({ patternId: schema.mistakes.patternId })
      .from(schema.mistakes)
      .where(and(
        eq(schema.mistakes.meetingId, meetingId),
        ne(schema.mistakes.occurrenceState, 'rejected')
      ))
      .all();
    for (const row of rows) if (row.patternId) occurredNow.add(row.patternId);
  }

  const patterns = await db.select().from(schema.patterns).all();

  for (const pattern of patterns) {
    const tally = byPattern.get(pattern.id);
    const occurrenceCount = tally?.occurrences ?? 0;
    const meetingCount = tally?.meetings ?? 0;
    const occurredThisRun = occurredNow.has(pattern.id);

    let state: PatternState = pattern.state;
    let relapseCount = pattern.relapseCount;
    let masteredAt = pattern.masteredAt;
    // Clean runs are what earn the "ready to mark mastered?" nudge.
    let cleanRunStreak = pattern.cleanRunStreak;

    if (occurredThisRun) {
      cleanRunStreak = 0;
      if (pattern.state === 'mastered') {
        // A mastered habit coming back is the signal that makes mastery mean
        // something, so it reopens rather than staying quietly mastered.
        state = 'learning';
        relapseCount += 1;
        masteredAt = null;
      } else if (pattern.state === 'new' && occurrenceCount >= 2) {
        state = 'learning';
      }
    } else if (meetingId && pattern.state !== 'ignored' && pattern.state !== 'mastered') {
      cleanRunStreak += 1;
    }

    // A pattern whose every occurrence was rejected should stop being tracked.
    if (occurrenceCount === 0 && pattern.state !== 'ignored') {
      state = 'new';
      cleanRunStreak = 0;
    }

    await db.update(schema.patterns)
      .set({
        state,
        occurrenceCount,
        meetingCount,
        cleanRunStreak,
        relapseCount,
        masteredAt,
        lastSeenAt: tally?.lastSeen ?? pattern.lastSeenAt,
        updatedAt: now,
      })
      .where(eq(schema.patterns.id, pattern.id));
  }
}

export async function setPatternState(patternId: string, state: PatternState): Promise<void> {
  const db = getDb();
  const now = Date.now();
  await db.update(schema.patterns)
    .set({
      state,
      masteredAt: state === 'mastered' ? now : null,
      ignoredAt: state === 'ignored' ? now : null,
      // Marking something mastered resets the streak that prompted it.
      cleanRunStreak: state === 'mastered' ? 0 : undefined,
      updatedAt: now,
    })
    .where(eq(schema.patterns.id, patternId));
}

export interface PatternOccurrence {
  id: string;
  meetingId: string;
  meetingTitle: string;
  recordingMode: string;
  startedAt: number;
  sentenceText: string;
  startTime: number;
  originalText: string;
  correctedText: string;
  explanation: string;
  severity: MistakeSeverity;
  occurrenceState: string;
  rawRuleKey: string | null;
}

/** Every occurrence of a pattern across recordings, newest first. */
export async function getPatternOccurrences(patternId: string): Promise<PatternOccurrence[]> {
  const db = getDb();
  const rows = await db.select({
    id: schema.mistakes.id,
    meetingId: schema.mistakes.meetingId,
    meetingTitle: schema.meetings.title,
    recordingMode: schema.meetings.recordingMode,
    startedAt: schema.meetings.startedAt,
    sentenceText: schema.sentences.text,
    startTime: schema.sentences.startTime,
    originalText: schema.mistakes.originalText,
    correctedText: schema.mistakes.correctedText,
    explanation: schema.mistakes.explanation,
    severity: schema.mistakes.severity,
    occurrenceState: schema.mistakes.occurrenceState,
    rawRuleKey: schema.mistakes.rawRuleKey,
  })
    .from(schema.mistakes)
    .innerJoin(schema.meetings, eq(schema.mistakes.meetingId, schema.meetings.id))
    .leftJoin(schema.sentences, eq(schema.mistakes.sentenceId, schema.sentences.id))
    .where(eq(schema.mistakes.patternId, patternId))
    .all();

  return rows
    .map(r => ({
      ...r,
      sentenceText: r.sentenceText ?? r.originalText,
      startTime: r.startTime ?? 0,
    }))
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Counts for the sidebar badge and the review queue's section headers. */
export async function getReviewSummary(): Promise<{
  active: number;
  mastered: number;
  ignored: number;
  relapsed: number;
  unlocatedShare: number;
}> {
  const db = getDb();
  const patterns = await db.select({
    state: schema.patterns.state,
    relapseCount: schema.patterns.relapseCount,
    occurrenceCount: schema.patterns.occurrenceCount,
  }).from(schema.patterns).all();

  const tracked = patterns.filter(p => p.occurrenceCount > 0);

  // How often the model's quote could not be found in the sentence — a direct
  // read on analysis quality, surfaced so it does not go unnoticed.
  const spans = await db.select({
    match: schema.mistakes.spanMatch,
    count: sql<number>`count(*)`,
  })
    .from(schema.mistakes)
    .groupBy(schema.mistakes.spanMatch)
    .all();
  const totalSpans = spans.reduce((sum, s) => sum + s.count, 0);
  const unlocated = spans.find(s => s.match === 'none')?.count ?? 0;

  return {
    active: tracked.filter(p => p.state === 'new' || p.state === 'learning').length,
    mastered: tracked.filter(p => p.state === 'mastered').length,
    ignored: patterns.filter(p => p.state === 'ignored').length,
    relapsed: tracked.filter(p => p.state === 'learning' && p.relapseCount > 0).length,
    unlocatedShare: totalSpans > 0 ? Math.round((unlocated / totalSpans) * 1000) / 10 : 0,
  };
}

/**
 * Flips one occurrence's review state. Rejecting a false positive has to ripple
 * out: the sentence may become clean again, which changes the meeting's rate.
 */
export async function setOccurrenceState(
  mistakeId: string,
  occurrenceState: 'new' | 'acknowledged' | 'rejected'
): Promise<{ meetingId: string } | null> {
  const db = getDb();
  const mistake = await db.select().from(schema.mistakes)
    .where(eq(schema.mistakes.id, mistakeId))
    .get();
  if (!mistake) return null;

  await db.update(schema.mistakes)
    .set({ occurrenceState })
    .where(eq(schema.mistakes.id, mistakeId));

  // Does the sentence still have a surviving mistake?
  const siblings = await db.select({
    id: schema.mistakes.id,
    occurrenceState: schema.mistakes.occurrenceState,
  })
    .from(schema.mistakes)
    .where(eq(schema.mistakes.sentenceId, mistake.sentenceId))
    .all();

  const anyLive = siblings.some(s => s.occurrenceState !== 'rejected');
  const sentence = await db.select().from(schema.sentences)
    .where(eq(schema.sentences.id, mistake.sentenceId))
    .get();

  // Only move a sentence that was actually checked; a failed one stays failed.
  if (sentence && (sentence.status === 'clean' || sentence.status === 'has_mistake')) {
    await db.update(schema.sentences)
      .set({ status: anyLive ? 'has_mistake' : 'clean' })
      .where(eq(schema.sentences.id, mistake.sentenceId));
  }

  return { meetingId: mistake.meetingId };
}

/** Removes patterns that no longer have any occurrence and were never acted on. */
export async function pruneEmptyPatterns(): Promise<number> {
  const db = getDb();
  const empty = await db.select({ id: schema.patterns.id })
    .from(schema.patterns)
    .where(and(
      eq(schema.patterns.occurrenceCount, 0),
      eq(schema.patterns.state, 'new')
    ))
    .all();
  if (empty.length === 0) return 0;

  await db.delete(schema.patterns).where(inArray(schema.patterns.id, empty.map(p => p.id)));
  return empty.length;
}
