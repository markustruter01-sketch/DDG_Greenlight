import type { AssessmentRun, Finding, Wave } from '@workspace/api-client-react';

export const STATUS_COLOR: Record<string, string> = {
  C: '#4FD99A',
  L: '#4FD99A',
  P: '#FFA62B',
  N: '#FF5C6E',
  UN: '#CFE3EE',
  NA: '#7F98A8',
};
export const STATUS_WORD: Record<string, string> = {
  C: 'Compliant',
  L: 'Largely compliant',
  P: 'Partial',
  N: 'Failing',
  UN: 'Needs answer',
  NA: 'Not applicable',
};

export const ANNUNCIATORS: { id: string; label: string; themes: string[]; why: string }[] = [
  { id: 'access', label: 'Identity and access', themes: ['access'], why: 'Who can get in, with what proof, and who reviews that access. Weak identity controls undo every other control.' },
  { id: 'safety', label: 'Safety case', themes: ['safety', 'testing', 'docs'], why: 'The argument and evidence that the software is safe for its intended use: hazards, tests and documentation.' },
  { id: 'governance', label: 'Governance', themes: ['governance', 'ai'], why: 'Decisions, ownership, change control and AI oversight that a regulator expects to see written down.' },
  { id: 'supply', label: 'Supply chain', themes: ['supply'], why: 'What you depend on: libraries, services and suppliers, and whether you know what they bring in.' },
  { id: 'appsec', label: 'Application security', themes: ['appsec'], why: 'Flaws in the code itself that an attacker could use: injection, weak crypto, unsafe handling of input.' },
  { id: 'secrets', label: 'Secrets', themes: ['secrets'], why: 'Keys, tokens and passwords. Anything committed to the repository must be treated as exposed.' },
  { id: 'logging', label: 'Logging', themes: ['logging'], why: 'Whether you can see what happened, and prove it afterwards.' },
  { id: 'ops', label: 'Incidents', themes: ['ops'], why: 'How the software is run, patched, hardened and recovered when something goes wrong.' },
  { id: 'build', label: 'Build and release', themes: ['build'], why: 'How code becomes a release: pipelines, review gates, signing and reproducibility.' },
  { id: 'answers', label: 'Needs your answers', themes: [], why: 'Some requirements cannot be decided from code. Answer these and the rules re-run.' },
];

export function normLens(l: string): 'saf' | 'sec' | 'ai' {
  const x = (l || '').toLowerCase();
  if (x.startsWith('saf')) return 'saf';
  if (x.startsWith('ai')) return 'ai';
  return 'sec';
}

export const isGood = (s: string) => s === 'C' || s === 'L';

export function findingsFor(run: AssessmentRun, annId: string): Finding[] {
  if (annId === 'answers') return run.findings.filter((f) => f.status === 'UN');
  const a = ANNUNCIATORS.find((x) => x.id === annId);
  if (!a) return [];
  return run.findings.filter((f) => a.themes.includes((f.theme || '').toLowerCase()));
}

export function waveOf(run: AssessmentRun, n: number): Wave | undefined {
  return n > 0 ? run.waves.find((w) => w.number === n) : undefined;
}

export function statusMap(run: AssessmentRun, n: number): Record<string, string> {
  const w = waveOf(run, n);
  const out: Record<string, string> = {};
  for (const f of run.findings) out[f.key] = (w && w.statuses[f.key]) || f.status;
  return out;
}

export function tally(run: AssessmentRun, st: Record<string, string>) {
  const c = { total: 0, compliant: 0, partial: 0, failed: 0, unanswered: 0, blocking: 0 };
  for (const f of run.findings) {
    const s = st[f.key];
    if (s === 'NA') continue;
    c.total++;
    if (isGood(s)) c.compliant++;
    else if (s === 'P') c.partial++;
    else if (s === 'N') c.failed++;
    else if (s === 'UN') c.unanswered++;
    if (f.blocking && (s === 'P' || s === 'N')) c.blocking++;
  }
  return c;
}

export function tone(c: { failed: number; blocking: number; partial: number; unanswered: number }) {
  if (c.blocking > 0 || c.failed > 0) return { color: '#FF5C6E', word: 'Not ready' };
  if (c.partial > 0 || c.unanswered > 0) return { color: '#FFA62B', word: 'Conditions apply' };
  return { color: '#4FD99A', word: 'Ready' };
}

