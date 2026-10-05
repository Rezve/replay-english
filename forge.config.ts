import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';

// Local publishes read GITHUB_TOKEN from .env (gitignored); in CI it comes from the workflow.
if (fs.existsSync('.env')) process.loadEnvFile('.env');

// Modules marked `external` in vite.main.config.ts are not bundled, and the Vite plugin
// ships no node_modules, so they (plus their dependency trees) must be copied in manually.
const EXTERNAL_MODULES = ['better-sqlite3', 'ffmpeg-static', 'adm-zip'];

function collectDependencies(name: string, seen: Set<string>): void {
  if (seen.has(name)) return;
  const pkgJsonPath = path.resolve('node_modules', name, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return; // optional / platform-specific dep not installed
  seen.add(name);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) collectDependencies(dep, seen);
}

const config: ForgeConfig = {
  packagerConfig: {
    // Extension omitted on purpose: packager picks icon.ico on Windows, icon.icns on macOS.
    // Regenerate from icon.svg with `npx electron scripts/build-icon.cjs`.
    icon: 'resources/icon/icon',
    // The deb/rpm makers look for a binary named after package.json `name`. Linux only:
    // renaming the Windows exe would break existing Squirrel installs.
    executableName: process.platform === 'linux' ? 'replay-english' : undefined,
    asar: {
      unpack: '**/node_modules/{better-sqlite3,ffmpeg-static}/**',
    },
  },
  rebuildConfig: {
    onlyModules: ['better-sqlite3'],
  },
  hooks: {
    // Runs before the native-module rebuild, so better-sqlite3 is rebuilt for Electron.
    packageAfterCopy: async (_config, buildPath) => {
      const modules = new Set<string>();
      EXTERNAL_MODULES.forEach((m) => collectDependencies(m, modules));
      for (const name of modules) {
        const dest = path.join(buildPath, 'node_modules', name);
        await fs.promises.cp(path.resolve('node_modules', name), dest, {
          recursive: true,
          // ffmpeg-static's *.LICENSE/*.README sidecars are not needed at runtime and
          // have been deleted mid-package by AV scanners, breaking the asar step (ENOENT).
          filter: (src) => !/\.(LICENSE|README)$/.test(src),
        });
      }
    },
  },
  makers: [
    new MakerSquirrel({
      name: 'replay_english',
      setupExe: 'ReplayEnglish-Setup.exe',
      setupIcon: 'resources/icon/icon.ico',
      // Shown while Setup.exe installs; regenerate with scripts/build-loading-gif.cjs.
      loadingGif: 'resources/installer/loading.gif',
      // Shown in "Apps & features"; Squirrel only accepts a URL here.
      iconUrl: 'https://raw.githubusercontent.com/Rezve/replay-english/main/resources/icon/icon.ico',
    }),
    // macOS: a zipped .app. Unsigned, so there is no auto-update (Squirrel.Mac requires signing).
    new MakerZIP({}, ['darwin']),
    // Linux: no auto-update; users upgrade through the package.
    new MakerDeb({
      options: {
        icon: 'resources/icon/icon.png',
        categories: ['Education', 'AudioVideo'],
        homepage: 'https://github.com/Rezve/replay-english',
      },
    }),
    new MakerRpm({
      options: {
        icon: 'resources/icon/icon.png',
        categories: ['Education', 'AudioVideo'],
        homepage: 'https://github.com/Rezve/replay-english',
        license: 'MIT',
      },
    }),
  ],
  publishers: [
    // Uploads this platform's make output to a GitHub Release tagged v<package.json version>.
    // For local publishes only — CI builds each platform separately and creates the release
    // once with every artifact (see release.yml). Needs GITHUB_TOKEN (.env locally).
    new PublisherGithub({
      repository: { owner: 'Rezve', name: 'replay-english' },
      prerelease: false,
      draft: false,
      generateReleaseNotes: true,
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
