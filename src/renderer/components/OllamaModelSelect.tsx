import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

const SUGGESTED_MODELS: { name: string; note: string }[] = [
  { name: 'qwen2.5:7b', note: 'Recommended (7B params)' },
  { name: 'phi3:3.8b', note: 'Lightweight (3.8B params)' },
  { name: 'llama3.1:8b', note: 'Alternative (8B params)' },
];

interface OllamaModelSelectProps {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  /** Change this to re-read which models are installed (e.g. after a pull). */
  refreshKey?: unknown;
  className?: string;
}

/**
 * Ollama model picker. Lists suggested models plus every model already
 * installed in Ollama, marking which ones are installed.
 */
export function OllamaModelSelect({ value, onChange, disabled, refreshKey, className }: OllamaModelSelectProps) {
  const [installed, setInstalled] = useState<string[]>([]);

  useEffect(() => {
    api.listOllamaModels().then(setInstalled).catch(() => setInstalled([]));
  }, [refreshKey, value]);

  // Ollama reports e.g. "qwen2.5:7b" or "llama3:latest"; a bare name matches ":latest".
  const isInstalled = (name: string) =>
    installed.some(i => i === name || i === `${name}:latest`);

  const suggestedNames = new Set(SUGGESTED_MODELS.map(m => m.name));
  const extras = installed.filter(i => !suggestedNames.has(i));
  if (value && !suggestedNames.has(value) && !extras.includes(value)) extras.push(value);

  const mark = (name: string) => (isInstalled(name) ? ' ✓ installed' : ' · not installed');

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={className ?? 'w-full px-3 py-2 bg-navy-900 border border-navy-700 rounded-lg text-white text-sm disabled:opacity-50'}
    >
      <optgroup label="Suggested">
        {SUGGESTED_MODELS.map(m => (
          <option key={m.name} value={m.name}>{m.name} — {m.note}{mark(m.name)}</option>
        ))}
      </optgroup>
      {extras.length > 0 && (
        <optgroup label="Other models">
          {extras.map(name => (
            <option key={name} value={name}>{name}{mark(name)}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
