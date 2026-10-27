import type { AssessmentRun } from '@workspace/api-client-react';
import type { AfterView } from '@/lib/after';
import type { FixRecording } from '@/lib/fix-events';
import { STATUS_WORD, lineDiff, publicSource } from '@/lib/greenlight';
import { plainName } from '@/lib/standard-info';

/**
 * The audit document: everything a reviewer needs to check the claim with
 * their own eyes. One self-contained HTML file (print it for a PDF):
 *   1. what was checked, when, by what;
 *   2. the numbers before and after, per standard;
 *   3. why it is not 100%: every requirement that needs a person;
 *   4. every requirement whose rating changed, and which fix changed it;
 *   5. every file changed, line by line, every round;
 *   6. every test run.
 * Built in the browser from the same data the screens show. No AI anywhere
 * in it: the ratings come from the rules, the diffs from the files.
 */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const pct = (v: number) => `${Math.round(v)}%`;

type Round = { wave: number; changes: { file: string; before: string; after: string }[]; packages: { title: string; items: { standard: string; id: string }[] }[]; tests: { command: string; status: string; output?: string }[]; durationMs: number; costUsd: number | null };

function roundsOf(after: AfterView): Round[] {
  if (after.mode === 'recording') {
    return after.recordings.map((r: FixRecording) => ({
      wave: r.wave,
      changes: r.changes,
      packages: r.packages,
      tests: r.events.filter((e): e is Extract<typeof e, { type: 'test' }> => e.type === 'test' && e.status !== 'start').map((e) => ({ command: e.command, status: e.status, output: e.output })),
      durationMs: r.durationMs,
      costUsd: (() => { const c = [...r.events].reverse().find((e) => e.type === 'cost'); return c && c.type === 'cost' ? c.usd : null; })(),
    }));
  }
  if (after.mode === 'fix' && after.fixRun) {
    const fr = after.fixRun as typeof after.fixRun & { events?: FixRecording['events'] };
    const events = fr.events ?? [];
    const plan = events.find((e) => e.type === 'plan');
    return [{
      wave: fr.wave,
      changes: fr.changes.map((c) => ({ file: c.file, before: c.before, after: c.after })),
      packages: plan && plan.type === 'plan' ? plan.packages : [],
      tests: events.filter((e): e is Extract<typeof e, { type: 'test' }> => e.type === 'test' && e.status !== 'start').map((e) => ({ command: e.command, status: e.status, output: e.output })),
      durationMs: events.length ? events[events.length - 1].at : 0,
      costUsd: null,
    }];
  }
  return [];
}

