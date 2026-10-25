import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Download, GitPullRequest, Package, MonitorPlay, ListChecks } from 'lucide-react';
import {
  getGetAssessmentQueryKey,
  getListFixRunsQueryKey,
  useApproveFix,
  useGetAssessment,
  useListFixRuns,
  type FixRun,
  type AssessmentRun,
} from '@workspace/api-client-react';
import { Shell, DEMO_RECORDING } from '@/components/shell';
import { Dot, ErrorBlock, Skeleton } from '@/components/gl';
import { download, lineDiff, pc } from '@/lib/greenlight';
import { FixConsole } from '@/components/fix-console';
import type { FixEvent, FixRecording } from '@/lib/fix-events';

/** Events persisted on a finished fix run (added to the API after the client was generated). */
const eventsOf = (fr: FixRun): FixEvent[] => ((fr as FixRun & { events?: FixEvent[] }).events ?? []);
const readinessBy = (run: AssessmentRun) => Object.fromEntries(run.standards.map((s) => [s.short, s.readiness]));
/** Turns a finished run plus its before/after assessments into a replayable recording. */
export function recordingOf(fr: FixRun, before: AssessmentRun, after?: AssessmentRun): FixRecording {
  const events = eventsOf(fr);
  const plan = events.find((e) => e.type === 'plan');
  return {
    version: 1, recordedAt: before.assessedAt, project: before.projectName, wave: fr.wave, model: 'Claude',
    durationMs: events.length ? events[events.length - 1].at : 0,
    packages: plan && plan.type === 'plan' ? plan.packages : [], events, changes: fr.changes,
    outcome: { before: readinessBy(before), after: after ? readinessBy(after) : readinessBy(before), verdictBefore: before.verdict, verdictAfter: after?.verdict ?? before.verdict },
  };
}

export const WORKING = /run|pend|queue|start|prepar|generat|verif|appl|work|propos/i;
export const AWAITING = /await|review|ready|propos/i;

function Diff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => lineDiff(before, after), [before, after]);
  return (
    <pre className="max-h-80 overflow-auto rounded-xl p-3 font-mono text-xs leading-5" style={{ background: 'rgba(0,0,0,.35)' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ background: r.t === '+' ? 'rgba(79,217,154,.14)' : r.t === '-' ? 'rgba(255,92,110,.14)' : undefined, color: r.t === ' ' ? '#CFE3EE' : '#F7FBFF' }}>
          <span className="mr-2 inline-block w-3 opacity-70">{r.t}</span>{r.s || ' '}
        </div>
      ))}
    </pre>
  );
}

