import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import http from 'node:http';
import AdmZip from 'adm-zip';
import type { GpuInfo, WhisperBinaryVariant } from '../../shared/types';

const execFileAsync = promisify(execFile);

// Whisper binary and model paths
function getWhisperDir(): string {
  // Packaged: the install dir is read-only and updated on each release, so the
  // downloaded binary lives in userData. Dev: resources/whisper in the project.
  if (app.isPackaged) return path.join(app.getPath('userData'), 'whisper');
  return path.join(process.cwd(), 'resources', 'whisper');
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
  modelName: string = 'ggml-base.en.bin',
  language: string = 'en',
  translate: boolean = false
): Promise<TranscriptionSegment[]> {
  const binaryPath = getWhisperBinaryPath();
  const modelPath = getModelPath(modelName);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Whisper binary not found at: ${binaryPath}`);
  }
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found at: ${modelPath}. Please download the model from the Setup page.`);
  }
  if (!fs.existsSync(wavPath)) {
    throw new Error(`WAV file not found at: ${wavPath}`);
  }

  // Check WAV file size
  const wavStats = fs.statSync(wavPath);
  if (wavStats.size === 0) {
    throw new Error(`WAV file is empty: ${wavPath}`);
  }
  if (wavStats.size < 1000) {
    throw new Error(`WAV file is too small (${wavStats.size} bytes), likely corrupted: ${wavPath}`);
  }

  console.log(`Transcribing: ${wavPath} (${Math.round(wavStats.size / 1024)}KB)`);
  console.log(`Using model: ${modelPath}`);
  console.log(`Using binary: ${binaryPath}`);

  // Run whisper.cpp with JSON output to file
  // Remove file extension to get base path for -of flag
  const outputBase = wavPath.replace(/\.(wav|mp3|m4a)$/i, '') + (translate ? '_tr' : '');
  const jsonPath = `${outputBase}.json`;

  const args = [
    '-m', modelPath,
    '-f', wavPath,
    '-l', language,
    '-oj',           // output JSON to file
    '-of', outputBase, // output file base path (without extension)
    '-np',           // no-prints (suppress console output)
  ];
  if (translate) args.push('--translate');

  try {
    await execFileAsync(binaryPath, args, {
      timeout: 600000, // 10 minute timeout per chunk
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });
    console.log('Whisper completed successfully');
    console.log('JSON output path:', jsonPath);
  } catch (err: any) {
    console.error('Whisper command failed with error:', err);
    console.error('Exit code:', err.code);
    console.error('stderr:', err.stderr);
    console.error('stdout:', err.stdout);
    const errorMsg = err.stderr || err.stdout || err.message || 'Unknown error';
    const exitCode = err.code || 'unknown';
    throw new Error(`Whisper transcription failed (exit code: ${exitCode}): ${errorMsg}`);
  }

  // Wait a moment for file to be fully written
  // Increased wait time to ensure file is fully flushed to disk
  await new Promise(resolve => setTimeout(resolve, 500));

  // Read and parse JSON output file
  let output: WhisperOutput;

  // Check if file exists with retry logic
  let fileExists = false;
  for (let retry = 0; retry < 5; retry++) {
    if (fs.existsSync(jsonPath)) {
      fileExists = true;
      break;
    }
    console.log(`JSON file not found yet, retry ${retry + 1}/5...`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  if (!fileExists) {
    const dir = path.dirname(wavPath);
    const filesInDir = fs.readdirSync(dir);
    console.error('JSON file not found after retries!');
    console.error('Expected path:', jsonPath);
    console.error('Files in directory:', filesInDir);
    throw new Error(`JSON output file not found at: ${jsonPath}`);
  }

  // Read JSON file
  let jsonContent: string;
  try {
    jsonContent = fs.readFileSync(jsonPath, 'utf-8');
    console.log('Successfully read JSON file:', jsonContent.length, 'bytes');
  } catch (err: any) {
    console.error('Failed to read JSON file:', err.message);
    throw new Error(`Failed to read JSON file from ${jsonPath}: ${err.message}`);
  }

  // Parse JSON content
  try {
    console.log('Parsing JSON content...');
    console.log('First 200 chars:', jsonContent.substring(0, 200));
    output = JSON.parse(jsonContent);
    console.log('JSON parsed successfully, transcription segments:', output.transcription?.length || 0);
  } catch (err: any) {
    console.error('Failed to parse JSON:', err.message);
    console.error('JSON content preview:', jsonContent.substring(0, 500));
    throw new Error(`Failed to parse JSON from ${jsonPath}: ${err.message}`);
  }

  // Clean up JSON file
  try {
    fs.unlinkSync(jsonPath);
    console.log('Cleaned up JSON file');
  } catch (err: any) {
    console.warn('Failed to delete JSON file:', err.message);
  }

  return output.transcription.map(seg => ({
    startTime: seg.offsets.from / 1000, // ms to seconds
    endTime: seg.offsets.to / 1000,
    text: seg.text.trim(),
    confidence: null, // whisper.cpp doesn't output confidence in JSON mode
  }));
}

const WHISPER_VERSION = 'v1.8.3';
const WHISPER_DOWNLOAD_URLS: Record<WhisperBinaryVariant, { fileName: string; label: string }> = {
  cpu: { fileName: 'whisper-bin-x64.zip', label: 'CPU' },
  cuda: { fileName: 'whisper-cublas-12.4.0-bin-x64.zip', label: 'CUDA 12' },
};

export async function checkGpu(): Promise<GpuInfo> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=name',
      '--format=csv,noheader',
    ], { timeout: 5000 });
    const name = stdout.trim().split('\n')[0]?.trim();
    return { available: true, name: name || 'NVIDIA GPU' };
  } catch {
    return { available: false };
  }
}

function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl: string) => {
      const protocol = requestUrl.startsWith('https') ? https : http;
      protocol.get(requestUrl, { headers: { 'User-Agent': 'MemPill-Language/1.0' } }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            doRequest(redirectUrl);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        const fileStream = fs.createWriteStream(destPath);

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (onProgress) onProgress(downloadedBytes, totalBytes);
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          try { fs.unlinkSync(destPath); } catch { /* ignore */ }
          reject(err);
        });
      }).on('error', reject);
    };

    doRequest(url);
  });
}

export async function downloadWhisperBinary(
  variant: WhisperBinaryVariant,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  const { fileName } = WHISPER_DOWNLOAD_URLS[variant];
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/${fileName}`;
  const whisperDir = getWhisperDir();
  fs.mkdirSync(whisperDir, { recursive: true });

  const tempZipPath = path.join(app.getPath('temp'), fileName);

  try {
    console.log(`Downloading whisper binary (${variant}): ${url}`);
    await downloadFile(url, tempZipPath, onProgress);

    console.log('Extracting zip to:', whisperDir);
    const zip = new AdmZip(tempZipPath);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const fileName = path.basename(entry.entryName);
      const destFile = path.join(whisperDir, fileName);
      fs.writeFileSync(destFile, entry.getData());
    }
    console.log('Whisper binary extracted successfully');
  } finally {
    try { fs.unlinkSync(tempZipPath); } catch { /* ignore */ }
  }
}

// Download whisper model from Hugging Face
export async function downloadModel(
  modelName: string = 'ggml-base.en.bin',
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const modelPath = getModelPath(modelName);
  if (fs.existsSync(modelPath)) return;

  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`;
  const tempPath = modelPath + '.tmp';

  try {
    await downloadFile(url, tempPath, onProgress);
    fs.renameSync(tempPath, modelPath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw err;
  }
}
