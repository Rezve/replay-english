import { app, BrowserWindow, desktopCapturer, session, Menu } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerAllIpcHandlers } from './main/ipc';
import { runMigrations } from './main/db/migrate';
import { closeDb } from './main/db/connection';
import { migrateAudioStorage, cleanupOrphanAudio } from './main/services/audio.service';
import { migrateLegacyUserData } from './main/legacy-data';

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Replay English',
    // Packaged builds take the taskbar icon from the exe; dev runs electron.exe, which has its own.
    icon: app.isPackaged ? undefined : path.join(app.getAppPath(), 'resources/icon/icon.ico'),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Register IPC handlers
  registerAllIpcHandlers(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
};

app.on('ready', () => {
  migrateLegacyUserData();
  const { reset } = runMigrations();
  migrateAudioStorage();

  // A schema reset drops meeting rows but not their audio files.
  if (reset) {
    import('./main/db/connection').then(async ({ getDb }) => {
      const dbSchema = await import('./main/db/schema');
      const rows = await getDb().select({ id: dbSchema.meetings.id }).from(dbSchema.meetings).all();
      const removed = cleanupOrphanAudio(rows.map(r => r.id));
      if (removed > 0) console.warn(`Removed ${removed} orphaned recording folder(s) after the schema reset.`);
    }).catch(err => console.warn('Orphaned audio cleanup failed:', err));
  }

  // Allow renderer to capture desktop audio via getDisplayMedia().
  // Automatically selects the entire screen so no picker dialog appears.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // Provide the first screen source; pass audio: 'loopback' to capture system audio
      callback({ video: sources[0], audio: 'loopback' });
    });
  });

  createWindow();
});

app.on('window-all-closed', () => {
  closeDb();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

export { mainWindow };
