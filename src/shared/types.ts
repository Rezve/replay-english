// Domain models

export interface Profile {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
}

export interface Meeting {
  id: string;
  title: string;
  profileId: string | null;
  recordingMode: RecordingMode;
  topic: string | null;
  grammarMode: GrammarModeValue;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number | null;
  status: MeetingStatus;
  totalSegments: number;
  totalMistakes: number;
  sentencesTotal: number;
  sentencesClean: number;
  sentencesFailed: number;
  /** Clean sentences as a percentage of *checked* sentences; null until analysed. */
  cleanSentenceRate: number | null;
  analysisState: AnalysisState;
  sentenceSplitVersion: number;
  notes: string | null;
  transcript: string | null;
}

export type MeetingStatus = 'recording' | 'transcribing' | 'analyzing' | 'transcribed' | 'completed' | 'failed';

export type RecordingMode = 'solo' | 'meeting';

export type GrammarModeValue = 'professional' | 'conversational';

/** Whether a meeting's analysis finished, finished with gaps, or never ran. */
export type AnalysisState = 'none' | 'running' | 'partial' | 'complete' | 'failed';

export type AnalysisRunStatus = 'ok' | 'failed';

export type SentenceStatus = 'unanalyzed' | 'clean' | 'has_mistake' | 'failed';

export type SentenceFailureReason = 'parse' | 'network' | 'model' | 'cancelled';

export type SpanMatchKindValue = 'exact' | 'normalized' | 'fuzzy' | 'none';

export type OccurrenceState = 'new' | 'acknowledged' | 'rejected';

export type PatternState = 'new' | 'learning' | 'mastered' | 'ignored';

export interface Sentence {
  id: string;
  meetingId: string;
  segmentId: string;
  sentenceIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
  startTime: number;
  endTime: number;
  wordCount: number;
  countsTowardRate: boolean;
  status: SentenceStatus;
  failureReason: SentenceFailureReason | null;
  analyzedAt: number | null;
}

export interface Rule {
  key: string;
  categorySlug: string;
  label: string;
  hint: string;
  exampleWrong: string | null;
  exampleRight: string | null;
  defaultSeverity: MistakeSeverity | null;
  sortOrder: number;
}

export interface Pattern {
  id: string;
  ruleKey: string;
  state: PatternState;
  occurrenceCount: number;
  meetingCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastMeetingId: string | null;
  cleanRunStreak: number;
  masteredAt: number | null;
  relapseCount: number;
  ignoredAt: number | null;
  updatedAt: number;
}

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  chunkIndex: number;
  segmentIndex: number;
  startTime: number;
  endTime: number;
  text: string;
  translatedText?: string | null;
  confidence: number | null;
}

export interface Mistake {
  id: string;
  meetingId: string;
  sentenceId: string;
  segmentId: string;
  originalText: string;
  correctedText: string;
  explanation: string;
  alternatives: string[];
  categoryId: string | null;
  severity: MistakeSeverity;
  patternId: string | null;
  ruleKey: string | null;
  rawRuleKey: string | null;
  normalizedText: string;
  /** Offsets into the sentence's text, null when the quote could not be located. */
  spanStart: number | null;
  spanEnd: number | null;
  spanMatch: SpanMatchKindValue;
  occurrenceState: OccurrenceState;
  createdAt: number;
}

export type MistakeSeverity = 'minor' | 'moderate' | 'major';

export interface ErrorCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentCategory: string | null;
  sortOrder: number;
}

// Context analysis types

export type ContextAnalysisType = 'grammar_full' | 'summary' | 'action_items' | 'vocabulary' | 'fluency';

export interface MeetingAnalysis {
  id: string;
  meetingId: string;
  type: ContextAnalysisType;
  status: AnalysisRunStatus;
  errorMessage: string | null;
  chunkCount: number;
  content: string; // JSON string — parse per type
  createdAt: number;
}

export interface GrammarFullResult {
  issues: {
    original: string;
    corrected: string;
    explanation: string;
    severity: 'minor' | 'moderate' | 'major';
  }[];
}

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
}

