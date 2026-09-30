// Prints the next release version, or nothing if there is nothing worth releasing.
// Bump rules (Conventional Commits since the latest v* tag):
//   BREAKING CHANGE / "type!:"  -> major
//   feat                        -> minor
//   fix, perf, refactor         -> patch
//   chore, docs, ci, style, test, build -> no release
// With no tag yet, the version already in package.json is released as-is.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;

let lastTag = '';
try {
  lastTag = sh('git describe --tags --abbrev=0 --match "v*"');
} catch {
  /* no tags yet */
}

if (!lastTag) {
  console.log(pkgVersion);
  process.exit(0);
}

const log = sh(`git log ${lastTag}..HEAD --format=%B%x00`);
const commits = log.split('\0').map((c) => c.trim()).filter(Boolean);

let bump = null;
for (const msg of commits) {
  const subject = msg.split('\n')[0];
  if (/^\w+(\([^)]*\))?!:/.test(subject) || /^BREAKING[ -]CHANGE:/m.test(msg)) bump = 'major';
  else if (/^feat(\(|:)/.test(subject) && bump !== 'major') bump = 'minor';
  else if (/^(fix|perf|refactor)(\(|:)/.test(subject) && !bump) bump = 'patch';
}

if (!bump) process.exit(0);

const [maj, min, pat] = lastTag.replace(/^v/, '').split('.').map(Number);
const next =
  bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
console.log(next);
