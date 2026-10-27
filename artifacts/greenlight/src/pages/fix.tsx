import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Code2, Download, GitPullRequest, MonitorPlay, Package } from 'lucide-react';
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
    <pre className="max-h-72 overflow-auto rounded-xl p-3 font-mono text-xs leading-5" style={{ background: 'rgba(0,0,0,.35)' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ background: r.t === '+' ? 'rgba(79,217,154,.14)' : r.t === '-' ? 'rgba(255,92,110,.14)' : undefined, color: r.t === ' ' ? '#CFE3EE' : '#F7FBFF' }}>
          <span className="mr-2 inline-block w-3 opacity-70">{r.t}</span>{r.s || ' '}
        </div>
      ))}
    </pre>
  );
}

const plusMinus = (c: { before: string; after: string }) => {
  const rows = lineDiff(c.before, c.after);
  return { add: rows.filter((r) => r.t === '+').length, del: rows.filter((r) => r.t === '-').length };
};

/** One finished (or finishing) round: keep the changes, or not. */
function Approve({ fr, runId, baseline, onReplay }: { fr: FixRun; runId: string; baseline: AssessmentRun; onReplay: (rec: FixRecording) => void }) {
  const qc = useQueryClient();
  const approve = useApproveFix();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [code, setCode] = useState(false);
  useEffect(() => { setPicked(Object.fromEntries(fr.changes.map((c) => [c.file, c.approved || fr.status === 'awaiting_approval']))); }, [fr.id, fr.changes.length, fr.status]);
  const after = useGetAssessment(fr.verificationRunId ?? '', { query: { enabled: !!fr.verificationRunId, queryKey: getGetAssessmentQueryKey(fr.verificationRunId ?? '') } });
  const files = fr.changes.filter((c) => picked[c.file]).map((c) => c.file);
  const awaiting = fr.status === 'awaiting_approval';
  const failed = /fail|error/i.test(fr.status) || !!fr.error;
  const working = WORKING.test(fr.status) && !AWAITING.test(fr.status) && !fr.error;
  const totals = useMemo(() => fr.changes.reduce((n, c) => { const d = plusMinus(c); return { add: n.add + d.add, del: n.del + d.del }; }, { add: 0, del: 0 }), [fr.changes]);
  const submit = (output: 'zip' | 'pr') => approve.mutate({ id: fr.id, data: { approvedFiles: files, output } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListFixRunsQueryKey(runId) }) });
  const title = failed ? `Round ${fr.wave} stopped. Nothing was changed.` : working ? `Round ${fr.wave} is still being fixed.` : awaiting ? `Round ${fr.wave} is done. Keep these changes?` : fr.verificationRunId ? `Round ${fr.wave} is kept and checked again.` : `Round ${fr.wave} is kept.`;
  return (
    <section className={`glass jcard ${fr.verificationRunId ? 'is-ok' : ''}`} data-testid={`card-fixrun-${fr.id}`}>
      <div className="jrow">
        <h1 className="jh">{title}</h1>
        <span className="jnote">{fr.changes.length} file{fr.changes.length === 1 ? '' : 's'} · <span style={{ color: '#4FD99A' }}>+{totals.add.toLocaleString()}</span> / <span style={{ color: '#FF8C9A' }}>−{totals.del.toLocaleString()}</span>{after.data ? ` · now ${pc(after.data.readiness)}%` : ''}</span>
      </div>
      {fr.error && <Dot color="#FF5C6E" word={fr.error} />}
      {fr.changes.length > 0 && (
        <div className="jchgs" data-testid="change-list">
          {fr.changes.map((c) => {
            const d = plusMinus(c);
            const on = !!picked[c.file];
            const summary = (c as { summary?: string }).summary;
            return (
              <div key={c.file}>
                <label className={`jchg ${on ? 'is-on' : ''}`} style={{ cursor: awaiting ? 'pointer' : 'default' }}>
                  <input type="checkbox" className="sr-only" disabled={!awaiting} checked={on} onChange={(e) => setPicked({ ...picked, [c.file]: e.target.checked })} data-testid={`checkbox-file-${c.file}`} />
                  <span className="ok" aria-hidden="true">{on ? '✓' : ''}</span>
                  <span className="min-w-0 truncate">{summary || c.file.split('/').pop()}</span>
                  <code title={c.file}>{c.file}</code>
                  <span className="pm"><span style={{ color: '#4FD99A' }}>+{d.add}</span> <span style={{ color: '#FF8C9A' }}>−{d.del}</span></span>
                </label>
                {code && <div className="mt-1 mb-2"><Diff before={c.before} after={c.after} /></div>}
              </div>
            );
          })}
        </div>
      )}
      {working && <ol className="space-y-1 border-l pl-4 text-sm" style={{ borderColor: 'rgba(0,229,255,.4)' }} data-testid="timeline">{fr.timeline.slice(-4).map((t, i) => <li key={i} style={{ color: '#CFE3EE' }}>{t}</li>)}<li className="lbl !text-[#00E5FF]">Working</li></ol>}
      <div className="jrow">
        <div className="flex flex-wrap items-center gap-3">
          {awaiting && <>
            <button className="btn btn-go btn-big" disabled={!files.length || approve.isPending} onClick={() => submit('pr')} data-testid="button-approve-pr"><GitPullRequest size={18} /> Keep them · open the pull request</button>
            <button className="btn btn-quiet" disabled={!files.length || approve.isPending} onClick={() => submit('zip')} data-testid="button-approve-zip"><Package size={15} /> Keep them · download a zip</button>
          </>}
          {fr.verificationRunId && <Link href={`/verified/${runId}?fix=${fr.id}`} className="btn btn-go btn-big" data-testid="link-verified-results">See the proof <ArrowRight size={20} /></Link>}
          {fr.pullRequestUrl && <a className="btn btn-quiet" href={fr.pullRequestUrl} target="_blank" rel="noreferrer" data-testid="link-pr"><GitPullRequest size={15} /> The pull request</a>}
          {fr.downloadUrl && <button className="btn btn-quiet" onClick={() => download(fr.downloadUrl!)} data-testid="button-download-fixed"><Download size={15} /> Fixed zip</button>}
          {fr.changes.length > 0 && <button className="btn btn-quiet" onClick={() => setCode((v) => !v)} aria-pressed={code} data-testid="button-show-code"><Code2 size={15} /> {code ? 'Hide the exact code' : 'Read the exact code'}</button>}
          {eventsOf(fr).length > 0 && <button className="btn btn-quiet" onClick={() => onReplay(recordingOf(fr, baseline, after.data))} data-testid={`button-replay-${fr.id}`}><MonitorPlay size={15} /> Replay</button>}
        </div>
        {awaiting && <Link href={`/plan/${runId}`} className="btn btn-quiet" style={{ color: '#FF8C9A', borderColor: 'rgba(255,92,110,.4)' }} data-testid="link-discard">Throw them away</Link>}
      </div>
      {approve.isError && <Dot color="#FF5C6E" word="Approval failed. Try again." />}
      <span className="jnote">{awaiting ? 'Keeping them opens a pull request on your GitHub for your team to merge. Nothing is merged for you.' : fr.pullRequestUrl ? 'Pull request opened. Greenlight never merges it; your team reviews and merges.' : 'Untick a file to leave it out. Nothing is applied until you keep it.'}</span>
    </section>
  );
}

