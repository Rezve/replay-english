import { eq, and, gte, ne, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import type { AnalyticsData, TimeRange, RecordingMode } from '../../shared/types';

function getTimeRangeMs(range: TimeRange): number | null {
  const now = Date.now();
  switch (range) {
    case '7d': return now - 7 * 24 * 60 * 60 * 1000;
    case '30d': return now - 30 * 24 * 60 * 60 * 1000;
    case '90d': return now - 90 * 24 * 60 * 60 * 1000;
    case 'all': return null;
  }
}

const EMPTY: AnalyticsData = {
  totalMeetings: 0,
  averageMistakes: 0,
  averageCleanRate: null,
  sentencesChecked: 0,
  sentencesClean: 0,
  mistakesByCategory: [],
  cleanRateTrend: [],
  dailyTrend: [],
  topPatterns: [],
  mostImprovedCategory: null,
  mostRegressedCategory: null,
  mostProblematicCategory: null,
};

/** YYYY-MM-DD in local time, so grouping matches the user's idea of a day. */
function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export async function getAnalytics(
  timeRange: TimeRange,
  profileId?: string,
  recordingMode?: RecordingMode
): Promise<AnalyticsData> {
  const db = getDb();
  const fromDate = getTimeRangeMs(timeRange);

  const conditions = [eq(schema.meetings.status, 'completed')];
  if (fromDate) conditions.push(gte(schema.meetings.startedAt, fromDate));
  if (profileId) conditions.push(eq(schema.meetings.profileId, profileId));
  if (recordingMode) conditions.push(eq(schema.meetings.recordingMode, recordingMode));

  const meetings = await db.select().from(schema.meetings)
    .where(and(...conditions))
    .orderBy(schema.meetings.startedAt)
    .all();

  if (meetings.length === 0) return EMPTY;

  const meetingIds = meetings.map(m => m.id);

  // One query for every mistake in range, replacing a per-meeting loop.
  // Rejected occurrences are excluded everywhere so "not a mistake" actually
  // removes an item from the numbers.
  const mistakeRows = await db.select({
    meetingId: schema.mistakes.meetingId,
    createdAt: schema.mistakes.createdAt,
    categoryName: schema.errorCategories.name,
  })
    .from(schema.mistakes)
    .leftJoin(schema.errorCategories, eq(schema.mistakes.categoryId, schema.errorCategories.id))
    .where(and(
      inArray(schema.mistakes.meetingId, meetingIds),
      ne(schema.mistakes.occurrenceState, 'rejected')
    ))
    .all();

  // --- averages ---
  const avgMistakes = mistakeRows.length / meetings.length;

  // Pooled, not a mean of per-meeting rates: a four-sentence recording should
  // not weigh as much as a two-hundred-sentence one.
  const sentencesChecked = meetings.reduce(
    (sum, m) => sum + Math.max(0, m.sentencesTotal - m.sentencesFailed),
    0
  );
  const sentencesClean = meetings.reduce((sum, m) => sum + m.sentencesClean, 0);
  const averageCleanRate = sentencesChecked > 0
    ? Math.round((sentencesClean / sentencesChecked) * 1000) / 10
    : null;

  // --- categories ---
  const categoryCountMap = new Map<string, number>();
  for (const m of mistakeRows) {
    const cat = m.categoryName || 'Uncategorized';
    categoryCountMap.set(cat, (categoryCountMap.get(cat) || 0) + 1);
  }
  const mistakesByCategory = Array.from(categoryCountMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // --- trends ---
  const cleanRateTrend = meetings.map(m => ({
    meetingId: m.id,
    startedAt: m.startedAt,
    title: m.title,
    count: m.totalMistakes,
    cleanRate: m.cleanSentenceRate,
  }));

  // Real per-day grouping: two recordings on one day are one point, which is
  // what the old per-meeting "trend" claimed to be but was not.
  const byDay = new Map<string, { count: number; clean: number; checked: number }>();
  for (const m of meetings) {
    const key = dayKey(m.startedAt);
    const entry = byDay.get(key) ?? { count: 0, clean: 0, checked: 0 };
    entry.count += m.totalMistakes;
    entry.clean += m.sentencesClean;
    entry.checked += Math.max(0, m.sentencesTotal - m.sentencesFailed);
    byDay.set(key, entry);
  }
  const dailyTrend = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      count: v.count,
      cleanRate: v.checked > 0 ? Math.round((v.clean / v.checked) * 1000) / 10 : null,
    }));

  // --- top patterns ---
  const topPatterns = await getRankedPatterns(10);

  // --- improvement ---
  const { improved, regressed } = compareHalves(meetings, mistakeRows);

  return {
    totalMeetings: meetings.length,
    averageMistakes: Math.round(avgMistakes * 10) / 10,
    averageCleanRate,
    sentencesChecked,
    sentencesClean,
    mistakesByCategory,
    cleanRateTrend,
    dailyTrend,
    topPatterns,
    mostImprovedCategory: improved,
    mostRegressedCategory: regressed,
    mostProblematicCategory: mistakesByCategory[0]?.category ?? null,
  };
}

