export const ERROR_PARENT_CATEGORIES = ['Grammar', 'Vocabulary', 'Phrasing'] as const;

export const ERROR_CATEGORIES = {
  Grammar: [
    'Subject-Verb Agreement',
    'Tense Consistency',
    'Article Usage',
    'Preposition Errors',
    'Plural/Singular',
    'Word Order',
    'Conditional Structures',
    'Pronoun Reference',
  ],
  Vocabulary: [
    'Word Choice',
    'False Friends',
    'Collocation Errors',
    'Register Mismatch',
  ],
  Phrasing: [
    'Awkward Phrasing',
    'Redundancy',
    'Run-on Sentence',
    'Incomplete Thought',
    'Non-idiomatic Expression',
  ],
} as const;

/** Stable key for a category, used for seeding and to prefix its rule keys. */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface GrammarRuleSeed {
  key: string;
  categorySlug: string;
  label: string;
  /** The one-line teaching text — this is what makes the review queue a learning tool. */
  hint: string;
  exampleWrong?: string;
  exampleRight?: string;
  defaultSeverity?: 'minor' | 'moderate' | 'major';
}

// The closed rule vocabulary behind pattern identity. The model picks a key
// from this list, so the same habit in different words collapses to one
// tracked item. Anything unrecognized falls back to '<category>.other'.
const RULES_BY_CATEGORY: Record<string, Omit<GrammarRuleSeed, 'categorySlug'>[]> = {
  'Subject-Verb Agreement': [
    { key: 'sva.third-person-s', label: 'Third-person -s on present verbs', hint: 'With he, she, it or a singular noun, add -s to the present-tense verb.', exampleWrong: 'He have two dogs.', exampleRight: 'He has two dogs.', defaultSeverity: 'moderate' },
    { key: 'sva.plural-subject', label: 'Plural subject with singular verb', hint: 'Plural subjects take the base verb: "they work", not "they works".', exampleWrong: 'The files is ready.', exampleRight: 'The files are ready.', defaultSeverity: 'moderate' },
    { key: 'sva.there-is-are', label: '"There is" vs "there are"', hint: 'Match "there is/are" to what follows it, not to the speaker.', exampleWrong: 'There is three issues.', exampleRight: 'There are three issues.', defaultSeverity: 'minor' },
    { key: 'sva.collective-noun', label: 'Agreement with collective nouns', hint: 'Treat team, group and data consistently once you pick singular or plural.', exampleWrong: 'The team are deciding, and it have concerns.', exampleRight: 'The team is deciding, and it has concerns.', defaultSeverity: 'minor' },
  ],
  'Tense Consistency': [
    { key: 'tense.past-form', label: 'Wrong past-tense form', hint: 'Use the past form for finished past actions, including irregular verbs.', exampleWrong: 'Yesterday I go to the office.', exampleRight: 'Yesterday I went to the office.', defaultSeverity: 'moderate' },
    { key: 'tense.present-perfect', label: 'Present perfect vs simple past', hint: 'Use present perfect for things still relevant now, simple past for a finished time.', exampleWrong: 'I have finished it yesterday.', exampleRight: 'I finished it yesterday.', defaultSeverity: 'moderate' },
    { key: 'tense.continuous', label: 'Simple vs continuous', hint: 'Use the continuous for something in progress: "I am working on it".', exampleWrong: 'Right now I work on the report.', exampleRight: "Right now I'm working on the report.", defaultSeverity: 'minor' },
    { key: 'tense.shift', label: 'Unintended tense shift', hint: 'Stay in one tense within a thought unless the time actually changes.', exampleWrong: 'He called me and says it is done.', exampleRight: 'He called me and said it was done.', defaultSeverity: 'moderate' },
  ],
  'Article Usage': [
    { key: 'article.missing-indefinite', label: 'Missing "a"/"an"', hint: 'Singular countable nouns need an article: "a meeting", not "meeting".', exampleWrong: 'I had call with the client.', exampleRight: 'I had a call with the client.', defaultSeverity: 'minor' },
    { key: 'article.missing-definite', label: 'Missing "the"', hint: 'Use "the" for something specific both speakers already know about.', exampleWrong: 'Can you send report?', exampleRight: 'Can you send the report?', defaultSeverity: 'minor' },
    { key: 'article.unnecessary', label: 'Unnecessary article', hint: 'Drop the article before uncountable and general plural nouns.', exampleWrong: 'I need the informations about the softwares.', exampleRight: 'I need information about the software.', defaultSeverity: 'minor' },
    { key: 'article.a-vs-an', label: '"a" vs "an"', hint: 'Choose by the sound that follows: "an hour", "a university".', exampleWrong: 'It took a hour.', exampleRight: 'It took an hour.', defaultSeverity: 'minor' },
  ],
  'Preposition Errors': [
    { key: 'prep.time', label: 'Prepositions of time', hint: 'in for months and years, on for days and dates, at for clock times.', exampleWrong: 'The call is in Monday at morning.', exampleRight: 'The call is on Monday in the morning.', defaultSeverity: 'minor' },
    { key: 'prep.place', label: 'Prepositions of place', hint: 'in for enclosed spaces, on for surfaces, at for points and addresses.', exampleWrong: "I'm on the office.", exampleRight: "I'm at the office.", defaultSeverity: 'minor' },
    { key: 'prep.verb-pairing', label: 'Preposition a verb requires', hint: 'Many verbs fix their preposition: depend on, listen to, agree with.', exampleWrong: 'It depends of the budget.', exampleRight: 'It depends on the budget.', defaultSeverity: 'moderate' },
    { key: 'prep.extra', label: 'Extra preposition', hint: 'Some verbs take a direct object: discuss it, not discuss about it.', exampleWrong: 'We discussed about the plan.', exampleRight: 'We discussed the plan.', defaultSeverity: 'moderate' },
  ],
  'Plural/Singular': [
    { key: 'plural.missing-s', label: 'Missing plural -s', hint: 'Count nouns take -s when there is more than one.', exampleWrong: 'I sent three email.', exampleRight: 'I sent three emails.', defaultSeverity: 'moderate' },
    { key: 'plural.uncountable', label: 'Pluralizing an uncountable noun', hint: 'Information, feedback, advice and software have no plural form.', exampleWrong: 'Thanks for the feedbacks.', exampleRight: 'Thanks for the feedback.', defaultSeverity: 'moderate' },
    { key: 'plural.irregular', label: 'Irregular plural form', hint: 'Some plurals change the word: people, children, analyses, criteria.', exampleWrong: 'Two persons joined.', exampleRight: 'Two people joined.', defaultSeverity: 'minor' },
    { key: 'plural.quantifier', label: 'Quantifier and noun mismatch', hint: 'much/little go with uncountables, many/few with countables.', exampleWrong: 'I have much tasks.', exampleRight: 'I have many tasks.', defaultSeverity: 'minor' },
  ],
  'Word Order': [
    { key: 'order.question', label: 'Question word order', hint: 'Questions invert the subject and auxiliary: "Where is it?"', exampleWrong: 'Where it is?', exampleRight: 'Where is it?', defaultSeverity: 'moderate' },
    { key: 'order.adjective', label: 'Adjective position', hint: 'In English the adjective goes before the noun.', exampleWrong: 'a solution simple', exampleRight: 'a simple solution', defaultSeverity: 'moderate' },
    { key: 'order.adverb', label: 'Adverb placement', hint: 'Frequency adverbs go before the main verb, after "be".', exampleWrong: 'I go always early.', exampleRight: 'I always go early.', defaultSeverity: 'minor' },
    { key: 'order.indirect-question', label: 'Embedded question order', hint: 'Inside a longer sentence, keep normal order: "I know where it is".', exampleWrong: 'I know where is it.', exampleRight: 'I know where it is.', defaultSeverity: 'moderate' },
  ],
  'Conditional Structures': [
    { key: 'conditional.first', label: 'Real future condition', hint: 'Use present after "if" and will in the result: "If it works, I will ship".', exampleWrong: 'If it will work, I will ship it.', exampleRight: 'If it works, I will ship it.', defaultSeverity: 'moderate' },
    { key: 'conditional.second', label: 'Hypothetical condition', hint: 'For unreal present situations: "If I had time, I would do it".', exampleWrong: 'If I would have time, I will do it.', exampleRight: 'If I had time, I would do it.', defaultSeverity: 'moderate' },
    { key: 'conditional.third', label: 'Past hypothetical', hint: 'For the unchangeable past: "If I had known, I would have told you".', exampleWrong: 'If I knew, I would tell you yesterday.', exampleRight: 'If I had known, I would have told you.', defaultSeverity: 'moderate' },
  ],
  'Pronoun Reference': [
    { key: 'pronoun.unclear', label: 'Unclear what a pronoun refers to', hint: 'Name the thing again when "it" or "they" could mean more than one thing.', exampleWrong: 'The build and the test failed, so I fixed it.', exampleRight: 'The build and the test failed, so I fixed the build.', defaultSeverity: 'moderate' },
    { key: 'pronoun.agreement', label: 'Pronoun does not match its noun', hint: 'A singular noun takes a singular pronoun.', exampleWrong: 'Each member should bring their own laptop and he can set it up.', exampleRight: 'Each member should bring their own laptop and set it up.', defaultSeverity: 'minor' },
    { key: 'pronoun.case', label: 'Subject vs object pronoun', hint: 'Use I, he, she, they as subjects; me, him, her, them as objects.', exampleWrong: 'Him and me reviewed it.', exampleRight: 'He and I reviewed it.', defaultSeverity: 'moderate' },
    { key: 'pronoun.missing-subject', label: 'Missing subject pronoun', hint: 'English needs an explicit subject, even when it is obvious.', exampleWrong: 'Is working now.', exampleRight: 'It is working now.', defaultSeverity: 'moderate' },
  ],
  'Word Choice': [
    { key: 'wordchoice.wrong-meaning', label: 'Word means something else', hint: 'The word chosen has a different meaning than intended.', defaultSeverity: 'major' },
    { key: 'wordchoice.make-vs-do', label: 'make vs do', hint: 'You make a decision and do a task.', exampleWrong: 'I will do a decision.', exampleRight: 'I will make a decision.', defaultSeverity: 'moderate' },
    { key: 'wordchoice.say-vs-tell', label: 'say vs tell', hint: 'You tell someone something; you say something.', exampleWrong: 'He said me the news.', exampleRight: 'He told me the news.', defaultSeverity: 'moderate' },
    { key: 'wordchoice.confusable-pair', label: 'Commonly confused pair', hint: 'Easily swapped words: affect/effect, then/than, lose/loose.', defaultSeverity: 'moderate' },
  ],
  'False Friends': [
    { key: 'falsefriend.lookalike', label: 'Looks like a word in your language', hint: 'The English word that resembles your own means something different here.', defaultSeverity: 'moderate' },
    { key: 'falsefriend.actually', label: '"actually" / "eventually"', hint: 'actually means "in fact", not "currently"; eventually means "in the end", not "possibly".', exampleWrong: 'Actually I am in a meeting.', exampleRight: 'Currently I am in a meeting.', defaultSeverity: 'minor' },
  ],
  'Collocation Errors': [
    { key: 'collocation.verb-noun', label: 'Verb and noun do not pair', hint: 'Some verb-noun pairs are fixed: take a decision is not standard, make one is.', defaultSeverity: 'minor' },
    { key: 'collocation.adjective-noun', label: 'Adjective and noun do not pair', hint: 'Use the adjective English conventionally pairs with that noun.', exampleWrong: 'a strong rain', exampleRight: 'heavy rain', defaultSeverity: 'minor' },
    { key: 'collocation.phrasal-verb', label: 'Wrong particle on a phrasal verb', hint: 'The particle changes the meaning: look up, look after, look into.', defaultSeverity: 'moderate' },
  ],
  'Register Mismatch': [
    { key: 'register.too-informal', label: 'Too informal for the setting', hint: 'A more neutral phrasing fits a professional conversation better.', defaultSeverity: 'minor' },
    { key: 'register.too-formal', label: 'Stiffer than it needs to be', hint: 'A simpler, more natural phrasing sounds less rehearsed.', defaultSeverity: 'minor' },
  ],
  'Awkward Phrasing': [
    { key: 'awkward.literal-translation', label: 'Translated word for word', hint: 'The words are English but the construction comes from another language.', defaultSeverity: 'moderate' },
    { key: 'awkward.overcomplicated', label: 'Longer than it needs to be', hint: 'A shorter phrasing carries the same meaning more clearly.', defaultSeverity: 'minor' },
    { key: 'awkward.unnatural-order', label: 'Unnatural phrase order', hint: 'A native speaker would arrange this differently.', defaultSeverity: 'minor' },
  ],
  'Redundancy': [
    { key: 'redundancy.repeated-meaning', label: 'Says the same thing twice', hint: 'Drop the part that repeats what you already said.', exampleWrong: 'Let me repeat it again.', exampleRight: 'Let me repeat it.', defaultSeverity: 'minor' },
    { key: 'redundancy.filler-phrase', label: 'Phrase that adds nothing', hint: 'Cut the words that carry no meaning of their own.', defaultSeverity: 'minor' },
  ],
  'Run-on Sentence': [
    { key: 'runon.missing-connector', label: 'Clauses joined without a connector', hint: 'Join clauses with and, but or because, or make two sentences.', defaultSeverity: 'minor' },
    { key: 'runon.chained-and', label: 'Too many clauses chained together', hint: 'Break a long chain into shorter sentences so listeners can follow.', defaultSeverity: 'minor' },
  ],
  'Incomplete Thought': [
    { key: 'incomplete.missing-verb', label: 'Sentence has no verb', hint: 'Every clause needs a verb, usually a form of "be" at minimum.', exampleWrong: 'The report ready.', exampleRight: 'The report is ready.', defaultSeverity: 'moderate' },
    { key: 'incomplete.abandoned', label: 'Sentence trails off', hint: 'Finish the thought — the listener is left waiting for the rest.', defaultSeverity: 'minor' },
    { key: 'incomplete.missing-object', label: 'Verb is missing its object', hint: 'Transitive verbs need to say what they act on.', defaultSeverity: 'moderate' },
  ],
  'Non-idiomatic Expression': [
    { key: 'idiom.altered', label: 'Fixed expression changed', hint: 'The idiom exists, but one of its words has been swapped.', defaultSeverity: 'minor' },
    { key: 'idiom.invented', label: 'Expression does not exist in English', hint: 'This phrasing is not an English expression — say it plainly instead.', defaultSeverity: 'moderate' },
  ],
};

