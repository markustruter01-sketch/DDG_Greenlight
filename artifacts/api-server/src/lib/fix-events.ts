/**
 * Fix-session events: one timestamped record per thing Claude does while
 * remediating a wave. The live console, the progress bar and recordings all
 * speak this one shape, so a replay is indistinguishable from a live run.
 *
 * `at` is milliseconds since the session started (not wall-clock), so a
 * recording replays with its real pacing wherever it is played.
 */
export type FixStage = "preparing" | "fixing" | "verifying" | "review" | "done" | "failed";

export interface PlanPackage {
  key: string;
  title: string;
  theme: string;
  acceptance: string;
  /** What the check found before the fix (one line). */
  found?: string;
  /** Evidence locations the check pointed at. */
  where: string[];
  /** Catalogue items this package closes: standard short name, clause id, paraphrased title. */
  items: { standard: string; id: string; title: string; blocking: boolean }[];
}

export type FixEvent =
  | { at: number; type: "plan"; packages: PlanPackage[] }
  | { at: number; type: "stage"; stage: FixStage; label: string }
  | { at: number; type: "note"; text: string }
  | { at: number; type: "package"; index: number; total: number; title: string; status: "start" | "done" }
  | { at: number; type: "tool"; tool: "Read" | "Glob" | "Grep" | "Edit" | "Write" | string; path?: string; detail?: string }
  | { at: number; type: "edit"; path: string; hunk: string; added: number; removed: number }
  | { at: number; type: "test"; command: string; status: "start" | "pass" | "fail" | "skipped"; output?: string }
  | { at: number; type: "cost"; usd: number; turns: number }
  | { at: number; type: "done"; summary: string; filesChanged: number; durationMs: number };

export interface FixRecording {
  version: 1;
  recordedAt: string;
  project: string;
  wave: number;
  model: string;
  /** Wall-clock length of the original run. */
  durationMs: number;
  packages: PlanPackage[];
  events: FixEvent[];
  /** Final file list with before/after, so the review step works offline. */
  changes: { file: string; before: string; after: string }[];
  /** Readiness before and after, per standard, from the deterministic engine. */
  outcome: {
    before: Record<string, number>; after: Record<string, number>; verdictBefore: string; verdictAfter: string; changed?: Record<string, string>;
    /** Clauses the wave's packages set out to close, how many the re-check rates met, which stayed open, and how many retarget rounds ran. */
    targeted?: number; met?: number; open?: string[]; retargetRounds?: number;
  };
}

/** A FixEvent without its timestamp; distributive so each variant keeps its own fields. */
export type FixInput = FixEvent extends infer E ? (E extends FixEvent ? Omit<E, "at"> & { at?: number } : never) : never;

/** Builds a unified-diff style hunk for the console from a before/after pair (bounded). */
export function hunkFor(before: string, after: string, maxLines = 60): { hunk: string; added: number; removed: number } {
  const a = before.split("\n"), b = after.split("\n");
  // Longest-common-subsequence is overkill for a console; a simple prefix/suffix trim
  // isolates the changed region, which is what a viewer wants to see.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const removed = a.slice(start, endA), added = b.slice(start, endB);
  const ctxBefore = a.slice(Math.max(0, start - 2), start), ctxAfter = a.slice(endA, endA + 2);
  const lines = [
    `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`,
    ...ctxBefore.map(l => ` ${l}`),
    ...removed.map(l => `-${l}`),
    ...added.map(l => `+${l}`),
    ...ctxAfter.map(l => ` ${l}`),
  ];
  const clipped = lines.length > maxLines ? [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`] : lines;
  return { hunk: clipped.join("\n"), added: added.length, removed: removed.length };
}

/**
 * A tiny in-process pub/sub so an HTTP stream can follow a running fix.
 * Subscribers get every event already emitted (so a late viewer sees the
 * whole console), then live ones.
 */
export class FixSession {
  readonly startedAt = Date.now();
  readonly events: FixEvent[] = [];
  private listeners = new Set<(e: FixEvent) => void>();
  closed = false;
  constructor(readonly id: string, private readonly recorder?: (e: FixEvent) => void) {}
  emit(e: FixInput) {
    const event = { ...e, at: e.at ?? Date.now() - this.startedAt } as FixEvent;
    this.events.push(event);
    this.recorder?.(event);
    for (const l of this.listeners) l(event);
    if (event.type === "done" || (event.type === "stage" && event.stage === "failed")) this.close();
    return event;
  }
  subscribe(l: (e: FixEvent) => void) {
    for (const e of this.events) l(e);
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  close() { this.closed = true; this.listeners.clear(); }
}

const sessions = new Map<string, FixSession>();
export function openSession(id: string, recorder?: (e: FixEvent) => void) {
  const s = new FixSession(id, recorder);
  sessions.set(id, s);
  return s;
}
export function getSession(id: string) { return sessions.get(id); }
export function dropSession(id: string) { sessions.delete(id); }