/**
 * Step 5 · Fixing: the console takes over while Claude works (or a recording
 * plays); otherwise the round's changes wait for your approval.
 */
export default function Fix() {
  const { id = '' } = useParams<{ id: string }>();
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
  const [screen, setScreen] = useState<{ kind: 'live'; fixId: string } | { kind: 'replay'; recording: FixRecording } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const run = q.data;
  const inFlight = (fixes.data ?? []).find((f) => WORKING.test(f.status) && !AWAITING.test(f.status) && !f.error);
  const requested = wanted ? (fixes.data ?? []).find((f) => f.id === wanted) : undefined;
  useEffect(() => {
    if (screen) return;
    if (requested && dismissed !== requested.id) {
      if (WORKING.test(requested.status) && !AWAITING.test(requested.status) && !requested.error) setScreen({ kind: 'live', fixId: requested.id });
      return;
    }
    if (inFlight && dismissed !== inFlight.id) setScreen({ kind: 'live', fixId: inFlight.id });
  }, [inFlight?.id, requested?.id, requested?.status, screen, dismissed, run?.id]);

  const list = fixes.data ?? [];
  const latest = list[list.length - 1];
  const shown = requested ?? list.find((f) => AWAITING.test(f.status) && !f.verificationRunId) ?? latest;
  const awaiting = shown && AWAITING.test(shown.status) && !shown.verificationRunId;
  const guide = {
    steps: screen?.kind === 'live'
      ? ['Nothing yet. Claude is writing the fixes; the bar shows how far along it is.', 'When it says ready, read the changes', 'Keep them; the same code checks again']
      : awaiting ? ['Read each change; untick any you do not want', 'Press Keep them', 'Then See the proof']
        : shown?.verificationRunId ? ['This round is kept and checked again', 'Press See the proof', 'Or back to The plan for the next round']
          : ['No round has been started yet', 'Go to The plan and press Fix round 1 with Claude', 'Come back here to watch it'],
    current: 0,
    tone: shown?.verificationRunId && !awaiting && !screen ? 'ok' as const : undefined,
  };

  return (
    <Shell runId={id} guide={screen ? undefined : guide} runMeta={run ? `${run.projectName} · fixing` : undefined} pip={screen || !run ? null : awaiting ? { id: 'approve', corner: 'tl', what: 'The changes Claude made, in plain words. Nothing is kept until you say so.', press: 'Press Keep them.', target: '[data-testid="button-approve-pr"]', also: 'Read the exact code shows every line.' } : shown?.verificationRunId ? { id: 'fix-proof', corner: 'tl', press: 'Press See the proof.', target: '[data-testid="link-verified-results"]' } : { id: 'fix-plan', corner: 'tl', press: 'Press Go to the plan.', target: '[data-testid="link-plan"]' }}>
      {q.isLoading ? <div className="jl"><Skeleton className="h-80 w-full" /></div> : q.isError || !run ? <div className="jl"><ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /></div> : screen ? (
        <FixConsole key={screen.kind === 'live' ? screen.fixId : 'replay'} source={screen} project={run.projectName} wave={screen.kind === 'replay' ? screen.recording.wave : (requested?.wave ?? inFlight?.wave ?? latest?.wave ?? 1)}
          exitLabel={screen.kind === 'live' ? 'Review the changes' : 'Back'}
          onExit={() => { if (screen.kind === 'live') setDismissed(screen.fixId); setScreen(null); qc.invalidateQueries({ queryKey: getListFixRunsQueryKey(id) }); }} />
      ) : (
        <div className="jl">
          {fixes.isLoading ? <Skeleton className="h-80 w-full" /> : fixes.isError ? <ErrorBlock message="Fix runs unavailable." onRetry={() => fixes.refetch()} /> : !shown ? (
            <section className="glass jcard" data-testid="screen-fix-empty">
              <h1 className="jh">Nothing is being fixed yet.</h1>
              <p className="jp">The plan lists what each round fixes. Press <b>Fix round 1 with Claude</b> there and this screen shows the work live, with a bar you can watch. Where live fixing is off, the recorded fix shows a real run end to end.</p>
              <div className="flex flex-wrap gap-3"><Link href={`/plan/${id}`} className="btn btn-go btn-big" data-testid="link-plan">Go to the plan <ArrowRight size={20} /></Link><Link href={`/replay/${DEMO_RECORDING}`} className="btn btn-quiet" data-testid="link-recorded-fix"><MonitorPlay size={15} /> Watch the recorded fix</Link></div>
            </section>
          ) : (
            <Approve fr={shown} runId={id} baseline={run} onReplay={(recording) => setScreen({ kind: 'replay', recording })} />
          )}
          {list.length > 1 && !fixes.isLoading && (
            <div className="mt-3 flex flex-wrap gap-2" data-testid="fix-history">
              {list.map((f) => <Link key={f.id} href={`/fix/${id}?fix=${f.id}`} className={`btn !px-3 !py-1.5 text-xs ${shown?.id === f.id ? 'fc-on' : ''}`} data-testid={`link-fixrun-${f.id}`}>Round {f.wave}{f.verificationRunId ? ' ✓' : AWAITING.test(f.status) ? ' · waiting' : ''}</Link>)}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
