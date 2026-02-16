import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { PrerequisiteStatus } from '../../shared/types';

type CheckStatus = 'checking' | 'ok' | 'error';

interface PrerequisiteItem {
  name: string;
  description: string;
  status: CheckStatus;
  hint?: string;
}

export function SetupPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PrerequisiteItem[]>([
    { name: 'Whisper Binary', description: 'Speech-to-text engine', status: 'checking' },
    { name: 'Whisper Model', description: 'English language model (base.en)', status: 'checking' },
    { name: 'Ollama', description: 'Local LLM runtime', status: 'checking' },
    { name: 'Ollama Model', description: 'Grammar analysis model (qwen2.5:7b)', status: 'checking' },
    { name: 'FFmpeg', description: 'Audio conversion tool', status: 'checking' },
  ]);
  const [checking, setChecking] = useState(false);

  const runChecks = async () => {
    setChecking(true);
    setItems(prev => prev.map(i => ({ ...i, status: 'checking' as CheckStatus })));

    try {
      const status: PrerequisiteStatus = await api.checkPrerequisites();
      setItems([
        {
          name: 'Whisper Binary',
          description: 'Speech-to-text engine',
          status: status.whisperBinary ? 'ok' : 'error',
          hint: status.whisperBinary ? undefined : 'Place whisper-cli.exe in resources/whisper/',
        },
        {
          name: 'Whisper Model',
          description: 'English language model (base.en)',
          status: status.whisperModel ? 'ok' : 'error',
          hint: status.whisperModel ? undefined : 'Model will be downloaded on first use (~148MB)',
        },
        {
          name: 'Ollama',
          description: 'Local LLM runtime',
          status: status.ollamaRunning ? 'ok' : 'error',
          hint: status.ollamaRunning ? undefined : 'Install Ollama from ollama.com and make sure it is running',
        },
        {
          name: 'Ollama Model',
          description: 'Grammar analysis model (qwen2.5:7b)',
          status: status.ollamaModel ? 'ok' : 'error',
          hint: status.ollamaModel ? undefined : 'Run: ollama pull qwen2.5:7b',
        },
        {
          name: 'FFmpeg',
          description: 'Audio conversion tool',
          status: status.ffmpeg ? 'ok' : 'error',
          hint: status.ffmpeg ? undefined : 'Bundled with the app — if missing, reinstall',
        },
      ]);
    } catch (err) {
      console.error('Prerequisite check failed:', err);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    runChecks();
  }, []);

  const allPassed = items.every(i => i.status === 'ok');
  const hasErrors = items.some(i => i.status === 'error');

  return (
    <div className="flex items-center justify-center h-screen bg-slate-900">
      <div className="max-w-lg w-full p-8">
        <h1 className="text-3xl font-bold text-white mb-2">MemPill Language</h1>
        <p className="text-slate-400 mb-8">
          Let's check that everything is set up correctly
        </p>
        <div className="space-y-3 mb-8">
          {items.map((item) => (
            <div
              key={item.name}
              className={`flex items-start gap-3 rounded-lg p-4 ${
                item.status === 'error' ? 'bg-red-500/5 border border-red-500/20' : 'bg-slate-800'
              }`}
            >
              {item.status === 'checking' && <Loader2 size={20} className="text-slate-500 animate-spin mt-0.5" />}
              {item.status === 'ok' && <CheckCircle size={20} className="text-green-500 mt-0.5" />}
              {item.status === 'error' && <XCircle size={20} className="text-red-500 mt-0.5" />}
              <div>
                <p className="text-white font-medium text-sm">{item.name}</p>
                <p className="text-slate-500 text-xs">{item.description}</p>
                {item.hint && (
                  <p className="text-orange-400 text-xs mt-1">{item.hint}</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          {hasErrors && (
            <button
              onClick={runChecks}
              disabled={checking}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
            >
              <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
              Re-check
            </button>
          )}
          <button
            onClick={() => navigate('/')}
            className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors ${
              allPassed
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {allPassed ? 'Continue' : 'Continue anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}
