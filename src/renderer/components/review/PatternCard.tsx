import React from 'react';
import {
  ChevronRight, Play, Check, EyeOff, Target, RotateCcw, Undo2,
} from 'lucide-react';
import type { RankedPattern, PatternOccurrence, PatternState } from '../../../shared/types';

const severityBadge: Record<string, string> = {
  minor: 'bg-yellow-500/20 text-yellow-300',
  moderate: 'bg-orange-500/20 text-orange-300',
  major: 'bg-red-500/20 text-red-300',
};

function relativeDay(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

interface PatternCardProps {
  pattern: RankedPattern;
  expanded: boolean;
  occurrences: PatternOccurrence[] | null;
  onToggle: () => void;
  onSetState: (state: PatternState) => void;
  onRejectOccurrence: (mistakeId: string) => void;
  onPlayOccurrence: (meetingId: string, timeSeconds: number) => void;
  busy?: boolean;
}

/**
 * One tracked habit: what it is, how to fix it, how often you have done it, and
 * the controls to work on it or retire it. Shared by the review queue and the
 * report's grouped view so both stay consistent.
 */
export function PatternCard({
  pattern,
  expanded,
  occurrences,
  onToggle,
  onSetState,
  onRejectOccurrence,
  onPlayOccurrence,
  busy,
}: PatternCardProps) {
  const isActive = pattern.state === 'new' || pattern.state === 'learning';
  const readyToMaster = isActive && pattern.cleanRunStreak >= 3;

  return (
    <div className="bg-navy-800 border border-navy-700 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-navy-700/50 transition-colors"
      >
        <div className="flex items-start gap-3">
          <ChevronRight
            size={16}
            className={`text-slate-500 mt-0.5 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-medium">{pattern.label}</span>
              {pattern.relapseCount > 0 && pattern.state === 'learning' && (
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-xs flex items-center gap-1">
                  <RotateCcw size={10} />
                  came back
                </span>
              )}
              {pattern.state === 'mastered' && (
                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-xs">
                  mastered
                </span>
              )}
              {pattern.state === 'ignored' && (
                <span className="px-2 py-0.5 bg-navy-700 text-slate-400 rounded text-xs">ignored</span>
              )}
            </div>

            {/* The teaching line — the reason this is a learning tool and not a tally */}
            <p className="text-slate-400 text-sm mt-1">{pattern.hint}</p>

            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
              <span>
                {pattern.occurrenceCount}&times; across {pattern.meetingCount} recording
                {pattern.meetingCount === 1 ? '' : 's'}
              </span>
              <span>last heard {relativeDay(pattern.lastSeenAt)}</span>
            </div>

            {readyToMaster && (
              <p className="text-emerald-400 text-xs mt-2">
                {pattern.cleanRunStreak} clean recordings in a row — ready to mark mastered?
              </p>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-navy-700 p-4 space-y-4">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {isActive && (
              <>
                <button
                  onClick={() => onSetState('mastered')}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Check size={12} />
                  Mark mastered
                </button>
                {pattern.state === 'new' && (
                  <button
                    onClick={() => onSetState('learning')}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-navy-700 hover:bg-navy-600 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Target size={12} />
                    I'm working on this
                  </button>
                )}
                <button
                  onClick={() => onSetState('ignored')}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-navy-700 hover:bg-navy-600 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
                >
                  <EyeOff size={12} />
                  Ignore
                </button>
              </>
            )}
            {!isActive && (
              <button
                onClick={() => onSetState('learning')}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-navy-700 hover:bg-navy-600 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Undo2 size={12} />
                Put back in the queue
              </button>
            )}
          </div>

          {/* Occurrences */}
          {occurrences === null ? (
            <p className="text-slate-500 text-sm">Loading what you said...</p>
          ) : occurrences.length === 0 ? (
            <p className="text-slate-500 text-sm">No occurrences left.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-slate-400 text-xs uppercase tracking-wide">
                What you said
              </p>
              {occurrences.map(occ => {
                const rejected = occ.occurrenceState === 'rejected';
                return (
                  <div
                    key={occ.id}
                    className={`bg-navy-900 rounded-lg p-3 ${rejected ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-red-300 text-sm line-through">{occ.originalText}</p>
                        <p className="text-emerald-300 text-sm">{occ.correctedText}</p>
                        {occ.explanation && (
                          <p className="text-slate-400 text-xs mt-1">{occ.explanation}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded ${severityBadge[occ.severity] ?? ''}`}>
                          {occ.severity}
                        </span>
                        {/* Hearing your own error is the thing that teaches */}
                        <button
                          onClick={() => onPlayOccurrence(occ.meetingId, occ.startTime)}
                          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          <Play size={10} />
                          Hear it
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-navy-800">
                      <span className="text-slate-500 text-xs truncate">
                        {occ.meetingTitle}
                        {occ.recordingMode === 'solo' ? ' · solo' : ''}
                      </span>
                      {!rejected ? (
                        <button
                          onClick={() => onRejectOccurrence(occ.id)}
                          disabled={busy}
                          className="text-slate-500 hover:text-slate-300 text-xs transition-colors disabled:opacity-50 flex-shrink-0"
                        >
                          Not a mistake
                        </button>
                      ) : (
                        <span className="text-slate-600 text-xs flex-shrink-0">dismissed</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