/**
 * Every rule, flattened, with an `<category>.other` catch-all per category so
 * an unrecognized label from the model still lands somewhere explainable.
 */
export const GRAMMAR_RULES: GrammarRuleSeed[] = Object.entries(RULES_BY_CATEGORY).flatMap(
  ([category, rules]) => {
    const slug = categorySlug(category);
    return [
      ...rules.map(rule => ({ ...rule, categorySlug: slug })),
      {
        key: `${slug}.other`,
        categorySlug: slug,
        label: `Other ${category.toLowerCase()} issue`,
        hint: `A ${category.toLowerCase()} issue that does not fit the specific rules yet.`,
      },
    ];
  }
);

/** Rule keys grouped by category, for building the prompt's closed enum. */
export const RULE_KEYS_BY_CATEGORY: Record<string, string[]> = Object.fromEntries(
  Object.keys(RULES_BY_CATEGORY).map(category => [
    category,
    GRAMMAR_RULES.filter(r => r.categorySlug === categorySlug(category)).map(r => r.key),
  ])
);

// Categories the conversational standard explicitly does not treat as errors, so
// they must not appear in that mode's prompt enum either.
const CONVERSATIONAL_EXCLUDED_CATEGORIES = ['Register Mismatch'];

/**
 * The rule keys available to an LLM prompt, grouped by category. Keys are
 * self-describing so no labels are needed, keeping this compact enough to
 * include in every batch.
 */
