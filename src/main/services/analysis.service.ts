import { v4 as uuidv4 } from 'uuid';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import {
  analyzeSentences,
  analyzeGrammarFull,
  summarizeTranscript,
  extractActionItems,
  suggestVocabulary,
  analyzeFluency,
  type AnalysisResult,
  type GrammarMode,
  type LlmResult,
  type LlmFailureReason,
} from './ollama.service';
import { buildTranscriptParagraphs } from '../../shared/transcript';
import { splitIntoSentences, SENTENCE_SPLIT_VERSION } from '../../shared/sentences';
import { locateSpan } from '../../shared/highlight';
import { resolveRuleKey, assignPattern, recomputePatternCounters } from './patterns.service';
import type {
  TranscriptSegment,
  Mistake,
  MeetingAnalysis,
  ContextAnalysisType,
  Sentence,
  AnalysisState,
} from '../../shared/types';

const BATCH_SIZE = 6; // sentences per LLM call — shorter units than segments, so a few more fit

// Cancellation tracking per meeting
const cancelledMeetings = new Set<string>();

export function cancelAnalysis(meetingId: string) {
  cancelledMeetings.add(meetingId);
}

export function isAnalysisCancelled(meetingId: string): boolean {
  return cancelledMeetings.has(meetingId);
}

function clearCancellation(meetingId: string) {
  cancelledMeetings.delete(meetingId);
}

/** Lowercased, punctuation-free form used to spot verbatim repeats. */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

// --- sentences ---

/**
 * Derives the sentence rows for a meeting from its segments and replaces any
 * previous ones. Sentences are the unit the LLM is asked about and the
 * denominator of the clean-sentence rate, so they are written once here right
 * after transcription rather than recomputed per analysis run.
 */
export async function deriveSentences(
  meetingId: string,
  segments: TranscriptSegment[]
): Promise<Sentence[]> {
  const db = getDb();
  await db.delete(schema.sentences).where(eq(schema.sentences.meetingId, meetingId));

  const rows: Sentence[] = [];
  let sentenceIndex = 0;

  for (const segment of segments) {
    const spans = splitIntoSentences(segment.text);
    const segmentDuration = Math.max(0, segment.endTime - segment.startTime);
    const textLength = segment.text.length || 1;

    for (const span of spans) {
      // Whisper timestamps a whole segment, so place a sentence inside it by
      // character position. Close enough to click "play from here".
      const startRatio = span.charStart / textLength;
      const endRatio = span.charEnd / textLength;

      rows.push({
        id: uuidv4(),
        meetingId,
        segmentId: segment.id,
        sentenceIndex: sentenceIndex++,
        charStart: span.charStart,
        charEnd: span.charEnd,
        text: span.text,
        startTime: segment.startTime + segmentDuration * startRatio,
        endTime: segment.startTime + segmentDuration * endRatio,
        wordCount: span.wordCount,
        countsTowardRate: span.countsTowardRate,
        status: 'unanalyzed',
        failureReason: null,
        analyzedAt: null,
      });
    }
  }

  for (const row of rows) {
    await db.insert(schema.sentences).values({
      ...row,
      countsTowardRate: row.countsTowardRate ? 1 : 0,
    });
  }

  return rows;
}

async function loadSentences(meetingId: string): Promise<Sentence[]> {
  const db = getDb();
  const rows = await db.select().from(schema.sentences)
    .where(eq(schema.sentences.meetingId, meetingId))
    .orderBy(schema.sentences.sentenceIndex)
    .all();
  return rows.map(r => ({ ...r, countsTowardRate: !!r.countsTowardRate }));
}

// --- line-by-line pass ---

export interface AnalysisRunOptions {
  modelName: string;
  mode: GrammarMode;
  lineByLine: boolean;
  contextTypes: ContextAnalysisType[];
  onLineProgress?: (current: number, total: number) => void;
  onBatchComplete?: (mistakes: Mistake[], batchIndex: number, totalBatches: number, done: boolean) => void;
  onContextProgress?: (type: ContextAnalysisType, done: boolean) => void;
}

