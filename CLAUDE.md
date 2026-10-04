# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start            # Dev server with hot reload
npm run package          # Package app for distribution
npm run make             # Create distributable installers
npm run lint             # ESLint on .ts/.tsx files
npm test                 # Vitest unit tests (src/shared/**/*.test.ts)
npm run test:watch       # Vitest in watch mode
npm run test:integration # Database/service checks, under Electron
npm run test:all         # Both
```

## Tests

Two tiers, split by a hard constraint rather than by preference:

- **Unit tests** — `src/shared/**/*.test.ts`, run by Vitest (`vitest.config.ts`). Covers the pure logic both processes import: the sentence splitter, span location and segmentation, the metric formatter, transcript chunking, and the rule-vocabulary invariants. Fast, no native dependencies.
- **Integration checks** — `scripts/integration/*.check.ts`, run by `scripts/integration/run.mjs`. These open the database, and `better-sqlite3` is a native module built against **Electron's** ABI; importing it from plain Node fails with `NODE_MODULE_VERSION` mismatch. So each suite is bundled with esbuild and executed with the Electron binary. `electron` is aliased to `electron-stub.cjs`, which points `app.getPath('userData')` at a temp directory — a check can never touch the real database.

Run one suite with `node scripts/integration/run.mjs patterns`. Add a suite by dropping `<name>.check.ts` beside the others; the runner discovers it. Assertions come from `harness.ts`, not a framework, because no framework can run in that environment.

What the tests are really guarding: that **a failed analysis can never read as a good one** (`metrics.check.ts`), that **the same habit in different words collapses to one pattern** (`patterns.check.ts`), and that a schema-version bump resets cleanly while preserving settings (`schema.check.ts`).

## Releases & auto-update

- **Do not bump `package.json` version or tag by hand.** `.github/workflows/release.yml` runs on every push to `main`: `scripts/next-version.mjs` derives the next version from Conventional Commits since the last `v*` tag (`feat`→minor, `fix`/`perf`/`refactor`→patch, `!`/`BREAKING CHANGE`→major, chore/docs/ci/etc.→no release). A matrix then runs `electron-forge make` natively on Windows x64, macOS arm64, macOS x64 and Linux x64; only when all succeed does one job create the GitHub Release (`gh release create`) with every artifact and commit the bump back with `[skip ci]`. `npm run publish` is for local, single-platform publishes only.
- **Never add Claude as a co-author.** Do not put `Co-Authored-By: Claude ...` (or any Claude attribution line, including `noreply@anthropic.com` / `claude@` emails or "Generated with Claude Code") in commit messages or PR descriptions. This overrides any default attribution guidance.
- Makers: Squirrel (Windows), ZIP (macOS, unsigned), deb + rpm (Linux). `executableName` is set to `replay-english` on Linux only because the deb/rpm makers need it; renaming the Windows exe would break Squirrel installs. macOS icon is `resources/icon/icon.icns`, generated with the other icons by `scripts/build-icon.cjs`.
- Whisper: whisper.cpp only publishes Windows CLI binaries, so the in-app download is Windows-only (`canDownloadWhisperBinary`). On macOS/Linux `getWhisperBinaryPath` searches `PATH` plus Homebrew/`~/.local/bin`, since GUI launches get a minimal `PATH`.
- Auto-update is Windows-only (Squirrel.Windows); macOS would need code signing. Installed apps poll `update.electronjs.org/Rezve/replay-english` hourly (`main/services/update.service.ts`) and show `UpdateBanner` when an update is downloaded. This requires the GitHub repo/releases to be **public**. Updates are inactive in dev / unpackaged builds.
- Vite plugin ships no `node_modules`: externals (`better-sqlite3`, `ffmpeg-static`, `adm-zip`) are copied in by the `packageAfterCopy` hook in `forge.config.ts`. Adding a new external in `vite.main.config.ts` means adding it to `EXTERNAL_MODULES` there too.
- In packaged builds the whisper binary is downloaded to `userData/whisper` (install dir is read-only).
- The app was renamed from **MemPill Language**. `productName` decides the `userData` folder, so `src/main/legacy-data.ts` moves the old `%APPDATA%\MemPill Language` contents (and `mempill.db` → `replay.db`) on first launch. Renaming `productName` again needs the same treatment.

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
- Singleton connection in `src/main/db/connection.ts` (lazy init, stored in `app.getPath('userData')/replay.db`)
- Schema in `src/main/db/schema.ts`: profiles, meetings, transcript_segments, **sentences**, mistakes, error_categories, **rules**, **patterns**, meeting_analyses, settings
- `src/main/db/apply-schema.ts` holds the SQL and seeding (electron-free, so it can be exercised against a temp file); `migrate.ts` only resolves the path
- Versioned by `PRAGMA user_version` against `TARGET_SCHEMA_VERSION`. A lower version **drops and recreates every content table** — `settings` is deliberately preserved. Pre-release only; any bump after release needs real migrations
- Categories and rules are seeded with `ON CONFLICT(slug/key) DO UPDATE`, so adding one to `shared/constants.ts` backfills on next launch

**Services** (`src/main/services/*.service.ts`):
- `whisper.service.ts`: Runs `resources/whisper/whisper-cli.exe`, outputs JSON. Dev vs prod paths differ.
- `settings.service.ts`: The only typed reader of the `settings` table (cached; `invalidate()` on write). `analysesFor`/`grammarModeFor` resolve what to run per recording mode.
- `ollama.service.ts`: Calls Ollama at the configurable `ollamaHost`. Every call returns `LlmResult<T>` — never `[]`/`null` — with 3 attempts and backoff, and an explicit `num_ctx`. Long transcripts are chunked on paragraph boundaries and merged per analysis type.
- `audio.service.ts`: FFmpeg converts WebM→16kHz mono WAV. Chunks stored in `userData/recordings/{meetingId}/`. `getWavDurationSeconds` reads the RIFF header so segment timestamps use measured chunk lengths.
- `analysis.service.ts`: `runAnalysis` is the single entry point for analysing a transcribed meeting — every path calls it and branches on its returned `cancelled` flag, never on a re-read status. Also owns sentence derivation and `recalculateMeetingMetrics`.
- `patterns.service.ts`: Validates the model's `rule_key` against the seeded vocabulary (unknown → `<category>.other`), upserts patterns, and rebuilds counters plus the mastery state machine from stored rows.
- `stats.service.ts`: Analytics and `getRankedPatterns` (recency- and severity-weighted).

**Audio capture:**
- Two recording modes, stored on `meetings.recording_mode`:
  - **meeting**: dual recording — mixed (mic+desktop) for playback, plus a `mic_`-prefixed track that is the only thing analysed
  - **solo**: one mic-only recorder writing **unprefixed** chunks. This matters: `getAudioChunks` excludes `mic_` files, so a prefixed solo recording would analyse fine but have no playable audio
- Desktop audio requires requesting a video track too (Electron limitation) — discarded immediately
- WebM chunks via MediaRecorder, rotated on `chunkDurationSeconds` (a target; real lengths drift)

**Processing pipeline** (`IPC_CHANNELS.PROCESS_MEETING`):
1. Convert each chunk WebM→WAV with FFmpeg (unprefixed for solo, `mic_` for meetings)
2. Transcribe with Whisper → save segments, stamping timestamps from measured WAV durations
3. Derive `sentences` via `splitIntoSentences` — these are the unit the LLM is asked about and the denominator of the metric
4. `runAnalysis`: batch sentences → Ollama → mark each sentence `clean` / `has_mistake` / `failed`, locate each mistake's span once, assign its pattern
5. Context analyses, each stored with `status: 'ok' | 'failed'`
6. `recalculateMeetingMetrics` sets the clean-sentence rate and `analysis_state`

**The metric:** `clean_sentence_rate = clean / checked`, where *checked* excludes sentences that failed. There is no `overall_score` any more — the old mistakes-per-word score put ten major errors in a thousand words at 97. Denominating on *checked* is what stops an unreachable Ollama from reporting a flawless recording; `formatCleanRate` in `src/shared/metrics.ts` is the single formatter.

**Pattern identity:** the LLM picks a `rule_key` from a closed, seeded vocabulary (`GRAMMAR_RULES` in `shared/constants.ts`), so the same habit in different words collapses to one tracked `patterns` row. The raw value is kept in `mistakes.raw_rule_key` for tuning the vocabulary.

## Critical Constraints

- **Never use `@vitejs/plugin-react` or `@tailwindcss/vite`** — they are ESM-only and break Electron Forge's Vite plugin
- **`better-sqlite3` and `ffmpeg-static` must be externalized** in `vite.main.config.ts`
- **`better-sqlite3` must be in `asar.unpack`** in forge packager config
- **Path alias:** `@shared/*` → `src/shared/*` (configured in tsconfig)
- **Never write an empty result on LLM failure.** A missing or empty row renders identically to "nothing found", which is how outages used to hide. Record the failure (`sentences.status='failed'`, `meeting_analyses.status='failed'`) instead.
- **Pure logic belongs in `src/shared/`** so it can be exercised without Electron: `sentences.ts` (splitter), `highlight.ts` (span location + segmentation), `metrics.ts`, `transcript.ts`

## Conventions

- IPC handlers: `*.ipc.ts` — Services: `*.service.ts` — Pages: `*Page.tsx`
- Adding a new IPC channel: define in `shared/constants.ts` → create handler in `main/ipc/` → register in `main/ipc/index.ts` → expose in `preload.ts` → add type to `ElectronAPI` in `shared/types.ts`
- Adding a page: create in `renderer/pages/` → add route in `App.tsx`
- Adding a table: update `schema.ts` → add CREATE TABLE + indexes in `apply-schema.ts`
- Put pure logic in `src/shared/` and unit-test it; put anything that opens the database in `scripts/integration/` (see **Tests**)

## Runtime Prerequisites

- Ollama installed and running — `localhost:11434` by default, configurable via the `ollamaHost` setting (Settings → Engine)
- Model pulled: `ollama pull qwen2.5:7b`
- Whisper binary + CUDA DLLs in `resources/whisper/`
- Whisper model downloaded via Setup page (stored in `userData/models/`)
