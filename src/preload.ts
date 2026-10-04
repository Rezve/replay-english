import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/constants';
import type {
  ElectronAPI,
  CreateMeetingInput,
  MeetingFilters,
  TimeRange,
  TranscriptSegment,
  ProgressEvent,
  DownloadProgressEvent,
  AnalysisBatchEvent,
  WhisperBinaryVariant,
  UpdateStatus,
} from './shared/types';

const electronAPI: ElectronAPI = {
  // Updates
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.CHECK_FOR_UPDATES),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.INSTALL_UPDATE),
  getUpdateStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GET_UPDATE_STATUS),
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: UpdateStatus) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATUS, handler);
  },

  // Audio
  saveAudioChunk: (meetingId: string, chunkIndex: number, buffer: ArrayBuffer, prefix?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_AUDIO_CHUNK, meetingId, chunkIndex, buffer, prefix),
  convertToWav: (inputPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONVERT_TO_WAV, inputPath),
  getAudioChunks: (meetingId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_AUDIO_CHUNKS, meetingId),
  readAudioChunk: (meetingId: string, filename: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.READ_AUDIO_CHUNK, meetingId, filename),

  // Transcription
  transcribeChunk: (wavPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSCRIBE_CHUNK, wavPath),

  // Analysis
  analyzeTranscript: (meetingId: string, segments: TranscriptSegment[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.ANALYZE_TRANSCRIPT, meetingId, segments),
  reAnalyzeMeeting: (meetingId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RE_ANALYZE_MEETING, meetingId),
  stopAnalysis: (meetingId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.STOP_ANALYSIS, meetingId),
  startAnalysis: (meetingId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.START_ANALYSIS, meetingId),

  // Meetings
  createMeeting: (data: CreateMeetingInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.CREATE_MEETING, data),
  getMeeting: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_MEETING, id),
  listMeetings: (filters?: MeetingFilters) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_MEETINGS, filters),
  deleteMeeting: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DELETE_MEETING, id),
  updateMeetingStatus: (id: string, status: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_MEETING_STATUS, id, status),

  // Profiles
  listProfiles: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_PROFILES),
  createProfile: (name: string, color?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CREATE_PROFILE, name, color),
  deleteProfile: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DELETE_PROFILE, id),

  // Dashboard
  getAnalytics: (timeRange: TimeRange, profileId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_ANALYTICS, timeRange, profileId),

  // Settings
  getSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  updateSettings: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),

  // Pipeline
  processMeeting: (meetingId: string, chunkPaths: string[]) =>
    ipcRenderer.invoke('pipeline:process-meeting', meetingId, chunkPaths),

  // Context analyses
  runContextAnalyses: (meetingId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RUN_CONTEXT_ANALYSES, meetingId),
  runSingleContextAnalysis: (meetingId: string, type: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RUN_SINGLE_CONTEXT_ANALYSIS, meetingId, type),

  // Prerequisites
  checkPrerequisites: () =>
    ipcRenderer.invoke(IPC_CHANNELS.CHECK_PREREQUISITES),
  checkModelStatus: (whisperModel: string, ollamaModel: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CHECK_MODEL_STATUS, whisperModel, ollamaModel),
  listWhisperModels: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_WHISPER_MODELS),
  listOllamaModels: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_OLLAMA_MODELS),
  downloadWhisperModel: (modelName?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_WHISPER_MODEL, modelName),
  downloadWhisperBinary: (variant: WhisperBinaryVariant) =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_WHISPER_BINARY, variant),
  pullOllamaModel: (modelName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PULL_OLLAMA_MODEL, modelName),
  checkGpu: () =>
    ipcRenderer.invoke(IPC_CHANNELS.CHECK_GPU),

  // Window controls
  windowMinimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  windowIsMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),

  // Events
  onProgress: (callback: (event: ProgressEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ProgressEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PROGRESS, handler);
  },
  onDownloadProgress: (callback: (event: DownloadProgressEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DownloadProgressEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOAD_PROGRESS, handler);
  },
  onAnalysisBatch: (callback: (event: AnalysisBatchEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AnalysisBatchEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.ANALYSIS_BATCH_READY, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ANALYSIS_BATCH_READY, handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
