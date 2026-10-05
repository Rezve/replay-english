import React, { useEffect, useState } from 'react';
import { X, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { WhisperModelSelect } from '../WhisperModelSelect';

interface RetranscribeDialogProps {
  /** 'resume' starts on "only the unfinished parts"; 'all' starts over. */
  mode: 'all' | 'resume';
  defaultModel: string;
  /** Parts already transcribed, which a resume keeps. */
  doneParts: number;
  onConfirm: (whisperModel: string, resume: boolean) => void;
  onClose: () => void;
  onOpenSetup: () => void;
}

export function whisperModelLabel(file: string): string {
  return file.replace(/^ggml-/, '').replace(/\.bin$/, '');
}

/**
 * Picks the whisper model for a retranscription. A bigger model is the usual
 * fix for a poor transcript, so the choice is offered here rather than only in
 * Settings, and it applies to this run without changing the default.
 */
export function RetranscribeDialog({
  mode,
  defaultModel,
  doneParts,
  onConfirm,
  onClose,
  onOpenSetup,
}: RetranscribeDialogProps) {
  const [model, setModel] = useState(defaultModel);
  // Resuming is offered only when there is something to keep.
  const [resume, setResume] = useState(mode === 'resume' && doneParts > 0);
  const [downloaded, setDownloaded] = useState<string[] | null>(null);

  useEffect(() => {
    api.listWhisperModels().then(setDownloaded).catch(() => setDownloaded([]));
  }, []);

  const isDownloaded = downloaded?.includes(model) ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-navy-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">
            {mode === 'resume' ? 'Finish transcription' : 'Retranscribe recording'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {doneParts > 0 ? (
          <div className="space-y-2 mb-4">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" checked={resume} onChange={() => setResume(true)} className="mt-1 accent-blue-500" />
              <span className="text-sm text-slate-300">
                <span className="text-white">Only the unfinished parts</span> — keep the {doneParts} part{doneParts === 1 ? '' : 's'} already transcribed.
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" checked={!resume} onChange={() => setResume(false)} className="mt-1 accent-blue-500" />
              <span className="text-sm text-slate-300">
                <span className="text-white">All parts</span> — replace the whole transcript, so it all comes from one model.
              </span>
            </label>
            <p className="text-xs text-slate-500">Grammar analysis then runs again on the whole recording.</p>
          </div>
        ) : (
          <p className="text-slate-300 text-sm mb-4">
            The current transcript, mistakes and insights will be replaced.
          </p>
        )}

        <label className="block text-xs text-slate-400 mb-1.5">Whisper model</label>
        <WhisperModelSelect value={model} onChange={setModel} />
        <p className="text-xs text-slate-500 mt-1.5">
          Applies to this recording only. Larger models are more accurate but slower.
        </p>

        {downloaded && !isDownloaded && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-4">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-amber-300 text-sm">
              {whisperModelLabel(model)} isn't downloaded yet.{' '}
              <button onClick={onOpenSetup} className="underline hover:text-amber-200">
                Download it on the Setup page
              </button>
              , then come back.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm bg-navy-700 hover:bg-navy-600 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(model, resume)}
            disabled={!isDownloaded}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} />
            {resume ? 'Transcribe remaining' : 'Retranscribe'}
          </button>
        </div>
      </div>
    </div>
  );
}
