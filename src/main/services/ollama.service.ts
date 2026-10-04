import { Ollama } from 'ollama';
import { promptCategoryList, promptRuleList } from '../../shared/constants';
import { chunkTranscript } from '../../shared/transcript';
import { getSettings } from './settings.service';
import type {
  GrammarFullResult,
  SummaryResult,
  ActionItemsResult,
  VocabularyResult,
  FluencyResult,
} from '../../shared/types';

export type GrammarMode = 'professional' | 'conversational';

/**
 * Why a call failed, so callers can tell "analysed, nothing wrong" apart from
 * "never actually analysed". Returning [] for both is what used to let a dead
 * Ollama produce a flawless-looking report.
 */
export type LlmFailureReason = 'parse' | 'network' | 'model' | 'cancelled';

export type LlmResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; reason: LlmFailureReason; message: string; attempts: number };

// --- client ---

let client: Ollama | null = null;
let clientHost: string | null = null;

async function getClient(): Promise<Ollama> {
  const { ollamaHost } = await getSettings();
  if (!client || clientHost !== ollamaHost) {
    client = new Ollama({ host: ollamaHost });
    clientHost = ollamaHost;
  }
  return client;
}

// --- retries ---

const RETRY_BACKOFF_MS = [1000, 3000];

function classifyError(error: unknown): LlmFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  // A missing model will never succeed on retry — fail fast and say so.
  if (/not found|no such model|try pulling/i.test(message)) return 'model';
  if (error instanceof SyntaxError) return 'parse';
  return 'network';
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retries transient Ollama failures (network, timeouts, truncated JSON) but not
 * a missing model. Returns the failure rather than throwing so every caller is
 * forced to handle it.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<LlmResult<T>> {
  let lastReason: LlmFailureReason = 'network';
  let lastMessage = 'Unknown error';

  for (let attempt = 1; attempt <= RETRY_BACKOFF_MS.length + 1; attempt++) {
    try {
      return { ok: true, value: await fn(), attempts: attempt };
    } catch (error) {
      lastReason = classifyError(error);
      lastMessage = error instanceof Error ? error.message : String(error);

      if (lastReason === 'model') {
        console.error(`${label} failed (model unavailable): ${lastMessage}`);
        return { ok: false, reason: 'model', message: lastMessage, attempts: attempt };
      }

      const backoff = RETRY_BACKOFF_MS[attempt - 1];
      if (backoff === undefined) break;
      console.warn(`${label} failed (attempt ${attempt}, ${lastReason}), retrying in ${backoff}ms: ${lastMessage}`);
      await sleep(backoff);
    }
  }

  console.error(`${label} failed after ${RETRY_BACKOFF_MS.length + 1} attempts: ${lastMessage}`);
  return { ok: false, reason: lastReason, message: lastMessage, attempts: RETRY_BACKOFF_MS.length + 1 };
}

// --- prompts ---

function sharedTranscriptCaveat(): string {
  return `IMPORTANT: This is TRANSCRIBED SPEECH, not written text. The transcription may lack proper punctuation (commas, periods, etc.) - this is normal for speech-to-text output.`;
}

