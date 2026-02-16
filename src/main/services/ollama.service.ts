import { Ollama } from 'ollama';

const ollama = new Ollama({ host: 'http://localhost:11434' });

const SYSTEM_PROMPT = `You are an expert English language teacher and grammar analyst. Your job is to analyze transcribed speech from a non-native English speaker in a professional meeting context.

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

export async function pullModel(modelName: string): Promise<void> {
  await ollama.pull({ model: modelName });
}

export async function analyzeSegments(
  segments: { index: number; text: string }[],
  modelName: string = 'qwen2.5:7b'
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
      { role: 'system', content: SYSTEM_PROMPT },
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
