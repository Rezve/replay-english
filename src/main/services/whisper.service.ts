import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import http from 'node:http';

const execFileAsync = promisify(execFile);

// Whisper binary and model paths
function getWhisperDir(): string {
  // In dev: resources/whisper, in production: extraResources
  const devPath = path.join(process.cwd(), 'resources', 'whisper');
  const prodPath = path.join(process.resourcesPath, 'whisper');
  return fs.existsSync(prodPath) ? prodPath : devPath;
}

function getModelDir(): string {
  const dir = path.join(app.getPath('userData'), 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getWhisperBinaryPath(): string {
  const dir = getWhisperDir();
  // whisper.cpp builds as whisper-cli.exe on Windows
  const binaryName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  return path.join(dir, binaryName);
}

export function getModelPath(modelName: string = 'ggml-base.en.bin'): string {
  return path.join(getModelDir(), modelName);
}

export function isWhisperAvailable(): boolean {
  const binaryPath = getWhisperBinaryPath();
  return fs.existsSync(binaryPath);
}

export function isModelAvailable(modelName: string = 'ggml-base.en.bin'): boolean {
  return fs.existsSync(getModelPath(modelName));
}

interface WhisperSegment {
  timestamps: {
    from: string;
    to: string;
  };
  offsets: {
    from: number;
    to: number;
  };
  text: string;
}

interface WhisperOutput {
  transcription: WhisperSegment[];
}

export interface TranscriptionSegment {
  startTime: number;
  endTime: number;
  text: string;
  confidence: number | null;
}

export async function transcribeWav(
  wavPath: string,
  modelName: string = 'ggml-base.en.bin'
): Promise<TranscriptionSegment[]> {
  const binaryPath = getWhisperBinaryPath();
  const modelPath = getModelPath(modelName);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Whisper binary not found at: ${binaryPath}`);
  }
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found at: ${modelPath}`);
  }

  // Run whisper.cpp with JSON output
  const { stdout } = await execFileAsync(binaryPath, [
    '-m', modelPath,
    '-f', wavPath,
    '-l', 'en',
    '-oj',           // output JSON
    '--no-prints',   // suppress progress output
  ], {
    timeout: 600000, // 10 minute timeout per chunk
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer
  });

  // Parse JSON output
  const output: WhisperOutput = JSON.parse(stdout);

  return output.transcription.map(seg => ({
    startTime: seg.offsets.from / 1000, // ms to seconds
    endTime: seg.offsets.to / 1000,
    text: seg.text.trim(),
    confidence: null, // whisper.cpp doesn't output confidence in JSON mode
  }));
}

// Download whisper model from Hugging Face
export async function downloadModel(
  modelName: string = 'ggml-base.en.bin',
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const modelPath = getModelPath(modelName);
  if (fs.existsSync(modelPath)) return;

  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;

  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl: string) => {
      const protocol = requestUrl.startsWith('https') ? https : http;
      protocol.get(requestUrl, { headers: { 'User-Agent': 'MemPill-Language/1.0' } }, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            doRequest(redirectUrl);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download model: HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        const tempPath = modelPath + '.tmp';
        const fileStream = fs.createWriteStream(tempPath);

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (onProgress) onProgress(downloadedBytes, totalBytes);
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          fs.renameSync(tempPath, modelPath);
          resolve();
        });

        fileStream.on('error', (err) => {
          fs.unlinkSync(tempPath);
          reject(err);
        });
      }).on('error', reject);
    };

    doRequest(url);
  });
}
