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
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number | null;
  status: MeetingStatus;
  totalSegments: number;
  totalMistakes: number;
  overallScore: number | null;
  notes: string | null;
}

export type MeetingStatus = 'recording' | 'transcribing' | 'analyzing' | 'completed' | 'failed';

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  chunkIndex: number;
  segmentIndex: number;
  startTime: number;
  endTime: number;
  text: string;
  confidence: number | null;
}

export interface Mistake {
  id: string;
  meetingId: string;
  segmentId: string;
  originalText: string;
  correctedText: string;
  explanation: string;
  alternatives: string[];
  categoryId: string | null;
  severity: MistakeSeverity;
}

export type MistakeSeverity = 'minor' | 'moderate' | 'major';

export interface ErrorCategory {
  id: string;
  name: string;
  description: string | null;
  parentCategory: string | null;
}

// IPC types

export interface CreateMeetingInput {
  title: string;
  profileId?: string;
}

export interface MeetingWithAnalysis extends Meeting {
  segments: TranscriptSegment[];
  mistakes: Mistake[];
  profile: Profile | null;
}

export interface MeetingFilters {
  profileId?: string;
  status?: MeetingStatus;
  fromDate?: number;
  toDate?: number;
}

export type TimeRange = '7d' | '30d' | '90d' | 'all';

export interface AnalyticsData {
  totalMeetings: number;
  averageMistakes: number;
  averageScore: number;
  mistakesByCategory: { category: string; count: number }[];
  mistakesTrend: { date: string; count: number; score: number }[];
  recurringMistakes: { original: string; corrected: string; count: number }[];
  mostImprovedCategory: string | null;
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
  chunkDurationSeconds: number;
  dataPath: string;
}

export interface ProgressEvent {
  stage: 'transcribing' | 'analyzing';
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

export interface GpuInfo {
  available: boolean;
  name?: string;
}

export type WhisperBinaryVariant = 'cpu' | 'cuda';

// Electron API exposed via preload
export interface ElectronAPI {
  // Audio
  saveAudioChunk(meetingId: string, chunkIndex: number, buffer: ArrayBuffer, prefix?: string): Promise<string>;
  convertToWav(inputPath: string): Promise<string>;

  // Transcription
  transcribeChunk(wavPath: string): Promise<TranscriptSegment[]>;

  // Analysis
  analyzeTranscript(meetingId: string, segments: TranscriptSegment[]): Promise<Mistake[]>;
  reAnalyzeMeeting(meetingId: string): Promise<Mistake[]>;

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
  getAnalytics(timeRange: TimeRange, profileId?: string): Promise<AnalyticsData>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<void>;

  // Pipeline
  processMeeting(meetingId: string, chunkPaths?: string[]): Promise<{ segments: TranscriptSegment[]; mistakes: Mistake[] }>;

  // Prerequisites
  checkPrerequisites(): Promise<PrerequisiteStatus>;
  downloadWhisperModel(modelName?: string): Promise<void>;
  downloadWhisperBinary(variant: WhisperBinaryVariant): Promise<void>;
  checkGpu(): Promise<GpuInfo>;

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
