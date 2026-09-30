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

export const WHISPER_MODEL_CATALOG = [
  { file: 'ggml-base.en.bin', label: 'base.en', size: '148 MB', multilingual: false, note: 'Fast, good accuracy' },
  { file: 'ggml-small.en.bin', label: 'small.en', size: '488 MB', multilingual: false, note: 'Slower, better accuracy' },
  { file: 'ggml-medium.en.bin', label: 'medium.en', size: '1.5 GB', multilingual: false, note: 'Slowest, best accuracy' },
  { file: 'ggml-base.bin', label: 'base', size: '148 MB', multilingual: true, note: 'Fast, multilingual' },
  { file: 'ggml-small.bin', label: 'small', size: '488 MB', multilingual: true, note: 'Better accuracy, multilingual' },
  { file: 'ggml-medium.bin', label: 'medium', size: '1.5 GB', multilingual: true, note: 'Best accuracy, multilingual' },
] as const;

export const DEFAULT_SETTINGS = {
  whisperModel: 'ggml-base.en.bin',
  ollamaModel: 'qwen2.5:7b',
  transcriptionLanguage: 'en',
  chunkDurationSeconds: 300,
  dataPath: '',
  analysisLineByLine: true,
  analysisGrammarFull: true,
  analysisSummary: true,
  analysisActionItems: true,
  analysisVocabulary: true,
  analysisFluency: true,
  grammarMode: 'professional',
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
  ANALYZE_TRANSCRIPT: 'analysis:analyze-transcript',
  RE_ANALYZE_MEETING: 'analysis:re-analyze',
  STOP_ANALYSIS: 'analysis:stop',
  START_ANALYSIS: 'analysis:start',
  RUN_CONTEXT_ANALYSES: 'analysis:run-context-analyses',
  RUN_SINGLE_CONTEXT_ANALYSIS: 'analysis:run-single-context-analysis',

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
} as const;
