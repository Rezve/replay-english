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