function lineByLineSystemPrompt(mode: GrammarMode): string {
  const categories = promptCategoryList(mode);

  if (mode === 'conversational') {
    return `You are a supportive English language coach. Your job is to analyze transcribed speech from a non-native English speaker in a casual, informal conversation context.

Focus ONLY on mistakes that genuinely impede understanding or sound clearly wrong to any listener. Be lenient — informal conversation has very different standards than formal writing or professional meetings.

${sharedTranscriptCaveat()}

DO NOT flag:
- Missing punctuation (transcription artifact)
- Filler words (um, uh, like, you know, basically, right) — natural in casual speech
- Contractions (I'm, gonna, wanna, gotta, kinda) — completely acceptable in conversation
- Colloquialisms and informal expressions — appropriate in casual contexts
- Sentence fragments that are clearly understood from context
- Informal phrasing or style choices that don't cause confusion
- Minor article omissions that do not change meaning
- Preposition variations common in spoken English
- Accent-related transcription artifacts
- Formality or register differences — these are not errors in conversation

ONLY flag:
- Subject-verb agreement errors that would confuse a listener
- Tense errors that change the intended meaning
- Word choices that produce the wrong meaning entirely
- Grammatical structures that are clearly ungrammatical even in casual speech
- Errors that make the sentence genuinely hard to understand

Severity guidance for conversational mode:
- minor: Use sparingly — only for errors a native casual speaker would definitely notice as wrong (not just informal)
- moderate: Noticeably incorrect to most listeners, though meaning is still clear
- major: Causes genuine confusion or sounds very wrong even in casual speech

For each mistake found, provide:
1. The original problematic text (exact quote)
2. The corrected version
3. A friendly, concise explanation of what was wrong
4. 2-3 alternative natural ways to express the same idea
5. The error category (one of: ${categories})
6. The rule_key for the specific rule broken, chosen from the list below
7. Severity: minor, moderate, or major

Available rule_key values, grouped by category:
${promptRuleList(mode)}

Pick the rule_key that belongs to the category you chose. If no specific rule fits, use that category's ".other" key. Never invent a rule_key that is not listed.`;
  }

  return `You are an expert English language teacher and grammar analyst. Your job is to analyze transcribed speech from a non-native English speaker in a professional meeting context.

For each sentence, identify grammar mistakes, vocabulary errors, and unnatural phrasing. Focus on errors that would be noticeable in a professional setting.

${sharedTranscriptCaveat()}

DO NOT flag:
- Missing commas, periods, or other punctuation marks (this is a transcription artifact, not a speaker error)
- Filler words (um, uh, like) -- these are natural in speech
- Minor hesitations or self-corrections
- Accent-related transcription artifacts
- Run-on sentences that lack punctuation but are clear in meaning
- Sentences that would be grammatically correct if proper punctuation were added
- Sentences that are grammatically and idiomatically correct

ONLY flag punctuation-related issues if the lack of punctuation causes actual grammatical errors in the spoken words themselves (e.g., sentence fragments, subject-verb agreement issues).

Focus on analyzing the WORDS that were spoken, not how the transcription formatted them.

For each mistake found, provide:
1. The original problematic text (exact quote)
2. The corrected version
3. A clear, concise explanation of what was wrong
4. 2-3 alternative ways to express the same idea naturally
5. The error category (one of: ${categories})
6. The rule_key for the specific rule broken, chosen from the list below
7. Severity: minor (native speakers might not notice), moderate (noticeable but understandable), major (causes confusion or sounds very unnatural)

Available rule_key values, grouped by category:
${promptRuleList(mode)}

Pick the rule_key that belongs to the category you chose. If no specific rule fits, use that category's ".other" key. Never invent a rule_key that is not listed.`;
}

/** How strictly the context analyses should judge, in one reusable sentence. */
function modeCaveat(mode: GrammarMode): string {
  return mode === 'conversational'
    ? `Apply lenient, conversational standards — flag only things that genuinely impede understanding, never formality or style.`
    : `Apply professional standards — flag anything that would be noticeable in a business setting.`;
}

// --- types ---

export interface AnalysisResult {
  sentenceIndex: number;
  original: string;
  corrected: string;
  explanation: string;
  alternatives: string[];
  category: string;
  /** Raw value the model returned; validated against the vocabulary downstream. */
  ruleKey: string;
  severity: 'minor' | 'moderate' | 'major';
}

/** The raw shape the model emits — snake_case per the prompt, with camelCase tolerated. */
interface RawMistake {
  sentence_index?: number;
  sentenceIndex?: number;
  /** Older prompt wording; still accepted so a stale model reply is not discarded. */
  segment_index?: number;
  original?: string;
  corrected?: string;
  explanation?: string;
  alternatives?: string[];
  category?: string;
  rule_key?: string;
  ruleKey?: string;
  severity?: string;
}

function normalizeSeverity(raw: string | undefined): AnalysisResult['severity'] {
  return raw === 'major' || raw === 'moderate' ? raw : 'minor';
}

// --- discovery helpers ---

export async function isOllamaRunning(): Promise<boolean> {
  try {
    await (await getClient()).list();
    return true;
  } catch {
    return false;
  }
}

export async function isModelAvailable(modelName: string): Promise<boolean> {
  try {
    const models = await (await getClient()).list();
    return models.models.some(m => m.name === modelName || m.name.startsWith(modelName + ':'));
  } catch {
    return false;
  }
}

