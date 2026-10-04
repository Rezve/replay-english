import React from 'react';
import { Play, AlertTriangle } from 'lucide-react';
import { segmentSentence } from '../../../shared/highlight';
import type { Mistake, Sentence } from '../../../shared/types';

const highlightColors: Record<string, string> = {
  minor: 'bg-yellow-500/20 text-yellow-100 rounded px-0.5',
  moderate: 'bg-orange-500/25 text-orange-100 rounded px-0.5',
  major: 'bg-red-500/25 text-red-100 rounded px-0.5',
};

// Used when the model's quote could not be located: marks the sentence without
// claiming to know which words were wrong.
const approximateColors: Record<string, string> = {
  minor: 'decoration-dotted underline decoration-yellow-400/70 underline-offset-2',
  moderate: 'decoration-dotted underline decoration-orange-400/70 underline-offset-2',
  major: 'decoration-dotted underline decoration-red-400/70 underline-offset-2',
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

interface SentenceLineProps {
  sentence: Sentence;
  mistakes: Mistake[];
  selectedMistakeId: string | null;
  canPlay: boolean;
  onPlay: (timeSeconds: number) => void;
  onSelectMistake: (mistake: Mistake) => void;
}

/**
 * One sentence, showing exactly what it is: correct, carrying specific flagged
 * words, or never checked. The third state matters — a gap rendered as plain
 * text reads as "fine".
 */
export function SentenceLine({
  sentence,
  mistakes,
  selectedMistakeId,
  canPlay,
  onPlay,
  onSelectMistake,
}: SentenceLineProps) {
  const live = mistakes.filter(m => m.occurrenceState !== 'rejected');
  const failed = sentence.status === 'failed';
  const isSelected = live.some(m => m.id === selectedMistakeId);

  // Spans the model quoted but we could not find — highlighted loosely instead.
  const approximate = live.filter(m => m.spanMatch === 'none');
  const runs = segmentSentence<Mistake>(
    sentence.text,
    live
      .filter(m => m.spanMatch !== 'none')
      .map(m => ({ start: m.spanStart, end: m.spanEnd, severity: m.severity, owner: m }))
  );

  const borderClass = failed
    ? 'border-l-2 border-dashed border-slate-600'
    : live.length > 0
      ? 'border-l-2 border-orange-500/60'
      : sentence.status === 'clean'
        ? 'border-l-2 border-emerald-500/40'
        : 'border-l-2 border-transparent';

  const worstApproximate = approximate.length > 0
    ? approximate.reduce((worst, m) => {
        const rank = { major: 3, moderate: 2, minor: 1 } as const;
        return rank[m.severity] > rank[worst.severity] ? m : worst;
      })
    : null;

  return (
    <div
      className={`flex gap-3 py-1.5 pl-3 pr-2 rounded-r transition-colors ${borderClass} ${
        live.length > 0 ? 'hover:bg-navy-800 cursor-pointer' : ''
      } ${isSelected ? 'bg-navy-800' : ''}`}
      onClick={() => { if (live.length > 0) onSelectMistake(live[0]); }}
    >
      <span className="flex items-center gap-1 flex-shrink-0 pt-0.5">
        {canPlay && (
          <button
            onClick={e => { e.stopPropagation(); onPlay(sentence.startTime); }}
            className="text-slate-600 hover:text-blue-400 transition-colors"
            title="Play from here"
          >
            <Play size={10} fill="currentColor" />
          </button>
        )}
        <span className="text-slate-500 text-xs font-mono w-12">
          {formatTime(sentence.startTime)}
        </span>
      </span>

      <div className="min-w-0">
        <p
          className={`text-sm leading-relaxed ${
            failed ? 'text-slate-500' : live.length > 0 ? 'text-white' : 'text-slate-300'
          } ${worstApproximate ? approximateColors[worstApproximate.severity] : ''}`}
        >
          {runs.map((run, i) =>
            run.owner ? (
              <span
                key={i}
                className={highlightColors[run.owner.severity]}
                onClick={e => { e.stopPropagation(); onSelectMistake(run.owner!); }}
              >
                {run.text}
              </span>
            ) : (
              <span key={i}>{run.text}</span>
            )
          )}
          {live.length > 0 && (
            <AlertTriangle size={12} className="inline ml-1 text-orange-400 flex-shrink-0" />
          )}
        </p>

        {failed && (
          <p className="text-xs text-slate-600 mt-0.5">
            not checked{sentence.failureReason ? ` (${sentence.failureReason})` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
