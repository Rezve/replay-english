import { describe, it, expect } from 'vitest';
import { buildTranscriptParagraphs, chunkTranscript } from './transcript';

describe('buildTranscriptParagraphs', () => {
  const seg = (startTime: number, endTime: number, text: string) => ({ startTime, endTime, text });

  it('joins consecutive speech into one paragraph', () => {
    const text = buildTranscriptParagraphs([
      seg(0, 2, 'The build is green.'),
      seg(2.1, 4, 'We can ship it.'),
    ]);
    expect(text).toBe('The build is green. We can ship it.');
  });

  it('starts a new paragraph after a pause', () => {
    const text = buildTranscriptParagraphs([
      seg(0, 2, 'The build is green.'),
      seg(10, 12, 'Separate thought.'),
    ]);
    expect(text).toBe('The build is green.\n\nSeparate thought.');
  });

  it('skips empty segments', () => {
    const text = buildTranscriptParagraphs([
      seg(0, 1, 'Real text.'),
      seg(1, 2, '   '),
      seg(2, 3, 'More text.'),
    ]);
    expect(text).toBe('Real text. More text.');
  });

  it('collapses internal whitespace', () => {
    expect(buildTranscriptParagraphs([seg(0, 1, 'too    many\n\nspaces')])).toBe('too many spaces');
  });

  it('returns an empty string for no segments', () => {
    expect(buildTranscriptParagraphs([])).toBe('');
  });
});

describe('chunkTranscript', () => {
  it('passes a short transcript through whole', () => {
    expect(chunkTranscript('one\n\ntwo', 100)).toEqual(['one\n\ntwo']);
  });

  it('splits only on paragraph boundaries', () => {
    const paragraphs = ['x'.repeat(50), 'y'.repeat(50), 'z'.repeat(50)];
    expect(chunkTranscript(paragraphs.join('\n\n'), 60)).toEqual(paragraphs);
  });

  it('packs several paragraphs into one chunk when they fit', () => {
    const paragraphs = ['a'.repeat(20), 'b'.repeat(20), 'c'.repeat(20)];
    const chunks = chunkTranscript(paragraphs.join('\n\n'), 100);
    expect(chunks).toHaveLength(1);
  });

  it('never cuts a paragraph, even one over the limit', () => {
    // The caller's num_ctx has to absorb it; mangling a sentence is worse.
    const huge = 'q'.repeat(200);
    expect(chunkTranscript(huge, 60)).toEqual([huge]);
  });

  it('loses no content', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `paragraph number ${i} with some words`);
    const source = paragraphs.join('\n\n');
    const rejoined = chunkTranscript(source, 80).join('\n\n');
    expect(rejoined).toBe(source);
  });

  it('returns nothing for empty input', () => {
    expect(chunkTranscript('', 60)).toEqual([]);
    expect(chunkTranscript('   ', 60)).toEqual([]);
  });

  it('keeps every chunk within the limit when paragraphs allow it', () => {
    const paragraphs = Array.from({ length: 10 }, () => 'w'.repeat(30));
    for (const chunk of chunkTranscript(paragraphs.join('\n\n'), 100)) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });
});
