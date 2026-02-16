import { eq, and, gte, sql, desc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import type { AnalyticsData, TimeRange } from '../../shared/types';

function getTimeRangeMs(range: TimeRange): number | null {
  const now = Date.now();
  switch (range) {
    case '7d': return now - 7 * 24 * 60 * 60 * 1000;
    case '30d': return now - 30 * 24 * 60 * 60 * 1000;
    case '90d': return now - 90 * 24 * 60 * 60 * 1000;
    case 'all': return null;
  }
}

export async function getAnalytics(timeRange: TimeRange, profileId?: string): Promise<AnalyticsData> {
  const db = getDb();
  const fromDate = getTimeRangeMs(timeRange);

  // Build conditions
  const conditions = [eq(schema.meetings.status, 'completed')];
  if (fromDate) {
    conditions.push(gte(schema.meetings.startedAt, fromDate));
  }
  if (profileId) {
    conditions.push(eq(schema.meetings.profileId, profileId));
  }

  // Get completed meetings
  const meetings = await db.select().from(schema.meetings)
    .where(and(...conditions))
    .orderBy(schema.meetings.startedAt)
    .all();

  if (meetings.length === 0) {
    return {
      totalMeetings: 0,
      averageMistakes: 0,
      averageScore: 0,
      mistakesByCategory: [],
      mistakesTrend: [],
      recurringMistakes: [],
      mostImprovedCategory: null,
      mostProblematicCategory: null,
    };
  }

  const meetingIds = meetings.map(m => m.id);

  // Average stats
  const totalMistakes = meetings.reduce((sum, m) => sum + m.totalMistakes, 0);
  const avgMistakes = totalMistakes / meetings.length;
  const avgScore = meetings.reduce((sum, m) => sum + (m.overallScore || 0), 0) / meetings.length;

  // Mistakes by category
  const allMistakes = [];
  for (const meetingId of meetingIds) {
    const mistakes = await db.select({
      categoryName: schema.errorCategories.name,
      parentCategory: schema.errorCategories.parentCategory,
    })
      .from(schema.mistakes)
      .leftJoin(schema.errorCategories, eq(schema.mistakes.categoryId, schema.errorCategories.id))
      .where(eq(schema.mistakes.meetingId, meetingId))
      .all();
    allMistakes.push(...mistakes);
  }

  const categoryCountMap = new Map<string, number>();
  for (const m of allMistakes) {
    const cat = m.categoryName || 'Uncategorized';
    categoryCountMap.set(cat, (categoryCountMap.get(cat) || 0) + 1);
  }

  const mistakesByCategory = Array.from(categoryCountMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Trend data (group by date)
  const mistakesTrend = meetings.map(m => ({
    date: new Date(m.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    count: m.totalMistakes,
    score: Math.round(m.overallScore || 0),
  }));

  // Recurring mistakes
  const recurringMap = new Map<string, { corrected: string; count: number }>();
  for (const meetingId of meetingIds) {
    const mistakes = await db.select().from(schema.mistakes)
      .where(eq(schema.mistakes.meetingId, meetingId))
      .all();
    for (const m of mistakes) {
      const key = m.originalText.toLowerCase().trim();
      const existing = recurringMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        recurringMap.set(key, { corrected: m.correctedText, count: 1 });
      }
    }
  }

  const recurringMistakes = Array.from(recurringMap.entries())
    .filter(([_, v]) => v.count >= 2)
    .map(([original, v]) => ({ original, corrected: v.corrected, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Most problematic/improved categories
  const mostProblematicCategory = mistakesByCategory.length > 0 ? mistakesByCategory[0].category : null;

  return {
    totalMeetings: meetings.length,
    averageMistakes: Math.round(avgMistakes * 10) / 10,
    averageScore: Math.round(avgScore * 10) / 10,
    mistakesByCategory,
    mistakesTrend,
    recurringMistakes,
    mostImprovedCategory: null, // Would need historical comparison
    mostProblematicCategory,
  };
}