export interface AnalysisRunResult {
  mistakes: Mistake[];
  analyses: MeetingAnalysis[];
  cancelled: boolean;
  sentencesTotal: number;
  sentencesClean: number;
  sentencesFailed: number;
  cleanSentenceRate: number | null;
  analysisState: AnalysisState;
  failedContextTypes: ContextAnalysisType[];
}

interface LineByLineOutcome {
  mistakes: Mistake[];
  cancelled: boolean;
  failedSentenceIds: Set<string>;
}

/**
 * Checks sentences in batches, recording per sentence whether it came back
 * clean, with a mistake, or unchecked. That third state is what keeps the
 * clean-sentence rate honest when the model is unreachable.
 */
async function analyzeLineByLine(
  meetingId: string,
  sentences: Sentence[],
  opts: AnalysisRunOptions
): Promise<LineByLineOutcome> {
  const db = getDb();
  const allMistakes: Mistake[] = [];
  const failedSentenceIds = new Set<string>();

  const categories = await db.select().from(schema.errorCategories).all();
  const categoryMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

  const batches: Sentence[][] = [];
  for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
    batches.push(sentences.slice(i, i + BATCH_SIZE));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];

    if (isAnalysisCancelled(meetingId)) {
      await markSentences(batches.slice(batchIdx).flat(), 'failed', 'cancelled');
      batches.slice(batchIdx).flat().forEach(s => failedSentenceIds.add(s.id));
      return { mistakes: allMistakes, cancelled: true, failedSentenceIds };
    }

    opts.onLineProgress?.(batchIdx + 1, batches.length);

    const outcome: LlmResult<AnalysisResult[]> = await analyzeSentences(
      batch.map(s => ({ index: s.sentenceIndex, text: s.text })),
      opts.modelName,
      opts.mode
    );

    // The call can take minutes — re-check before writing anything.
    if (isAnalysisCancelled(meetingId)) {
      await markSentences(batches.slice(batchIdx).flat(), 'failed', 'cancelled');
      batches.slice(batchIdx).flat().forEach(s => failedSentenceIds.add(s.id));
      return { mistakes: allMistakes, cancelled: true, failedSentenceIds };
    }

    if (!outcome.ok) {
      console.error(
        `Analysis batch ${batchIdx + 1}/${batches.length} failed (${outcome.reason}): ${outcome.message}`
      );
      await markSentences(batch, 'failed', outcome.reason);
      batch.forEach(s => failedSentenceIds.add(s.id));
      continue;
    }

    const mistakesBefore = allMistakes.length;
    const withMistakes = new Set<string>();

    for (const result of outcome.value) {
      const sentence = batch.find(s => s.sentenceIndex === result.sentenceIndex);
      if (!sentence) continue;

      const categoryId = await resolveCategoryId(result.category, categoryMap);
      // Located once here so every consumer shares one answer, and so the
      // share of unlocatable quotes is measurable.
      const span = locateSpan(sentence.text, result.original);

      // Pattern identity: a validated rule key, so the same habit in different
      // words lands on one tracked item.
      const ruleKey = await resolveRuleKey(result.ruleKey, result.category);
      const patternId = ruleKey ? await assignPattern(ruleKey, meetingId) : null;

      const mistake: Mistake = {
        id: uuidv4(),
        meetingId,
        sentenceId: sentence.id,
        segmentId: sentence.segmentId,
        originalText: result.original,
        correctedText: result.corrected,
        explanation: result.explanation,
        alternatives: result.alternatives,
        categoryId,
        severity: result.severity,
        patternId,
        ruleKey,
        rawRuleKey: result.ruleKey || null,
        normalizedText: normalizeText(result.original),
        spanStart: span.start,
        spanEnd: span.end,
        spanMatch: span.match,
        occurrenceState: 'new',
        createdAt: Date.now(),
      };

      await db.insert(schema.mistakes).values({
        ...mistake,
        alternatives: JSON.stringify(mistake.alternatives),
      });

      allMistakes.push(mistake);
      withMistakes.add(sentence.id);
    }

    // Everything in a successful batch was genuinely checked.
    await markSentences(
      batch.filter(s => withMistakes.has(s.id)),
      'has_mistake',
      null
    );
    await markSentences(
      batch.filter(s => !withMistakes.has(s.id)),
      'clean',
      null
    );

    opts.onBatchComplete?.(
      allMistakes.slice(mistakesBefore),
      batchIdx,
      batches.length,
      batchIdx === batches.length - 1
    );
  }

  return { mistakes: allMistakes, cancelled: false, failedSentenceIds };
}

