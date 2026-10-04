import { isWhisperAvailable, isModelAvailable as isWhisperModelAvailable, canDownloadWhisperBinary } from './whisper.service';
import { isOllamaRunning, isModelAvailable as isOllamaModelAvailable } from './ollama.service';
import type { PrerequisiteStatus, ModelCheckResult } from '../../shared/types';

function isFFmpegAvailable(): boolean {
  try {
    // ffmpeg-static provides the binary path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegPath = require('ffmpeg-static');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    return fs.existsSync(ffmpegPath);
  } catch {
    return false;
  }
}

export async function checkPrerequisites(
  whisperModel: string,
  ollamaModel: string,
): Promise<PrerequisiteStatus> {
  const ollamaRunning = await isOllamaRunning();
  let ollamaModelAvailable = false;
  if (ollamaRunning) {
    ollamaModelAvailable = await isOllamaModelAvailable(ollamaModel);
  }

  return {
    whisperBinary: isWhisperAvailable(),
    whisperBinaryDownloadable: canDownloadWhisperBinary(),
    whisperModel: isWhisperModelAvailable(whisperModel),
    ollamaRunning,
    ollamaModel: ollamaModelAvailable,
    ffmpeg: isFFmpegAvailable(),
  };
}

export async function checkModelStatus(
  whisperModel: string,
  ollamaModel: string,
): Promise<ModelCheckResult> {
  const ollamaRunning = await isOllamaRunning();
  let ollamaModelAvailable = false;
  if (ollamaRunning) {
    ollamaModelAvailable = await isOllamaModelAvailable(ollamaModel);
  }

  return {
    whisperModel: { name: whisperModel, available: isWhisperModelAvailable(whisperModel) },
    ollamaModel: { name: ollamaModel, available: ollamaModelAvailable, ollamaRunning },
  };
}
