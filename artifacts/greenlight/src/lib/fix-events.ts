/**
 * Client view of a fix session: the event shapes the API streams, a reducer
 * that turns a prefix of events into what the console shows, and the two
 * sources (live stream, recording) that feed it. Live and replay share the
 * reducer, so a replayed run looks exactly like it did live.
 */
export type FixStage = 'preparing' | 'fixing' | 'verifying' | 'review' | 'done' | 'failed';

export interface PlanPackage {
  key: string;
  title: string;
  theme: string;
  acceptance: string;
  found?: string;
  where: string[];
  items: { standard: string; id: string; title: string; blocking: boolean }[];
}

export type FixEvent =
  | { at: number; type: 'plan'; packages: PlanPackage[] }
  | { at: number; type: 'stage'; stage: FixStage; label: string }
  | { at: number; type: 'note'; text: string }
  | { at: number; type: 'package'; index: number; total: number; title: string; status: 'start' | 'done' }
  | { at: number; type: 'tool'; tool: string; path?: string; detail?: string }
  | { at: number; type: 'edit'; path: string; hunk: string; added: number; removed: number }
  | { at: number; type: 'test'; command: string; status: 'start' | 'pass' | 'fail' | 'skipped'; output?: string }
  | { at: number; type: 'cost'; usd: number; turns: number }
  | { at: number; type: 'done'; summary: string; filesChanged: number; durationMs: number };

export interface FixRecording {
  version: 1;
  recordedAt: string;
  project: string;
  wave: number;
  model: string;
  durationMs: number;
  packages: PlanPackage[];
  events: FixEvent[];
  changes: { file: string; before: string; after: string }[];
  outcome: { before: Record<string, number>; after: Record<string, number>; verdictBefore: string; verdictAfter: string };
}

export type PackageState = 'queued' | 'active' | 'done';

export interface ConsoleLine {
  at: number;
  kind: 'note' | 'tool' | 'edit' | 'test' | 'stage' | 'package' | 'cost';
  text: string;
  path?: string;
  hunk?: string;
  tone?: 'ok' | 'bad' | 'warn' | 'dim';
}

export interface FixView {
  stage: FixStage;
  stageLabel: string;
  packages: PlanPackage[];
  packageState: PackageState[];
  /** Index of the package being worked on, or -1. */
  active: number;
  activeSince: number;
  /** Ms spent on each finished package, to estimate the rest. */
  packageDurations: number[];
  lines: ConsoleLine[];
  files: Record<string, { added: number; removed: number; edits: number }>;
  lastNote: string;
  cost?: { usd: number; turns: number };
  done?: { summary: string; filesChanged: number; durationMs: number };
  /** Short-lived banner for the lower-third overlay. */
  banner?: { at: number; kind: 'start' | 'done' | 'stage'; title: string; sub?: string; index?: number; total?: number };
  reads: number;
  edits: number;
  tests: { pass: number; fail: number };
  lastAt: number;
}

const TOOL_VERBS: Record<string, string> = { Read: 'read', Glob: 'find', Grep: 'search', Edit: 'edit', Write: 'write' };

export function emptyView(): FixView {
  return { stage: 'preparing', stageLabel: 'Preparing', packages: [], packageState: [], active: -1, activeSince: 0, packageDurations: [], lines: [], files: {}, lastNote: '', reads: 0, edits: 0, tests: { pass: 0, fail: 0 }, lastAt: 0 };
}