export interface ActionItemsResult {
  items: {
    task: string;
    owner?: string;
    deadline?: string;
  }[];
}

export interface VocabularyResult {
  suggestions: {
    original: string;
    suggestion: string;
    reason: string;
  }[];
}

export interface FluencyResult {
  score: number;
  fillerWordCount: number;
  repetitionCount: number;
  notes: string[];
}

// IPC types

export interface CreateMeetingInput {
  title: string;
  profileId?: string;
  recordingMode?: RecordingMode;
  topic?: string | null;
  grammarMode?: GrammarModeValue;
}

export interface MeetingWithAnalysis extends Meeting {
  segments: TranscriptSegment[];
  sentences: Sentence[];
  mistakes: Mistake[];
  profile: Profile | null;
  analyses: MeetingAnalysis[];
}

export interface MeetingFilters {
  profileId?: string;
  status?: MeetingStatus;
  recordingMode?: RecordingMode;
  fromDate?: number;
  toDate?: number;
}

export type TimeRange = '7d' | '30d' | '90d' | 'all';

export interface RankedPattern {
  id: string;
  ruleKey: string;
  label: string;
  hint: string;
  categorySlug: string;
  state: PatternState;
  occurrenceCount: number;
  meetingCount: number;
  lastSeenAt: number;
  cleanRunStreak: number;
  relapseCount: number;
  /** Recency- and severity-weighted priority; higher means work on it sooner. */
  score: number;
}

/** One stored instance of a pattern, joined to the recording it came from. */
export interface PatternOccurrence {
  id: string;
  meetingId: string;
  meetingTitle: string;
  recordingMode: string;
  startedAt: number;
  sentenceText: string;
  startTime: number;
  originalText: string;
  correctedText: string;
  explanation: string;
  severity: MistakeSeverity;
  occurrenceState: string;
  rawRuleKey: string | null;
}

export interface ReviewSummary {
  active: number;
  mastered: number;
  ignored: number;
  relapsed: number;
  /** Share of mistakes whose quote could not be located — an analysis-quality signal. */
  unlocatedShare: number;
}

export interface AnalyticsData {
  totalMeetings: number;
  averageMistakes: number;
  /** Pooled clean sentences over checked sentences; null when nothing is checked. */
  averageCleanRate: number | null;
  sentencesChecked: number;
  sentencesClean: number;
  mistakesByCategory: { category: string; count: number }[];
  /** One point per recording. */
  cleanRateTrend: {
    meetingId: string;
    startedAt: number;
    title: string;
    count: number;
    cleanRate: number | null;
  }[];
  /** One point per calendar day, keyed YYYY-MM-DD. */
  dailyTrend: { date: string; count: number; cleanRate: number | null }[];
  topPatterns: RankedPattern[];
  mostImprovedCategory: string | null;
  mostRegressedCategory: string | null;
  mostProblematicCategory: string | null;
}

export interface PrerequisiteStatus {
  whisperBinary: boolean;
  whisperModel: boolean;
  ollamaRunning: boolean;
  ollamaModel: boolean;
  ffmpeg: boolean;
}

export interface AppSettings {
  whisperModel: string;
  ollamaModel: string;
  ollamaHost: string;
  transcriptionLanguage: string;
  chunkDurationSeconds: number;
  llmNumCtx: number;
  llmMaxChunkChars: number;
  defaultRecordingMode: RecordingMode;
  /** Which standard each mode is judged by; solo practice defaults to strict. */
  grammarModeSolo: GrammarModeValue;
  grammarModeMeeting: GrammarModeValue;
  /** Comma-separated AnalysisKind lists, one per recording mode. */
  analysesSolo: string;
  analysesMeeting: string;
  analysisPreset: string;
  skipStartupCheck: boolean;
}

export interface ProgressEvent {
  stage: 'transcribing' | 'analyzing' | 'context-analyzing';
  current: number;
  total: number;
  message: string;
}

export interface DownloadProgressEvent {
  downloaded: number;
  total: number;
  percentage: number;
}