/**
 * Compares category rates per 100 checked sentences across the first and second
 * half of the window. Returns null until there is enough history to mean
 * anything, instead of the hardcoded null this used to return forever.
 */
function compareHalves(
  meetings: { id: string; sentencesTotal: number; sentencesFailed: number }[],
  mistakeRows: { meetingId: string; categoryName: string | null }[]
): { improved: string | null; regressed: string | null } {
  if (meetings.length < 4) return { improved: null, regressed: null };

  const mid = Math.floor(meetings.length / 2);
  const firstIds = new Set(meetings.slice(0, mid).map(m => m.id));
  const secondIds = new Set(meetings.slice(mid).map(m => m.id));

  const checkedIn = (ids: Set<string>) =>
    meetings
      .filter(m => ids.has(m.id))
      .reduce((sum, m) => sum + Math.max(0, m.sentencesTotal - m.sentencesFailed), 0);

  const firstChecked = checkedIn(firstIds);
  const secondChecked = checkedIn(secondIds);
  if (firstChecked === 0 || secondChecked === 0) return { improved: null, regressed: null };

  const rates = new Map<string, { first: number; second: number }>();
  for (const row of mistakeRows) {
    const cat = row.categoryName || 'Uncategorized';
    const entry = rates.get(cat) ?? { first: 0, second: 0 };
    if (firstIds.has(row.meetingId)) entry.first++;
    else if (secondIds.has(row.meetingId)) entry.second++;
    rates.set(cat, entry);
  }

  let improved: string | null = null;
  let regressed: string | null = null;
  let bestDrop = 0;
  let worstRise = 0;

  for (const [category, counts] of rates) {
    // Needs a real baseline, or a single stray mistake reads as a trend.
    if (counts.first < 3) continue;
    const firstRate = (counts.first / firstChecked) * 100;
    const secondRate = (counts.second / secondChecked) * 100;
    const change = (secondRate - firstRate) / firstRate;

    if (change < bestDrop) {
      bestDrop = change;
      improved = category;
    }
    if (change > worstRise) {
      worstRise = change;
      regressed = category;
    }
  }

  return { improved, regressed };
}

/**
 * Active patterns ranked by how much they deserve attention: recent frequency,
 * weighted by severity, decayed by how long since you last said it. A twelve-
 * time pattern you fixed two months ago should sink below a fresh one.
 */
export async function getRankedPatterns(limit: number): Promise<AnalyticsData['topPatterns']> {
  const db = getDb();

  const rows = await db.select({
    id: schema.patterns.id,
    ruleKey: schema.patterns.ruleKey,
    state: schema.patterns.state,
    occurrenceCount: schema.patterns.occurrenceCount,
    meetingCount: schema.patterns.meetingCount,
    lastSeenAt: schema.patterns.lastSeenAt,
    cleanRunStreak: schema.patterns.cleanRunStreak,
    relapseCount: schema.patterns.relapseCount,
    label: schema.rules.label,
    hint: schema.rules.hint,
    categorySlug: schema.rules.categorySlug,
    defaultSeverity: schema.rules.defaultSeverity,
  })
    .from(schema.patterns)
    .leftJoin(schema.rules, eq(schema.patterns.ruleKey, schema.rules.key))
    .where(ne(schema.patterns.state, 'ignored'))
    .all();

  const now = Date.now();
  const severityWeight = { major: 3, moderate: 2, minor: 1 } as const;

  return rows
    .map(r => {
      const daysSince = Math.max(0, (now - r.lastSeenAt) / (24 * 60 * 60 * 1000));
      const weight = severityWeight[r.defaultSeverity ?? 'minor'];
      const recencyBoost = 1 / (1 + daysSince / 14);
      return {
        id: r.id,
        ruleKey: r.ruleKey,
        label: r.label ?? r.ruleKey,
        hint: r.hint ?? '',
        categorySlug: r.categorySlug ?? '',
        state: r.state,
        occurrenceCount: r.occurrenceCount,
        meetingCount: r.meetingCount,
        lastSeenAt: r.lastSeenAt,
        cleanRunStreak: r.cleanRunStreak,
        relapseCount: r.relapseCount,
        score: Math.round(r.occurrenceCount * weight * recencyBoost * 100) / 100,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
