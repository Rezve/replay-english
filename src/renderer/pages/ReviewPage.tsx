import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, Mic, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { PatternCard } from '../components/review/PatternCard';
import type {
  RankedPattern,
  PatternOccurrence,
  PatternState,
  ReviewSummary,
} from '../../shared/types';

/**
 * The review queue: what to work on next, across every recording.
 *
 * This is the half of the product that was missing — the report tells you what
 * you did wrong once, this tells you what you keep doing wrong and lets you
 * retire it.
 */
export function ReviewPage() {
  const navigate = useNavigate();
  const [patterns, setPatterns] = useState<RankedPattern[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<Record<string, PatternOccurrence[]>>({});
  const [showMastered, setShowMastered] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  const load = useCallback(async () => {
    const [list, sum] = await Promise.all([api.listPatterns(100), api.getReviewSummary()]);
    setPatterns(list);
    setSummary(sum);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(err => {
      console.error('Failed to load the review queue:', err);
      setLoading(false);
    });
  }, [load]);

  const { active, mastered, ignored } = useMemo(() => {
    // Patterns with no surviving occurrence are not worth showing.
    const tracked = patterns.filter(p => p.occurrenceCount > 0);
    return {
      active: tracked.filter(p => p.state === 'new' || p.state === 'learning'),
      mastered: tracked.filter(p => p.state === 'mastered'),
      ignored: tracked.filter(p => p.state === 'ignored'),
    };
  }, [patterns]);

  const toggleExpanded = async (patternId: string) => {
    if (expandedId === patternId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(patternId);
    if (!occurrences[patternId]) {
      const occ = await api.getPatternOccurrences(patternId);
      setOccurrences(prev => ({ ...prev, [patternId]: occ }));
    }
  };

  const handleSetState = async (patternId: string, state: PatternState) => {
    setBusy(true);
    try {
      await api.updatePatternState(patternId, state);
      await load();
    } catch (err) {
      console.error('Could not update that pattern:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleRejectOccurrence = async (patternId: string, mistakeId: string) => {
    setBusy(true);
    try {
      await api.updateOccurrenceState(mistakeId, 'rejected');
      // Both the occurrence list and the counts it feeds have moved.
      const occ = await api.getPatternOccurrences(patternId);
      setOccurrences(prev => ({ ...prev, [patternId]: occ }));
      await load();
    } catch (err) {
      console.error('Could not dismiss that occurrence:', err);
    } finally {
      setBusy(false);
    }
  };

  // Deep-links into the report at the moment you said it.
  const handlePlayOccurrence = (meetingId: string, timeSeconds: number) => {
    navigate(`/meetings/${meetingId}?t=${timeSeconds.toFixed(1)}&tab=line-by-line`);
  };

  const renderCard = (pattern: RankedPattern) => (
    <PatternCard
      key={pattern.id}
      pattern={pattern}
      expanded={expandedId === pattern.id}
      occurrences={expandedId === pattern.id ? occurrences[pattern.id] ?? null : null}
      onToggle={() => toggleExpanded(pattern.id)}
      onSetState={state => handleSetState(pattern.id, state)}
      onRejectOccurrence={mistakeId => handleRejectOccurrence(pattern.id, mistakeId)}
      onPlayOccurrence={handlePlayOccurrence}
      busy={busy}
    />
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="text-blue-500 animate-spin" />
      </div>
    );
  }

  // Doubles as the first-run screen, which is why this is the landing page.
  if (patterns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <Target size={48} className="text-navy-700 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Nothing to review yet</h2>
        <p className="text-slate-400 max-w-md mb-6">
          Record yourself speaking and the mistakes you repeat will collect here, grouped
          by the rule behind them, so you can work on one habit at a time.
        </p>
        <button
          onClick={() => navigate('/record')}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          <Mic size={16} />
          Record your first session
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Review</h2>
          <p className="text-slate-400 text-sm mt-1">
            {active.length === 0
              ? 'Nothing active — everything you repeat has been mastered or ignored.'
              : `${active.length} habit${active.length === 1 ? '' : 's'} to work on, most worth your time first.`}
          </p>
        </div>
        {summary && summary.unlocatedShare >= 20 && (
          <p className="text-amber-400/70 text-xs max-w-xs text-right">
            {summary.unlocatedShare}% of flagged quotes couldn't be matched to your words —
            highlights may be approximate.
          </p>
        )}
      </div>

      {active.length > 0 && <div className="space-y-3">{active.map(renderCard)}</div>}

      {mastered.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowMastered(prev => !prev)}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors mb-3"
          >
            <ChevronRight size={14} className={`transition-transform ${showMastered ? 'rotate-90' : ''}`} />
            Mastered ({mastered.length})
            {summary && summary.relapsed > 0 && (
              <span className="text-purple-400 text-xs">· {summary.relapsed} came back</span>
            )}
          </button>
          {showMastered && <div className="space-y-3">{mastered.map(renderCard)}</div>}
        </div>
      )}

      {ignored.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowIgnored(prev => !prev)}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors mb-3"
          >
            <ChevronRight size={14} className={`transition-transform ${showIgnored ? 'rotate-90' : ''}`} />
            Ignored ({ignored.length})
          </button>
          {showIgnored && <div className="space-y-3">{ignored.map(renderCard)}</div>}
        </div>
      )}
    </div>
  );
}
