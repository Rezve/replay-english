import { Ollama } from 'ollama';
import type {
  GrammarFullResult,
  SummaryResult,
  ActionItemsResult,
  VocabularyResult,
  FluencyResult,
} from '../../shared/types';

const ollama = new Ollama({ host: 'http://localhost:11434' });

const SYSTEM_PROMPT_PROFESSIONAL = `You are an expert English language teacher and grammar analyst. Your job is to analyze transcribed speech from a non-native English speaker in a professional meeting context.

For each sentence, identify grammar mistakes, vocabulary errors, and unnatural phrasing. Focus on errors that would be noticeable in a professional setting.

IMPORTANT: This is TRANSCRIBED SPEECH, not written text. The transcription may lack proper punctuation (commas, periods, etc.) - this is normal for speech-to-text output.

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
5. The error category (one of: Subject-Verb Agreement, Tense Consistency, Article Usage, Preposition Errors, Plural/Singular, Word Order, Conditional Structures, Pronoun Reference, Word Choice, False Friends, Collocation Errors, Register Mismatch, Awkward Phrasing, Redundancy, Incomplete Thought, Non-idiomatic Expression)
6. Severity: minor (native speakers might not notice), moderate (noticeable but understandable), major (causes confusion or sounds very unnatural)`;

const SYSTEM_PROMPT_CONVERSATIONAL = `You are a supportive English language coach. Your job is to analyze transcribed speech from a non-native English speaker in a casual, informal conversation context.

Focus ONLY on mistakes that genuinely impede understanding or sound clearly wrong to any listener. Be lenient — informal conversation has very different standards than formal writing or professional meetings.

IMPORTANT: This is TRANSCRIBED SPEECH, not written text. The transcription may lack proper punctuation — this is normal.

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
- Register mismatch (formal vs informal) — this is not an error in conversation

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
5. The error category (one of: Subject-Verb Agreement, Tense Consistency, Article Usage, Preposition Errors, Plural/Singular, Word Order, Conditional Structures, Pronoun Reference, Word Choice, False Friends, Collocation Errors, Register Mismatch, Awkward Phrasing, Redundancy, Incomplete Thought, Non-idiomatic Expression)
6. Severity: minor, moderate, or major`;

function getLineByLineSystemPrompt(mode: 'professional' | 'conversational'): string {
  return mode === 'conversational' ? SYSTEM_PROMPT_CONVERSATIONAL : SYSTEM_PROMPT_PROFESSIONAL;
}

export interface AnalysisResult {
  segmentIndex: number;
  original: string;
  corrected: string;
  explanation: string;
  alternatives: string[];
  category: string;
  severity: 'minor' | 'moderate' | 'major';
}

interface OllamaAnalysisResponse {
  mistakes: AnalysisResult[];
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    await ollama.list();
    return true;
  } catch {
    return false;
  }
}

export async function isModelAvailable(modelName: string): Promise<boolean> {
  try {
    const models = await ollama.list();
    return models.models.some(m => m.name === modelName || m.name.startsWith(modelName + ':'));
  } catch {
    return false;
  }
}

export async function listInstalledModels(): Promise<string[]> {
  try {
    const models = await ollama.list();
    return models.models.map(m => m.name);
  } catch {
    return [];
  }
}

export async function pullModel(modelName: string): Promise<void> {
  await ollama.pull({ model: modelName });
}

export async function analyzeSegments(
  segments: { index: number; text: string }[],
  modelName: string = 'qwen2.5:7b',
  mode: 'professional' | 'conversational' = 'professional'
): Promise<AnalysisResult[]> {
  const segmentLines = segments
    .map(s => `[${s.index}] "${s.text}"`)
    .join('\n');

  const userPrompt = `Analyze the following transcribed speech segments for English language mistakes.
Return a JSON array of mistakes found. If a segment has no mistakes, skip it entirely.

Segments:
${segmentLines}

Respond ONLY with valid JSON in this exact format:
{
  "mistakes": [
    {
      "segment_index": 1,
      "original": "the problematic phrase",
      "corrected": "the correct version",
      "explanation": "Why it was wrong",
      "alternatives": ["alternative way 1", "alternative way 2"],
      "category": "Category Name",
      "severity": "minor|moderate|major"
    }
  ]
}`;

  const response = await ollama.chat({
    model: modelName,
    messages: [
      { role: 'system', content: getLineByLineSystemPrompt(mode) },
      { role: 'user', content: userPrompt },
    ],
    format: 'json',
    options: {
      temperature: 0.3,
      num_predict: 4096,
    },
  });

  try {
    const parsed: OllamaAnalysisResponse = JSON.parse(response.message.content);
    return (parsed.mistakes || []).map(m => ({
      segmentIndex: m.segment_index ?? m.segmentIndex,
      original: m.original,
      corrected: m.corrected,
      explanation: m.explanation,
      alternatives: m.alternatives || [],
      category: m.category,
      severity: m.severity,
    }));
  } catch {
    console.error('Failed to parse Ollama response:', response.message.content);
    return [];
  }
}

// --- Context analysis functions (operate on full transcript) ---

