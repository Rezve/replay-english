import { isWhisperAvailable, isModelAvailable as isWhisperModelAvailable } from './whisper.service';
import { isOllamaRunning, isModelAvailable as isOllamaModelAvailable } from './ollama.service';
import type { PrerequisiteStatus } from '../../shared/types';

function isFFmpegAvailable(): boolean {
  try {
    // ffmpeg-static provides the binary path
    const ffmpegPath = require('ffmpeg-static');
    const fs = require('node:fs');
    return fs.existsSync(ffmpegPath);
  } catch {
    return false;
  }
}

export async function checkPrerequisites(): Promise<PrerequisiteStatus> {
  const ollamaRunning = await isOllamaRunning();
  let ollamaModel = false;
  if (ollamaRunning) {
    ollamaModel = await isOllamaModelAvailable('qwen2.5:7b');
  }

  return {
    whisperBinary: isWhisperAvailable(),
    whisperModel: isWhisperModelAvailable(),
    ollamaRunning,
    ollamaModel,
    ffmpeg: isFFmpegAvailable(),
  };
}
