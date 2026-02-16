import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type { MeetingWithAnalysis, Mistake, ProgressEvent } from '../../shared/types';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

const severityColors = {
  minor: 'border-yellow-500/30 bg-yellow-500/5',
  moderate: 'border-orange-500/30 bg-orange-500/5',
  major: 'border-red-500/30 bg-red-500/5',
};

const severityBadge = {
  minor: 'bg-yellow-500/20 text-yellow-400',
  moderate: 'bg-orange-500/20 text-orange-400',
  major: 'bg-red-500/20 text-red-400',
};

const highlightColors = {
  minor: 'bg-yellow-500/20 underline decoration-yellow-500/50',
  moderate: 'bg-orange-500/20 underline decoration-orange-500/50',
  major: 'bg-red-500/20 underline decoration-red-500/50',
};

export function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<MeetingWithAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMistake, setSelectedMistake] = useState<Mistake | null>(null);
  const [mistakeIndex, setMistakeIndex] = useState(0);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  useEffect(() => {
    if (!id) return;

    const loadMeeting = async () => {
      const data = await api.getMeeting(id);
      setMeeting(data);
      setLoading(false);
    };

    loadMeeting();

    // Listen for progress events
    const unsubscribe = api.onProgress((event: ProgressEvent) => {
      setProgress(event);
      // Reload meeting data when analysis completes
      if (event.current === event.total && event.stage === 'analyzing') {
        setTimeout(loadMeeting, 1000);
      }
    });

    return unsubscribe;
  }, [id]);

  const getMistakesForSegment = (segmentId: string): Mistake[] => {
    if (!meeting) return [];
    return meeting.mistakes.filter(m => m.segmentId === segmentId);
  };

  const navigateMistake = (direction: 'prev' | 'next') => {
    if (!meeting) return;
    const mistakes = meeting.mistakes;
    if (mistakes.length === 0) return;
    const newIndex = direction === 'next'
      ? Math.min(mistakeIndex + 1, mistakes.length - 1)
      : Math.max(mistakeIndex - 1, 0);
    setMistakeIndex(newIndex);
    setSelectedMistake(mistakes[newIndex]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={32} className="text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <p className="text-slate-400">Meeting not found</p>
        <button onClick={() => navigate('/meetings')} className="text-blue-400 hover:text-blue-300 mt-2">
          Back to meetings
        </button>
      </div>
    );
  }

  const isProcessing = meeting.status === 'transcribing' || meeting.status === 'analyzing';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 mb-6">
        <button
          onClick={() => navigate('/meetings')}
          className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-3 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to meetings
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">{meeting.title}</h2>
            <div className="flex items-center gap-4 mt-1 text-sm text-slate-400">
              <span>{new Date(meeting.startedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
              <span className="flex items-center gap-1"><Clock size={14} />{formatDuration(meeting.durationSeconds)}</span>
              {meeting.profile && (
                <span className="px-2 py-0.5 bg-slate-700 rounded text-xs">{meeting.profile.name}</span>
              )}
            </div>
          </div>
          {meeting.status === 'completed' && (
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-white">{meeting.overallScore !== null ? Math.round(meeting.overallScore) : '--'}</p>
                <p className="text-xs text-slate-400">Score</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-orange-400">{meeting.totalMistakes}</p>
                <p className="text-xs text-slate-400">Mistakes</p>
              </div>
            </div>
          )}
        </div>

        {/* Summary stats */}
        {meeting.status === 'completed' && meeting.mistakes.length > 0 && (
          <div className="flex gap-3 mt-4">
            {(['minor', 'moderate', 'major'] as const).map(sev => {
              const count = meeting.mistakes.filter(m => m.severity === sev).length;
              if (count === 0) return null;
              return (
                <span key={sev} className={`text-xs px-2 py-1 rounded ${severityBadge[sev]}`}>
                  {count} {sev}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Processing indicator */}
      {isProcessing && (
        <div className="flex-shrink-0 mb-4 bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex items-center gap-3">
          <Loader2 size={20} className="text-blue-400 animate-spin" />
          <div>
            <p className="text-blue-300 font-medium">
              {meeting.status === 'transcribing' ? 'Transcribing...' : 'Analyzing grammar...'}
            </p>
            {progress && (
              <p className="text-blue-400/60 text-sm">{progress.message}</p>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Transcript panel */}
        <div className="flex-1 overflow-y-auto pr-2">
          {meeting.segments.length === 0 && !isProcessing && (
            <div className="text-center py-12">
              <p className="text-slate-400">No transcript available</p>
            </div>
          )}
          <div className="space-y-1">
            {meeting.segments.map(segment => {
              const segMistakes = getMistakesForSegment(segment.id);
              const hasMistakes = segMistakes.length > 0;
              return (
                <div
                  key={segment.id}
                  className={`flex gap-3 p-2 rounded transition-colors ${
                    hasMistakes ? 'hover:bg-slate-800 cursor-pointer' : ''
                  } ${selectedMistake && segMistakes.some(m => m.id === selectedMistake.id) ? 'bg-slate-800' : ''}`}
                  onClick={() => {
                    if (segMistakes.length > 0) {
                      setSelectedMistake(segMistakes[0]);
                      const idx = meeting.mistakes.findIndex(m => m.id === segMistakes[0].id);
                      if (idx >= 0) setMistakeIndex(idx);
                    }
                  }}
                >
                  <span className="text-slate-500 text-xs font-mono w-12 flex-shrink-0 pt-0.5">
                    {formatTime(segment.startTime)}
                  </span>
                  <p className={`text-sm leading-relaxed ${hasMistakes ? 'text-white' : 'text-slate-300'}`}>
                    {hasMistakes ? (
                      <span>
                        {segMistakes.reduce((text, mistake) => {
                          // Simple highlight — wrap the mistake's original text
                          return text;
                        }, '')}
                        <span className={highlightColors[segMistakes[0].severity]}>
                          {segment.text}
                        </span>
                        <AlertTriangle size={12} className="inline ml-1 text-orange-400" />
                      </span>
                    ) : (
                      segment.text
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mistake detail panel */}
        {selectedMistake && (
          <div className="w-96 flex-shrink-0 overflow-y-auto">
            <div className={`rounded-lg border p-4 ${severityColors[selectedMistake.severity]}`}>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-xs px-2 py-0.5 rounded ${severityBadge[selectedMistake.severity]}`}>
                  {selectedMistake.severity}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => navigateMistake('prev')}
                    disabled={mistakeIndex === 0}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs text-slate-400">
                    {mistakeIndex + 1} / {meeting.mistakes.length}
                  </span>
                  <button
                    onClick={() => navigateMistake('next')}
                    disabled={mistakeIndex === meeting.mistakes.length - 1}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    onClick={() => setSelectedMistake(null)}
                    className="p-1 text-slate-400 hover:text-white ml-1"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Original */}
              <div className="mb-3">
                <p className="text-xs text-slate-400 mb-1">Original</p>
                <p className="text-red-300 line-through text-sm">{selectedMistake.originalText}</p>
              </div>

              {/* Corrected */}
              <div className="mb-3">
                <p className="text-xs text-slate-400 mb-1">Corrected</p>
                <p className="text-green-300 text-sm font-medium">{selectedMistake.correctedText}</p>
              </div>

              {/* Explanation */}
              <div className="mb-3">
                <p className="text-xs text-slate-400 mb-1">Why</p>
                <p className="text-slate-200 text-sm">{selectedMistake.explanation}</p>
              </div>

              {/* Alternatives */}
              {selectedMistake.alternatives.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-1">Alternative ways to say it</p>
                  <ul className="space-y-1">
                    {selectedMistake.alternatives.map((alt, i) => (
                      <li key={i} className="text-blue-300 text-sm flex items-start gap-1.5">
                        <span className="text-blue-500 mt-0.5">-</span>
                        {alt}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
