// Prints Markdown release notes: the commits shipped since the latest v* tag, grouped
// by Conventional Commit type, followed by a compare link. Used by release.yml.
//   node scripts/release-notes.mjs [version]
// `version` (e.g. 2.2.1) only labels the compare link; HEAD is what gets described.
// Override the range with FROM=<ref> TO=<ref> to preview notes for an existing release.
import { execSync } from 'node:child_process';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const repo = process.env.GITHUB_REPOSITORY || 'Rezve/replay-english';
const version = process.argv[2];
const to = process.env.TO || 'HEAD';

let from = process.env.FROM || '';
if (!from) {
  try {
    from = sh(`git describe --tags --abbrev=0 --match "v*" ${to}`);
  } catch {
    /* first release: describe everything */
  }
}

const SECTIONS = [
  ['breaking', '⚠️ Breaking changes'],
  ['feat', '✨ Features'],
  ['fix', '🐛 Fixes'],
  ['perf', '⚡ Performance'],
  ['refactor', '♻️ Refactoring'],
  ['other', '🧰 Maintenance'],
];

const range = from ? `${from}..${to}` : to;
const log = sh(`git log ${range} --no-merges --format=%H%x1f%s%x1f%b%x00`);
const groups = Object.fromEntries(SECTIONS.map(([key]) => [key, []]));

for (const entry of log.split('\0')) {
  const [sha, subject, body = ''] = entry.trim().split('\x1f');
  if (!sha || /\[skip ci\]/.test(subject)) continue; // version-bump commits

  const m = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  const type = m?.[1].toLowerCase();
  const breaking = Boolean(m?.[3]) || /^BREAKING[ -]CHANGE:/m.test(body);
  const key = breaking ? 'breaking' : groups[type] && type !== 'other' ? type : 'other';
  const text = m ? `${m[2] ? `**${m[2]}:** ` : ''}${m[4]}` : subject;

  groups[key].push(`- ${text} ([\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha}))`);
}

const out = [];
for (const [key, title] of SECTIONS) {
  if (groups[key].length) out.push(`### ${title}`, '', ...groups[key], '');
}
if (!out.length) out.push('No user-facing changes.', '');

if (from) {
  const target = version ? `v${version.replace(/^v/, '')}` : to;
  out.push(`**Full changelog:** https://github.com/${repo}/compare/${from}...${target}`);
}

console.log(out.join('\n'));
