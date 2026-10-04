import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Shield, Mic, Users, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { SystemCheckModal } from '../components/SystemCheckModal';
import { WhisperModelSelect } from '../components/WhisperModelSelect';
import { OllamaModelSelect } from '../components/OllamaModelSelect';
import {
  MODE_ANALYSES,
  ANALYSIS_PRESETS,
  ANALYSIS_KIND_LABELS,
  parseAnalyses,
  serializeAnalyses,
  type AnalysisKind,
} from '../../shared/constants';
import type { AppSettings, RecordingMode, GrammarModeValue } from '../../shared/types';

const MODE_META: Record<RecordingMode, { label: string; blurb: string; Icon: typeof Mic }> = {
  solo: { label: 'Solo practice', blurb: 'Just you. Mic only.', Icon: Mic },
  meeting: { label: 'Meeting', blurb: 'You plus everyone else.', Icon: Users },
};

const GRAMMAR_MODE_META: Record<GrammarModeValue, { label: string; blurb: string }> = {
  professional: { label: 'Professional', blurb: 'Strict — flags formality & style issues' },
  conversational: { label: 'Conversational', blurb: 'Lenient — flags only clarity errors' },
};

export function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [showModelCheck, setShowModelCheck] = useState(false);
  const [pendingWhisperModel, setPendingWhisperModel] = useState('');
  const [pendingOllamaModel, setPendingOllamaModel] = useState('');
  const [modeTab, setModeTab] = useState<RecordingMode>('meeting');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCustomAnalyses, setShowCustomAnalyses] = useState(false);
  const [hostDraft, setHostDraft] = useState('');
  const [hostTest, setHostTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.getSettings().then(s => {
      setSettings(s);
      setModeTab(s.defaultRecordingMode);
      setHostDraft(s.ollamaHost);
      setShowCustomAnalyses(s.analysisPreset === 'custom');
    }).catch(console.error);
  }, []);

  const persistSettings = useCallback(async (updated: AppSettings) => {
    setSettings(updated);
    await api.updateSettings(updated);
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
  }, []);

  const isEnglishOnlyModel = (model: string) => model.endsWith('.en.bin');

  const handleWhisperModelChange = (value: string) => {
    if (!settings) return;
    persistSettings({ ...settings, whisperModel: value });
    setPendingWhisperModel(value);
    setPendingOllamaModel(settings.ollamaModel);
    setShowModelCheck(true);
  };

  const handleOllamaModelChange = (value: string) => {
    if (!settings) return;
    persistSettings({ ...settings, ollamaModel: value });
    setPendingWhisperModel(settings.whisperModel);
    setPendingOllamaModel(value);
    setShowModelCheck(true);
  };

  const handleTestHost = async () => {
    if (!settings) return;
    setHostTest('testing');
    // Save first — the check runs in the main process against the stored host.
    await persistSettings({ ...settings, ollamaHost: hostDraft.trim() || settings.ollamaHost });
    try {
      const status = await api.checkPrerequisites();
      setHostTest(status.ollamaRunning ? 'ok' : 'fail');
    } catch {
      setHostTest('fail');
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-400">Loading settings...</p>
      </div>
    );
  }

  const activeSettings = settings;
  const analysesKey = modeTab === 'solo' ? 'analysesSolo' : 'analysesMeeting';
  const grammarKey = modeTab === 'solo' ? 'grammarModeSolo' : 'grammarModeMeeting';
  const selected = parseAnalyses(activeSettings[analysesKey], []);
  const availableKinds = MODE_ANALYSES[modeTab];

  const toggleKind = (kind: AnalysisKind, on: boolean) => {
    const next = on ? [...selected, kind] : selected.filter(k => k !== kind);
    // Any manual change means this is no longer one of the presets.
    persistSettings({
      ...activeSettings,
      [analysesKey]: serializeAnalyses(availableKinds.filter(k => next.includes(k))),
      analysisPreset: 'custom',
    });
  };

  const applyPreset = (presetKey: string) => {
    const preset = ANALYSIS_PRESETS[presetKey];
    if (!preset) return;
    // A preset applies to both modes, each capped by what that mode supports.
    persistSettings({
      ...activeSettings,
      analysisPreset: presetKey,
      analysesSolo: serializeAnalyses(MODE_ANALYSES.solo.filter(k => preset.kinds.includes(k))),
      analysesMeeting: serializeAnalyses(MODE_ANALYSES.meeting.filter(k => preset.kinds.includes(k))),
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Settings</h2>
        {saved && (
          <span className="flex items-center gap-1.5 text-emerald-400 text-sm font-medium">
            <Check size={16} />
            Saved
          </span>
        )}
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* 1. Recording & modes */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-1">Recording</h3>
          <p className="text-slate-400 text-xs mb-3">
            Each mode keeps its own grammar standard and its own set of analyses.
          </p>

          <p className="text-slate-300 text-sm mb-2">Default mode for new recordings</p>
          <div className="flex gap-3 mb-5">
            {(['solo', 'meeting'] as const).map(mode => {
              const { label, blurb, Icon } = MODE_META[mode];
              const active = activeSettings.defaultRecordingMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => persistSettings({ ...activeSettings, defaultRecordingMode: mode })}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm transition-colors border text-left ${
                    active
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-navy-900 border-navy-700 text-slate-400 hover:border-navy-600 hover:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <Icon size={14} />
                    {label}
                  </div>
                  <div className="text-xs mt-0.5 opacity-80">{blurb}</div>
                </button>
              );
            })}
          </div>

          {/* Per-mode settings */}
          <div className="flex gap-1 mb-4 border-b border-navy-700">
            {(['solo', 'meeting'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setModeTab(mode)}
                className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-px ${
                  modeTab === mode
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-300'
                }`}
              >
                {MODE_META[mode].label}
              </button>
            ))}
          </div>

          <p className="text-slate-300 text-sm mb-2">
            Grammar standard for {MODE_META[modeTab].label.toLowerCase()}
          </p>
          <div className="flex gap-3">
            {(['professional', 'conversational'] as const).map(gm => {
              const active = activeSettings[grammarKey] === gm;
              return (
                <button
                  key={gm}
                  onClick={() => persistSettings({ ...activeSettings, [grammarKey]: gm })}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm transition-colors border text-left ${
                    active
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-navy-900 border-navy-700 text-slate-400 hover:border-navy-600 hover:text-slate-300'
                  }`}
                >
                  <div className="font-semibold">{GRAMMAR_MODE_META[gm].label}</div>
                  <div className="text-xs mt-0.5 opacity-80">{GRAMMAR_MODE_META[gm].blurb}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Analysis depth */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-1">Analysis depth</h3>
          <p className="text-slate-400 text-xs mb-3">
            More analyses mean a longer wait after each recording.
          </p>

          <div className="grid grid-cols-3 gap-2 mb-3">
            {Object.entries(ANALYSIS_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => { applyPreset(key); setShowCustomAnalyses(false); }}
                className={`px-3 py-2.5 rounded-lg text-left border transition-colors ${
                  activeSettings.analysisPreset === key
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-navy-900 border-navy-700 text-slate-400 hover:border-navy-600 hover:text-slate-300'
                }`}
              >
                <div className="text-sm font-semibold">{preset.label}</div>
                <div className="text-xs mt-0.5 opacity-80">{preset.description}</div>
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowCustomAnalyses(prev => !prev)}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ChevronRight size={14} className={`transition-transform ${showCustomAnalyses ? 'rotate-90' : ''}`} />
            Customize for {MODE_META[modeTab].label.toLowerCase()}
            {activeSettings.analysisPreset === 'custom' && (
              <span className="text-xs text-blue-400">(custom)</span>
            )}
          </button>

          {showCustomAnalyses && (
            <div className="space-y-3 mt-3 pt-3 border-t border-navy-700">
              {availableKinds.map(kind => (
                <label key={kind} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes(kind)}
                    onChange={e => toggleKind(kind, e.target.checked)}
                    className="mt-0.5 accent-blue-500"
                  />
                  <div>
                    <p className="text-sm text-white">{ANALYSIS_KIND_LABELS[kind].label}</p>
                    <p className="text-xs text-slate-400">{ANALYSIS_KIND_LABELS[kind].description}</p>
                  </div>
                </label>
              ))}
              {MODE_ANALYSES.meeting
                .filter(k => !availableKinds.includes(k))
                .map(kind => (
                  <p key={kind} className="text-xs text-slate-500 pl-6">
                    {ANALYSIS_KIND_LABELS[kind].label} is not available for{' '}
                    {MODE_META[modeTab].label.toLowerCase()}.
                  </p>
                ))}
            </div>
          )}
        </div>

        {/* 3. Engine */}
        <div className="bg-navy-800 rounded-lg p-4 space-y-4">
          <h3 className="text-white font-medium">Engine</h3>

          <div>
            <p className="text-slate-300 text-sm mb-1.5">Transcription language</p>
            <select
              value={activeSettings.transcriptionLanguage}
              onChange={e => persistSettings({ ...activeSettings, transcriptionLanguage: e.target.value })}
              className="w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm"
            >
              <option value="en">English</option>
              <option value="bn">Bengali (বাংলা)</option>
            </select>
            {activeSettings.transcriptionLanguage !== 'en' && isEnglishOnlyModel(activeSettings.whisperModel) && (
              <p className="mt-2 text-amber-400 text-xs">
                English-only models (.en) cannot transcribe Bengali. Please select a multilingual model below.
              </p>
            )}
          </div>

          <div>
            <p className="text-slate-300 text-sm mb-1.5">Whisper model</p>
            <WhisperModelSelect
              value={activeSettings.whisperModel}
              refreshKey={showModelCheck}
              onChange={handleWhisperModelChange}
            />
          </div>

          <div>
            <p className="text-slate-300 text-sm mb-1.5">Ollama model</p>
            <OllamaModelSelect
              value={activeSettings.ollamaModel}
              refreshKey={showModelCheck}
              onChange={handleOllamaModelChange}
            />
          </div>

          <div>
            <p className="text-slate-300 text-sm mb-1.5">Ollama address</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={hostDraft}
                onChange={e => { setHostDraft(e.target.value); setHostTest('idle'); }}
                placeholder="http://localhost:11434"
                className="flex-1 px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm"
              />
              <button
                onClick={handleTestHost}
                disabled={hostTest === 'testing'}
                className="px-3 py-2 bg-navy-700 hover:bg-navy-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {hostTest === 'testing' && <Loader2 size={14} className="animate-spin" />}
                Test
              </button>
            </div>
            <p className="mt-1.5 text-xs">
              {hostTest === 'ok' && <span className="text-emerald-400">Connected.</span>}
              {hostTest === 'fail' && <span className="text-red-400">No response at that address.</span>}
              {hostTest !== 'ok' && hostTest !== 'fail' && (
                <span className="text-slate-500">Change this if Ollama runs in WSL, Docker, or on another machine.</span>
              )}
            </p>
          </div>

          <div>
            <p className="text-slate-300 text-sm mb-1.5">Audio chunk duration</p>
            <select
              value={activeSettings.chunkDurationSeconds}
              onChange={e => persistSettings({ ...activeSettings, chunkDurationSeconds: parseInt(e.target.value) })}
              className="w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm"
            >
              <option value="180">3 minutes</option>
              <option value="300">5 minutes (recommended)</option>
              <option value="600">10 minutes</option>
            </select>
          </div>
        </div>

        {/* 4. Advanced */}
        <div className="bg-navy-800 rounded-lg p-4">
          <button
            onClick={() => setShowAdvanced(prev => !prev)}
            className="flex items-center gap-1.5 text-white font-medium transition-colors"
          >
            <ChevronRight size={16} className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
            Advanced
          </button>

          {showAdvanced && (
            <div className="space-y-4 mt-4">
              <div>
                <p className="text-slate-300 text-sm mb-1.5">Model context window (tokens)</p>
                <input
                  type="number"
                  value={activeSettings.llmNumCtx}
                  min={2048}
                  step={1024}
                  onChange={e => persistSettings({ ...activeSettings, llmNumCtx: parseInt(e.target.value) || 8192 })}
                  className="w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Too low and long recordings get silently truncated. Too high and analysis slows down.
                </p>
              </div>

              <div>
                <p className="text-slate-300 text-sm mb-1.5">Transcript characters per analysis pass</p>
                <input
                  type="number"
                  value={activeSettings.llmMaxChunkChars}
                  min={1000}
                  step={500}
                  onChange={e => persistSettings({ ...activeSettings, llmMaxChunkChars: parseInt(e.target.value) || 6000 })}
                  className="w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Longer transcripts are split into passes at paragraph boundaries and merged.
                </p>
              </div>

              <div className="pt-2 border-t border-navy-700">
                <p className="text-white text-sm font-medium mb-2 flex items-center gap-2">
                  <Shield size={14} className="text-blue-400" />
                  System check
                </p>
                <button
                  onClick={() => navigate('/setup')}
                  className="px-4 py-2 bg-navy-700 hover:bg-navy-600 text-white rounded-lg text-sm transition-colors"
                >
                  Check prerequisites
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showModelCheck && (
        <SystemCheckModal
          whisperModel={pendingWhisperModel}
          ollamaModel={pendingOllamaModel}
          onClose={() => setShowModelCheck(false)}
          onModelsChanged={m => setSettings(prev => prev ? { ...prev, ...m } : prev)}
        />
      )}
    </div>
  );
}
