import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  X,
  Sparkles,
  Play,
  Pause,
  Volume2,
  Square,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  MeetingWithAnalysis,
  Mistake,
  ProgressEvent,
  AnalysisBatchEvent,
  ContextAnalysisType,
  GrammarFullResult,
  SummaryResult,
  ActionItemsResult,
  VocabularyResult,
  FluencyResult,
  AudioChunkInfo,
} from '../../shared/types';

type ReportTab = 'line-by-line' | ContextAnalysisType;

const TAB_LABELS: Record<ReportTab, string> = {
  'line-by-line': 'Line-by-Line',
  grammar_full: 'Grammar (Full)',
  summary: 'Summary',
  action_items: 'Action Items',
  vocabulary: 'Vocabulary',
  fluency: 'Fluency',
};

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
  const [reanalyzing, setReanalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<ReportTab>('line-by-line');
  const [runningInsights, setRunningInsights] = useState(false);
  const processingStartedRef = React.useRef(false);

  // Audio player state
  const [audioChunks, setAudioChunks] = useState<AudioChunkInfo[]>([]);
  const [audioBlobUrls, setAudioBlobUrls] = useState<string[]>([]);
  const [currentChunkIdx, setCurrentChunkIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioExpanded, setAudioExpanded] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleReAnalyze = async () => {
    if (!meeting || !id) return;
    setReanalyzing(true);
    setSelectedMistake(null);
    setMistakeIndex(0);
    setMeeting(prev => prev ? { ...prev, mistakes: [], totalMistakes: 0, overallScore: null, status: 'analyzing' } : prev);
    try {
      await api.reAnalyzeMeeting(id);
      const data = await api.getMeeting(id);
      setMeeting(data);
    } catch (err: any) {
      console.error('Re-analysis failed:', err);
      alert(`Re-analysis failed: ${err?.message || 'Unknown error'}`);
      const data = await api.getMeeting(id);
      setMeeting(data);
    } finally {
      setReanalyzing(false);
    }
  };

  const handleStopAnalysis = async () => {
    if (!id) return;
    try {
      await api.stopAnalysis(id);
      const data = await api.getMeeting(id);
      setMeeting(data);
      setProgress(null);
    } catch (err: any) {
      console.error('Failed to stop analysis:', err);
    }
  };

  const handleStartAnalysis = async () => {
    if (!id) return;
    setReanalyzing(true);
    setSelectedMistake(null);
    setMistakeIndex(0);
    setMeeting(prev => prev ? { ...prev, mistakes: [], totalMistakes: 0, overallScore: null, status: 'analyzing' } : prev);
    try {
      await api.startAnalysis(id);
      const data = await api.getMeeting(id);
      setMeeting(data);
    } catch (err: any) {
      console.error('Analysis failed:', err);
      alert(`Analysis failed: ${err?.message || 'Unknown error'}`);
      const data = await api.getMeeting(id);
      setMeeting(data);
    } finally {
      setReanalyzing(false);
    }
  };

  const handleRunInsights = async () => {
    if (!id) return;
    setRunningInsights(true);
    try {
      await api.runContextAnalyses(id);
      const data = await api.getMeeting(id);
      setMeeting(data);
    } catch (err: any) {
      console.error('Context analyses failed:', err);
      alert(`Insights failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setRunningInsights(false);
    }
  };

  // Load audio chunks when meeting is available
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const loadAudio = async () => {
      const chunks = await api.getAudioChunks(id);
      if (cancelled || chunks.length === 0) return;
      setAudioChunks(chunks);

      // Load all chunks as blob URLs
      const urls: string[] = [];
      for (const chunk of chunks) {
        const buffer = await api.readAudioChunk(id, chunk.filename);
        if (cancelled) {
          urls.forEach(u => URL.revokeObjectURL(u));
          return;
        }
        if (buffer) {
          const blob = new Blob([buffer], { type: 'audio/webm' });
          urls.push(URL.createObjectURL(blob));
        }
      }
      setAudioBlobUrls(urls);
    };

    loadAudio();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Revoke blob URLs on unmount
  useEffect(() => {
    return () => {
      audioBlobUrls.forEach(u => URL.revokeObjectURL(u));
    };
  }, [audioBlobUrls]);

  // Audio playback handlers
  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [isPlaying]);

  const handleAudioTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioCurrentTime(audio.currentTime);
  }, []);

  const handleAudioLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioDuration(audio.duration);
  }, []);

  const handleAudioEnded = useCallback(() => {
    // Auto-advance to next chunk
    if (currentChunkIdx < audioBlobUrls.length - 1) {
      setCurrentChunkIdx(prev => prev + 1);
      setTimeout(() => audioRef.current?.play(), 50);
    } else {
      setIsPlaying(false);
    }
  }, [currentChunkIdx, audioBlobUrls.length]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audioDuration;
  }, [audioDuration]);

  const handlePlayFromTime = useCallback((timeSeconds: number) => {
    if (audioBlobUrls.length === 0) return;
    const chunkDuration = 300; // 5-minute chunks
    const chunkIdx = Math.min(Math.floor(timeSeconds / chunkDuration), audioBlobUrls.length - 1);
    const offset = timeSeconds - chunkIdx * chunkDuration;

    setAudioExpanded(true);

    if (chunkIdx === currentChunkIdx) {
      // Same chunk — just seek and play
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = offset;
        audio.play();
      }
    } else {
      // Different chunk — switch, then seek after load
      setCurrentChunkIdx(chunkIdx);
      setTimeout(() => {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = offset;
          audio.play();
        }
      }, 100);
    }
  }, [audioBlobUrls.length, currentChunkIdx]);

  useEffect(() => {
    if (!id) return;

    // Reset the processing flag when the effect runs
    processingStartedRef.current = false;

    const loadMeeting = async () => {
      const data = await api.getMeeting(id);
      setMeeting(data);
      setLoading(false);

      // Auto-start processing if meeting is in transcribing status
      if (data && data.status === 'transcribing' && !processingStartedRef.current) {
        processingStartedRef.current = true;
        startProcessing(data.id);
      }
    };

    const startProcessing = async (meetingId: string) => {
      try {
        // Check prerequisites before processing
        const prereqs = await api.checkPrerequisites();
        if (!prereqs.whisperModel) {
          console.error('Whisper model not found - cannot transcribe');
          await api.updateMeetingStatus(meetingId, 'failed');
          alert('Whisper model not found. Please download it from the Setup page before transcribing.');
          loadMeeting();
          return;
        }

        // The backend will automatically find and process the audio chunks
        await api.processMeeting(meetingId);

        // Reload meeting after processing
        loadMeeting();
      } catch (err: any) {
        console.error('Processing failed:', err);
        const errorMsg = err?.message || 'Unknown error';
        alert(`Transcription failed: ${errorMsg}`);
        await api.updateMeetingStatus(meetingId, 'failed');
        loadMeeting();
      }
    };

    loadMeeting();

    // Listen for progress events
    let prevStage: string | null = null;
    const unsubProgress = api.onProgress((event: ProgressEvent) => {
      setProgress(event);
      // Reload transcript when transcription finishes and analysis begins
      if (prevStage === 'transcribing' && event.stage === 'analyzing') {
        loadMeeting();
      }
      // Reload full meeting data when analysis completes (for score/stats)
      if (event.current === event.total && event.stage === 'analyzing') {
        setTimeout(loadMeeting, 1000);
      }
      // Reload when context analyses complete
      if (event.stage === 'context-analyzing' && event.current === 1) {
        setTimeout(loadMeeting, 500);
      }
      prevStage = event.stage;
    });

    // Listen for batch results — show mistakes as they arrive
    const unsubBatch = api.onAnalysisBatch((event: AnalysisBatchEvent) => {
      if (event.meetingId !== id) return;
      setMeeting(prev => {
        if (!prev) return prev;
        const existingIds = new Set(prev.mistakes.map(m => m.id));
        const newMistakes = event.mistakes.filter(m => !existingIds.has(m.id));
        if (newMistakes.length === 0) return prev;
        return {
          ...prev,
          mistakes: [...prev.mistakes, ...newMistakes],
          totalMistakes: prev.totalMistakes + newMistakes.length,
        };
      });
    });

    return () => {
      unsubProgress();
      unsubBatch();
    };
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

  const availableTabs = useMemo((): ReportTab[] => {
    const tabs: ReportTab[] = ['line-by-line'];
    if (!meeting?.analyses) return tabs;
    const analysisTypes: ContextAnalysisType[] = ['grammar_full', 'summary', 'action_items', 'vocabulary', 'fluency'];
    for (const type of analysisTypes) {
      if (meeting.analyses.some(a => a.type === type)) {
        tabs.push(type);
      }
    }
    return tabs;
  }, [meeting?.analyses]);

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

  const isProcessing = meeting.status === 'transcribing' || meeting.status === 'analyzing' || reanalyzing;
  const isRunningContext = runningInsights || (progress?.stage === 'context-analyzing' && progress?.current === 0);

  const getAnalysisContent = <T,>(type: ContextAnalysisType): T | null => {
    const analysis = meeting.analyses?.find(a => a.type === type);
    if (!analysis) return null;
    try {
      return JSON.parse(analysis.content) as T;
    } catch {
      return null;
    }
  };

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
          <div className="flex items-center gap-4">
            {(meeting.status === 'completed' || meeting.mistakes.length > 0) && (
              <>
                {meeting.status === 'completed' && (
                  <div className="text-center">
                    <p className="text-3xl font-bold text-white">{meeting.overallScore !== null ? Math.round(meeting.overallScore) : '--'}</p>
                    <p className="text-xs text-slate-400">Score</p>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-3xl font-bold text-orange-400">{meeting.mistakes.length}</p>
                  <p className="text-xs text-slate-400">Mistakes{meeting.status === 'analyzing' ? ' so far' : ''}</p>
                </div>
              </>
            )}
            {meeting.status === 'transcribed' && meeting.segments.length > 0 && (
              <button
                onClick={handleStartAnalysis}
                disabled={reanalyzing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Play size={14} />
                Start Analysis
              </button>
            )}
            {(meeting.status === 'completed' || meeting.status === 'failed') && meeting.segments.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunInsights}
                  disabled={runningInsights || reanalyzing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Sparkles size={14} className={runningInsights ? 'animate-pulse' : ''} />
                  Re-run Insights
                </button>
                <button
                  onClick={handleReAnalyze}
                  disabled={reanalyzing || runningInsights}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={14} className={reanalyzing ? 'animate-spin' : ''} />
                  Re-analyze
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Summary stats */}
        {meeting.mistakes.length > 0 && (
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

      {/* Audio player */}
      {audioBlobUrls.length > 0 && (
        <div className="flex-shrink-0 mb-4">
          <button
            onClick={() => setAudioExpanded(prev => !prev)}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-2"
          >
            <Volume2 size={16} />
            <span>Recording ({audioChunks.length} chunk{audioChunks.length !== 1 ? 's' : ''})</span>
            <ChevronRight size={14} className={`transition-transform ${audioExpanded ? 'rotate-90' : ''}`} />
          </button>
          {audioExpanded && (
            <div className="bg-slate-800 rounded-lg p-3">
              <audio
                ref={audioRef}
                src={audioBlobUrls[currentChunkIdx]}
                onTimeUpdate={handleAudioTimeUpdate}
                onLoadedMetadata={handleAudioLoadedMetadata}
                onEnded={handleAudioEnded}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePlayPause}
                  className="p-1.5 rounded-full bg-blue-500 hover:bg-blue-400 text-white transition-colors"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <span className="text-xs text-slate-400 font-mono w-10">{formatTime(audioCurrentTime)}</span>
                <div
                  className="flex-1 h-1.5 bg-slate-700 rounded-full cursor-pointer relative"
                  onClick={handleSeek}
                >
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: audioDuration ? `${(audioCurrentTime / audioDuration) * 100}%` : '0%' }}
                  />
                </div>
                <span className="text-xs text-slate-400 font-mono w-10">{formatTime(audioDuration)}</span>
                {audioBlobUrls.length > 1 && (
                  <span className="text-xs text-slate-500">
                    Part {currentChunkIdx + 1}/{audioBlobUrls.length}
                  </span>
                )}
              </div>
              {audioBlobUrls.length > 1 && (
                <div className="flex gap-1 mt-2">
                  {audioBlobUrls.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setCurrentChunkIdx(i);
                        setAudioCurrentTime(0);
                        setTimeout(() => {
                          const audio = audioRef.current;
                          if (audio) {
                            audio.currentTime = 0;
                            if (isPlaying) audio.play();
                          }
                        }, 50);
                      }}
                      className={`px-2 py-0.5 text-xs rounded transition-colors ${
                        i === currentChunkIdx
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Processing indicator */}
      {(isProcessing || isRunningContext) && (
        <div className="flex-shrink-0 mb-4 bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex items-center gap-3">
          <Loader2 size={20} className="text-blue-400 animate-spin" />
          <div className="flex-1">
            <p className="text-blue-300 font-medium">
              {meeting.status === 'transcribing' ? 'Transcribing...'
                : isRunningContext ? 'Running additional insights...'
                : 'Analyzing grammar...'}
            </p>
            {progress && (
              <p className="text-blue-400/60 text-sm">{progress.message}</p>
            )}
            {meeting.status === 'analyzing' && meeting.mistakes.length > 0 && (
              <p className="text-blue-400/60 text-sm mt-1">
                {meeting.mistakes.length} mistake{meeting.mistakes.length !== 1 ? 's' : ''} found so far — you can start reviewing below
              </p>
            )}
          </div>
          {(meeting.status === 'analyzing' || isRunningContext) && (
            <button
              onClick={handleStopAnalysis}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg transition-colors flex-shrink-0"
            >
              <Square size={12} fill="currentColor" />
              Stop
            </button>
          )}
        </div>
      )}

      {/* Transcribed but not analyzed banner */}
      {meeting.status === 'transcribed' && !isProcessing && (
        <div className="flex-shrink-0 mb-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-yellow-300 font-medium">Analysis incomplete</p>
            <p className="text-yellow-400/60 text-sm">
              Transcription is complete but grammar analysis was stopped. You can start it anytime.
            </p>
          </div>
          <button
            onClick={handleStartAnalysis}
            disabled={reanalyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
          >
            <Play size={14} />
            Start Analysis
          </button>
        </div>
      )}

      {/* Tab bar */}
      {availableTabs.length > 1 && (
        <div className="flex-shrink-0 flex gap-1 mb-4 border-b border-slate-700 pb-0">
          {availableTabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab
                  ? 'bg-slate-800 text-white border-b-2 border-blue-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex gap-4 min-h-0">
        {activeTab === 'line-by-line' && (
          <>
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
                      <span className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                        {audioBlobUrls.length > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayFromTime(segment.startTime);
                            }}
                            className="text-slate-600 hover:text-blue-400 transition-colors"
                            title="Play from here"
                          >
                            <Play size={10} fill="currentColor" />
                          </button>
                        )}
                        <span className="text-slate-500 text-xs font-mono w-12">
                          {formatTime(segment.startTime)}
                        </span>
                      </span>
                      <p className={`text-sm leading-relaxed ${hasMistakes ? 'text-white' : 'text-slate-300'}`}>
                        {hasMistakes ? (
                          <span>
                            {segMistakes.reduce((text) => {
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
          </>
        )}

        {/* Grammar Full tab */}
        {activeTab === 'grammar_full' && (() => {
          const data = getAnalysisContent<GrammarFullResult>('grammar_full');
          if (!data) return <div className="flex-1 text-center py-12 text-slate-400">No full grammar analysis available</div>;
          return (
            <div className="flex-1 overflow-y-auto pr-2 space-y-3">
              {data.issues.length === 0 ? (
                <div className="text-center py-12 text-green-400">No grammar issues found with full context analysis</div>
              ) : (
                data.issues.map((issue, i) => (
                  <div key={i} className={`rounded-lg border p-4 ${severityColors[issue.severity]}`}>
                    <span className={`text-xs px-2 py-0.5 rounded ${severityBadge[issue.severity]}`}>{issue.severity}</span>
                    <div className="mt-2 mb-2">
                      <p className="text-red-300 line-through text-sm">{issue.original}</p>
                    </div>
                    <div className="mb-2">
                      <p className="text-green-300 text-sm font-medium">{issue.corrected}</p>
                    </div>
                    <p className="text-slate-300 text-sm">{issue.explanation}</p>
                  </div>
                ))
              )}
            </div>
          );
        })()}

        {/* Summary tab */}
        {activeTab === 'summary' && (() => {
          const data = getAnalysisContent<SummaryResult>('summary');
          if (!data) return <div className="flex-1 text-center py-12 text-slate-400">No summary available</div>;
          return (
            <div className="flex-1 overflow-y-auto pr-2">
              <div className="bg-slate-800 rounded-lg p-5">
                <h3 className="text-white font-medium mb-3">Summary</h3>
                <p className="text-slate-200 text-sm leading-relaxed mb-5">{data.summary}</p>
                {data.keyPoints.length > 0 && (
                  <>
                    <h4 className="text-white font-medium mb-2">Key Points</h4>
                    <ul className="space-y-2">
                      {data.keyPoints.map((point, i) => (
                        <li key={i} className="text-slate-300 text-sm flex items-start gap-2">
                          <span className="text-blue-400 mt-0.5 flex-shrink-0">&#8226;</span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* Action Items tab */}
        {activeTab === 'action_items' && (() => {
          const data = getAnalysisContent<ActionItemsResult>('action_items');
          if (!data) return <div className="flex-1 text-center py-12 text-slate-400">No action items available</div>;
          return (
            <div className="flex-1 overflow-y-auto pr-2">
              {data.items.length === 0 ? (
                <div className="text-center py-12 text-slate-400">No action items found in this conversation</div>
              ) : (
                <div className="space-y-3">
                  {data.items.map((item, i) => (
                    <div key={i} className="bg-slate-800 rounded-lg p-4 flex items-start gap-3">
                      <div className="w-5 h-5 rounded border-2 border-slate-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-white text-sm">{item.task}</p>
                        <div className="flex gap-3 mt-1">
                          {item.owner && (
                            <span className="text-xs text-slate-400">Owner: <span className="text-slate-300">{item.owner}</span></span>
                          )}
                          {item.deadline && (
                            <span className="text-xs text-slate-400">Deadline: <span className="text-slate-300">{item.deadline}</span></span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Vocabulary tab */}
        {activeTab === 'vocabulary' && (() => {
          const data = getAnalysisContent<VocabularyResult>('vocabulary');
          if (!data) return <div className="flex-1 text-center py-12 text-slate-400">No vocabulary suggestions available</div>;
          return (
            <div className="flex-1 overflow-y-auto pr-2">
              {data.suggestions.length === 0 ? (
                <div className="text-center py-12 text-green-400">No vocabulary improvements suggested</div>
              ) : (
                <div className="space-y-3">
                  {data.suggestions.map((sug, i) => (
                    <div key={i} className="bg-slate-800 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-orange-300 text-sm">{sug.original}</span>
                        <span className="text-slate-500">→</span>
                        <span className="text-green-300 text-sm font-medium">{sug.suggestion}</span>
                      </div>
                      <p className="text-slate-400 text-xs">{sug.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Fluency tab */}
        {activeTab === 'fluency' && (() => {
          const data = getAnalysisContent<FluencyResult>('fluency');
          if (!data) return <div className="flex-1 text-center py-12 text-slate-400">No fluency analysis available</div>;
          return (
            <div className="flex-1 overflow-y-auto pr-2">
              <div className="bg-slate-800 rounded-lg p-5">
                <div className="flex items-center gap-8 mb-6">
                  <div className="text-center">
                    <p className="text-4xl font-bold text-white">{data.score}</p>
                    <p className="text-xs text-slate-400 mt-1">Fluency Score</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-orange-400">{data.fillerWordCount}</p>
                    <p className="text-xs text-slate-400 mt-1">Filler Words</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-yellow-400">{data.repetitionCount}</p>
                    <p className="text-xs text-slate-400 mt-1">Repetitions</p>
                  </div>
                </div>
                {data.notes.length > 0 && (
                  <>
                    <h4 className="text-white font-medium mb-2">Observations</h4>
                    <ul className="space-y-2">
                      {data.notes.map((note, i) => (
                        <li key={i} className="text-slate-300 text-sm flex items-start gap-2">
                          <span className="text-blue-400 mt-0.5 flex-shrink-0">&#8226;</span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
