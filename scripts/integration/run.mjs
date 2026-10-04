#!/usr/bin/env node
/**
 * Runs the integration checks under Electron.
 *
 * Why not Vitest: these open the database, and `better-sqlite3` is a native
 * module compiled against Electron's ABI. Importing it from plain Node fails
 * with NODE_MODULE_VERSION mismatch, so each suite is bundled with esbuild and
 * executed with the Electron binary instead.
 *
 * `electron` itself is aliased to a stub that points `app.getPath('userData')`
 * at a temp directory, so a check can never touch the real database.
 *
 * Usage: node scripts/integration/run.mjs [suite-name ...]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
// The package entry points are run with node rather than the .bin shims:
// spawning a .cmd on Windows needs a shell, which then needs arg quoting.
const esbuild = path.join(projectRoot, 'node_modules', 'esbuild', 'bin', 'esbuild');
const electron = path.join(projectRoot, 'node_modules', 'electron', 'cli.js');

for (const [name, bin] of [['esbuild', esbuild], ['electron', electron]]) {
  if (!fs.existsSync(bin)) {
    console.error(`Could not find ${name} at ${bin}. Run \`npm install\` first.`);
    process.exit(1);
  }
}

const requested = process.argv.slice(2);
const suites = fs.readdirSync(here)
  .filter(f => f.endsWith('.check.ts'))
  .map(f => f.replace('.check.ts', ''))
  .filter(name => requested.length === 0 || requested.includes(name))
  .sort();

if (suites.length === 0) {
  console.error(requested.length > 0 ? `No such suite: ${requested.join(', ')}` : 'No suites found.');
  process.exit(1);
}

// Bundles land in the project root so Node can resolve better-sqlite3 from
// node_modules; they are removed again below.
const artifacts = [];
let failed = 0;

for (const suite of suites) {
  const bundle = path.join(projectRoot, `.integration-${suite}.cjs`);
  artifacts.push(bundle);

  const build = spawnSync(process.execPath, [
    esbuild,
    path.join(here, `${suite}.check.ts`),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:better-sqlite3',
    `--alias:electron=${path.join(here, 'electron-stub.cjs')}`,
    `--outfile=${bundle}`,
  ], { encoding: 'utf8' });

  if (build.status !== 0) {
    console.error(`\n${suite}: bundling failed`);
    console.error(build.stderr || build.stdout);
    failed++;
    continue;
  }

  const run = spawnSync(process.execPath, [electron, bundle], { stdio: 'inherit' });
  if (run.status !== 0) failed++;
}

for (const artifact of artifacts) {
  try {
    fs.rmSync(artifact, { force: true });
  } catch {
    /* ignore */
  }
}

console.log(
  failed === 0
    ? `\nAll ${suites.length} integration suite(s) passed.`
    : `\n${failed} of ${suites.length} integration suite(s) FAILED.`
);
process.exit(failed === 0 ? 0 : 1);