async function chatJson<T>(systemPrompt: string, userPrompt: string, modelName: string): Promise<T | null> {
  try {
    const response = await ollama.chat({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      format: 'json',
      options: { temperature: 0.3, num_predict: 4096 },
    });
    return JSON.parse(response.message.content) as T;
  } catch (error) {
    console.error('Context analysis failed:', error);
    return null;
  }
}

export async function analyzeGrammarFull(
  transcript: string,
  modelName = 'qwen2.5:7b',
  mode: 'professional' | 'conversational' = 'professional'
): Promise<GrammarFullResult> {
  const systemPromptProfessional = `You are an expert English language teacher analyzing a complete transcribed meeting from a non-native English speaker.

Analyze the FULL transcript as a whole, considering context across sentences. Focus on grammar mistakes, vocabulary errors, and unnatural phrasing that would be noticeable in a professional setting.

This is TRANSCRIBED SPEECH — do NOT flag missing punctuation, filler words, hesitations, or accent artifacts.
Only flag genuine language errors in the words spoken.`;

  const systemPromptConversational = `You are a supportive English language coach analyzing a complete transcribed conversation from a non-native English speaker.

Analyze the FULL transcript as a whole, considering context across sentences. Apply lenient, conversational standards — flag only errors that genuinely impede understanding or sound clearly ungrammatical, not style or formality issues.

This is TRANSCRIBED SPEECH — do NOT flag missing punctuation, filler words, contractions, colloquialisms, or accent artifacts.
Only flag genuine errors in spoken words that would confuse or noticeably jar a listener even in casual speech.`;

  const systemPrompt = mode === 'conversational' ? systemPromptConversational : systemPromptProfessional;

  const userPrompt = `Analyze this full meeting transcript for English language mistakes. Consider the full context when evaluating each issue.

Transcript:
${transcript}

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

If no issues found, return {"issues": []}.`;

  const result = await chatJson<GrammarFullResult>(systemPrompt, userPrompt, modelName);
  return result ?? { issues: [] };
}

export async function summarizeTranscript(
  transcript: string,
  modelName = 'qwen2.5:7b'
): Promise<SummaryResult> {
  const systemPrompt = `You are a meeting summarizer. Analyze transcribed meeting speech and produce a concise, clear summary with key discussion points.`;

  const userPrompt = `Summarize this meeting transcript. Provide a brief overall summary and a list of key points discussed.

Transcript:
${transcript}

Respond with JSON:
{
  "summary": "A concise 2-4 sentence summary of the meeting",
  "keyPoints": ["key point 1", "key point 2", ...]
}`;

  const result = await chatJson<SummaryResult>(systemPrompt, userPrompt, modelName);
  return result ?? { summary: '', keyPoints: [] };
}

export async function extractActionItems(
  transcript: string,
  modelName = 'qwen2.5:7b'
): Promise<ActionItemsResult> {
  const systemPrompt = `You are a meeting assistant. Extract action items, tasks, commitments, and follow-ups from transcribed meeting speech. Only extract items that were clearly stated or agreed upon.`;

  const userPrompt = `Extract all action items from this meeting transcript. Include the task description, and if mentioned, who is responsible and any deadline.

Transcript:
${transcript}

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

If no action items found, return {"items": []}.`;

  const result = await chatJson<ActionItemsResult>(systemPrompt, userPrompt, modelName);
  return result ?? { items: [] };
}

export async function suggestVocabulary(
  transcript: string,
  modelName = 'qwen2.5:7b'
): Promise<VocabularyResult> {
  const systemPrompt = `You are an English language coach specializing in professional communication. Identify informal, imprecise, or weak word choices in meeting speech and suggest stronger, more professional alternatives. Focus on vocabulary that would make the speaker sound more fluent and natural in a business context.`;

  const userPrompt = `Review this meeting transcript and suggest vocabulary improvements. Focus on word choices that could be more professional, precise, or natural-sounding.

Transcript:
${transcript}

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

If no suggestions, return {"suggestions": []}.`;

  const result = await chatJson<VocabularyResult>(systemPrompt, userPrompt, modelName);
  return result ?? { suggestions: [] };
}

export async function analyzeFluency(
  transcript: string,
  modelName = 'qwen2.5:7b'
): Promise<FluencyResult> {
  const systemPrompt = `You are a fluency evaluator for non-native English speakers. Analyze transcribed speech for fluency indicators: filler words (um, uh, like, you know, basically, actually), repeated phrases, sentence complexity, and overall flow. Provide a fluency score from 0-100.`;

  const userPrompt = `Evaluate the fluency of this meeting transcript. Count filler words, identify repetitions, and assess overall speaking fluency.

Transcript:
${transcript}

Respond with JSON:
{
  "score": 75,
  "fillerWordCount": 12,
  "repetitionCount": 3,
  "notes": ["specific observation 1", "specific observation 2"]
}`;

  const result = await chatJson<FluencyResult>(systemPrompt, userPrompt, modelName);
  return result ?? { score: 0, fillerWordCount: 0, repetitionCount: 0, notes: [] };
}
