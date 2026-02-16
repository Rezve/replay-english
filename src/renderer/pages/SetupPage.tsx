import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, RefreshCw, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { PrerequisiteStatus, DownloadProgressEvent } from '../../shared/types';

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
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressEvent | null>(null);

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

    // Listen for download progress
    const unsubscribe = api.onDownloadProgress((progress) => {
      setDownloadProgress(progress);
    });

    return unsubscribe;
  }, []);

  const downloadWhisperModel = async () => {
    setDownloading(true);
    setDownloadProgress(null);
    try {
      await api.downloadWhisperModel();
      // Re-check prerequisites after download
      await runChecks();
    } catch (err) {
      console.error('Failed to download model:', err);
      alert('Failed to download model. Please check your internet connection and try again.');
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

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
          {items.map((item) => {
            const isWhisperModel = item.name === 'Whisper Model';
            const canDownload = isWhisperModel && item.status === 'error';

            return (
              <div
                key={item.name}
                className={`flex items-start gap-3 rounded-lg p-4 ${
                  item.status === 'error' ? 'bg-red-500/5 border border-red-500/20' : 'bg-slate-800'
                }`}
              >
                {item.status === 'checking' && <Loader2 size={20} className="text-slate-500 animate-spin mt-0.5" />}
                {item.status === 'ok' && <CheckCircle size={20} className="text-green-500 mt-0.5" />}
                {item.status === 'error' && <XCircle size={20} className="text-red-500 mt-0.5" />}
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">{item.name}</p>
                  <p className="text-slate-500 text-xs">{item.description}</p>
                  {item.hint && !downloading && (
                    <p className="text-orange-400 text-xs mt-1">{item.hint}</p>
                  )}
                  {canDownload && downloading && downloadProgress && (
                    <div className="mt-2">
                      <p className="text-blue-400 text-xs mb-1">
                        Downloading... {downloadProgress.percentage}%
                        {downloadProgress.total > 0 && (
                          <> ({Math.round(downloadProgress.downloaded / 1024 / 1024)}MB / {Math.round(downloadProgress.total / 1024 / 1024)}MB)</>
                        )}
                      </p>
                      <div className="w-full bg-slate-700 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${downloadProgress.percentage}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {canDownload && downloading && !downloadProgress && (
                    <p className="text-blue-400 text-xs mt-2">Starting download...</p>
                  )}
                  {canDownload && !downloading && (
                    <button
                      onClick={downloadWhisperModel}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                    >
                      <Download size={14} />
                      Download Model (~148MB)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-3">
          {hasErrors && (
            <button
              onClick={runChecks}
              disabled={checking || downloading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