/** Folds one event into the view. Pure, so a replay can rebuild any point from a prefix. */
export function applyEvent(v: FixView, e: FixEvent): FixView {
  const n: FixView = { ...v, lines: v.lines, lastAt: e.at };
  const push = (l: ConsoleLine) => { n.lines = [...n.lines, l]; };
  switch (e.type) {
    case 'plan':
      n.packages = e.packages;
      n.packageState = e.packages.map(() => 'queued');
      push({ at: e.at, kind: 'stage', text: `Plan: ${e.packages.length} work package${e.packages.length === 1 ? '' : 's'} in this wave`, tone: 'dim' });
      break;
    case 'stage':
      n.stage = e.stage; n.stageLabel = e.label;
      n.banner = { at: e.at, kind: 'stage', title: e.label };
      push({ at: e.at, kind: 'stage', text: e.label, tone: e.stage === 'failed' ? 'bad' : 'dim' });
      break;
    case 'note':
      n.lastNote = e.text;
      push({ at: e.at, kind: 'note', text: e.text });
      break;
    case 'package': {
      const ps = [...(n.packageState.length ? n.packageState : Array.from({ length: e.total }, () => 'queued' as PackageState))];
      if (e.status === 'start') {
        if (n.active >= 0 && ps[n.active] === 'active') ps[n.active] = 'done';
        ps[e.index] = 'active'; n.active = e.index; n.activeSince = e.at;
        n.banner = { at: e.at, kind: 'start', title: e.title, index: e.index, total: e.total, sub: `Now fixing · ${e.index + 1} of ${e.total}` };
        push({ at: e.at, kind: 'package', text: `▶ ${e.index + 1}/${e.total}  ${e.title}`, tone: 'warn' });
      } else {
        if (ps[e.index] === 'active') n.packageDurations = [...n.packageDurations, Math.max(1000, e.at - n.activeSince)];
        ps[e.index] = 'done';
        if (n.active === e.index) n.active = -1;
        n.banner = { at: e.at, kind: 'done', title: e.title, index: e.index, total: e.total, sub: `Fixed · ${e.index + 1} of ${e.total}` };
        push({ at: e.at, kind: 'package', text: `✓ ${e.index + 1}/${e.total}  ${e.title}`, tone: 'ok' });
      }
      n.packageState = ps;
      break;
    }
    case 'tool': {
      if (e.tool === 'Read') n.reads += 1;
      const verb = TOOL_VERBS[e.tool] || e.tool.toLowerCase();
      push({ at: e.at, kind: 'tool', text: `${verb} ${e.path ?? ''}${e.detail ? `  “${e.detail}”` : ''}`.trim(), path: e.path, tone: 'dim' });
      break;
    }
    case 'edit': {
      n.edits += 1;
      const f = n.files[e.path] ?? { added: 0, removed: 0, edits: 0 };
      n.files = { ...n.files, [e.path]: { added: f.added + e.added, removed: f.removed + e.removed, edits: f.edits + 1 } };
      push({ at: e.at, kind: 'edit', text: `${e.path}  +${e.added} −${e.removed}`, path: e.path, hunk: e.hunk });
      break;
    }
    case 'test':
      if (e.status === 'pass') n.tests = { ...n.tests, pass: n.tests.pass + 1 };
      if (e.status === 'fail') n.tests = { ...n.tests, fail: n.tests.fail + 1 };
      push({ at: e.at, kind: 'test', text: `${e.command} · ${e.status}${e.output ? `\n${e.output}` : ''}`, tone: e.status === 'pass' ? 'ok' : e.status === 'fail' ? 'bad' : 'dim' });
      break;
    case 'cost':
      // Each agent round reports its own cost; the screen shows the running total.
      n.cost = { usd: (v.cost?.usd ?? 0) + e.usd, turns: (v.cost?.turns ?? 0) + e.turns };
      break;
    case 'done':
      n.done = { summary: e.summary, filesChanged: e.filesChanged, durationMs: e.durationMs };
      n.packageState = n.packageState.map(() => 'done');
      n.active = -1;
      push({ at: e.at, kind: 'stage', text: `${e.summary} · ${e.filesChanged} file${e.filesChanged === 1 ? '' : 's'} changed`, tone: 'ok' });
      break;
  }
  return n;
}

export function reduceEvents(events: FixEvent[]): FixView {
  let v = emptyView();
  for (const e of events) v = applyEvent(v, e);
  return v;
}

/**
 * Progress for the big bar. With a known total duration (replay) it is the
 * timeline position; live, it is packages finished plus a bounded share of
 * the one in progress, using the average package time so far.
 */
export function progressOf(v: FixView, now: number, totalMs?: number): number {
  if (v.done) return 1;
  if (totalMs) return Math.min(1, now / totalMs);
  const total = v.packages.length || 1;
  const done = v.packageState.filter((s) => s === 'done').length;
  if (v.active < 0) return v.stage === 'preparing' ? 0.02 : Math.min(0.98, done / total);
  const avg = v.packageDurations.length ? v.packageDurations.reduce((a, b) => a + b, 0) / v.packageDurations.length : 120_000;
  const part = Math.min(0.9, (now - v.activeSince) / avg);
  return Math.min(0.98, (done + part) / total);
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