export function promptRuleList(mode: 'professional' | 'conversational'): string {
  const usable = new Set(promptCategoryList(mode).split(', '));
  return Object.entries(RULE_KEYS_BY_CATEGORY)
    .filter(([category]) => usable.has(category))
    .map(([category, keys]) => `${category}: ${keys.join(', ')}`)
    .join('\n');
}

/**
 * The category list for an LLM prompt, derived from the seeded taxonomy so the
 * prompt and the database can never drift apart.
 */
export function promptCategoryList(mode: 'professional' | 'conversational'): string {
  const all = Object.values(ERROR_CATEGORIES).flat() as string[];
  const usable = mode === 'conversational'
    ? all.filter(c => !CONVERSATIONAL_EXCLUDED_CATEGORIES.includes(c))
    : all;
  return usable.join(', ');
}

export const WHISPER_MODEL_CATALOG = [
  { file: 'ggml-base.en.bin', label: 'base.en', size: '148 MB', multilingual: false, note: 'Fast, good accuracy' },
  { file: 'ggml-small.en.bin', label: 'small.en', size: '488 MB', multilingual: false, note: 'Slower, better accuracy' },
  { file: 'ggml-medium.en.bin', label: 'medium.en', size: '1.5 GB', multilingual: false, note: 'Slowest, best accuracy' },
  { file: 'ggml-base.bin', label: 'base', size: '148 MB', multilingual: true, note: 'Fast, multilingual' },
  { file: 'ggml-small.bin', label: 'small', size: '488 MB', multilingual: true, note: 'Better accuracy, multilingual' },
  { file: 'ggml-medium.bin', label: 'medium', size: '1.5 GB', multilingual: true, note: 'Best accuracy, multilingual' },
] as const;

