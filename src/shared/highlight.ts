/**
 * Locates the text a mistake refers to inside the sentence it came from.
 *
 * The LLM is asked for an exact quote but routinely paraphrases, normalizes
 * punctuation, or changes case, so a plain indexOf misses often. Each fallback
 * is reported in `match` so the caller can show an honest highlight — and so
 * the share of 'none' results is measurable as an analysis-quality signal.
 */
export type SpanMatchKind = 'exact' | 'normalized' | 'fuzzy' | 'none';

export interface LocatedSpan {
  /** Offset into the sentence text, or null when the quote could not be found. */
  start: number | null;
  end: number | null;
  match: SpanMatchKind;
}

const NOT_FOUND: LocatedSpan = { start: null, end: null, match: 'none' };

// Below this Dice coefficient a fuzzy window is too different to claim it is
// the quoted text; a dotted underline over the whole sentence is more honest.
const FUZZY_MIN_SCORE = 0.6;

const STRIPPED_PUNCTUATION = /[.,!?;:'"“”‘’()[\]]/;

/**
 * Lowercases, collapses whitespace and drops punctuation, while recording where
 * each surviving character came from so a match maps back to real offsets.
 */
function normalizeWithMap(text: string): { normalized: string; offsets: number[] } {
  let normalized = '';
  const offsets: number[] = [];
  let lastWasSpace = true;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (STRIPPED_PUNCTUATION.test(char)) continue;

    if (/\s/.test(char)) {
      if (lastWasSpace) continue;
      normalized += ' ';
      offsets.push(i);
      lastWasSpace = true;
      continue;
    }

    normalized += char.toLowerCase();
    offsets.push(i);
    lastWasSpace = false;
  }

  // Drop a trailing space so offsets never point past the quote.
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    offsets.pop();
  }
  return { normalized, offsets };
}

function bigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

/** Sørensen–Dice similarity over character bigrams. */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  let shared = 0;
  for (const gram of aGrams) if (bGrams.has(gram)) shared++;
  return (2 * shared) / (aGrams.size + bGrams.size);
}

interface Token {
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({ start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/**
 * Slides a token window of roughly the quote's length across the sentence and
 * keeps the best-scoring one.
 */
function locateFuzzy(sentenceText: string, quote: string): LocatedSpan {
  const tokens = tokenize(sentenceText);
  if (tokens.length === 0) return NOT_FOUND;

  const quoteTokenCount = tokenize(quote).length || 1;
  const normalizedQuote = normalizeWithMap(quote).normalized;
  if (!normalizedQuote) return NOT_FOUND;

  let best: LocatedSpan = NOT_FOUND;
  let bestScore = 0;

  for (let size = Math.max(1, quoteTokenCount - 2); size <= quoteTokenCount + 2; size++) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const start = tokens[i].start;
      const end = tokens[i + size - 1].end;
      const candidate = normalizeWithMap(sentenceText.slice(start, end)).normalized;
      const score = diceCoefficient(candidate, normalizedQuote);
      if (score > bestScore) {
        bestScore = score;
        best = { start, end, match: 'fuzzy' };
      }
    }
  }

  return bestScore >= FUZZY_MIN_SCORE ? best : NOT_FOUND;
}

/**
 * Finds `quote` within `sentenceText`, trying progressively looser matches.
 * Offsets index into `sentenceText` exactly as given.
 */
export function locateSpan(sentenceText: string, quote: string): LocatedSpan {
  const needle = quote?.trim();
  if (!sentenceText || !needle) return NOT_FOUND;

  const exact = sentenceText.indexOf(needle);
  if (exact !== -1) {
    return { start: exact, end: exact + needle.length, match: 'exact' };
  }

  const haystack = normalizeWithMap(sentenceText);
  const normalizedNeedle = normalizeWithMap(needle).normalized;
  if (normalizedNeedle) {
    const found = haystack.normalized.indexOf(normalizedNeedle);
    if (found !== -1) {
      const start = haystack.offsets[found];
      // The last matched character's offset, +1 for an exclusive end.
      const lastIndex = found + normalizedNeedle.length - 1;
      const end = haystack.offsets[lastIndex] + 1;
      if (start !== undefined && !Number.isNaN(end)) {
        return { start, end, match: 'normalized' };
      }
    }
  }

  return locateFuzzy(sentenceText, needle);
}

/** A run of sentence text, either plain or attributed to one mistake. */
export interface TextRun<T> {
  text: string;
  owner: T | null;
}

export interface SpanRef<T> {
  start: number | null;
  end: number | null;
  severity: 'minor' | 'moderate' | 'major';
  owner: T;
}

const SEVERITY_RANK = { major: 3, moderate: 2, minor: 1 } as const;

/**
 * Splits a sentence into runs so each highlighted span can be styled
 * independently.
 *
 * Several mistakes on one sentence used to collapse into a single tint over the
 * whole thing. Where spans overlap the more severe one wins, since two nested
 * highlights cannot both be read.
 */
export function segmentSentence<T>(text: string, spans: SpanRef<T>[]): TextRun<T>[] {
  const usable = spans
    .filter(s => s.start !== null && s.end !== null && s.end > s.start && s.start >= 0 && s.end <= text.length)
    .sort((a, b) =>
      a.start! - b.start! || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    );

  const kept: SpanRef<T>[] = [];
  for (const span of usable) {
    const clash = kept.find(k => span.start! < k.end! && span.end! > k.start!);
    if (!clash) {
      kept.push(span);
      continue;
    }
    // Same region flagged twice — keep whichever matters more.
    if (SEVERITY_RANK[span.severity] > SEVERITY_RANK[clash.severity]) {
      kept[kept.indexOf(clash)] = span;
    }
  }

  kept.sort((a, b) => a.start! - b.start!);

  const runs: TextRun<T>[] = [];
  let cursor = 0;
  for (const span of kept) {
    if (span.start! > cursor) {
      runs.push({ text: text.slice(cursor, span.start!), owner: null });
    }
    runs.push({ text: text.slice(span.start!, span.end!), owner: span.owner });
    cursor = span.end!;
  }
  if (cursor < text.length) {
    runs.push({ text: text.slice(cursor), owner: null });
  }

  return runs.length > 0 ? runs : [{ text, owner: null }];
}
