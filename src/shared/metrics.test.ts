import { describe, it, expect } from 'vitest';
import { formatCleanRate, encouragementFor } from './metrics';
import type { Meeting } from './types';

type RateInput = Parameters<typeof formatCleanRate>[0];

/** A meeting whose numbers are consistent, unless a test deliberately skews them. */
function meeting(over: Partial<RateInput> = {}): RateInput {
  return {
    sentencesTotal: 48,
    sentencesClean: 42,
    sentencesFailed: 0,
    cleanSentenceRate: 87.5,
    analysisState: 'complete',
    ...over,
  };
}

describe('formatCleanRate', () => {
  it('states the count and the percentage', () => {
    const display = formatCleanRate(meeting());
    expect(display.headline).toBe('42 of 48 sentences were correct');
    expect(display.percent).toBe(88);
    expect(display.caveat).toBeNull();
  });

  describe('the denominator is what was CHECKED', () => {
    // This is the property that makes the number trustworthy: an unreachable
    // model reduces what was checked, it does not inflate the score.
    it('excludes failed sentences from the denominator', () => {
      const display = formatCleanRate(meeting({
        sentencesTotal: 48, sentencesClean: 40, sentencesFailed: 3, cleanSentenceRate: 88.9,
        analysisState: 'partial',
      }));
      expect(display.headline).toBe('40 of 45 sentences were correct');
    });

    it('says plainly that some sentences were not counted', () => {
      const display = formatCleanRate(meeting({
        sentencesFailed: 3, analysisState: 'partial', sentencesClean: 40, cleanSentenceRate: 88.9,
      }));
      expect(display.caveat).toContain("3 sentences couldn't be checked");
    });

    it('uses the singular for exactly one unchecked sentence', () => {
      const display = formatCleanRate(meeting({
        sentencesFailed: 1, analysisState: 'partial', sentencesClean: 42, cleanSentenceRate: 89.4,
      }));
      expect(display.caveat).toContain("1 sentence couldn't be checked");
      expect(display.caveat).toContain('is not counted');
    });
  });

  describe('a failed analysis never looks like a good one', () => {
    it('shows no percentage when the run failed', () => {
      const display = formatCleanRate(meeting({ analysisState: 'failed', cleanSentenceRate: null }));
      expect(display.percent).toBeNull();
      expect(display.headline).toBe('Not checked yet');
      expect(display.tone).toBe('warning');
    });

    it('shows no percentage when nothing was checked, whatever the rate says', () => {
      // Guards against a stale rate surviving beside a zero checked count.
      const display = formatCleanRate(meeting({
        sentencesTotal: 10, sentencesFailed: 10, sentencesClean: 0, cleanSentenceRate: 100,
        analysisState: 'partial',
      }));
      expect(display.percent).toBeNull();
      expect(display.caveat).toContain('Analysis failed');
    });

    it('tells the user how to recover', () => {
      const display = formatCleanRate(meeting({ analysisState: 'failed', cleanSentenceRate: null }));
      expect(display.caveat).toContain('Ollama');
    });
  });

  describe('states before a verdict exists', () => {
    it('reports not-checked-yet before analysis runs', () => {
      const display = formatCleanRate(meeting({ analysisState: 'none', cleanSentenceRate: null }));
      expect(display.headline).toBe('Not checked yet');
      expect(display.caveat).toBeNull();
      expect(display.tone).toBe('neutral');
    });

    it('reports progress while analysis runs', () => {
      const display = formatCleanRate(meeting({ analysisState: 'running', cleanSentenceRate: null }));
      expect(display.headline).toContain('Checking');
      expect(display.percent).toBeNull();
    });
  });

  describe('tone', () => {
    it('is good at 85% and above', () => {
      expect(formatCleanRate(meeting({ cleanSentenceRate: 85 })).tone).toBe('good');
      expect(formatCleanRate(meeting({ cleanSentenceRate: 100 })).tone).toBe('good');
    });

    it('is neutral in the middle', () => {
      expect(formatCleanRate(meeting({ cleanSentenceRate: 60 })).tone).toBe('neutral');
      expect(formatCleanRate(meeting({ cleanSentenceRate: 84 })).tone).toBe('neutral');
    });

    it('warns below 60%', () => {
      expect(formatCleanRate(meeting({ cleanSentenceRate: 59 })).tone).toBe('warning');
    });
  });

  it('handles a recording with no gradeable sentences', () => {
    const display = formatCleanRate(meeting({
      sentencesTotal: 0, sentencesClean: 0, sentencesFailed: 0, cleanSentenceRate: null,
      analysisState: 'complete',
    }));
    expect(display.percent).toBeNull();
  });
});

describe('encouragementFor', () => {
  const base = meeting() as Pick<Meeting,
    'sentencesClean' | 'sentencesTotal' | 'sentencesFailed' | 'cleanSentenceRate' | 'analysisState'>;

  it('says nothing when the run did not complete', () => {
    // Congratulating someone on an incomplete run is the dishonesty this
    // whole change set exists to remove.
    expect(encouragementFor({ ...base, analysisState: 'partial' }, 0, null)).toBeNull();
    expect(encouragementFor({ ...base, analysisState: 'failed' }, 0, null)).toBeNull();
    expect(encouragementFor({ ...base, analysisState: 'running' }, 0, null)).toBeNull();
  });

  it('says nothing when there is no rate', () => {
    expect(encouragementFor({ ...base, cleanSentenceRate: null }, 0, null)).toBeNull();
  });

  it('reports real improvement over the previous recording', () => {
    const line = encouragementFor({ ...base, cleanSentenceRate: 88 }, 2, 80);
    expect(line).toBe('Up from 80% last time.');
  });

  it('does not claim improvement for noise', () => {
    expect(encouragementFor({ ...base, cleanSentenceRate: 80.5 }, 2, 80) ?? '').not.toContain('Up from');
  });

  it('does not claim improvement when the rate went down', () => {
    expect(encouragementFor({ ...base, cleanSentenceRate: 70 }, 2, 90) ?? '').not.toContain('Up from');
  });

  it('notes a clean run on severity', () => {
    expect(encouragementFor({ ...base, cleanSentenceRate: 80 }, 0, null)).toBe('No major errors in this one.');
  });

  it('withholds the no-major-errors line when the rate is poor', () => {
    // Zero major errors in a sea of moderate ones is not worth celebrating.
    expect(encouragementFor({ ...base, cleanSentenceRate: 40 }, 0, null)).toBeNull();
  });

  it('recognises a near-perfect recording', () => {
    expect(encouragementFor({ ...base, cleanSentenceRate: 97 }, 1, null))
      .toBe('Almost everything you said was correct.');
  });

  it('says nothing when there is nothing to say', () => {
    expect(encouragementFor({ ...base, cleanSentenceRate: 70 }, 3, 72)).toBeNull();
  });
});
