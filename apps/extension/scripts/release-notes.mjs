#!/usr/bin/env node
// Extension-only "What's Changed" for an ext-v* release, in the same format GitHub's
// auto-generated notes use (the desktop release relies on those directly).
//
// GitHub's generator is purely tag-range based, and in this monorepo the range between two
// ext-v* tags also contains desktop-only PRs. So: take the PRs merged into main between the
// previous ext-v* tag and this one (by merge-commit ancestry, not by date), and keep only
// those that touched the extension or the shared core it ships.
//
//   node apps/extension/scripts/release-notes.mjs [--tag ext-vX.Y.Z] [--prev ext-vA.B.C]
//
// --tag defaults to $GITHUB_REF_NAME; --prev defaults to the highest ext-v* tag below --tag
// (run `git fetch --tags` first on a shallow checkout). Needs `gh` (authenticated) + `git`.
import { execFileSync } from 'node:child_process';

const RELEVANT = /^(apps\/extension|packages\/core)\//;

const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? undefined : process.argv[i + 1]; };
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const isAncestor = (a, b) => { try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; } catch { return false; } };

const tag = arg('--tag') ?? process.env.GITHUB_REF_NAME;
if (!tag) { console.error('release-notes: pass --tag or set GITHUB_REF_NAME'); process.exit(2); }

const extTags = run('git', ['tag', '--list', 'ext-v*', '--sort=-v:refname']).split('\n').filter(Boolean);
const prev = arg('--prev') ?? extTags.slice(extTags.indexOf(tag) + 1)[0] ?? null;

const repo = JSON.parse(run('gh', ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
// The date filter only narrows the API query; ancestry below decides membership.
const since = prev ? run('git', ['log', '-1', '--format=%cI', prev]) : '1970-01-01T00:00:00Z';
const prs = JSON.parse(run('gh', [
  'pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '200',
  '--search', `merged:>=${since}`,
  '--json', 'number,title,author,url,mergeCommit,mergedAt,files',
]));

const inRange = (sha) => isAncestor(sha, tag) && !(prev && isAncestor(sha, prev));
const picked = prs
  .filter((p) => p.mergeCommit && inRange(p.mergeCommit.oid))
  .filter((p) => p.files.some((f) => RELEVANT.test(f.path)))
  .sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));

const lines = ['## What\'s Changed'];
for (const p of picked) lines.push(`* ${p.title} by @${p.author.login} in ${p.url}`);
if (picked.length === 0) lines.push('* No extension-facing changes since the previous release.');
lines.push('', '', `**Full Changelog**: https://github.com/${repo}/compare/${prev ? `${prev}...${tag}` : tag}`);
console.log(lines.join('\n'));