export async function listInstalledModels(): Promise<string[]> {
  try {
    const models = await (await getClient()).list();
    return models.models.map(m => m.name);
  } catch {
    return [];
  }
}

export async function pullModel(modelName: string): Promise<void> {
  await (await getClient()).pull({ model: modelName });
}

// --- core chat ---

async function chatJson<T>(
  label: string,
  systemPrompt: string,
  userPrompt: string,
  modelName: string,
  numPredict: number
): Promise<LlmResult<T>> {
  const { llmNumCtx } = await getSettings();
  const ollama = await getClient();

  return withRetry<T>(label, async () => {
    const response = await ollama.chat({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      format: 'json',
      options: {
        temperature: 0.3,
        // Without an explicit num_ctx the server default (often 2048) silently
        // truncates long prompts, which reads downstream as "no mistakes".
        num_ctx: llmNumCtx,
        num_predict: numPredict,
      },
    });
    // A truncated response throws SyntaxError here, which withRetry retries.
    return JSON.parse(response.message.content) as T;
  });
}

export async function analyzeSentences(
  sentences: { index: number; text: string }[],
  modelName: string,
  mode: GrammarMode = 'professional'
): Promise<LlmResult<AnalysisResult[]>> {
  const sentenceLines = sentences.map(s => `[${s.index}] "${s.text}"`).join('\n');

  const userPrompt = `Analyze the following transcribed sentences for English language mistakes.
Return a JSON array of mistakes found. If a sentence has no mistakes, skip it entirely.

Sentences:
${sentenceLines}

Respond ONLY with valid JSON in this exact format:
{
  "mistakes": [
    {
      "sentence_index": 1,
      "original": "the problematic phrase",
      "corrected": "the correct version",
      "explanation": "Why it was wrong",
      "alternatives": ["alternative way 1", "alternative way 2"],
      "category": "Category Name",
      "rule_key": "one key from the list above",
      "severity": "minor|moderate|major"
    }
  ]
}`;

  const result = await chatJson<{ mistakes?: RawMistake[] }>(
    'Line-by-line analysis',
    lineByLineSystemPrompt(mode),
    userPrompt,
    modelName,
    // Prompt and completion share num_ctx, so leave the prompt room to breathe.
    2048
  );

  if (!result.ok) return result;

  const mistakes = (result.value.mistakes ?? [])
    .map((m): AnalysisResult | null => {
      const sentenceIndex = m.sentence_index ?? m.sentenceIndex ?? m.segment_index;
      if (sentenceIndex === undefined || !m.original || !m.corrected) return null;
      return {
        sentenceIndex,
        original: m.original,
        corrected: m.corrected,
        explanation: m.explanation ?? '',
        alternatives: m.alternatives ?? [],
        category: m.category ?? '',
        ruleKey: (m.rule_key ?? m.ruleKey ?? '').trim(),
        severity: normalizeSeverity(m.severity),
      };
    })
    .filter((m): m is AnalysisResult => m !== null);

  return { ok: true, value: mistakes, attempts: result.attempts };
}

// --- context analyses (operate on the full transcript) ---

/**
 * Runs one analysis over a transcript, splitting it across several calls when it
 * exceeds the context budget and merging the pieces. A chunk that fails fails
 * the whole analysis — a partial summary presented as complete would mislead.
 */
async function analyzeChunked<T>(
  label: string,
  transcript: string,
  systemPrompt: string,
  buildUserPrompt: (chunk: string, index: number, total: number) => string,
  merge: (parts: T[]) => T,
  modelName: string
): Promise<LlmResult<T> & { chunkCount?: number }> {
  const { llmMaxChunkChars } = await getSettings();
  const chunks = chunkTranscript(transcript, llmMaxChunkChars);
  if (chunks.length === 0) {
    return { ok: false, reason: 'parse', message: 'Transcript was empty', attempts: 0 };
  }

  const parts: T[] = [];
  let attempts = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkLabel = chunks.length > 1 ? `${label} (part ${i + 1}/${chunks.length})` : label;
    const result = await chatJson<T>(
      chunkLabel,
      systemPrompt,
      buildUserPrompt(chunks[i], i, chunks.length),
      modelName,
      4096
    );
    attempts += result.attempts;
    if (!result.ok) return { ...result, attempts };
    parts.push(result.value);
  }

  return { ok: true, value: merge(parts), attempts, chunkCount: chunks.length };
}