export const ALL_CONTEXT_ANALYSIS_TYPES = [
  'grammar_full',
  'summary',
  'action_items',
  'vocabulary',
  'fluency',
] as const;

/** Everything that can be switched on, including the line-by-line pass. */
export const ALL_ANALYSIS_KINDS = ['line_by_line', ...ALL_CONTEXT_ANALYSIS_TYPES] as const;

export type AnalysisKind = typeof ALL_ANALYSIS_KINDS[number];

/**
 * What each recording mode is even allowed to run. Action items are
 * meaningless when you are practising alone, so solo cannot select them and
 * the report hides that tab rather than showing a permanently empty panel.
 */
export const MODE_ANALYSES: Record<'solo' | 'meeting', AnalysisKind[]> = {
  solo: ['line_by_line', 'grammar_full', 'summary', 'vocabulary', 'fluency'],
  meeting: ['line_by_line', 'grammar_full', 'summary', 'action_items', 'vocabulary', 'fluency'],
};

export const ANALYSIS_PRESETS: Record<string, { label: string; description: string; kinds: AnalysisKind[] }> = {
  essentials: {
    label: 'Essentials',
    description: 'Just the sentence-by-sentence check. Fastest.',
    kinds: ['line_by_line'],
  },
  balanced: {
    label: 'Balanced',
    description: 'Sentence check plus full-context grammar and a summary.',
    kinds: ['line_by_line', 'grammar_full', 'summary'],
  },
  everything: {
    label: 'Everything',
    description: 'Every analysis. Slowest, most thorough.',
    kinds: [...ALL_ANALYSIS_KINDS],
  },
};

