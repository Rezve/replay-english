import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, Download, X, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { WhisperModelSelect } from './WhisperModelSelect';
import { WHISPER_MODEL_CATALOG } from '../../shared/constants';
import type { ModelCheckResult, DownloadProgressEvent } from '../../shared/types';

const OLLAMA_MODELS = ['qwen2.5:7b', 'phi3:3.8b', 'llama3.1:8b'];

interface SystemCheckModalProps {
  whisperModel: string;
  ollamaModel: string;
  onClose: () => void;
  /** Called after the user switches model in the popup; the choice is already saved. */
  onModelsChanged?: (models: { whisperModel: string; ollamaModel: string }) => void;
  /** Show the "don't check on startup" checkbox (used for the automatic launch check). */
  showSkipOption?: boolean;
}

const whisperSize = (file: string) =>
  WHISPER_MODEL_CATALOG.find(m => m.file === file)?.size ?? 'unknown size';

export function SystemCheckModal({ whisperModel: initialWhisper, ollamaModel: initialOllama, onClose, onModelsChanged, showSkipOption }: SystemCheckModalProps) {
  const [whisperModel, setWhisperModel] = useState(initialWhisper);
  const [ollamaModel, setOllamaModel] = useState(initialOllama);
  const [downloadsVersion, setDownloadsVersion] = useState(0);
  const [status, setStatus] = useState<ModelCheckResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [downloadingWhisper, setDownloadingWhisper] = useState(false);
  const [pullingOllama, setPullingOllama] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipNextTime, setSkipNextTime] = useState(false);

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

  const changeModels = async (next: { whisperModel: string; ollamaModel: string }) => {
    setWhisperModel(next.whisperModel);
    setOllamaModel(next.ollamaModel);
    try {
      const current = await api.getSettings();
      await api.updateSettings({ ...current, ...next });
      onModelsChanged?.(next);
    } catch (err: any) {
      setError(`Failed to save model selection: ${err.message}`);
    }
  };

  const toggleSkip = async (checked: boolean) => {
    setSkipNextTime(checked);
    try {
      const current = await api.getSettings();
      await api.updateSettings({ ...current, skipStartupCheck: checked });
    } catch (err: any) {
      setError(`Failed to save preference: ${err.message}`);
    }
  };

  const handleDownloadWhisper = async () => {
    setDownloadingWhisper(true);
    setDownloadProgress(null);
    setError(null);
    try {
      await api.downloadWhisperModel(whisperModel);
      setDownloadsVersion(v => v + 1);
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
      <div className="bg-navy-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
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
            <div className={`rounded-lg p-4 ${status.whisperModel.available ? 'bg-navy-700/50' : 'bg-red-500/5 border border-red-500/20'}`}>
              <div className="flex items-center gap-2 mb-1">
                {status.whisperModel.available
                  ? <CheckCircle size={18} className="text-green-500" />
                  : <XCircle size={18} className="text-red-500" />
                }
                <span className="text-white font-medium text-sm">Whisper Model</span>
              </div>
              <div className="ml-[26px] mt-1">
                <WhisperModelSelect
                  value={whisperModel}
                  refreshKey={downloadsVersion}
                  disabled={downloadingWhisper}
                  onChange={m => changeModels({ whisperModel: m, ollamaModel })}
                  className="w-full px-2 py-1.5 bg-navy-900 border border-navy-700 rounded text-white text-xs disabled:opacity-50"
                />
              </div>
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
                      <div className="w-full bg-navy-700 rounded-full h-1.5">
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
                      Download (~{whisperSize(whisperModel)})
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Ollama Model */}
            <div className={`rounded-lg p-4 ${status.ollamaModel.available ? 'bg-navy-700/50' : 'bg-red-500/5 border border-red-500/20'}`}>
              <div className="flex items-center gap-2 mb-1">
                {status.ollamaModel.available
                  ? <CheckCircle size={18} className="text-green-500" />
                  : <XCircle size={18} className="text-red-500" />
                }
                <span className="text-white font-medium text-sm">Ollama Model</span>
              </div>
              <div className="ml-[26px] mt-1">
                <select
                  value={ollamaModel}
                  disabled={pullingOllama}
                  onChange={e => changeModels({ whisperModel, ollamaModel: e.target.value })}
                  className="w-full px-2 py-1.5 bg-navy-900 border border-navy-700 rounded text-white text-xs disabled:opacity-50"
                >
                  {[...new Set([...OLLAMA_MODELS, ollamaModel])].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
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

        <div className="mt-5 flex items-center justify-between gap-3">
          {showSkipOption ? (
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={skipNextTime}
                onChange={e => toggleSkip(e.target.checked)}
                className="accent-blue-600"
              />
              Don't check on startup
            </label>
          ) : <span />}
          <button
            onClick={onClose}
            disabled={downloadingWhisper || pullingOllama}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              allReady
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-navy-700 hover:bg-navy-600 text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {allReady ? 'Continue' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
