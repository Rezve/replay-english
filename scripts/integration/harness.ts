/**
 * A minimal assertion harness for the integration checks.
 *
 * These cannot run under Vitest: they open the database, and `better-sqlite3`
 * is a native module built against Electron's ABI rather than plain Node's, so
 * importing it outside Electron fails with a NODE_MODULE_VERSION mismatch.
 * They are bundled by `run.mjs` and executed with the Electron binary instead,
 * which is why this file does not depend on a test framework.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
let passes = 0;

export function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passes++;
    console.log(`  ok   ${label}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${label}`);
  console.log(`         expected ${e}`);
  console.log(`         got      ${a}`);
}

export function section(name: string): void {
  console.log(`\n${name}`);
}

/** Ends the run, reporting the tally. Exit code 1 means something failed. */
export function finish(suite: string): never {
  console.log(
    failures === 0
      ? `\n${suite}: ${passes} passed`
      : `\n${suite}: ${passes} passed, ${failures} FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

/** A throwaway directory, registered for cleanup on exit. */
export function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.on('exit', () => {
    // SQLite's WAL files can still be held briefly on Windows; a leftover
    // temp directory is not worth failing a passing run over.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
  return dir;
}