export const ANALYSIS_KIND_LABELS: Record<AnalysisKind, { label: string; description: string }> = {
  line_by_line: {
    label: 'Sentence-by-sentence check',
    description: 'Checks each sentence for grammar, vocabulary, and phrasing errors. This is what the correct-sentence percentage is based on.',
  },
  grammar_full: {
    label: 'Full-context grammar',
    description: 'Re-reads the whole transcript so errors that only show up across sentences get caught.',
  },
  summary: { label: 'Summary', description: 'Summarizes what was discussed and pulls out key points.' },
  action_items: { label: 'Action items', description: 'Extracts tasks, owners, and deadlines.' },
  vocabulary: { label: 'Vocabulary suggestions', description: 'Suggests more natural or precise word choices.' },
  fluency: { label: 'Fluency score', description: 'Rates filler words, repetition, and overall flow.' },
};

/** Serializes an analysis selection for the key/value settings table. */
export function serializeAnalyses(kinds: AnalysisKind[]): string {
  return kinds.join(',');
}

export function parseAnalyses(raw: string | undefined, fallback: AnalysisKind[]): AnalysisKind[] {
  if (raw === undefined) return fallback;
  const valid = new Set<string>(ALL_ANALYSIS_KINDS);
  // An empty string is a real choice ("run nothing"), not a missing value.
  return raw.split(',').map(s => s.trim()).filter(s => valid.has(s)) as AnalysisKind[];
}

