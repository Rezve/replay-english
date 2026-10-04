/**
 * Splits Whisper segments into sentences.
 *
 * Whisper segments are 5-10 second utterance chunks, not sentences, so they
 * cannot be the denominator of "42 of 48 sentences were correct". These spans
 * are that denominator, the unit the LLM is asked about, and the text a mistake
 * highlight is located inside.
 *
 * Bump SENTENCE_SPLIT_VERSION whenever the rules below change: the denominator
 * *is* the metric, so stored recordings need to say which rules produced them
 * before their rates can be compared.
 */
export const SENTENCE_SPLIT_VERSION = 1;

export interface SentenceSpan {
  /** Offset into the segment text this sentence starts at. */
  charStart: number;
  /** Offset into the segment text this sentence ends at (exclusive). */
  charEnd: number;
  text: string;
  wordCount: number;
  /**
   * False for filler-only utterances ("Yeah.", "Okay right"). They are still
   * stored and displayed, but counting them would inflate the clean rate with
   * sentences that were never really at risk of being wrong.
   */
  countsTowardRate: boolean;
}

// Below this, a fragment is glued onto the previous sentence instead of
// standing alone — "Yeah." and "Okay." are not sentences worth scoring.
const MIN_STANDALONE_WORDS = 3;

// A run of speech this long with no terminal punctuation gets soft-split, so a
// single unpunctuated paragraph does not become one enormous "sentence".
const SOFT_SPLIT_CHARS = 220;

// Mirrors what the analysis prompts already tell the model to ignore.
const FILLER_WORDS = new Set([
  'um', 'uh', 'ah', 'eh', 'oh', 'mm', 'mhm', 'mhmm', 'hmm', 'hm', 'huh',
  'yeah', 'yep', 'yup', 'yes', 'no', 'nope', 'nah', 'okay', 'ok', 'alright',
  'right', 'sure', 'exactly', 'totally',
  'like', 'so', 'well', 'anyway', 'basically', 'actually',
  'you', 'know', 'i', 'mean',
]);

const WORD_RE = /[\p{L}\p{N}']+/gu;

function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/** True when nothing is left after discarding filler. */
function isFillerOnly(text: string): boolean {
  const w = words(text);
  if (w.length === 0) return true;
  return w.every(word => FILLER_WORDS.has(word.toLowerCase()));
}

/** Soft-split points for an over-long run with no sentence-ending punctuation. */
function softSplitPoints(text: string): number[] {
  const points: number[] = [];
  // Prefer a clause boundary; a comma or a conjunction is the least bad cut.
  const boundary = /,\s+|\s+and\s+|\s+but\s+|\s+because\s+|\s+so\s+|\s+then\s+/gi;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    points.push(match.index + match[0].length);
  }
  return points;
}

function splitLongRun(text: string, offset: number): { start: number; end: number }[] {
  if (text.length <= SOFT_SPLIT_CHARS) {
    return [{ start: offset, end: offset + text.length }];
  }

  const points = softSplitPoints(text);
  const pieces: { start: number; end: number }[] = [];
  let cut = 0;

  for (const point of points) {
    if (point - cut >= SOFT_SPLIT_CHARS) {
      pieces.push({ start: offset + cut, end: offset + point });
      cut = point;
    }
  }
  pieces.push({ start: offset + cut, end: offset + text.length });

  // No usable boundary — one long span beats cutting mid-word.
  return pieces.length > 0 ? pieces : [{ start: offset, end: offset + text.length }];
}

/**
 * Splits one segment's text into sentence spans whose offsets index back into
 * that same string, so a highlight located in a sentence maps to the segment.
 */
export function splitIntoSentences(segmentText: string): SentenceSpan[] {
  if (!segmentText.trim()) return [];

  // Terminal punctuation followed by whitespace, or the end of the text.
  const terminator = /[.!?…]+(?=\s|$)/g;
  const raw: { start: number; end: number }[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = terminator.exec(segmentText)) !== null) {
    const end = match.index + match[0].length;
    raw.push(...splitLongRun(segmentText.slice(cursor, end), cursor));
    cursor = end;
  }
  if (cursor < segmentText.length) {
    raw.push(...splitLongRun(segmentText.slice(cursor), cursor));
  }

  const spans: SentenceSpan[] = [];

  for (const piece of raw) {
    // Trim whitespace by moving the offsets, keeping them valid indexes.
    let start = piece.start;
    let end = piece.end;
    while (start < end && /\s/.test(segmentText[start])) start++;
    while (end > start && /\s/.test(segmentText[end - 1])) end--;
    if (start >= end) continue;

    const text = segmentText.slice(start, end);
    const wordCount = words(text).length;
    const previous = spans[spans.length - 1];

    // Too short to stand alone — extend the previous sentence over it.
    if (previous && wordCount < MIN_STANDALONE_WORDS) {
      previous.charEnd = end;
      previous.text = segmentText.slice(previous.charStart, end);
      previous.wordCount = words(previous.text).length;
      previous.countsTowardRate = !isFillerOnly(previous.text);
      continue;
    }

    spans.push({
      charStart: start,
      charEnd: end,
      text,
      wordCount,
      countsTowardRate: !isFillerOnly(text),
    });
  }

  // A fragment at the very start had no predecessor to attach to, so fold it
  // forward instead — "Yeah. Okay." belongs to the sentence that follows it.
  while (spans.length > 1 && spans[0].wordCount < MIN_STANDALONE_WORDS) {
    const [fragment, next] = spans;
    next.charStart = fragment.charStart;
    next.text = segmentText.slice(fragment.charStart, next.charEnd);
    next.wordCount = words(next.text).length;
    next.countsTowardRate = !isFillerOnly(next.text);
    spans.shift();
  }

  return spans;
}
