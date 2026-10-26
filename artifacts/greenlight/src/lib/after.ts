import { useMemo } from 'react';
import { getGetAssessmentQueryKey, getListFixRunsQueryKey, getListReportsQueryKey, useGetAssessment, useListFixRuns, useListReports, type AssessmentRun, type FixRun } from '@workspace/api-client-react';
import { useRecordings } from '@/pages/replay';
import { reduceEvents, type FixRecording } from '@/lib/fix-events';
import { pc } from '@/lib/greenlight';

/**
 * The "after" side of a fix, from either source:
 *  - ?fix=<id>: a real fix run of this assessment and its verification run;
 *  - ?after=<name>: a published recording (public/demo/<name>.json), whose
 *    outcome carries the clauses it changed and the readiness after.
 * Verified and Sign-off both read this, so they agree with each other.
 */
export type AfterView = {
  mode: 'fix' | 'recording' | null;
  loading: boolean;
  fixRun?: FixRun;
  recording?: FixRecording | null;
  verification?: AssessmentRun;
  /** finding key → status, after the fix (baseline where nothing changed) */
  statusesAfter: Record<string, string>;
  statusesBefore: Record<string, string>;
  /** standard short name → readiness 0–100, before and after */
  readinessBefore: Record<string, number>;
  readinessAfter: Record<string, number>;
  changedKeys: string[];
  verdictBefore: string;
  verdictAfter: string;
  wave: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  durationMs: number;
  costUsd: number | null;
  tests: { pass: number; total: number } | null;
  pullRequestUrl?: string | null;
  downloadUrl?: string | null;
  verificationPdfUrl?: string | null;
};

export function useAfter(run: AssessmentRun | undefined, search: string): AfterView {
  const params = new URLSearchParams(search);
  const fixId = params.get('fix');
  const recName = params.get('after');
  const rec = useRecordings(recName);
  const fixes = useListFixRuns(run?.id ?? '', { query: { enabled: !!run?.id && !!fixId, queryKey: getListFixRunsQueryKey(run?.id ?? '') } });
  const fixRun = fixId ? (fixes.data ?? []).find((f) => f.id === fixId) ?? (fixes.data ?? [])[(fixes.data ?? []).length - 1] : undefined;
  const vid = fixRun?.verificationRunId ?? '';
  const verification = useGetAssessment(vid, { query: { enabled: !!vid, queryKey: getGetAssessmentQueryKey(vid) } });
  const reports = useListReports(vid, { query: { enabled: !!vid, queryKey: getListReportsQueryKey(vid) } });

  return useMemo<AfterView>(() => {
    const statusesBefore = Object.fromEntries((run?.findings ?? []).map((f) => [f.key, f.status]));
    const readinessBefore = Object.fromEntries((run?.standards ?? []).map((s) => [s.short, pc(s.readiness)]));
    const empty: AfterView = {
      mode: null, loading: false, statusesAfter: statusesBefore, statusesBefore, readinessBefore, readinessAfter: readinessBefore,
      changedKeys: [], verdictBefore: run?.verdict ?? '', verdictAfter: run?.verdict ?? '', wave: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0,
      durationMs: 0, costUsd: null, tests: null,
    };
    if (recName) {
      const list = rec.recs;
      if (!list.length) return { ...empty, mode: 'recording', loading: rec.state === 'loading' || rec.state === 'idle', recording: null };
      // Waves apply in order: each later wave's changes sit on top of the earlier ones.
      const first = list[0], last = list[list.length - 1];
      const changed: Record<string, string> = {};
      for (const r of list) Object.assign(changed, r.outcome.changed ?? {});
      const statusesAfter = { ...statusesBefore, ...changed };
      const readinessAfter: Record<string, number> = { ...readinessBefore };
      for (const [k, v] of Object.entries(last.outcome.after)) readinessAfter[k] = Math.round(v);
      const readinessB: Record<string, number> = { ...readinessBefore };
      for (const [k, v] of Object.entries(first.outcome.before)) readinessB[k] = Math.round(v);
      let files = 0, add = 0, del = 0, duration = 0, cost = 0, costSeen = false, pass = 0, total = 0, testsSeen = false;
      for (const r of list) {
        const view = reduceEvents(r.events);
        files += view.done?.filesChanged ?? r.changes.length;
        for (const f of Object.values(view.files)) { add += f.added; del += f.removed; }
        duration += r.durationMs;
        if (view.cost) { cost += view.cost.usd; costSeen = true; }
        // The full suite, not a later spot-check: keep the biggest run seen across the rounds.
        if (view.tests.pass + view.tests.fail > total) { pass = view.tests.pass; total = view.tests.pass + view.tests.fail; testsSeen = true; }
      }
      return {
        ...empty, mode: 'recording', recording: last, statusesAfter, readinessBefore: readinessB, readinessAfter,
        changedKeys: Object.keys(changed), verdictBefore: first.outcome.verdictBefore, verdictAfter: last.outcome.verdictAfter,
        wave: last.wave, filesChanged: files, linesAdded: add, linesRemoved: del,
        durationMs: duration, costUsd: costSeen ? cost : null, tests: testsSeen ? { pass, total } : null,
      };
    }
    if (fixId) {
      const v = verification.data;
      const statusesAfter = v ? Object.fromEntries(v.findings.map((f) => [f.key, f.status])) : statusesBefore;
      const readinessAfter = v ? Object.fromEntries(v.standards.map((s) => [s.short, pc(s.readiness)])) : readinessBefore;
      const changedKeys = Object.keys(statusesAfter).filter((k) => statusesAfter[k] !== statusesBefore[k]);
      const pdf = (reports.data ?? []).find((rep) => rep.formats.includes('pdf'));
      let add = 0, del = 0;
      for (const c of fixRun?.changes ?? []) { const b = c.before.split('\n').length, a = c.after.split('\n').length; if (a > b) add += a - b; else del += b - a; }
      return {
        ...empty, mode: 'fix', loading: fixes.isLoading || (!!vid && verification.isLoading), fixRun, verification: v, statusesAfter, readinessAfter, changedKeys,
        verdictAfter: v?.verdict ?? run?.verdict ?? '', wave: fixRun?.wave ?? 0, filesChanged: fixRun?.changes.length ?? 0, linesAdded: add, linesRemoved: del,
        pullRequestUrl: fixRun?.pullRequestUrl, downloadUrl: fixRun?.downloadUrl, verificationPdfUrl: pdf?.url ?? null,
      };
    }
    return empty;
  }, [run, recName, rec.recs, rec.state, fixId, fixRun, verification.data, verification.isLoading, fixes.isLoading, reports.data, vid]);
}