export const DEFAULT_SETTINGS = {
  whisperModel: 'ggml-base.en.bin',
  ollamaModel: 'qwen2.5:7b',
  ollamaHost: 'http://localhost:11434',
  transcriptionLanguage: 'en',
  chunkDurationSeconds: 300,
  // Prompt + completion share the context window, so keep num_predict well under it.
  llmNumCtx: 8192,
  llmMaxChunkChars: 6000,
  defaultRecordingMode: 'meeting',
  // Deliberate practice should be strict; real conversation should be lenient.
  grammarModeSolo: 'professional',
  grammarModeMeeting: 'conversational',
  analysesSolo: 'line_by_line,grammar_full,vocabulary,fluency',
  analysesMeeting: 'line_by_line,grammar_full,summary,action_items,vocabulary,fluency',
  analysisPreset: 'custom',
  skipStartupCheck: false,
} as const;

export const IPC_CHANNELS = {
  // Audio
  SAVE_AUDIO_CHUNK: 'audio:save-chunk',
  CONVERT_TO_WAV: 'audio:convert-to-wav',
  GET_AUDIO_CHUNKS: 'audio:get-chunks',
  READ_AUDIO_CHUNK: 'audio:read-chunk',

  // Transcription
  TRANSCRIBE_CHUNK: 'transcription:transcribe-chunk',

  // Analysis
  PROCESS_MEETING: 'pipeline:process-meeting',
  ANALYZE_TRANSCRIPT: 'analysis:analyze-transcript',
  RE_ANALYZE_MEETING: 'analysis:re-analyze',
  STOP_ANALYSIS: 'analysis:stop',
  STOP_TRANSCRIPTION: 'transcription:stop',
  START_ANALYSIS: 'analysis:start',
  RUN_CONTEXT_ANALYSES: 'analysis:run-context-analyses',
  RUN_SINGLE_CONTEXT_ANALYSIS: 'analysis:run-single-context-analysis',
  RETRY_FAILED_SENTENCES: 'analysis:retry-failed',

  // Patterns / review queue
  LIST_PATTERNS: 'pattern:list',
  GET_PATTERN: 'pattern:get',
  UPDATE_PATTERN_STATE: 'pattern:update-state',
  UPDATE_OCCURRENCE_STATE: 'mistake:update-state',
  GET_REVIEW_SUMMARY: 'review:get-summary',

  // Meetings
  CREATE_MEETING: 'meeting:create',
  GET_MEETING: 'meeting:get',
  LIST_MEETINGS: 'meeting:list',
  DELETE_MEETING: 'meeting:delete',
  UPDATE_MEETING_STATUS: 'meeting:update-status',

  // Profiles
  LIST_PROFILES: 'profile:list',
  CREATE_PROFILE: 'profile:create',
  DELETE_PROFILE: 'profile:delete',

  // Dashboard
  GET_ANALYTICS: 'dashboard:get-analytics',

  // Settings
  GET_SETTINGS: 'settings:get',
  UPDATE_SETTINGS: 'settings:update',

  // Prerequisites
  CHECK_PREREQUISITES: 'prerequisites:check',
  CHECK_MODEL_STATUS: 'prerequisites:check-model-status',
  LIST_WHISPER_MODELS: 'prerequisites:list-whisper-models',
  LIST_OLLAMA_MODELS: 'prerequisites:list-ollama-models',
  DOWNLOAD_WHISPER_MODEL: 'prerequisites:download-whisper-model',
  DOWNLOAD_WHISPER_BINARY: 'prerequisites:download-whisper-binary',
  PULL_OLLAMA_MODEL: 'prerequisites:pull-ollama-model',
  CHECK_GPU: 'prerequisites:check-gpu',

  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // Updates
  GET_APP_VERSION: 'app:get-version',
  CHECK_FOR_UPDATES: 'update:check',
  INSTALL_UPDATE: 'update:install',
  GET_UPDATE_STATUS: 'update:get-status',

  // Events
  UPDATE_STATUS: 'event:update-status',
  PROGRESS: 'event:progress',
  DOWNLOAD_PROGRESS: 'event:download-progress',
  ANALYSIS_BATCH_READY: 'event:analysis-batch-ready',
  TRANSCRIPT_CHUNK_READY: 'event:transcript-chunk-ready',
} as const;
