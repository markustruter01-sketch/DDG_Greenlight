#!/usr/bin/env node
/**
 * Turns a Greenlight fix recording into a pull request on the subject repo.
 *
 *   node scripts/apply-recording.mjs <recording.json> <subject checkout> [--base main] [--branch greenlight/wave-N] [--dry]
 *
 * The recording's `changes` hold each file Claude wrote (before/after). They
 * are applied on a fresh branch from --base, committed, pushed, and a PR is
 * opened with the plan, the before → after readiness and the test counts.
 * Nothing is merged; the PR is for the owner's review, as the product promises.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const [recPath, repoDir] = args;
if (!recPath || !repoDir) { console.error('usage: apply-recording.mjs <recording.json> <subject checkout> [--base main] [--branch name] [--dry]'); process.exit(2); }
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry');
const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
const base = opt('--base', 'main');
const branch = opt('--branch', `greenlight/wave-${rec.wave}`);
const git = (...a) => execFileSync('git', a, { cwd: repoDir, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
const remoteUrl = git('remote', 'get-url', 'origin');
const slug = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1];
if (!slug) throw new Error(`cannot read owner/repo from ${remoteUrl}`);

git('fetch', '-q', 'origin', base);
git('checkout', '-q', '-B', branch, `origin/${base}`);

let applied = 0, mismatched = [];
for (const c of rec.changes) {
  const file = path.join(repoDir, c.file);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current !== (c.before ?? '')) mismatched.push(c.file);
  if (c.after === '' && current) { fs.rmSync(file); applied++; continue; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, c.after);
  applied++;
}
if (mismatched.length) console.warn(`note: ${mismatched.length} file(s) differ from the recording's "before" (applied the recording's "after" anyway): ${mismatched.join(', ')}`);
console.log(`applied ${applied} file(s) on ${branch} from origin/${base}`);
if (dry) { console.log(git('status', '--short')); process.exit(0); }

const pkgs = rec.packages ?? [];
const stds = Object.keys(rec.outcome.after);
const num = (v) => Math.round(v);
const tests = (() => { const t = [...rec.events].reverse().find((e) => e.type === 'test' && /pass|fail/.test(e.status)); return t ? `${t.status === 'pass' ? 'passing' : 'see notes'}` : 'not run'; })();
const title = `Greenlight wave ${rec.wave}: ${pkgs.slice(0, 3).map((p) => p.title.replace(/\.$/, '').split(/[,:(]/)[0].trim()).join(' · ')}${pkgs.length > 3 ? ` +${pkgs.length - 3}` : ''}`;
const body = [
  `Fixes from Greenlight's plan for **${rec.project}**, wave ${rec.wave}. Checked by written rules, fixed by Claude, re-checked by the same rules. Nothing here is merged automatically; please review each file.`,
  '',
  '## What this wave fixes',
  ...pkgs.map((p, i) => `${i + 1}. **${p.title}** — ${p.acceptance} _(${p.items.map((x) => `${x.standard} ${x.id}`).join(', ')})_`),
  '',
  '## Re-checked by the same rules · before → after',
  '| Standard | Before | After |', '|---|---|---|',
  ...stds.map((s) => `| ${s} | ${num(rec.outcome.before[s])}% | **${num(rec.outcome.after[s])}%** |`),
  '',
  `Verdict: ${rec.outcome.verdictBefore} → ${rec.outcome.verdictAfter} · ${rec.changes.length} files changed · tests ${tests} · session ${Math.round(rec.durationMs / 60000)} min · model ${rec.model}`,
  rec.outcome.changed ? `\nClauses that changed status: ${Object.entries(rec.outcome.changed).map(([k, v]) => `${k.split('|')[1]} → ${v}`).join(', ')}` : '',
  '',
  `Recorded ${rec.recordedAt}. The full session (every file read, every edit, every test run) replays in Greenlight.`,
  '',
  '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  '',
  'https://claude.ai/code/session_01VeMEDuV9NvmRWgWSuzmZqK',
].join('\n');

git('add', '-A');
const msg = [`${title}`, '', `Greenlight wave ${rec.wave} of ${rec.project}: ${pkgs.length} work package(s), re-checked ${stds.map((s) => `${s} ${num(rec.outcome.before[s])} → ${num(rec.outcome.after[s])}%`).join(', ')}.`, '', 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>', 'Claude-Session: https://claude.ai/code/session_01VeMEDuV9NvmRWgWSuzmZqK'].join('\n');
execFileSync('git', ['-c', 'user.name=Pierre Truter', '-c', 'user.email=pierretruter07@gmail.com', 'commit', '-q', '-m', msg], { cwd: repoDir, stdio: 'inherit' });
git('push', '-q', '-f', '-u', 'origin', branch);

const existing = JSON.parse(execFileSync('gh', ['api', `repos/${slug}/pulls?state=open&head=${slug.split('/')[0]}:${branch}`]).toString());
let pr;
if (existing.length) {
  pr = JSON.parse(execFileSync('gh', ['api', '-X', 'PATCH', `repos/${slug}/pulls/${existing[0].number}`, '-f', `title=${title}`, '-f', `body=${body}`]).toString());
} else {
  pr = JSON.parse(execFileSync('gh', ['api', '-X', 'POST', `repos/${slug}/pulls`, '-f', `title=${title}`, '-f', `body=${body}`, '-f', `head=${branch}`, '-f', `base=${base}`]).toString());
}
console.log(`PR #${pr.number}: ${pr.html_url}`);