function FixRunCard({ fr, runId, baseline, onReplay }: { fr: FixRun; runId: string; baseline: AssessmentRun; onReplay: (rec: FixRecording) => void }) {
  const qc = useQueryClient();
  const approve = useApproveFix();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setPicked(Object.fromEntries(fr.changes.map((c) => [c.file, c.approved])));
  }, [fr.id, fr.changes.length]);
  const after = useGetAssessment(fr.verificationRunId ?? '', {
    query: { enabled: !!fr.verificationRunId, queryKey: getGetAssessmentQueryKey(fr.verificationRunId ?? '') },
  });
  const files = fr.changes.filter((c) => picked[c.file]).map((c) => c.file);
  const done = fr.status !== 'awaiting_approval';
  const submit = (output: 'zip' | 'pr') =>
    approve.mutate({ id: fr.id, data: { approvedFiles: files, output } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListFixRunsQueryKey(runId) }) });
  return (
    <div className="glass space-y-4 p-5" data-testid={`card-fixrun-${fr.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-head text-xl">Wave {fr.wave} fix</div>
        <div className="flex items-center gap-2">
          {eventsOf(fr).length > 0 && <button className="btn !px-2.5 !py-1.5 text-xs" onClick={() => onReplay(recordingOf(fr, baseline, after.data))} data-testid={`button-replay-${fr.id}`}><MonitorPlay size={14} /> Replay the session</button>}
          <Dot color={/fail|error/i.test(fr.status) ? '#FF5C6E' : WORKING.test(fr.status) ? '#FFA62B' : '#4FD99A'} word={fr.status} />
        </div>
      </div>
      {fr.error && <Dot color="#FF5C6E" word={fr.error} />}
      <ol className="space-y-1 border-l pl-4 text-sm" style={{ borderColor: 'rgba(0,229,255,.4)' }} data-testid="timeline">
        {fr.timeline.map((t, i) => <li key={i} style={{ color: '#CFE3EE' }}>{t}</li>)}
        {WORKING.test(fr.status) && !fr.error && <li className="lbl !text-[#00E5FF]">Working</li>}
      </ol>
      {fr.changes.length > 0 && (
        <div className="space-y-4">
          <div className="lbl">AI proposed {fr.changes.length} file change{fr.changes.length === 1 ? '' : 's'}. Nothing is applied until you approve.</div>
          {fr.changes.map((c) => (
            <div key={c.file}>
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-[#00E5FF]" disabled={done} checked={!!picked[c.file]} onChange={(e) => setPicked({ ...picked, [c.file]: e.target.checked })} data-testid={`checkbox-file-${c.file}`} />
                <span className="font-mono text-xs" style={{ color: '#00E5FF' }}>{c.file}</span>
                {c.approved && <Dot color="#4FD99A" word="Approved" />}
              </label>
              <Diff before={c.before} after={c.after} />
            </div>
          ))}
          {!done && (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={!files.length || approve.isPending} onClick={() => submit('zip')} data-testid="button-approve-zip"><Package size={15} /> Approve {files.length} and download zip</button>
              <button className="btn" disabled={!files.length || approve.isPending} onClick={() => submit('pr')} data-testid="button-approve-pr"><GitPullRequest size={15} /> Approve and open pull request</button>
            </div>
          )}
          {approve.isError && <Dot color="#FF5C6E" word="Approval failed. Try again." />}
        </div>
      )}
      {fr.downloadUrl && <button className="btn btn-primary" onClick={() => download(fr.downloadUrl!)} data-testid="button-download-fixed"><Download size={15} /> Download fixed zip</button>}
      {fr.pullRequestUrl && (
        <div className="tile p-4" data-testid="card-pr">
          <a href={fr.pullRequestUrl} target="_blank" rel="noreferrer" className="font-medium text-[#00E5FF] underline">{fr.pullRequestUrl}</a>
          <p className="lbl mt-2 !normal-case !tracking-normal">Pull request opened. Greenlight never merges it for you; review and merge it yourself.</p>
        </div>
      )}
      {fr.verificationRunId && (
        <div className="tile flex flex-wrap items-center justify-between gap-2 p-3" data-testid="card-verification">
          <div className="lbl">After-fix verification · {after.isLoading ? 'loading' : after.data ? `${pc(after.data.readiness)}% · ${after.data.verdict}` : 'unavailable'}</div>
          {after.data && <Link href={`/results/${after.data.id}`} className="btn !px-2 !py-1.5" data-testid="link-verified-results">Open verified results</Link>}
        </div>
      )}
    </div>
  );
}

export default function Fix() {
  const { id = '' } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const search = useSearch();
  const wanted = useMemo(() => new URLSearchParams(search).get('fix'), [search]);
  const qc = useQueryClient();
  const q = useGetAssessment(id, { query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id) } });
  const fixes = useListFixRuns(id, {
    query: {
      enabled: !!id,
      queryKey: getListFixRunsQueryKey(id),
      refetchInterval: (query) => (query.state.data?.some((f) => WORKING.test(f.status) && !AWAITING.test(f.status) && !f.error) ? 2500 : false),
    },
  });
  // The console takes over while a run is in flight, or when a finished one is replayed.
  const [screen, setScreen] = useState<{ kind: 'live'; fixId: string } | { kind: 'replay'; recording: FixRecording } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const run = q.data;
  const inFlight = (fixes.data ?? []).find((f) => WORKING.test(f.status) && !AWAITING.test(f.status) && !f.error);
  const requested = wanted ? (fixes.data ?? []).find((f) => f.id === wanted) : undefined;
  useEffect(() => {
    if (screen) return;
    if (requested && dismissed !== requested.id) {
      if (WORKING.test(requested.status) && !AWAITING.test(requested.status) && !requested.error) setScreen({ kind: 'live', fixId: requested.id });
      else if (run && eventsOf(requested).length) setScreen({ kind: 'replay', recording: recordingOf(requested, run) });
      return;
    }
    if (inFlight && dismissed !== inFlight.id) setScreen({ kind: 'live', fixId: inFlight.id });
  }, [inFlight?.id, requested?.id, requested?.status, screen, dismissed, run?.id]);

  const latest = (fixes.data ?? [])[(fixes.data ?? []).length - 1];
  const awaiting = (fixes.data ?? []).find((f) => AWAITING.test(f.status) && !f.verificationRunId);
  const verified = (fixes.data ?? []).filter((f) => f.verificationRunId);
  const guide = {
    steps: screen?.kind === 'live'
      ? ['Nothing yet. Claude is writing the fixes; watch the plan tick off on the left.', 'When it says awaiting your approval, read the changed files', 'Approve them; the same code checks again']
      : awaiting ? ['Read each changed file below; untick any you do not want', 'Press Approve and verify', 'Then go to Step 5 to see the result']
        : verified.length ? ['This wave is verified', 'Go to Step 5 · Verified to see before and after', 'Or back to the Plan for the next wave']
          : ['No fix has been started for this assessment yet', 'Go to Step 3 · Plan and press Fix with Claude', 'Come back here to watch it'],
    current: screen?.kind === 'live' ? 0 : awaiting ? 0 : verified.length ? 1 : 1,
    tone: verified.length && !awaiting && !screen ? 'ok' as const : undefined,
  };

  return (
    <Shell runId={id} guide={screen ? undefined : guide} runMeta={run ? `${run.projectName} · fixing` : undefined}>
      {q.isLoading ? <div className="flex flex-1 items-center p-8"><Skeleton className="h-full w-full" /></div> : q.isError || !run ? <div className="flex flex-1 items-center justify-center"><ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /></div> : screen ? (
        <FixConsole key={screen.kind === 'live' ? screen.fixId : 'replay'} source={screen} project={run.projectName} wave={screen.kind === 'replay' ? screen.recording.wave : (requested?.wave ?? inFlight?.wave ?? latest?.wave ?? 1)}
          exitLabel={screen.kind === 'live' ? 'Review the changes' : 'Back'}
          onExit={() => { if (screen.kind === 'live') setDismissed(screen.fixId); setScreen(null); qc.invalidateQueries({ queryKey: getListFixRunsQueryKey(id) }); }} />
      ) : (
        <div className="plan-layout" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
          <section className="glass plan-main">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div><div className="lbl">Step 4 of 6 · Fixing</div><h1 className="font-head mt-1 text-3xl font-semibold leading-tight">{awaiting ? `Wave ${awaiting.wave} is proposed. Approve the changes.` : verified.length ? `Wave ${verified[verified.length - 1].wave} is fixed and verified.` : 'Nothing is being fixed yet.'}</h1></div>
              <div className="flex gap-2">
                <Link href={`/plan/${id}`} className="btn !px-3 !py-2 text-xs" data-testid="link-plan"><ListChecks size={14} /> The plan</Link>
                {inFlight && <button className="btn btn-primary !px-3 !py-2 text-xs" onClick={() => { setDismissed(null); setScreen({ kind: 'live', fixId: inFlight.id }); }} data-testid="button-open-console"><MonitorPlay size={14} /> Watch the fix</button>}
                {verified.length > 0 && <Link href={`/verified/${id}?fix=${verified[verified.length - 1].id}`} className="btn btn-primary !px-3 !py-2 text-xs" data-testid="link-verified">See before → after</Link>}
              </div>
            </div>
            <div className="plan-list">
              {fixes.isLoading ? <Skeleton className="h-24" /> : fixes.isError ? <ErrorBlock message="Fix runs unavailable." onRetry={() => fixes.refetch()} /> : !(fixes.data ?? []).length ? (
                <div className="ink p-5 text-sm" style={{ color: '#EAF3F8' }}>
                  <p className="font-head text-lg text-[#F7FBFF]">Start from the plan</p>
                  <p className="mt-1">Step 3 lists what each wave fixes. Press <b>Fix wave 1 with Claude</b> there and this screen shows the work live. Where live fixing is off, <Link href={`/replay/${DEMO_RECORDING}`} className="underline" style={{ color: '#00E5FF' }}>the recorded fix</Link> shows a real run end to end.</p>
                </div>
              ) : [...(fixes.data ?? [])].reverse().map((fr) => <FixRunCard key={fr.id} fr={fr} runId={id} baseline={run} onReplay={(recording) => setScreen({ kind: 'replay', recording })} />)}
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}
