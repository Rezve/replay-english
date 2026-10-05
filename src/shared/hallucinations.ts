/**
 * Whisper fills silence and noise with the commonest short captions from its
 * training data, so a quiet stretch comes back as "You" line after line. These
 * are dropped after transcription as a last line of defence; VAD and the
 * silence check in the pipeline stop most of them reaching here.
 */

// Compared after normalizeForMatch: lowercase, no punctuation.
const STOCK_PHRASES = new Set([
  'you',
  'thank you',
  'thank you so much',
  'thank you very much',
  'thanks',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'bye',
  'bye bye',
]);

// "You" as a whole utterance is effectively never real speech. The others can
// be ("Thank you." at the end of a meeting), so they go only when repeated.
const ALWAYS_DROP = new Set(['you']);

// A run this long of any identical line is a repetition loop, not speech.
const LOOP_RUN = 3;

export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

/**
 * Removes hallucinated segments while keeping order:
 * - a lone "You" anywhere;
 * - a stock phrase repeated back to back (every copy, since none were said);
 * - any other line repeated LOOP_RUN+ times in a row, kept once.
 */
export function dropHallucinations<T extends { text: string }>(segments: T[]): T[] {
  const kept: T[] = [];
  let i = 0;

  while (i < segments.length) {
    const key = normalizeForMatch(segments[i].text);
    let end = i + 1;
    while (end < segments.length && normalizeForMatch(segments[end].text) === key) end++;
    const run = end - i;

    if (!key || ALWAYS_DROP.has(key)) {
      // dropped
    } else if (STOCK_PHRASES.has(key)) {
      if (run === 1) kept.push(segments[i]);
    } else if (run >= LOOP_RUN) {
      kept.push(segments[i]);
    } else {
      kept.push(...segments.slice(i, end));
    }
    i = end;
  }

  return kept;
}
