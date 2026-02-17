import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import {
  analyzeSegments,
  analyzeGrammarFull,
  summarizeTranscript,
  extractActionItems,
  suggestVocabulary,
  analyzeFluency,
  type AnalysisResult,
} from './ollama.service';
import type { TranscriptSegment, Mistake, MeetingAnalysis, ContextAnalysisType } from '../../shared/types';

const BATCH_SIZE = 4; // smaller batches for slower local LLMs

export async function analyzeTranscript(
  meetingId: string,
  segments: TranscriptSegment[],
  modelName = 'qwen2.5:7b',
  onProgress?: (current: number, total: number) => void,
  onBatchComplete?: (mistakes: Mistake[], batchIndex: number, totalBatches: number, done: boolean) => void
): Promise<Mistake[]> {
  const db = getDb();
  const allMistakes: Mistake[] = [];

  // Load error categories for mapping
  const categories = await db.select().from(schema.errorCategories).all();
  const categoryMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

  // Batch segments
  const batches: { index: number; text: string }[][] = [];
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE).map((seg) => ({
      index: seg.segmentIndex,
      text: seg.text,
    }));
    batches.push(batch);
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    if (onProgress) onProgress(batchIdx + 1, batches.length);

    let results: AnalysisResult[];
    try {
      results = await analyzeSegments(batches[batchIdx], modelName);
    } catch (err) {
      console.error(`Analysis batch ${batchIdx + 1} failed:`, err);
      continue;
    }

    // Map results to mistakes
    const mistakesBefore = allMistakes.length;
    for (const result of results) {
      // Find the matching segment
      const segment = segments.find(s => s.segmentIndex === result.segmentIndex);
      if (!segment) continue;

      // Find or create category
      let categoryId = result.category ? (categoryMap.get(result.category.toLowerCase()) || null) : null;
      if (!categoryId && result.category) {
        // Determine parent category
        let parentCategory = 'Grammar';
        const cat = result.category.toLowerCase();
        if (['word choice', 'false friends', 'collocation errors', 'register mismatch'].includes(cat)) {
          parentCategory = 'Vocabulary';
        } else if (['awkward phrasing', 'redundancy', 'run-on sentence', 'incomplete thought', 'non-idiomatic expression'].includes(cat)) {
          parentCategory = 'Phrasing';
        }

        categoryId = uuidv4();
        try {
          await db.insert(schema.errorCategories).values({
            id: categoryId,
            name: result.category,
            description: null,
            parentCategory,
          });
          categoryMap.set(result.category.toLowerCase(), categoryId);
        } catch {
          // Category might already exist due to race condition; look it up
          const existing = categories.find(c => c.name.toLowerCase() === result.category.toLowerCase());
          categoryId = existing?.id || null;
        }
      }

      const mistake: Mistake = {
        id: uuidv4(),
        meetingId,
        segmentId: segment.id,
        originalText: result.original,
        correctedText: result.corrected,
        explanation: result.explanation,
        alternatives: result.alternatives,
        categoryId,
        severity: result.severity,
      };

      await db.insert(schema.mistakes).values({
        ...mistake,
        alternatives: JSON.stringify(mistake.alternatives),
      });

      allMistakes.push(mistake);
    }

    // Notify renderer with this batch's results immediately
    if (onBatchComplete) {
      const batchMistakes = allMistakes.slice(mistakesBefore);
      const done = batchIdx === batches.length - 1;
      onBatchComplete(batchMistakes, batchIdx, batches.length, done);
    }
  }

  // Update meeting stats
  const totalWords = segments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
  const weightedMistakes = allMistakes.reduce((sum, m) => {
    const weight = m.severity === 'major' ? 3 : m.severity === 'moderate' ? 2 : 1;
    return sum + weight;
  }, 0);
  const score = Math.max(0, Math.min(100, 100 - (weightedMistakes / Math.max(totalWords, 1)) * 100));

  await db.update(schema.meetings)
    .set({
      totalMistakes: allMistakes.length,
      overallScore: Math.round(score * 10) / 10,
      status: 'completed',
      endedAt: Date.now(),
    })
    .where(eq(schema.meetings.id, meetingId));

  return allMistakes;
}

const contextAnalysisFns: Record<ContextAnalysisType, (transcript: string, model: string) => Promise<unknown>> = {
  grammar_full: analyzeGrammarFull,
  summary: summarizeTranscript,
  action_items: extractActionItems,
  vocabulary: suggestVocabulary,
  fluency: analyzeFluency,
};

export async function runContextAnalyses(
  meetingId: string,
  segments: TranscriptSegment[],
  modelName: string,
  enabledTypes: ContextAnalysisType[],
  onProgress?: (type: ContextAnalysisType, done: boolean) => void
): Promise<MeetingAnalysis[]> {
  if (enabledTypes.length === 0 || segments.length === 0) return [];

  const db = getDb();
  const fullTranscript = segments.map(s => s.text).join('\n');
  const results: MeetingAnalysis[] = [];

  // Delete existing analyses for these types (for re-runs)
  for (const type of enabledTypes) {
    await db.delete(schema.meetingAnalyses).where(
      and(
        eq(schema.meetingAnalyses.meetingId, meetingId),
        eq(schema.meetingAnalyses.type, type)
      )
    );
  }

  // Run each analysis type sequentially
  for (const type of enabledTypes) {
    if (onProgress) onProgress(type, false);

    try {
      const fn = contextAnalysisFns[type];
      const content = await fn(fullTranscript, modelName);

      const analysis: MeetingAnalysis = {
        id: uuidv4(),
        meetingId,
        type,
        content: JSON.stringify(content),
        createdAt: Date.now(),
      };

      await db.insert(schema.meetingAnalyses).values(analysis);
      results.push(analysis);
    } catch (error) {
      console.error(`Context analysis '${type}' failed:`, error);
    }

    if (onProgress) onProgress(type, true);
  }

  return results;
}