export async function analyzeGrammarFull(
  transcript: string,
  modelName: string,
  mode: GrammarMode = 'professional'
): Promise<LlmResult<GrammarFullResult>> {
  const systemPrompt = `You are ${
    mode === 'conversational'
      ? 'a supportive English language coach'
      : 'an expert English language teacher'
  } analyzing a complete transcribed recording from a non-native English speaker.

Analyze the transcript as a whole, considering context across sentences. ${modeCaveat(mode)}

This is TRANSCRIBED SPEECH — do NOT flag missing punctuation, filler words, hesitations, contractions, or accent artifacts. Only flag genuine language errors in the words spoken.`;

  return analyzeChunked<GrammarFullResult>(
    'Full-context grammar',
    transcript,
    systemPrompt,
    (chunk, i, total) => `Analyze this ${total > 1 ? `part (${i + 1} of ${total}) of a` : 'full'} transcript for English language mistakes. Consider the full context when evaluating each issue.

Transcript:
${chunk}

Respond with JSON:
{
  "issues": [
    {
      "original": "the problematic phrase",
      "corrected": "the correct version",
      "explanation": "why it was wrong",
      "severity": "minor|moderate|major"
    }
  ]
}

If no issues found, return {"issues": []}.`,
    parts => {
      const seen = new Set<string>();
      const issues: GrammarFullResult['issues'] = [];
      for (const part of parts) {
        for (const issue of part.issues ?? []) {
          const key = issue.original?.toLowerCase().trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          issues.push(issue);
        }
      }
      return { issues };
    },
    modelName
  );
}

export async function summarizeTranscript(
  transcript: string,
  modelName: string,
  mode: GrammarMode = 'professional'
): Promise<LlmResult<SummaryResult>> {
  const subject = mode === 'conversational' ? 'conversation' : 'meeting';
  const systemPrompt = `You are a ${subject} summarizer. Analyze transcribed speech and produce a concise, clear summary with key discussion points.`;

  const result = await analyzeChunked<SummaryResult>(
    'Summary',
    transcript,
    systemPrompt,
    (chunk, i, total) => `Summarize this ${total > 1 ? `part (${i + 1} of ${total}) of a` : ''} ${subject} transcript. Provide a brief overall summary and a list of key points discussed.

Transcript:
${chunk}

Respond with JSON:
{
  "summary": "A concise 2-4 sentence summary",
  "keyPoints": ["key point 1", "key point 2"]
}`,
    // Single chunk passes straight through; several get reduced below.
    parts => ({
      summary: parts.map(p => p.summary).filter(Boolean).join(' '),
      keyPoints: parts.flatMap(p => p.keyPoints ?? []),
    }),
    modelName
  );

  // Several chunks produce a concatenated summary — summarize the summaries so
  // the user reads one coherent paragraph rather than three stitched ones.
  if (result.ok && (result.chunkCount ?? 1) > 1 && result.value.summary) {
    const reduced = await chatJson<SummaryResult>(
      'Summary (reduce)',
      systemPrompt,
      `These are partial summaries of one ${subject}, in order. Combine them into a single coherent summary and a de-duplicated list of key points.

${result.value.summary}

Key points:
${result.value.keyPoints.map(p => `- ${p}`).join('\n')}

Respond with JSON:
{
  "summary": "A concise 2-4 sentence summary of the whole ${subject}",
  "keyPoints": ["key point 1", "key point 2"]
}`,
      modelName,
      4096
    );
    if (reduced.ok) return reduced;
    // Reduction is a nicety; the stitched summary is still usable.
  }

  return result;
}

