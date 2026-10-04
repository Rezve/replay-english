import { describe, it, expect } from 'vitest';
import {
  ERROR_CATEGORIES,
  GRAMMAR_RULES,
  RULE_KEYS_BY_CATEGORY,
  MODE_ANALYSES,
  ANALYSIS_PRESETS,
  ANALYSIS_KIND_LABELS,
  ALL_ANALYSIS_KINDS,
  DEFAULT_SETTINGS,
  IPC_CHANNELS,
  categorySlug,
  promptCategoryList,
  promptRuleList,
  parseAnalyses,
  serializeAnalyses,
  type AnalysisKind,
} from './constants';

const ALL_CATEGORIES = Object.values(ERROR_CATEGORIES).flat() as string[];

describe('categorySlug', () => {
  it('kebab-cases a name', () => {
    expect(categorySlug('Subject-Verb Agreement')).toBe('subject-verb-agreement');
  });

  it('handles a slash', () => {
    expect(categorySlug('Plural/Singular')).toBe('plural-singular');
  });

  it('leaves no leading or trailing separator', () => {
    for (const category of ALL_CATEGORIES) {
      const slug = categorySlug(category);
      expect(slug.startsWith('-'), category).toBe(false);
      expect(slug.endsWith('-'), category).toBe(false);
    }
  });

  it('is unique across every category', () => {
    const slugs = ALL_CATEGORIES.map(categorySlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('the rule vocabulary', () => {
  // Pattern identity depends on these keys, so a duplicate or an orphan would
  // silently merge or lose a tracked habit.
  it('has unique keys', () => {
    const keys = GRAMMAR_RULES.map(r => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('maps every rule to a real category slug', () => {
    const slugs = new Set(ALL_CATEGORIES.map(categorySlug));
    for (const rule of GRAMMAR_RULES) {
      expect(slugs.has(rule.categorySlug), rule.key).toBe(true);
    }
  });

  it('gives every category an ".other" fallback', () => {
    // resolveRuleKey falls back to this when the model invents a key.
    const keys = new Set(GRAMMAR_RULES.map(r => r.key));
    for (const category of ALL_CATEGORIES) {
      expect(keys.has(`${categorySlug(category)}.other`), category).toBe(true);
    }
  });

  it('gives every rule a label and a teaching hint', () => {
    // The hint is what makes the review queue a learning tool rather than a tally.
    for (const rule of GRAMMAR_RULES) {
      expect(rule.label.length, rule.key).toBeGreaterThan(0);
      expect(rule.hint.length, rule.key).toBeGreaterThan(0);
    }
  });

  it('only uses valid severities where one is given', () => {
    for (const rule of GRAMMAR_RULES) {
      if (rule.defaultSeverity !== undefined) {
        expect(['minor', 'moderate', 'major'], rule.key).toContain(rule.defaultSeverity);
      }
    }
  });

  it('indexes the same rules under RULE_KEYS_BY_CATEGORY', () => {
    const indexed = Object.values(RULE_KEYS_BY_CATEGORY).flat();
    expect(new Set(indexed)).toEqual(new Set(GRAMMAR_RULES.map(r => r.key)));
  });

  it('covers every category in the index', () => {
    expect(Object.keys(RULE_KEYS_BY_CATEGORY).sort()).toEqual([...ALL_CATEGORIES].sort());
  });
});

describe('promptCategoryList', () => {
  it('lists every category for the professional standard', () => {
    const listed = promptCategoryList('professional').split(', ');
    expect(new Set(listed)).toEqual(new Set(ALL_CATEGORIES));
  });

  it('includes Run-on Sentence', () => {
    // It was seeded in the database but missing from both hardcoded prompts,
    // which is exactly what generating this list from the taxonomy prevents.
    expect(promptCategoryList('professional')).toContain('Run-on Sentence');
  });

  it('drops Register Mismatch for the conversational standard', () => {
    // That prompt says formality is not an error, so offering the category
    // contradicted the instruction.
    expect(promptCategoryList('conversational')).not.toContain('Register Mismatch');
    expect(promptCategoryList('professional')).toContain('Register Mismatch');
  });
});

describe('promptRuleList', () => {
  it('groups keys under their category', () => {
    expect(promptRuleList('professional')).toContain('Subject-Verb Agreement: sva.');
  });

  it('omits rules for categories the mode excludes', () => {
    expect(promptRuleList('conversational')).not.toContain('register.');
  });

  it('offers only keys that exist in the vocabulary', () => {
    const known = new Set(GRAMMAR_RULES.map(r => r.key));
    for (const line of promptRuleList('professional').split('\n')) {
      const keys = line.split(': ')[1]?.split(', ') ?? [];
      for (const key of keys) expect(known.has(key), key).toBe(true);
    }
  });
});

describe('analysis selection', () => {
  it('round-trips through the settings table', () => {
    const kinds: AnalysisKind[] = ['line_by_line', 'summary'];
    expect(parseAnalyses(serializeAnalyses(kinds), [])).toEqual(kinds);
  });

  it('treats an empty string as "run nothing", not as missing', () => {
    expect(parseAnalyses('', ['line_by_line'])).toEqual([]);
  });

  it('falls back only when the value is absent', () => {
    expect(parseAnalyses(undefined, ['line_by_line'])).toEqual(['line_by_line']);
  });

  it('discards unknown kinds rather than passing them through', () => {
    expect(parseAnalyses('line_by_line,nonsense,summary', [])).toEqual(['line_by_line', 'summary']);
  });

  it('tolerates stray whitespace', () => {
    expect(parseAnalyses(' line_by_line , summary ', [])).toEqual(['line_by_line', 'summary']);
  });
});

describe('recording modes', () => {
  it('excludes action items from solo practice', () => {
    // There is nobody to assign a task to when practising alone.
    expect(MODE_ANALYSES.solo).not.toContain('action_items');
    expect(MODE_ANALYSES.meeting).toContain('action_items');
  });

  it('offers only real analysis kinds', () => {
    for (const [mode, kinds] of Object.entries(MODE_ANALYSES)) {
      for (const kind of kinds) {
        expect(ALL_ANALYSIS_KINDS, `${mode}/${kind}`).toContain(kind);
      }
    }
  });

  it('includes the line-by-line pass in both modes', () => {
    // It is what the clean-sentence rate is computed from.
    expect(MODE_ANALYSES.solo).toContain('line_by_line');
    expect(MODE_ANALYSES.meeting).toContain('line_by_line');
  });

  it('defaults each mode to a selection it actually supports', () => {
    for (const [mode, raw] of [['solo', DEFAULT_SETTINGS.analysesSolo], ['meeting', DEFAULT_SETTINGS.analysesMeeting]] as const) {
      const allowed = new Set(MODE_ANALYSES[mode]);
      for (const kind of parseAnalyses(raw, [])) {
        expect(allowed.has(kind), `${mode}/${kind}`).toBe(true);
      }
    }
  });
});

describe('analysis presets', () => {
  it('offer only real kinds', () => {
    for (const [key, preset] of Object.entries(ANALYSIS_PRESETS)) {
      for (const kind of preset.kinds) {
        expect(ALL_ANALYSIS_KINDS, `${key}/${kind}`).toContain(kind);
      }
    }
  });

  it('always include the line-by-line pass', () => {
    for (const [key, preset] of Object.entries(ANALYSIS_PRESETS)) {
      expect(preset.kinds, key).toContain('line_by_line');
    }
  });

  it('get broader from essentials to everything', () => {
    expect(ANALYSIS_PRESETS.essentials.kinds.length)
      .toBeLessThan(ANALYSIS_PRESETS.balanced.kinds.length);
    expect(ANALYSIS_PRESETS.balanced.kinds.length)
      .toBeLessThan(ANALYSIS_PRESETS.everything.kinds.length);
  });

  it('label every analysis kind for the UI', () => {
    for (const kind of ALL_ANALYSIS_KINDS) {
      expect(ANALYSIS_KIND_LABELS[kind], kind).toBeDefined();
    }
  });
});

describe('IPC channels', () => {
  it('are unique', () => {
    const values = Object.values(IPC_CHANNELS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('include the processing pipeline', () => {
    // This one escaped the constants file and was a raw string in two places.
    expect(IPC_CHANNELS.PROCESS_MEETING).toBe('pipeline:process-meeting');
  });

  it('are all namespaced', () => {
    for (const [name, channel] of Object.entries(IPC_CHANNELS)) {
      expect(channel, name).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });
});

describe('default settings', () => {
  it('make solo practice strict and conversation lenient', () => {
    expect(DEFAULT_SETTINGS.grammarModeSolo).toBe('professional');
    expect(DEFAULT_SETTINGS.grammarModeMeeting).toBe('conversational');
  });

  it('set an explicit context window', () => {
    // Leaving num_ctx unset let the Ollama server default truncate long
    // prompts silently, which read downstream as "no mistakes".
    expect(DEFAULT_SETTINGS.llmNumCtx).toBeGreaterThanOrEqual(4096);
  });

  it('keep the chunk budget well inside the context window', () => {
    // Roughly 4 characters per token, plus room for the completion.
    expect(DEFAULT_SETTINGS.llmMaxChunkChars / 4).toBeLessThan(DEFAULT_SETTINGS.llmNumCtx / 2);
  });
});