export function buildAuditDocument(run: AssessmentRun, after: AfterView): string {
  const rounds = roundsOf(after);
  const by = new Map(run.findings.map((f) => [f.key, f]));
  const changed = after.changedKeys.map((k) => ({ f: by.get(k)!, to: after.statusesAfter[k], from: after.statusesBefore[k] })).filter((x) => x.f);
  const fixedBy = new Map<string, string>();
  for (const r of rounds) for (const p of r.packages) for (const it of p.items) fixedBy.set(`${it.standard} ${it.id}`, `Round ${r.wave} · ${p.title}`);
  const open = run.findings.filter((f) => after.statusesAfter[f.key] === 'UN');
  const stillRed = run.findings.filter((f) => ['N', 'P'].includes(after.statusesAfter[f.key] ?? ''));
  const keys = Object.keys(after.readinessAfter);
  const avg = (m: Record<string, number>) => Math.round(keys.reduce((n, k) => n + (m[k] ?? 0), 0) / Math.max(1, keys.length));
  const today = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
  const idOf = (short: string) => run.standards.find((s) => s.short === short)?.id ?? short;
  let files = 0, add = 0, del = 0;
  const diffs = rounds.map((r) => ({
    wave: r.wave,
    files: r.changes.map((c) => {
      const rows = lineDiff(c.before, c.after);
      const a = rows.filter((x) => x.t === '+').length, d = rows.filter((x) => x.t === '-').length;
      files++; add += a; del += d;
      // Show changed lines with three lines of context either side; fold the rest.
      const keep = new Set<number>();
      rows.forEach((x, i) => { if (x.t !== ' ') for (let j = i - 3; j <= i + 3; j++) keep.add(j); });
      let html = '', folded = 0;
      rows.forEach((x, i) => {
        if (!keep.has(i)) { folded++; return; }
        if (folded) { html += `<div class="fold">… ${folded} unchanged line${folded === 1 ? '' : 's'}</div>`; folded = 0; }
        html += `<div class="l ${x.t === '+' ? 'add' : x.t === '-' ? 'del' : ''}"><span>${x.t}</span>${esc(x.s) || ' '}</div>`;
      });
      if (folded) html += `<div class="fold">… ${folded} unchanged line${folded === 1 ? '' : 's'}</div>`;
      return { file: c.file, a, d, html, isNew: !c.before, removed: !c.after };
    }),
  }));

  const stdRows = keys.map((k) => `<tr><td>${esc(plainName(idOf(k), k))}<br><small>${esc(k)}</small></td><td class="n">${pct(after.readinessBefore[k] ?? 0)}</td><td class="n">${pct(after.readinessAfter[k] ?? 0)}</td><td class="n">${(after.readinessAfter[k] ?? 0) - (after.readinessBefore[k] ?? 0) >= 0 ? '+' : ''}${Math.round((after.readinessAfter[k] ?? 0) - (after.readinessBefore[k] ?? 0))}</td></tr>`).join('');
  const changedRows = changed.sort((x, y) => `${x.f.standardShort} ${x.f.id}`.localeCompare(`${y.f.standardShort} ${y.f.id}`)).map(({ f, from, to }) =>
    `<tr><td><b>${esc(f.standardShort)} ${esc(f.id)}</b><br>${esc(f.title)}</td><td>${esc(STATUS_WORD[from] ?? from)}</td><td class="${/^(L|C)$/.test(to) ? 'ok' : ''}">${esc(STATUS_WORD[to] ?? to)}</td><td>${esc(fixedBy.get(`${f.standardShort} ${f.id}`) ?? 'Re-checked after the round')}</td></tr>`).join('');
  const openRows = open.map((f) => `<tr><td><b>${esc(f.standardShort)} ${esc(f.id)}</b></td><td>${esc(f.title)}</td></tr>`).join('');
  const redRows = stillRed.map((f) => `<tr><td><b>${esc(f.standardShort)} ${esc(f.id)}</b></td><td>${esc(f.title)}</td><td>${esc(STATUS_WORD[after.statusesAfter[f.key]] ?? '')}</td></tr>`).join('');
  const testRows = rounds.flatMap((r) => r.tests.map((t) => `<tr><td>Round ${r.wave}</td><td>${esc(t.command)}</td><td class="${t.status === 'pass' ? 'ok' : 'bad'}">${esc(t.status)}</td><td>${esc(t.output ?? '')}</td></tr>`)).join('');
  const diffHtml = diffs.map((r) => `<h3>Round ${r.wave} · ${r.files.length} file${r.files.length === 1 ? '' : 's'}</h3>` + r.files.map((f) => `<details open><summary><code>${esc(f.file)}</code> <span class="add">+${f.a}</span> <span class="del">−${f.d}</span>${f.isNew ? ' · new file' : f.removed ? ' · removed' : ''}</summary><pre>${f.html}</pre></details>`).join('')).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Greenlight audit · ${esc(run.projectName)}</title>
<style>
body{font:14px/1.5 Inter,system-ui,sans-serif;color:#111;margin:0;background:#fff}
main{max-width:1100px;margin:0 auto;padding:40px 32px 80px}
h1{font:700 32px/1.1 'Space Grotesk',Inter,sans-serif;margin:0 0 6px}h2{font:700 22px/1.2 'Space Grotesk',Inter,sans-serif;margin:40px 0 10px;padding-top:16px;border-top:2px solid #111}h3{font:600 16px Inter,sans-serif;margin:24px 0 8px}
.k{font:600 11px/1 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#555}
.big{font:700 44px/1 'Space Grotesk',Inter,sans-serif}
table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13px}th,td{text-align:left;vertical-align:top;padding:7px 8px;border-bottom:1px solid #ddd}th{font:600 11px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#555}td.n{text-align:right;font-family:'JetBrains Mono',monospace}
.ok{color:#15803d;font-weight:600}.bad{color:#b91c1c;font-weight:600}
.box{border:1px solid #ddd;border-radius:10px;padding:14px 16px;margin:10px 0}.why{border-color:#d97706;background:#fffbeb}
pre{margin:0;padding:8px 0;font:12px/1.5 'JetBrains Mono',monospace;background:#f6f7f9;border-radius:8px;overflow:auto;white-space:pre}
.l{padding:0 10px;white-space:pre-wrap}.l span{display:inline-block;width:14px;color:#888}.add{background:#dcfce7}.del{background:#fee2e2}.fold{padding:2px 10px;color:#777;font-style:italic}
details{margin:8px 0}summary{cursor:pointer;font-weight:600}summary code{font:600 13px 'JetBrains Mono',monospace}
small{color:#555}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
@media print{main{padding:0}h2{break-before:page}details{break-inside:avoid}pre{max-height:none}}
</style></head><body><main>
<div class="k">Greenlight audit document · checked by code, not AI</div>
<h1>${esc(run.projectName)}</h1>
<p>Source: <code>${esc(publicSource(run.source))}</code><br>Checked ${esc(new Date(run.assessedAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' }))} · this document ${esc(today)} · ${rounds.length ? `round${rounds.length === 1 ? '' : 's'} ${rounds.map((r) => r.wave).join(', ')}` : 'no fix round'} · ${after.mode === 'recording' ? 'recorded fix session' : 'live fix run'}</p>
<p>Every rating in this document comes from written rules in code that read the repository. Claude was used for one thing: writing the changes in section 5, each of which was approved by a person and then re-checked by the same rules.</p>

<h2>1. The numbers</h2>
<div class="grid">
<div class="box"><div class="k">Overall before</div><div class="big">${avg(after.readinessBefore)}%</div></div>
<div class="box"><div class="k">Overall after</div><div class="big">${avg(after.readinessAfter)}%</div></div>
<div class="box"><div class="k">Requirements fixed</div><div class="big">${changed.filter((x) => /^(L|C)$/.test(x.to)).length}</div></div>
<div class="box"><div class="k">Need a person</div><div class="big">${open.length}</div></div>
</div>
<table><thead><tr><th>Standard</th><th class="n">Before</th><th class="n">After</th><th class="n">Change</th></tr></thead><tbody>${stdRows}</tbody></table>
<p>${files} file${files === 1 ? '' : 's'} changed · <span class="ok">+${add.toLocaleString()}</span> / <span class="bad">−${del.toLocaleString()}</span> lines${after.tests ? ` · ${after.tests.pass.toLocaleString()} of ${after.tests.total.toLocaleString()} tests pass` : ''}${after.costUsd != null ? ` · $${after.costUsd.toFixed(2)}` : ''}</p>

<h2>2. Why it is not 100%</h2>
<div class="box why"><b>${open.length} requirement${open.length === 1 ? '' : 's'} can only be answered by a person.</b> The standards ask for things code cannot show: who is accountable, what the system is for, where it runs, that a document exists, that a review happened. Greenlight asks these as questions and never guesses. ${stillRed.length ? `A further ${stillRed.length} remain partly or wholly unmet in code after these rounds and are listed in section 3b.` : ''}</div>
<table><thead><tr><th>Requirement</th><th>What it asks</th></tr></thead><tbody>${openRows || '<tr><td colspan="2">None.</td></tr>'}</tbody></table>
${stillRed.length ? `<h3>3b. Still open in code</h3><table><thead><tr><th>Requirement</th><th>What it asks</th><th>Now</th></tr></thead><tbody>${redRows}</tbody></table>` : ''}

<h2>3. Every requirement whose rating changed</h2>
<p>${changed.length} requirement${changed.length === 1 ? '' : 's'}. "Before" is the rating from the first check; "after" is the rating the same rules gave the fixed code.</p>
<table><thead><tr><th>Requirement</th><th>Before</th><th>After</th><th>Changed by</th></tr></thead><tbody>${changedRows || '<tr><td colspan="4">None.</td></tr>'}</tbody></table>

<h2>4. Every test run</h2>
<table><thead><tr><th>Round</th><th>Command</th><th>Result</th><th>Output</th></tr></thead><tbody>${testRows || '<tr><td colspan="4">No test runs recorded.</td></tr>'}</tbody></table>

<h2>5. Every line changed</h2>
<p>Green lines were added, red lines removed; unchanged lines are folded except three either side of a change.</p>
${diffHtml || '<p>No file changes.</p>'}
</main></body></html>`;
}

/** Open the document in a new tab (print it for a PDF). Falls back to a download. */
export function openAuditDocument(run: AssessmentRun, after: AfterView, download: (url: string, name?: string) => void) {
  const html = buildAuditDocument(run, after);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) download(url, `greenlight-audit-${run.projectName}.html`);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Every requirement, one row each, as CSV: standard, clause, title, before, after, changed by. */
export function buildAuditCsv(run: AssessmentRun, after: AfterView): string {
  const rounds = roundsOf(after);
  const fixedBy = new Map<string, string>();
  for (const r of rounds) for (const p of r.packages) for (const it of p.items) fixedBy.set(`${it.standard} ${it.id}`, `Round ${r.wave}: ${p.title}`);
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['Standard', 'Clause', 'Requirement', 'Before', 'After', 'Changed', 'Changed by'].map(q).join(',')];
  for (const f of run.findings) {
    const from = after.statusesBefore[f.key], to = after.statusesAfter[f.key];
    rows.push([f.standardShort, f.id, f.title, STATUS_WORD[from] ?? from, STATUS_WORD[to] ?? to, from !== to ? 'yes' : '', fixedBy.get(`${f.standardShort} ${f.id}`) ?? ''].map(q).join(','));
  }
  return rows.join('\r\n');
}

export function downloadAuditCsv(run: AssessmentRun, after: AfterView, download: (url: string, name?: string) => void) {
  const url = URL.createObjectURL(new Blob(['﻿' + buildAuditCsv(run, after)], { type: 'text/csv;charset=utf-8' }));
  download(url, `greenlight-requirements-${run.projectName}.csv`);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
