import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { WHISPER_MODEL_CATALOG } from '../../shared/constants';

interface WhisperModelSelectProps {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  /** Change this to re-read which models are downloaded (e.g. after a download). */
  refreshKey?: unknown;
  className?: string;
}

/**
 * Whisper model picker. Lists the built-in catalog plus any other ggml-*.bin
 * found in the models folder, marking which ones are already downloaded.
 */
export function WhisperModelSelect({ value, onChange, disabled, refreshKey, className }: WhisperModelSelectProps) {
  const [downloaded, setDownloaded] = useState<string[]>([]);

  useEffect(() => {
    api.listWhisperModels().then(setDownloaded).catch(() => setDownloaded([]));
  }, [refreshKey, value]);

  const isDownloaded = (file: string) => downloaded.includes(file);
  const known = new Set<string>(WHISPER_MODEL_CATALOG.map(m => m.file));
  const extras = downloaded.filter(f => !known.has(f));
  if (value && !known.has(value) && !extras.includes(value)) extras.push(value);

  const renderGroup = (label: string, multilingual: boolean) => (
    <optgroup label={label}>
      {WHISPER_MODEL_CATALOG.filter(m => m.multilingual === multilingual).map(m => (
        <option key={m.file} value={m.file}>
          {m.label} ({m.size}) — {m.note}{isDownloaded(m.file) ? ' ✓ downloaded' : ' · not downloaded'}
        </option>
      ))}
    </optgroup>
  );

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={className ?? 'w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm disabled:opacity-50'}
    >
      {renderGroup('English-only (smaller, faster)', false)}
      {renderGroup('Multilingual (supports Bengali & others)', true)}
      {extras.length > 0 && (
        <optgroup label="Other models in your models folder">
          {extras.map(f => (
            <option key={f} value={f}>
              {f.replace(/^ggml-/, '').replace(/\.bin$/, '')}{isDownloaded(f) ? ' ✓ downloaded' : ' · not downloaded'}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