export interface AnalysisBatchEvent {
  meetingId: string;
  mistakes: Mistake[];
  batchIndex: number;
  totalBatches: number;
  done: boolean;
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading' }
  | { state: 'downloaded'; version: string; notes?: string }
  | { state: 'error'; message: string };

export interface AudioChunkInfo {
  filename: string;
  size: number;
}

export interface GpuInfo {
  available: boolean;
  name?: string;
}

export type WhisperBinaryVariant = 'cpu' | 'cuda';

export interface ModelCheckResult {
  whisperModel: { name: string; available: boolean };
  ollamaModel: { name: string; available: boolean; ollamaRunning: boolean };
}

// Electron API exposed via preload
export interface ElectronAPI {
  // Updates
  getAppVersion(): Promise<string>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;

  // Audio
  saveAudioChunk(meetingId: string, chunkIndex: number, buffer: ArrayBuffer, prefix?: string): Promise<string>;
  convertToWav(inputPath: string): Promise<string>;
  getAudioChunks(meetingId: string): Promise<AudioChunkInfo[]>;
  readAudioChunk(meetingId: string, filename: string): Promise<ArrayBuffer | null>;

  // Transcription
  transcribeChunk(wavPath: string): Promise<TranscriptSegment[]>;

  // Analysis
  analyzeTranscript(meetingId: string, segments: TranscriptSegment[]): Promise<Mistake[]>;
  retryFailedSentences(meetingId: string): Promise<Mistake[]>;

  // Patterns / review queue
  listPatterns(limit?: number): Promise<RankedPattern[]>;
  getPatternOccurrences(patternId: string): Promise<PatternOccurrence[]>;
  updatePatternState(patternId: string, state: PatternState): Promise<void>;
  updateOccurrenceState(mistakeId: string, state: OccurrenceState): Promise<{ meetingId: string } | null>;
  getReviewSummary(): Promise<ReviewSummary>;
  reAnalyzeMeeting(meetingId: string): Promise<Mistake[]>;
  stopAnalysis(meetingId: string): Promise<void>;
  startAnalysis(meetingId: string): Promise<Mistake[]>;

  // Meetings
  createMeeting(data: CreateMeetingInput): Promise<Meeting>;
  getMeeting(id: string): Promise<MeetingWithAnalysis | null>;
  listMeetings(filters?: MeetingFilters): Promise<Meeting[]>;
  deleteMeeting(id: string): Promise<void>;
  updateMeetingStatus(id: string, status: MeetingStatus): Promise<void>;

  // Profiles
  listProfiles(): Promise<Profile[]>;
  createProfile(name: string, color?: string): Promise<Profile>;
  deleteProfile(id: string): Promise<void>;

  // Dashboard
  getAnalytics(timeRange: TimeRange, profileId?: string, recordingMode?: RecordingMode): Promise<AnalyticsData>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<void>;

  // Pipeline
  processMeeting(meetingId: string, chunkPaths?: string[]): Promise<{ segments: TranscriptSegment[]; mistakes: Mistake[] }>;

  // Prerequisites
  checkPrerequisites(): Promise<PrerequisiteStatus>;
  checkModelStatus(whisperModel: string, ollamaModel: string): Promise<ModelCheckResult>;
  listWhisperModels(): Promise<string[]>;
  listOllamaModels(): Promise<string[]>;
  downloadWhisperModel(modelName?: string): Promise<void>;
  downloadWhisperBinary(variant: WhisperBinaryVariant): Promise<void>;
  pullOllamaModel(modelName: string): Promise<void>;
  checkGpu(): Promise<GpuInfo>;

  // Context analyses
  runContextAnalyses(meetingId: string): Promise<MeetingAnalysis[]>;
  runSingleContextAnalysis(meetingId: string, type: ContextAnalysisType): Promise<MeetingAnalysis | null>;

  // Window controls
  windowMinimize(): Promise<void>;
  windowMaximize(): Promise<void>;
  windowClose(): Promise<void>;
  windowIsMaximized(): Promise<boolean>;

  // Events
  onProgress(callback: (event: ProgressEvent) => void): () => void;
  onDownloadProgress(callback: (event: DownloadProgressEvent) => void): () => void;
  onAnalysisBatch(callback: (event: AnalysisBatchEvent) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