export async function extractActionItems(
  transcript: string,
  modelName: string,
  mode: GrammarMode = 'professional'
): Promise<LlmResult<ActionItemsResult>> {
  const subject = mode === 'conversational' ? 'conversation' : 'meeting';
  const systemPrompt = `You are a ${subject} assistant. Extract action items, tasks, commitments, and follow-ups from transcribed speech. Only extract items that were clearly stated or agreed upon.`;

  return analyzeChunked<ActionItemsResult>(
    'Action items',
    transcript,
    systemPrompt,
    (chunk, i, total) => `Extract all action items from this ${total > 1 ? `part (${i + 1} of ${total}) of a ` : ''}${subject} transcript. Include the task description, and if mentioned, who is responsible and any deadline.

Transcript:
${chunk}

Respond with JSON:
{
  "items": [
    {
      "task": "description of the action item",
      "owner": "person responsible (if mentioned)",
      "deadline": "deadline (if mentioned)"
    }
  ]
}

If no action items found, return {"items": []}.`,
    parts => ({ items: parts.flatMap(p => p.items ?? []) }),
    modelName
  );
}

export async function suggestVocabulary(
  transcript: string,
  modelName: string,
  mode: GrammarMode = 'professional'
): Promise<LlmResult<VocabularyResult>> {
  // The old prompt hardcoded "more professional / business context", which is
  // the wrong advice for casual speech and for solo practice.
  const systemPrompt = mode === 'conversational'
    ? `You are an English language coach. Identify imprecise, vague, or unnatural word choices in casual spoken English and suggest more natural alternatives a fluent speaker would use. Do not push formal or business vocabulary — the goal is natural conversation.`
    : `You are an English language coach specializing in professional communication. Identify informal, imprecise, or weak word choices in meeting speech and suggest stronger, more professional alternatives that would make the speaker sound more fluent and natural in a business context.`;

  const goal = mode === 'conversational'
    ? 'more natural-sounding or precise'
    : 'more professional, precise, or natural-sounding';

  return analyzeChunked<VocabularyResult>(
    'Vocabulary',
    transcript,
    systemPrompt,
    (chunk, i, total) => `Review this ${total > 1 ? `part (${i + 1} of ${total}) of a ` : ''}transcript and suggest vocabulary improvements. Focus on word choices that could be ${goal}.

Transcript:
${chunk}

Respond with JSON:
{
  "suggestions": [
    {
      "original": "the word or phrase used",
      "suggestion": "a better alternative",
      "reason": "why this is better"
    }
  ]
}

If no suggestions, return {"suggestions": []}.`,
    parts => {
      const seen = new Set<string>();
      const suggestions: VocabularyResult['suggestions'] = [];
      for (const part of parts) {
        for (const s of part.suggestions ?? []) {
          const key = s.original?.toLowerCase().trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          suggestions.push(s);
        }
      }
      return { suggestions };
    },
    modelName
  );
}

export async function analyzeFluency(
  transcript: string,
  modelName: string,
  mode: GrammarMode = 'professional'
): Promise<LlmResult<FluencyResult>> {
  const systemPrompt = `You are a fluency evaluator for non-native English speakers. Analyze transcribed speech for fluency indicators: filler words (um, uh, like, you know, basically, actually), repeated phrases, sentence complexity, and overall flow. ${modeCaveat(mode)} Provide a fluency score from 0-100.`;

  // Chunk scores are averaged by word count so a short trailing chunk cannot
  // swing the overall score as much as the bulk of the recording.
  const weights = chunkTranscript(transcript, (await getSettings()).llmMaxChunkChars)
    .map(c => c.split(/\s+/).length);

  return analyzeChunked<FluencyResult>(
    'Fluency',
    transcript,
    systemPrompt,
    (chunk, i, total) => `Evaluate the fluency of this ${total > 1 ? `part (${i + 1} of ${total}) of a ` : ''}transcript. Count filler words, identify repetitions, and assess overall speaking fluency.

Transcript:
${chunk}

Respond with JSON:
{
  "score": 75,
  "fillerWordCount": 12,
  "repetitionCount": 3,
  "notes": ["specific observation 1", "specific observation 2"]
}`,
    parts => {
      const totalWeight = weights.slice(0, parts.length).reduce((sum, w) => sum + w, 0) || 1;
      const weighted = parts.reduce(
        (sum, p, i) => sum + (p.score ?? 0) * (weights[i] ?? 1),
        0
      );
      return {
        score: Math.round(weighted / totalWeight),
        fillerWordCount: parts.reduce((sum, p) => sum + (p.fillerWordCount ?? 0), 0),
        repetitionCount: parts.reduce((sum, p) => sum + (p.repetitionCount ?? 0), 0),
        notes: parts.flatMap(p => p.notes ?? []),
      };
    },
    modelName
  );
}
