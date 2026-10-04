import { describe, it, expect } from 'vitest';
import { locateSpan, segmentSentence, type SpanRef } from './highlight';

const SENTENCE = 'I has three cats in my house';

describe('locateSpan', () => {
  describe('exact match', () => {
    it('finds a verbatim quote', () => {
      expect(locateSpan(SENTENCE, 'has three')).toEqual({ start: 2, end: 11, match: 'exact' });
    });

    it('returns offsets that slice back to the quote', () => {
      const span = locateSpan(SENTENCE, 'three cats');
      expect(SENTENCE.slice(span.start!, span.end!)).toBe('three cats');
    });

    it('matches the whole sentence', () => {
      expect(locateSpan(SENTENCE, SENTENCE)).toEqual({
        start: 0, end: SENTENCE.length, match: 'exact',
      });
    });
  });

  describe('normalized match', () => {
    // The model is asked for an exact quote but routinely changes case or
    // adds punctuation, which a plain indexOf would miss entirely.
    it('ignores case', () => {
      const span = locateSpan(SENTENCE, 'Has Three');
      expect(span.match).toBe('normalized');
      expect(SENTENCE.slice(span.start!, span.end!)).toBe('has three');
    });

    it('ignores trailing punctuation', () => {
      const span = locateSpan(SENTENCE, 'has three.');
      expect(span.match).toBe('normalized');
      expect(SENTENCE.slice(span.start!, span.end!)).toBe('has three');
    });

    it('ignores collapsed whitespace', () => {
      const span = locateSpan(SENTENCE, 'has    three');
      expect(span.match).toBe('normalized');
      expect(SENTENCE.slice(span.start!, span.end!)).toBe('has three');
    });

    it('locates a quote inside a sentence that has its own punctuation', () => {
      const text = 'The build, which was red, is green now.';
      const span = locateSpan(text, 'which was red');
      expect(span.match).toBe('exact');
      expect(text.slice(span.start!, span.end!)).toBe('which was red');
    });

    it('maps offsets back correctly when punctuation precedes the match', () => {
      const text = 'Well, honestly, he have two dogs.';
      const span = locateSpan(text, 'He Have Two');
      expect(span.match).toBe('normalized');
      expect(text.slice(span.start!, span.end!)).toBe('he have two');
    });
  });

  describe('fuzzy match', () => {
    it('finds a close paraphrase', () => {
      const span = locateSpan(SENTENCE, 'i has four cats');
      expect(span.match).toBe('fuzzy');
      expect(span.start).not.toBeNull();
    });

    it('still returns offsets within the sentence', () => {
      const span = locateSpan(SENTENCE, 'i has four cats');
      expect(span.start!).toBeGreaterThanOrEqual(0);
      expect(span.end!).toBeLessThanOrEqual(SENTENCE.length);
    });
  });

  describe('no match', () => {
    // Reported honestly so the UI can mark the sentence without claiming to
    // know which words were wrong.
    it('gives up on unrelated text', () => {
      expect(locateSpan(SENTENCE, 'completely unrelated wording here').match).toBe('none');
    });

    it('gives up on an empty quote', () => {
      expect(locateSpan(SENTENCE, '   ').match).toBe('none');
      expect(locateSpan(SENTENCE, '').match).toBe('none');
    });

    it('gives up on an empty sentence', () => {
      expect(locateSpan('', 'anything').match).toBe('none');
    });

    it('returns null offsets, not zeros', () => {
      const span = locateSpan(SENTENCE, 'completely unrelated wording here');
      expect(span.start).toBeNull();
      expect(span.end).toBeNull();
    });
  });
});

describe('segmentSentence', () => {
  const span = (start: number | null, end: number | null, severity: SpanRef<string>['severity'], owner: string)
    : SpanRef<string> => ({ start, end, severity, owner });

  const TEXT = 'I has three cats and he have two dogs';

  it('keeps two separate mistakes separate', () => {
    // The old renderer tinted the whole segment by the first mistake, so
    // several mistakes in one sentence collapsed into one highlight.
    const runs = segmentSentence(TEXT, [span(2, 5, 'moderate', 'a'), span(33, 37, 'minor', 'b')]);
    expect(runs.map(r => [r.text, r.owner])).toEqual([
      ['I ', null],
      ['has', 'a'],
      [' three cats and he have two ', null],
      ['dogs', 'b'],
    ]);
  });

  it('always reassembles into the original text', () => {
    const cases: SpanRef<string>[][] = [
      [],
      [span(0, 1, 'minor', 'a')],
      [span(2, 5, 'moderate', 'a'), span(33, 37, 'minor', 'b')],
      [span(TEXT.length - 4, TEXT.length, 'major', 'a')],
      [span(0, TEXT.length, 'major', 'a')],
    ];
    for (const spans of cases) {
      expect(segmentSentence(TEXT, spans).map(r => r.text).join('')).toBe(TEXT);
    }
  });

  it('resolves overlaps in favour of the more severe mistake', () => {
    const runs = segmentSentence(TEXT, [span(2, 10, 'minor', 'weak'), span(2, 10, 'major', 'strong')]);
    expect(runs.filter(r => r.owner).map(r => r.owner)).toEqual(['strong']);
    expect(runs.map(r => r.text).join('')).toBe(TEXT);
  });

  it('resolves partial overlaps too, without duplicating text', () => {
    const runs = segmentSentence(TEXT, [span(2, 12, 'minor', 'weak'), span(6, 16, 'major', 'strong')]);
    expect(runs.filter(r => r.owner)).toHaveLength(1);
    expect(runs.map(r => r.text).join('')).toBe(TEXT);
  });

  it('ignores spans that were never located', () => {
    expect(segmentSentence(TEXT, [span(null, null, 'minor', 'x')]))
      .toEqual([{ text: TEXT, owner: null }]);
  });

  it('ignores spans that fall outside the text', () => {
    for (const bad of [span(5, 999, 'minor', 'x'), span(-3, 4, 'minor', 'x'), span(9, 4, 'minor', 'x')]) {
      expect(segmentSentence(TEXT, [bad])).toEqual([{ text: TEXT, owner: null }]);
    }
  });

  it('returns one plain run when there are no spans', () => {
    expect(segmentSentence(TEXT, [])).toEqual([{ text: TEXT, owner: null }]);
  });

  it('orders runs by position regardless of input order', () => {
    const runs = segmentSentence(TEXT, [span(33, 37, 'minor', 'b'), span(2, 5, 'moderate', 'a')]);
    expect(runs.filter(r => r.owner).map(r => r.owner)).toEqual(['a', 'b']);
  });

  it('handles a span that touches the very start and end', () => {
    const runs = segmentSentence('abcdef', [span(0, 3, 'minor', 'a'), span(3, 6, 'minor', 'b')]);
    expect(runs.map(r => [r.text, r.owner])).toEqual([['abc', 'a'], ['def', 'b']]);
  });
});
