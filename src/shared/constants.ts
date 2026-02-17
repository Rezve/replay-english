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

export const DEFAULT_SETTINGS = {
  whisperModel: 'ggml-base.en.bin',
  ollamaModel: 'qwen2.5:7b',
  chunkDurationSeconds: 300,
  dataPath: '',
  analysisGrammarFull: true,
  analysisSummary: true,
  analysisActionItems: true,
  analysisVocabulary: true,
  analysisFluency: true,
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
  DOWNLOAD_WHISPER_MODEL: 'prerequisites:download-whisper-model',
  DOWNLOAD_WHISPER_BINARY: 'prerequisites:download-whisper-binary',
  PULL_OLLAMA_MODEL: 'prerequisites:pull-ollama-model',
  CHECK_GPU: 'prerequisites:check-gpu',

  // Events
  PROGRESS: 'event:progress',
  DOWNLOAD_PROGRESS: 'event:download-progress',
  ANALYSIS_BATCH_READY: 'event:analysis-batch-ready',
} as const;
