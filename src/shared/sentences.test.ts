import { describe, it, expect } from 'vitest';
import { splitIntoSentences, SENTENCE_SPLIT_VERSION } from './sentences';

/** Every span's offsets must address the text it claims to contain. */
function assertOffsetsAddressTheirText(source: string) {
  for (const span of splitIntoSentences(source)) {
    expect(source.slice(span.charStart, span.charEnd)).toBe(span.text);
  }
}

describe('splitIntoSentences', () => {
  it('splits on terminal punctuation', () => {
    const spans = splitIntoSentences('I has three cats. He have two dogs.');
    expect(spans.map(s => s.text)).toEqual(['I has three cats.', 'He have two dogs.']);
  });

  it('handles all terminal punctuation marks', () => {
    const spans = splitIntoSentences('Is the build ready? The build is ready! So we can ship it now...');
    expect(spans.map(s => s.text)).toEqual([
      'Is the build ready?',
      'The build is ready!',
      'So we can ship it now...',
    ]);
  });

  it('keeps a trailing sentence that has no final punctuation', () => {
    const spans = splitIntoSentences('First one here. second has no period');
    expect(spans.map(s => s.text)).toEqual(['First one here.', 'second has no period']);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(splitIntoSentences('')).toEqual([]);
    expect(splitIntoSentences('   \n  ')).toEqual([]);
  });

  describe('offsets', () => {
    it('address their own text', () => {
      assertOffsetsAddressTheirText('I has three cats. He have two dogs.');
      assertOffsetsAddressTheirText('Yeah. Okay. I went to the store yesterday.');
      assertOffsetsAddressTheirText('Is the build ready? The build is ready! So we can ship it now...');
    });

    it('exclude surrounding whitespace', () => {
      const spans = splitIntoSentences('   padded sentence here.   ');
      expect(spans[0].text).toBe('padded sentence here.');
      expect(spans[0].charStart).toBe(3);
    });

    it('never overlap and never go backwards', () => {
      const spans = splitIntoSentences('One sentence here. Two sentence here. Three sentence here.');
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].charStart).toBeGreaterThanOrEqual(spans[i - 1].charEnd);
      }
    });
  });

  describe('short fragments', () => {
    // These would otherwise inflate the denominator of the clean-sentence rate
    // with utterances that were never really at risk of being wrong.
    it('merges a fragment into the sentence before it', () => {
      const spans = splitIntoSentences('I went to the store yesterday. Yeah.');
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe('I went to the store yesterday. Yeah.');
    });

    it('merges a leading fragment forward, since it has no predecessor', () => {
      const spans = splitIntoSentences('Yeah. Okay. I went to the store yesterday.');
      expect(spans).toHaveLength(1);
      expect(spans[0].text).toBe('Yeah. Okay. I went to the store yesterday.');
    });

    it('leaves a fragment standing alone when it is all there is', () => {
      const spans = splitIntoSentences('Yeah.');
      expect(spans).toHaveLength(1);
      expect(spans[0].countsTowardRate).toBe(false);
    });
  });

  describe('countsTowardRate', () => {
    it('is false for filler-only utterances', () => {
      for (const filler of ['Um, yeah.', 'Right okay.', 'Uh huh.', 'You know, like, I mean.']) {
        const spans = splitIntoSentences(filler);
        expect(spans.every(s => s.countsTowardRate), filler).toBe(false);
      }
    });

    it('is true once there is real content', () => {
      const spans = splitIntoSentences('Um, yeah, the deployment failed.');
      expect(spans[0].countsTowardRate).toBe(true);
    });

    it('becomes true when a merge brings in real content', () => {
      const spans = splitIntoSentences('Yeah. The build is green now.');
      expect(spans[0].countsTowardRate).toBe(true);
    });
  });

  describe('long unpunctuated runs', () => {
    const run = 'and then we talked about the roadmap '.repeat(12);

    it('soft-splits rather than emitting one enormous sentence', () => {
      expect(splitIntoSentences(run).length).toBeGreaterThan(1);
    });

    it('produces contiguous, non-overlapping pieces', () => {
      const spans = splitIntoSentences(run);
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].charStart).toBeGreaterThanOrEqual(spans[i - 1].charEnd);
      }
    });

    it('never cuts mid-word', () => {
      for (const span of splitIntoSentences(run)) {
        expect(span.text).toBe(span.text.trim());
        expect(span.text.startsWith(' ')).toBe(false);
      }
    });

    it('emits a single span when there is no usable clause boundary', () => {
      // No commas or conjunctions to break on, so one long span beats a bad cut.
      const spans = splitIntoSentences('q'.repeat(400));
      expect(spans).toHaveLength(1);
    });
  });

  describe('word counts', () => {
    it('counts words, not tokens of punctuation', () => {
      const spans = splitIntoSentences('The build, which was red, is green now.');
      expect(spans[0].wordCount).toBe(8);
    });

    it('treats contractions as one word', () => {
      const spans = splitIntoSentences("It isn't working properly yet.");
      expect(spans[0].wordCount).toBe(5);
    });
  });

  it('exposes a split version, so stored rates can be compared knowingly', () => {
    // The denominator *is* the metric; a recording analysed under different
    // rules is not comparable, so the version is stored alongside it.
    expect(typeof SENTENCE_SPLIT_VERSION).toBe('number');
    expect(SENTENCE_SPLIT_VERSION).toBeGreaterThan(0);
  });
});
