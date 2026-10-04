import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import {
  DEFAULT_SETTINGS,
  MODE_ANALYSES,
  parseAnalyses,
  type AnalysisKind,
} from '../../shared/constants';
import type {
  AppSettings,
  ContextAnalysisType,
  GrammarModeValue,
  RecordingMode,
} from '../../shared/types';

// The settings table is read on nearly every analysis step; cache it and let
// updateSettings invalidate rather than re-querying per call site.
let cached: AppSettings | null = null;

export function invalidateSettings() {
  cached = null;
}

function num(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function grammarMode(raw: string | undefined, fallback: GrammarModeValue): GrammarModeValue {
  if (raw === 'conversational' || raw === 'professional') return raw;
  return fallback;
}

/**
 * The typed, coerced settings. Booleans are stored as 'true'/'false' strings;
 * an absent key falls back to DEFAULT_SETTINGS rather than silently meaning
 * "enabled", which is what the old `!== 'false'` checks did.
 */
export async function getSettings(): Promise<AppSettings> {
  if (cached) return cached;

  const db = getDb();
  const rows = await db.select().from(schema.settings).all();
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  const bool = (key: keyof AppSettings, fallback: boolean): boolean => {
    const raw = map[key];
    if (raw === undefined) return fallback;
    return raw === 'true';
  };

  cached = {
    whisperModel: map['whisperModel'] || DEFAULT_SETTINGS.whisperModel,
    ollamaModel: map['ollamaModel'] || DEFAULT_SETTINGS.ollamaModel,
    ollamaHost: map['ollamaHost'] || DEFAULT_SETTINGS.ollamaHost,
    transcriptionLanguage: map['transcriptionLanguage'] || DEFAULT_SETTINGS.transcriptionLanguage,
    chunkDurationSeconds: num(map['chunkDurationSeconds'], DEFAULT_SETTINGS.chunkDurationSeconds),
    llmNumCtx: num(map['llmNumCtx'], DEFAULT_SETTINGS.llmNumCtx),
    llmMaxChunkChars: num(map['llmMaxChunkChars'], DEFAULT_SETTINGS.llmMaxChunkChars),
    defaultRecordingMode: map['defaultRecordingMode'] === 'solo' ? 'solo' : 'meeting',
    grammarModeSolo: grammarMode(map['grammarModeSolo'], DEFAULT_SETTINGS.grammarModeSolo),
    grammarModeMeeting: grammarMode(map['grammarModeMeeting'], DEFAULT_SETTINGS.grammarModeMeeting),
    analysesSolo: map['analysesSolo'] ?? DEFAULT_SETTINGS.analysesSolo,
    analysesMeeting: map['analysesMeeting'] ?? DEFAULT_SETTINGS.analysesMeeting,
    analysisPreset: map['analysisPreset'] || DEFAULT_SETTINGS.analysisPreset,
    skipStartupCheck: bool('skipStartupCheck', DEFAULT_SETTINGS.skipStartupCheck),
  };
  return cached;
}

export async function updateSettings(updates: Partial<AppSettings>): Promise<void> {
  const db = getDb();
  for (const [key, value] of Object.entries(updates)) {
    const stringValue = String(value);
    const existing = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
    if (existing) {
      await db.update(schema.settings).set({ value: stringValue }).where(eq(schema.settings.key, key));
    } else {
      await db.insert(schema.settings).values({ key, value: stringValue });
    }
  }
  invalidateSettings();
}

/** The grammar standard that applies to a recording mode. */
export function grammarModeFor(settings: AppSettings, mode: RecordingMode): GrammarModeValue {
  return mode === 'solo' ? settings.grammarModeSolo : settings.grammarModeMeeting;
}

/**
 * What to run for a recording mode: the user's selection, capped by what the
 * mode supports — so solo can never end up asking for action items.
 */
export function analysesFor(settings: AppSettings, mode: RecordingMode): {
  lineByLine: boolean;
  contextTypes: ContextAnalysisType[];
} {
  const raw = mode === 'solo' ? settings.analysesSolo : settings.analysesMeeting;
  const fallback = mode === 'solo' ? DEFAULT_SETTINGS.analysesSolo : DEFAULT_SETTINGS.analysesMeeting;
  const selected = parseAnalyses(raw, parseAnalyses(fallback, []));
  const allowed = new Set<AnalysisKind>(MODE_ANALYSES[mode]);
  const effective = selected.filter(kind => allowed.has(kind));

  return {
    lineByLine: effective.includes('line_by_line'),
    contextTypes: effective.filter((k): k is ContextAnalysisType => k !== 'line_by_line'),
  };
}
