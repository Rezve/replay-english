# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start      # Dev server with hot reload
npm run package    # Package app for distribution
npm run make       # Create distributable installers
npm run lint       # ESLint on .ts/.tsx files
```

No test framework is configured.

## Releases & auto-update

- **Do not bump `package.json` version or tag by hand.** `.github/workflows/release.yml` runs on every push to `main`: `scripts/next-version.mjs` derives the next version from Conventional Commits since the last `v*` tag (`feat`→minor, `fix`/`perf`/`refactor`→patch, `!`/`BREAKING CHANGE`→major, chore/docs/ci/etc.→no release), then builds on Windows, publishes a GitHub Release via `electron-forge publish`, and commits the bump back with `[skip ci]`.
- Windows-only (Squirrel.Windows). Installed apps poll `update.electronjs.org/Rezve/mempill-language` hourly (`main/services/update.service.ts`) and show `UpdateBanner` when an update is downloaded. This requires the GitHub repo/releases to be **public**. Updates are inactive in dev / unpackaged builds.
- Vite plugin ships no `node_modules`: externals (`better-sqlite3`, `ffmpeg-static`, `adm-zip`) are copied in by the `packageAfterCopy` hook in `forge.config.ts`. Adding a new external in `vite.main.config.ts` means adding it to `EXTERNAL_MODULES` there too.
- In packaged builds the whisper binary is downloaded to `userData/whisper` (install dir is read-only).

## Stack

- Electron 40 + React 19 + TypeScript (Electron Forge with Vite plugin)
- Tailwind CSS v3 via PostCSS (NOT Vite plugin — ESM-only packages break Electron Forge's Vite plugin)
- SQLite via better-sqlite3 + Drizzle ORM
- Whisper.cpp (local STT) + Ollama with qwen2.5:7b (grammar analysis)
- All processing is fully local — no cloud APIs

## Architecture

**Electron process model with strict context isolation:**

- **Main process** (`src/main.ts`): Node.js APIs, database, services. Registers all IPC handlers on app ready.
- **Preload** (`src/preload.ts`): Bridges main↔renderer via `contextBridge.exposeInMainWorld('electronAPI', ...)`. All exposed methods typed via `ElectronAPI` interface in `src/shared/types.ts`.
- **Renderer** (`src/renderer/`): React app with HashRouter. Entry: `index.html` → `src/renderer.ts` → `src/renderer/main.tsx`. API access through typed proxy in `src/renderer/lib/api.ts`.
- **Shared** (`src/shared/`): Types and constants used by both processes. `IPC_CHANNELS` in `constants.ts` defines all channel names.

**IPC pattern:**
- Handlers live in `src/main/ipc/*.ipc.ts`, registered centrally in `src/main/ipc/index.ts`
- Request/response: `ipcMain.handle` + `ipcRenderer.invoke`
- Progress events (main→renderer): `mainWindow.webContents.send()` — handlers that send progress need the `mainWindow` reference
- Every IPC channel must be defined in `src/shared/constants.ts` and exposed in `src/preload.ts`

**Database:**
- SQLite with WAL mode and foreign keys enabled
- Singleton connection in `src/main/db/connection.ts` (lazy init, stored in `app.getPath('userData')/mempill.db`)
- Schema in `src/main/db/schema.ts`: profiles, meetings, transcript_segments, mistakes, error_categories, settings
- Manual SQL migrations in `src/main/db/migrate.ts` (no Drizzle Kit in production) — seeds error categories on first run

**Services** (`src/main/services/*.service.ts`):
- `whisper.service.ts`: Runs `resources/whisper/whisper-cli.exe`, outputs JSON. Dev vs prod paths differ.
- `ollama.service.ts`: Calls local Ollama (`localhost:11434`). Batches 12 segments per LLM call.
- `audio.service.ts`: FFmpeg converts WebM→16kHz mono WAV. Chunks stored in `userData/temp/{meetingId}/`.
- `analysis.service.ts`: Orchestrates batch analysis, calculates weighted score (major=3, moderate=2, minor=1).

**Audio capture:**
- Dual recording: mixed (mic+desktop) for playback, mic-only for grammar analysis
- Desktop audio requires requesting a video track too (Electron limitation) — discarded immediately
- 5-minute WebM chunks via MediaRecorder

**Processing pipeline** (`pipeline:process-meeting`):
1. Convert each mic chunk WebM→WAV with FFmpeg
2. Transcribe with Whisper → save segments to DB
3. Batch segments (12 per batch) → analyze with Ollama → save mistakes to DB
4. Calculate overall score, update meeting status to 'completed'

## Critical Constraints

- **Never use `@vitejs/plugin-react` or `@tailwindcss/vite`** — they are ESM-only and break Electron Forge's Vite plugin
- **`better-sqlite3` and `ffmpeg-static` must be externalized** in `vite.main.config.ts`
- **`better-sqlite3` must be in `asar.unpack`** in forge packager config
- **Path alias:** `@shared/*` → `src/shared/*` (configured in tsconfig)

## Conventions

- IPC handlers: `*.ipc.ts` — Services: `*.service.ts` — Pages: `*Page.tsx`
- Adding a new IPC channel: define in `shared/constants.ts` → create handler in `main/ipc/` → register in `main/ipc/index.ts` → expose in `preload.ts` → add type to `ElectronAPI` in `shared/types.ts`
- Adding a page: create in `renderer/pages/` → add route in `App.tsx`
- Adding a table: update `schema.ts` → add migration SQL in `migrate.ts`

## Runtime Prerequisites

- Ollama installed and running on `localhost:11434`
- Model pulled: `ollama pull qwen2.5:7b`
- Whisper binary + CUDA DLLs in `resources/whisper/`
- Whisper model downloaded via Setup page (stored in `userData/models/`)
