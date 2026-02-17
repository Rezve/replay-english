import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, Download, X, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import type { ModelCheckResult, DownloadProgressEvent } from '../../shared/types';

interface SystemCheckModalProps {
  whisperModel: string;
  ollamaModel: string;
  onClose: () => void;
}

const WHISPER_MODEL_SIZES: Record<string, string> = {
  'ggml-base.en.bin': '~148 MB',
  'ggml-small.en.bin': '~488 MB',
  'ggml-medium.en.bin': '~1.5 GB',
};

export function SystemCheckModal({ whisperModel, ollamaModel, onClose }: SystemCheckModalProps) {
  const [status, setStatus] = useState<ModelCheckResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [downloadingWhisper, setDownloadingWhisper] = useState(false);
  const [pullingOllama, setPullingOllama] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await api.checkModelStatus(whisperModel, ollamaModel);
      setStatus(result);
    } catch (err: any) {
      setError(err.message || 'Failed to check model status');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    runCheck();
    const unsubscribe = api.onDownloadProgress(setDownloadProgress);
    return unsubscribe;
  }, [whisperModel, ollamaModel]);

  const handleDownloadWhisper = async () => {
    setDownloadingWhisper(true);
    setDownloadProgress(null);
    setError(null);
    try {
      await api.downloadWhisperModel(whisperModel);
      await runCheck();
    } catch (err: any) {
      setError(`Failed to download Whisper model: ${err.message}`);
    } finally {
      setDownloadingWhisper(false);
      setDownloadProgress(null);
    }
  };

  const handlePullOllama = async () => {
    setPullingOllama(true);
    setError(null);
    try {
      await api.pullOllamaModel(ollamaModel);
      await runCheck();
    } catch (err: any) {
      setError(`Failed to pull Ollama model: ${err.message}`);
    } finally {
      setPullingOllama(false);
    }
  };

  const allReady = status && status.whisperModel.available && status.ollamaModel.available;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Model Status</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {checking && !status && (
          <div className="flex items-center gap-2 text-slate-400 py-4">
            <Loader2 size={18} className="animate-spin" />
            Checking model availability...
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
            <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {status && (
          <div className="space-y-4">
            {/* Whisper Model */}
            <div className={`rounded-lg p-4 ${status.whisperModel.available ? 'bg-slate-700/50' : 'bg-red-500/5 border border-red-500/20'}`}>
              <div className="flex items-center gap-2 mb-1">
                {status.whisperModel.available
                  ? <CheckCircle size={18} className="text-green-500" />
                  : <XCircle size={18} className="text-red-500" />
                }
                <span className="text-white font-medium text-sm">Whisper Model</span>
              </div>
              <p className="text-slate-400 text-xs ml-[26px]">{whisperModel}</p>
              {status.whisperModel.available ? (
                <p className="text-green-400 text-xs ml-[26px] mt-1">Ready to use</p>
              ) : (
                <div className="ml-[26px] mt-2">
                  {downloadingWhisper ? (
                    <div>
                      <p className="text-blue-400 text-xs mb-1">
                        {downloadProgress
                          ? `Downloading... ${downloadProgress.percentage}%${downloadProgress.total > 0 ? ` (${Math.round(downloadProgress.downloaded / 1024 / 1024)}MB / ${Math.round(downloadProgress.total / 1024 / 1024)}MB)` : ''}`
                          : 'Starting download...'
                        }
                      </p>
                      <div className="w-full bg-slate-700 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${downloadProgress?.percentage || 0}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={handleDownloadWhisper}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                    >
                      <Download size={14} />
                      Download ({WHISPER_MODEL_SIZES[whisperModel] || 'unknown size'})
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Ollama Model */}
            <div className={`rounded-lg p-4 ${status.ollamaModel.available ? 'bg-slate-700/50' : 'bg-red-500/5 border border-red-500/20'}`}>
              <div className="flex items-center gap-2 mb-1">
                {status.ollamaModel.available
                  ? <CheckCircle size={18} className="text-green-500" />
                  : <XCircle size={18} className="text-red-500" />
                }
                <span className="text-white font-medium text-sm">Ollama Model</span>
              </div>
              <p className="text-slate-400 text-xs ml-[26px]">{ollamaModel}</p>
              {!status.ollamaModel.ollamaRunning ? (
                <p className="text-orange-400 text-xs ml-[26px] mt-1">
                  Ollama is not running. Start Ollama first.
                </p>
              ) : status.ollamaModel.available ? (
                <p className="text-green-400 text-xs ml-[26px] mt-1">Ready to use</p>
              ) : (
                <div className="ml-[26px] mt-2">
                  {pullingOllama ? (
                    <div className="flex items-center gap-2 text-blue-400 text-xs">
                      <Loader2 size={14} className="animate-spin" />
                      Pulling model... this may take a few minutes
                    </div>
                  ) : (
                    <button
                      onClick={handlePullOllama}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                    >
                      <Download size={14} />
                      Pull Model
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            disabled={downloadingWhisper || pullingOllama}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              allReady
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {allReady ? 'All Ready' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
