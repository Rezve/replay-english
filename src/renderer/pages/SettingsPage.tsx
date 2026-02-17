import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, Shield } from 'lucide-react';
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

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    await api.updateSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleWhisperModelChange = (value: string) => {
    if (!settings) return;
    setSettings({ ...settings, whisperModel: value });
    setPendingWhisperModel(value);
    setPendingOllamaModel(settings.ollamaModel);
    setShowModelCheck(true);
  };

  const handleOllamaModelChange = (value: string) => {
    if (!settings) return;
    setSettings({ ...settings, ollamaModel: value });
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
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Save size={16} />
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Whisper Model */}
        <div className="bg-slate-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2">Whisper Model</h3>
          <select
            value={settings.whisperModel}
            onChange={e => handleWhisperModelChange(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
          >
            <option value="ggml-base.en.bin">base.en (148 MB) — Fast, good accuracy</option>
            <option value="ggml-small.en.bin">small.en (488 MB) — Slower, better accuracy</option>
            <option value="ggml-medium.en.bin">medium.en (1.5 GB) — Slowest, best accuracy</option>
          </select>
        </div>

        {/* Ollama Model */}
        <div className="bg-slate-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2">Ollama Model</h3>
          <select
            value={settings.ollamaModel}
            onChange={e => handleOllamaModelChange(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
          >
            <option value="qwen2.5:7b">qwen2.5:7b — Recommended (7B params)</option>
            <option value="phi3:3.8b">phi3:3.8b — Lightweight (3.8B params)</option>
            <option value="llama3.1:8b">llama3.1:8b — Alternative (8B params)</option>
          </select>
        </div>

        {/* Chunk Duration */}
        <div className="bg-slate-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2">Audio Chunk Duration</h3>
          <select
            value={settings.chunkDurationSeconds}
            onChange={e => setSettings({ ...settings, chunkDurationSeconds: parseInt(e.target.value) })}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm"
          >
            <option value="180">3 minutes</option>
            <option value="300">5 minutes (recommended)</option>
            <option value="600">10 minutes</option>
          </select>
        </div>

        {/* Prerequisites check */}
        <div className="bg-slate-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-2 flex items-center gap-2">
            <Shield size={16} className="text-blue-400" />
            System Check
          </h3>
          <button
            onClick={() => navigate('/setup')}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors"
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
