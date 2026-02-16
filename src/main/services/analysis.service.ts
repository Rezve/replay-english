import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import { analyzeSegments, type AnalysisResult } from './ollama.service';
import type { TranscriptSegment, Mistake } from '../../shared/types';

const BATCH_SIZE = 12; // segments per Ollama call

export async function analyzeTranscript(
  meetingId: string,
  segments: TranscriptSegment[],
  modelName: string = 'qwen2.5:7b',
  onProgress?: (current: number, total: number) => void
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
    for (const result of results) {
      // Find the matching segment
      const segment = segments.find(s => s.segmentIndex === result.segmentIndex);
      if (!segment) continue;

      // Find or create category
      let categoryId = categoryMap.get(result.category.toLowerCase()) || null;
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
