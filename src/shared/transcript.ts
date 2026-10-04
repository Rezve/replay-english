interface TimedText {
  startTime: number;
  endTime: number;
  text: string;
}

// A pause this long between segments starts a new paragraph.
const PARAGRAPH_GAP_SECONDS = 2;
// Past this length, a paragraph breaks at the next sentence end even without a pause.
const PARAGRAPH_SOFT_MAX_CHARS = 500;

/**
 * Joins Whisper segments into natural conversational paragraphs (separated by
 * a blank line), breaking on pauses in speech and on long runs of text.
 */
export function buildTranscriptParagraphs(segments: TimedText[]): string {
  const paragraphs: string[] = [];
  let current = '';
  let prevEnd = 0;

  for (const seg of segments) {
    const text = seg.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    if (current) {
      const paused = seg.startTime - prevEnd >= PARAGRAPH_GAP_SECONDS;
      const longAndComplete = current.length >= PARAGRAPH_SOFT_MAX_CHARS && /[.!?]["')\]]?$/.test(current);
      if (paused || longAndComplete) {
        paragraphs.push(current);
        current = '';
      }
    }

    current = current ? `${current} ${text}` : text;
    prevEnd = seg.endTime;
  }

  if (current) paragraphs.push(current);
  return paragraphs.join('\n\n');
}

/**
 * Splits a transcript into pieces that each fit an LLM context window, breaking
 * only on the paragraph boundaries buildTranscriptParagraphs produces so a
 * sentence is never cut in half. A single paragraph longer than maxChars is
 * emitted whole rather than mangled — the caller's num_ctx has to absorb it.
 */
export function chunkTranscript(transcript: string, maxChars: number): string[] {
  const text = transcript.trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of text.split(/\n{2,}/)) {
    const p = paragraph.trim();
    if (!p) continue;

    if (current && current.length + p.length + 2 > maxChars) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${p}` : p;
  }

  if (current) chunks.push(current);
  return chunks;
}