/** How many files the assessment read, from whatever shape the inventory has. */
/** A GitHub address with its owner hidden, for anything shown or downloaded (this is a demonstration deployment). */
export const publicSource = (source: string): string => source.replace(/(github\.com\/)[^/\s]+\//i, '$1…/');

export const countFiles = (inventory: unknown): number | null => {
  if (Array.isArray(inventory)) return inventory.length;
  if (inventory && typeof inventory === 'object') {
    const data = inventory as Record<string, unknown>;
    if (typeof data.files === 'number') return data.files;
    if (Array.isArray(data.files)) return data.files.length;
    if (typeof data.fileCount === 'number') return data.fileCount;
  }
  return null;
};

export const pc = (v: number | undefined) => {
  if (v == null || Number.isNaN(v)) return 0;
  return Math.round(v <= 1 ? v * 100 : v);
};

const BLOCK = ['S1', 'S2', 'SC', 'SH'];
export function orbitItems(run: AssessmentRun, st: Record<string, string>) {
  return run.findings.map((f) => {
    const lens = normLens(f.lens);
    const s = st[f.key];
    const sevBlocks = f.severity ? BLOCK.includes(f.severity) : false;
    const sev = f.blocking
      ? sevBlocks
        ? f.severity
        : lens === 'saf'
          ? 'S2'
          : 'SH'
      : f.severity && !sevBlocks
        ? f.severity
        : lens === 'saf'
          ? 'S3'
          : 'SM';
    return {
      id: f.key,
      lens,
      group: f.group || f.theme,
      groupName: f.group || f.theme,
      title: f.title,
      status: s === 'UN' || s === 'NA' ? null : s,
      out: s === 'NA',
      sev,
      fixed: !isGood(f.status) && f.status !== 'NA' && isGood(s),
    };
  });
}

export function orbitThemes(run: AssessmentRun) {
  const m = new Map<string, { saf: string[]; sec: string[]; ai: string[] }>();
  for (const f of run.findings) {
    const t = m.get(f.theme) ?? { saf: [], sec: [], ai: [] };
    t[normLens(f.lens)].push(f.key);
    m.set(f.theme, t);
  }
  return [...m.values()];
}

export function download(url: string, name?: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name ?? '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function reportUrl(url: string, format: string) {
  return `${url}${url.includes('?') ? '&' : '?'}format=${format}`;
}

export async function uploadZip(
  file: File,
  options: Record<string, unknown>,
): Promise<AssessmentRun> {
  const res = await fetch('/api/greenlight/upload', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/zip',
      'x-filename': encodeURIComponent(file.name),
      'x-options': JSON.stringify(options),
    },
    body: file,
  });
  if (!res.ok) {
    let msg = `Upload failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j.error || j.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export function fixPromptMarkdown(run: AssessmentRun, waveNo: number): string {
  const lines = [
    `# Fix prompt: ${run.projectName}`,
    '',
    `Assessment run ${run.id}, wave ${waveNo || 'all'}. Generated by DDG Greenlight from deterministic rule results.`,
    '',
    'Apply each work package below. Change only what is needed, keep behaviour otherwise identical, and explain each change.',
    '',
  ];
  for (const w of run.waves.filter((x) => !waveNo || x.number === waveNo)) {
    lines.push(`## Wave ${w.number}: ${w.title}`, '');
    for (const fx of w.fixes) {
      lines.push(`### ${fx.title}`, `- Kind: ${fx.kind}`, `- Theme: ${fx.theme}`, `- Acceptance: ${fx.acceptance}`);
      const items = run.findings.filter((f) => fx.itemKeys.includes(f.key));
      if (items.length) lines.push('- Closes:');
      for (const f of items) {
        lines.push(`  - ${f.standardShort} ${f.id}: ${f.title}`);
        for (const e of f.evidence.slice(0, 3)) lines.push(`    - Evidence: ${e.file}${e.line ? `:${e.line}` : ''} ${e.note}`);
      }
      lines.push('');
    }
  }
  lines.push('After the change, the same rules will run again to verify each acceptance line.');
  return lines.join('\n');
}

export function lineDiff(a: string, b: string): { t: ' ' | '+' | '-'; s: string }[] {
  const A = a.split('\n');
  const B = b.split('\n');
  if (A.length * B.length > 400000) return [...A.map((s) => ({ t: '-' as const, s })), ...B.map((s) => ({ t: '+' as const, s }))];
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: ' ' | '+' | '-'; s: string }[] = [];
  let i = 0,
    j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) out.push({ t: ' ', s: A[i++] }), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: A[i++] });
    else out.push({ t: '+', s: B[j++] });
  }
  while (i < A.length) out.push({ t: '-', s: A[i++] });
  while (j < B.length) out.push({ t: '+', s: B[j++] });
  return out;
}
