import { app, autoUpdater, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { UpdateStatus } from '../../shared/types';

// Public GitHub repo whose Releases host the Squirrel.Windows artifacts.
// Squirrel reads <feed>/RELEASES and fetches the nupkg it names relative to the same
// URL, and /releases/latest/download/* redirects to the newest release's asset — so
// GitHub serves the feed directly. (update.electronjs.org was used before; its cache
// stuck on an old release and stopped offering updates.)
const GITHUB_REPO = 'Rezve/replay-english';
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let status: UpdateStatus = { state: 'idle' };
let window: BrowserWindow | null = null;
let initialized = false;

function setStatus(next: UpdateStatus): void {
  status = next;
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.UPDATE_STATUS, status);
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function checkForUpdates(): void {
  if (!initialized) return;
  if (status.state === 'checking' || status.state === 'downloading' || status.state === 'downloaded') return;
  try {
    autoUpdater.checkForUpdates();
  } catch (err) {
    setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

export function installUpdate(): void {
  if (status.state === 'downloaded') autoUpdater.quitAndInstall();
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  window = mainWindow;
  // Updates only work for installed (Squirrel) builds on Windows.
  if (!app.isPackaged || process.platform !== 'win32' || initialized) return;

  const feedUrl = `https://github.com/${GITHUB_REPO}/releases/latest/download`;
  autoUpdater.setFeedURL({ url: feedUrl });

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  autoUpdater.on('update-available', () => setStatus({ state: 'downloading' }));
  autoUpdater.on('update-not-available', () => setStatus({ state: 'idle' }));
  autoUpdater.on('update-downloaded', (_e, notes, name) =>
    setStatus({ state: 'downloaded', version: name, notes: notes || undefined }),
  );
  autoUpdater.on('error', (err) => setStatus({ state: 'error', message: err.message }));

  initialized = true;
  checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}
