import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Shield } from 'lucide-react';
import { api } from '../lib/api';
import { SystemCheckModal } from '../components/SystemCheckModal';
import type { AppSettings } from '../../shared/types';

export function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [showModelCheck, setShowModelCheck] = useState(false);
  const [pendingWhisperModel, setPendingWhisperModel] = useState('');
  const [pendingOllamaModel, setPendingOllamaModel] = useState('');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
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
    const updated = { ...settings, whisperModel: value };
    persistSettings(updated);
    setPendingWhisperModel(value);
    setPendingOllamaModel(settings.ollamaModel);
    setShowModelCheck(true);
  };

  const handleOllamaModelChange = (value: string) => {
    if (!settings) return;
    const updated = { ...settings, ollamaModel: value };
    persistSettings(updated);
    setPendingWhisperModel(settings.whisperModel);
    setPendingOllamaModel(value);
    setShowModelCheck(true);
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-slate-400">Loading settings...</p>
      </div>
    );
  }

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
        {/* Transcription Language */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2">Transcription Language</h3>
          <select
            value={settings.transcriptionLanguage}
            onChange={e => persistSettings({ ...settings, transcriptionLanguage: e.target.value })}
            className="w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm"
          >
            <option value="en">English</option>
            <option value="bn">Bengali (বাংলা)</option>
          </select>
          {settings.transcriptionLanguage !== 'en' && isEnglishOnlyModel(settings.whisperModel) && (
            <p className="mt-2 text-amber-400 text-xs">
              English-only models (.en) cannot transcribe Bengali. Please select a multilingual model below.
            </p>
          )}
        </div>

        {/* Whisper Model */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2">Whisper Model</h3>
          <select
            value={settings.whisperModel}
            onChange={e => handleWhisperModelChange(e.target.value)}
            className="w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm"
          >
            <optgroup label="English-only (smaller, faster)">
              <option value="ggml-base.en.bin">base.en (148 MB) — Fast, good accuracy</option>
              <option value="ggml-small.en.bin">small.en (488 MB) — Slower, better accuracy</option>
              <option value="ggml-medium.en.bin">medium.en (1.5 GB) — Slowest, best accuracy</option>
            </optgroup>
            <optgroup label="Multilingual (supports Bengali &amp; others)">
              <option value="ggml-base.bin">base (148 MB) — Fast, multilingual</option>
              <option value="ggml-small.bin">small (488 MB) — Better accuracy, multilingual</option>
              <option value="ggml-medium.bin">medium (1.5 GB) — Best accuracy, multilingual</option>
            </optgroup>
          </select>
        </div>

        {/* Ollama Model */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2">Ollama Model</h3>
          <select
            value={settings.ollamaModel}
            onChange={e => handleOllamaModelChange(e.target.value)}
            className="w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm"
          >
            <option value="qwen2.5:7b">qwen2.5:7b — Recommended (7B params)</option>
            <option value="phi3:3.8b">phi3:3.8b — Lightweight (3.8B params)</option>
            <option value="llama3.1:8b">llama3.1:8b — Alternative (8B params)</option>
          </select>
        </div>

        {/* Chunk Duration */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2">Audio Chunk Duration</h3>
          <select
            value={settings.chunkDurationSeconds}
            onChange={e => persistSettings({ ...settings, chunkDurationSeconds: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm"
          >
            <option value="180">3 minutes</option>
            <option value="300">5 minutes (recommended)</option>
            <option value="600">10 minutes</option>
          </select>
        </div>

        {/* Grammar Check Mode */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-1">Grammar Check Mode</h3>
          <p className="text-slate-400 text-xs mb-3">
            Controls how strictly grammar is evaluated during analysis.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => persistSettings({ ...settings, grammarMode: 'professional' })}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm transition-colors border text-left ${
                settings.grammarMode === 'professional'
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-navy-900 border-navy-700 text-slate-400 hover:border-navy-600 hover:text-slate-300'
              }`}
            >
              <div className="font-semibold">Professional</div>
              <div className="text-xs mt-0.5 opacity-80">Strict — flags formality &amp; style issues</div>
            </button>
            <button
              onClick={() => persistSettings({ ...settings, grammarMode: 'conversational' })}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm transition-colors border text-left ${
                settings.grammarMode === 'conversational'
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-navy-900 border-navy-700 text-slate-400 hover:border-navy-600 hover:text-slate-300'
              }`}
            >
              <div className="font-semibold">Conversational</div>
              <div className="text-xs mt-0.5 opacity-80">Lenient — flags only clarity errors</div>
            </button>
          </div>
        </div>

        {/* Analysis Types */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-1">Analysis Types</h3>
          <p className="text-slate-400 text-xs mb-4">
            Choose which analyses to run after transcription.
          </p>
          <div className="space-y-3">
            {([
              ['analysisLineByLine', 'Line-by-Line Grammar', 'Checks each segment individually for grammar, vocabulary, and phrasing errors'],
              ['analysisGrammarFull', 'Full-Context Grammar', 'Re-analyzes grammar considering the complete conversation flow'],
              ['analysisSummary', 'Conversation Summary', 'Summarizes the meeting and extracts key points'],
              ['analysisActionItems', 'Action Items', 'Extracts tasks, owners, and deadlines from the conversation'],
              ['analysisVocabulary', 'Vocabulary Suggestions', 'Recommends stronger or more professional word choices'],
              ['analysisFluency', 'Fluency Score', 'Rates filler word usage, repetition, and sentence complexity'],
            ] as const).map(([key, label, desc]) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings[key] as boolean}
                  onChange={e => persistSettings({ ...settings, [key]: e.target.checked })}
                  className="mt-0.5 accent-blue-500"
                />
                <div>
                  <p className="text-sm text-white">{label}</p>
                  <p className="text-xs text-slate-400">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Prerequisites check */}
        <div className="bg-navy-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2 flex items-center gap-2">
            <Shield size={16} className="text-blue-400" />
            System Check
          </h3>
          <button
            onClick={() => navigate('/setup')}
            className="px-4 py-2 bg-navy-700 hover:bg-navy-600 text-white rounded-lg text-sm transition-colors"
          >
            Check Prerequisites
          </button>
        </div>
      </div>

      {showModelCheck && (
        <SystemCheckModal
          whisperModel={pendingWhisperModel}
          ollamaModel={pendingOllamaModel}
          onClose={() => setShowModelCheck(false)}
        />
      )}
    </div>
  );
}