async function markSentences(
  sentences: Sentence[],
  status: Sentence['status'],
  failureReason: LlmFailureReason | null
): Promise<void> {
  if (sentences.length === 0) return;
  const db = getDb();
  await db.update(schema.sentences)
    .set({ status, failureReason, analyzedAt: Date.now() })
    .where(inArray(schema.sentences.id, sentences.map(s => s.id)));
}

/** Maps an LLM category name to a category row, creating one if it is new. */
async function resolveCategoryId(
  name: string | undefined,
  categoryMap: Map<string, string>
): Promise<string | null> {
  if (!name) return null;

  const existing = categoryMap.get(name.toLowerCase());
  if (existing) return existing;

  const db = getDb();
  const cat = name.toLowerCase();
  let parentCategory = 'Grammar';
  if (['word choice', 'false friends', 'collocation errors', 'register mismatch'].includes(cat)) {
    parentCategory = 'Vocabulary';
  } else if (
    ['awkward phrasing', 'redundancy', 'run-on sentence', 'incomplete thought', 'non-idiomatic expression'].includes(cat)
  ) {
    parentCategory = 'Phrasing';
  }

  const categoryId = uuidv4();
  try {
    await db.insert(schema.errorCategories).values({
      id: categoryId,
      // Model-invented categories get a slug too, so seeding never collides.
      slug: `llm-${cat.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      name,
      description: null,
      parentCategory,
      sortOrder: 999,
    });
    categoryMap.set(cat, categoryId);
    return categoryId;
  } catch {
    // name/slug are UNIQUE — another write won the race, so read back its id.
    const row = await db.select().from(schema.errorCategories)
      .where(eq(schema.errorCategories.name, name))
      .get();
    if (row) categoryMap.set(cat, row.id);
    return row?.id ?? null;
  }
}

// --- context analyses ---

type ContextAnalysisFn = (
  transcript: string,
  model: string,
  mode: GrammarMode
) => Promise<LlmResult<unknown> & { chunkCount?: number }>;

const contextAnalysisFns: Record<ContextAnalysisType, ContextAnalysisFn> = {
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
  mode: GrammarMode = 'professional',
  onProgress?: (type: ContextAnalysisType, done: boolean) => void
): Promise<{ results: MeetingAnalysis[]; failedTypes: ContextAnalysisType[] }> {
  if (enabledTypes.length === 0 || segments.length === 0) return { results: [], failedTypes: [] };

  const db = getDb();
  // Same text the Transcript tab shows: the stored transcript, or paragraphs built from segments
  const [meetingRow] = await db.select({ transcript: schema.meetings.transcript })
    .from(schema.meetings)
    .where(eq(schema.meetings.id, meetingId));
  const fullTranscript = meetingRow?.transcript ?? buildTranscriptParagraphs(segments);
  const results: MeetingAnalysis[] = [];
  const failedTypes: ContextAnalysisType[] = [];

  for (const type of enabledTypes) {
    await db.delete(schema.meetingAnalyses).where(
      and(
        eq(schema.meetingAnalyses.meetingId, meetingId),
        eq(schema.meetingAnalyses.type, type)
      )
    );
  }

  for (const type of enabledTypes) {
    if (isAnalysisCancelled(meetingId)) return { results, failedTypes };

    onProgress?.(type, false);

    const outcome = await contextAnalysisFns[type](fullTranscript, modelName, mode);

    // The failure is recorded rather than skipped: a missing row renders
    // identically to "nothing found", which is what used to hide outages.
    const analysis: MeetingAnalysis = outcome.ok
      ? {
          id: uuidv4(),
          meetingId,
          type,
          status: 'ok',
          errorMessage: null,
          chunkCount: outcome.chunkCount ?? 1,
          content: JSON.stringify(outcome.value),
          createdAt: Date.now(),
        }
      : {
          id: uuidv4(),
          meetingId,
          type,
          status: 'failed',
          errorMessage: contextFailureMessage(outcome.reason, outcome.message),
          chunkCount: 0,
          content: JSON.stringify(null),
          createdAt: Date.now(),
        };

    await db.insert(schema.meetingAnalyses).values(analysis);

    if (outcome.ok) {
      results.push(analysis);
    } else {
      console.error(`Context analysis '${type}' failed (${outcome.reason}): ${outcome.message}`);
      failedTypes.push(type);
      results.push(analysis);
    }

    onProgress?.(type, true);
  }

  return { results, failedTypes };
}

function contextFailureMessage(reason: LlmFailureReason, detail: string): string {
  switch (reason) {
    case 'model':
      return 'The selected Ollama model is not available. Pull it, then re-run.';
    case 'network':
      return 'Could not reach Ollama. Check that it is running, then re-run.';
    case 'parse':
      return 'The model returned a response that could not be read. Re-running usually fixes this.';
    case 'cancelled':
      return 'Analysis was stopped before this finished.';
    default:
      return detail;
  }
}

// --- the single run entry point ---

/**
 * The one way to analyse a transcribed meeting: line-by-line pass, context
 * analyses, then the meeting's final state. Both the recording pipeline and the
 * manual "Start analysis" path call this, so they cannot disagree about when a
 * run is finished — which is what used to make Start Analysis silently skip the
 * context analyses.
 */
export async function runAnalysis(
  meetingId: string,
  segments: TranscriptSegment[],
  opts: AnalysisRunOptions
): Promise<AnalysisRunResult> {
  const db = getDb();

  // Cleared once per run, not per phase, so a Stop between phases still lands.
  clearCancellation(meetingId);

  await db.update(schema.meetings)
    .set({ analysisState: 'running' })
    .where(eq(schema.meetings.id, meetingId));

  let sentences = await loadSentences(meetingId);
  if (sentences.length === 0) {
    sentences = await deriveSentences(meetingId, segments);
  }

  let mistakes: Mistake[] = [];
  let cancelled = false;

  if (opts.lineByLine) {
    const outcome = await analyzeLineByLine(meetingId, sentences, opts);
    mistakes = outcome.mistakes;
    cancelled = outcome.cancelled;
  }

  const context = cancelled
    ? { results: [], failedTypes: [] }
    : await runContextAnalyses(
        meetingId,
        segments,
        opts.modelName,
        opts.contextTypes,
        opts.mode,
        opts.onContextProgress
      );

  if (!cancelled && isAnalysisCancelled(meetingId)) cancelled = true;
  clearCancellation(meetingId);

  // Rebuilt once, after every mistake for this run is stored.
  if (opts.lineByLine) {
    await recomputePatternCounters(meetingId);
  }

  const tally = await recalculateMeetingMetrics(meetingId, {
    lineByLine: opts.lineByLine,
    contextTypes: opts.contextTypes,
    failedContextTypes: context.failedTypes,
    cancelled,
  });

  return {
    mistakes,
    analyses: context.results,
    cancelled,
    ...tally,
    failedContextTypes: context.failedTypes,
  };
}

/**
 * Recomputes a meeting's sentence tally, clean rate and status from what is
 * actually in the database. Called at the end of a run and again whenever an
 * occurrence is rejected, so the headline number always matches the rows.
 */
export async function recalculateMeetingMetrics(
  meetingId: string,
  context?: {
    lineByLine: boolean;
    contextTypes: ContextAnalysisType[];
    failedContextTypes: ContextAnalysisType[];
    cancelled: boolean;
  }
): Promise<{
  sentencesTotal: number;
  sentencesClean: number;
  sentencesFailed: number;
  cleanSentenceRate: number | null;
  analysisState: AnalysisState;
}> {
  const db = getDb();
  const sentences = await loadSentences(meetingId);
  const countable = sentences.filter(s => s.countsTowardRate);

  const failed = countable.filter(s => s.status === 'failed').length;
  const clean = countable.filter(s => s.status === 'clean').length;
  const withMistake = countable.filter(s => s.status === 'has_mistake').length;
  const checked = clean + withMistake;

  const mistakeRows = await db.select().from(schema.mistakes)
    .where(eq(schema.mistakes.meetingId, meetingId))
    .all();
  const liveMistakes = mistakeRows.filter(m => m.occurrenceState !== 'rejected').length;

  // Denominated on what was checked, never on the total.
  const cleanSentenceRate = checked > 0 ? (clean / checked) * 100 : null;

  let analysisState: AnalysisState;
  if (context && !context.lineByLine && context.contextTypes.length > 0) {
    // Only context analyses ran, so their outcome is the whole verdict.
    analysisState = context.failedContextTypes.length === context.contextTypes.length
      ? 'failed'
      : context.failedContextTypes.length > 0 ? 'partial' : 'complete';
  } else if (context?.cancelled) {
    // Stopped partway: whatever was checked is real, the rest is simply not done.
    analysisState = checked > 0 ? 'partial' : 'none';
  } else if (checked === 0) {
    analysisState = countable.length === 0 ? 'complete' : 'failed';
  } else if (failed > 0 || context?.failedContextTypes.length) {
    analysisState = 'partial';
  } else {
    analysisState = 'complete';
  }

  const tally = {
    sentencesTotal: countable.length,
    sentencesClean: clean,
    sentencesFailed: failed,
    cleanSentenceRate: cleanSentenceRate === null ? null : Math.round(cleanSentenceRate * 10) / 10,
    analysisState,
  };

  // Only a finished run decides the meeting's status. A plain recount — such as
  // dismissing a false positive — must not promote a stopped meeting to
  // 'completed', and a cancelled run must stay at the 'transcribed' state
  // STOP_ANALYSIS parked it at so the "start analysis" affordance survives.
  const concludesRun = !!context && !context.cancelled;

  await db.update(schema.meetings)
    .set({
      ...tally,
      totalMistakes: liveMistakes,
      sentenceSplitVersion: SENTENCE_SPLIT_VERSION,
      ...(concludesRun
        ? { status: analysisState === 'failed' ? ('failed' as const) : ('completed' as const), endedAt: Date.now() }
        : {}),
    })
    .where(eq(schema.meetings.id, meetingId));

  if (failed > 0) {
    console.warn(`Meeting ${meetingId}: ${failed} of ${countable.length} sentences could not be checked.`);
  }

  return tally;
}

/**
 * Re-runs only the sentences that were never successfully checked, so a
 * recovered Ollama does not mean re-analysing the whole recording.
 */
export async function retryFailedSentences(
  meetingId: string,
  opts: AnalysisRunOptions
): Promise<AnalysisRunResult> {
  const db = getDb();
  clearCancellation(meetingId);

  const failed = (await loadSentences(meetingId)).filter(s => s.status === 'failed');
  if (failed.length === 0) {
    const tally = await recalculateMeetingMetrics(meetingId, {
      lineByLine: true,
      contextTypes: [],
      failedContextTypes: [],
      cancelled: false,
    });
    return {
      mistakes: [], analyses: [], cancelled: false, ...tally, failedContextTypes: [],
    };
  }

  await db.update(schema.meetings)
    .set({ analysisState: 'running' })
    .where(eq(schema.meetings.id, meetingId));

  const outcome = await analyzeLineByLine(meetingId, failed, opts);
  clearCancellation(meetingId);

  await recomputePatternCounters(meetingId);
  // A successful retry concludes the run, so a previously failed meeting can
  // return to 'completed'.
  const tally = await recalculateMeetingMetrics(meetingId, {
    lineByLine: true,
    contextTypes: [],
    failedContextTypes: [],
    cancelled: outcome.cancelled,
  });
  return {
    mistakes: outcome.mistakes,
    analyses: [],
    cancelled: outcome.cancelled,
    ...tally,
    failedContextTypes: [],
  };
}
