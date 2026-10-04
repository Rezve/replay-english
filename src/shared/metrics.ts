import type { Meeting } from './types';

/**
 * How a recording's correctness is phrased everywhere it appears.
 *
 * The old 0-100 score was mistakes-per-word, which put ten major errors in a
 * thousand words at 97 — every recording looked the same and the number taught
 * nothing. The clean-sentence rate answers the question the user actually has:
 * was I speaking correctly?
 */
export interface CleanRateDisplay {
  /** "42 of 48 sentences were correct", or why there is no number yet. */
  headline: string;
  /** Rounded percentage, or null when nothing has been checked. */
  percent: number | null;
  /** What the number does not cover, when something is missing. */
  caveat: string | null;
  tone: 'good' | 'neutral' | 'warning';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function formatCleanRate(meeting: Pick<
  Meeting,
  'sentencesTotal' | 'sentencesClean' | 'sentencesFailed' | 'cleanSentenceRate' | 'analysisState'
>): CleanRateDisplay {
  const { sentencesClean, sentencesFailed, cleanSentenceRate, analysisState } = meeting;
  // The denominator is what was actually checked, never the total — that is
  // what stops a dead model from reporting a perfect recording.
  const checked = Math.max(0, meeting.sentencesTotal - sentencesFailed);

  if (analysisState === 'none' || analysisState === 'running') {
    return {
      headline: analysisState === 'running' ? 'Checking your sentences...' : 'Not checked yet',
      percent: null,
      caveat: null,
      tone: 'neutral',
    };
  }

  if (analysisState === 'failed' || cleanSentenceRate === null || checked === 0) {
    return {
      headline: 'Not checked yet',
      percent: null,
      caveat: 'Analysis failed — check that Ollama is running, then retry.',
      tone: 'warning',
    };
  }

  const percent = Math.round(cleanSentenceRate);
  return {
    headline: `${sentencesClean} of ${checked} sentences were correct`,
    percent,
    caveat:
      sentencesFailed > 0
        ? `${plural(sentencesFailed, 'sentence')} couldn't be checked and ${
            sentencesFailed === 1 ? 'is' : 'are'
          } not counted above.`
        : null,
    tone: percent >= 85 ? 'good' : percent >= 60 ? 'neutral' : 'warning',
  };
}

/**
 * One short line of earned encouragement, or null when nothing is true enough
 * to say. Never congratulates on an incomplete run.
 */
export function encouragementFor(
  meeting: Pick<Meeting, 'sentencesClean' | 'sentencesTotal' | 'sentencesFailed' | 'cleanSentenceRate' | 'analysisState'>,
  majorCount: number,
  previousRate: number | null
): string | null {
  if (meeting.analysisState !== 'complete' || meeting.cleanSentenceRate === null) return null;

  if (previousRate !== null && meeting.cleanSentenceRate > previousRate + 1) {
    return `Up from ${Math.round(previousRate)}% last time.`;
  }
  if (majorCount === 0 && meeting.cleanSentenceRate >= 70) {
    return 'No major errors in this one.';
  }
  if (meeting.cleanSentenceRate >= 95) {
    return 'Almost everything you said was correct.';
  }
  return null;
}
