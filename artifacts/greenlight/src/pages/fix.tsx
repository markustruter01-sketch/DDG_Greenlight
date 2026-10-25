import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileText, GitPullRequest, Package, FileCheck2, MonitorPlay } from 'lucide-react';
import {
  getGetAssessmentQueryKey,
  getListFixRunsQueryKey,
  getListReportsQueryKey,
  useApproveFix,
  useGetAssessment,
  useGetGreenlightConfig,
  useListFixRuns,
  useListReports,
  useStartFix,
  type FixRun,
  type AssessmentRun,
} from '@workspace/api-client-react';
import { Shell, DEMO_RECORDING } from '@/components/shell';
import { Dot, ErrorBlock, Skeleton } from '@/components/gl';
import { useGate } from '@/hooks/use-gate';
import { download, lineDiff, pc, reportUrl, tally } from '@/lib/greenlight';
import { OrbitView } from '@/components/orbit-view';
import { FixConsole } from '@/components/fix-console';
import type { FixEvent, FixRecording } from '@/lib/fix-events';

/** Events persisted on a finished fix run (added to the API after the client was generated). */
const eventsOf = (fr: FixRun): FixEvent[] => ((fr as FixRun & { events?: FixEvent[] }).events ?? []);
const readinessBy = (run: AssessmentRun) => Object.fromEntries(run.standards.map((s) => [s.short, s.readiness]));
/** Turns a finished run plus its before/after assessments into a replayable recording. */
function recordingOf(fr: FixRun, before: AssessmentRun, after?: AssessmentRun): FixRecording {
  const events = eventsOf(fr);
  const plan = events.find((e) => e.type === 'plan');
  return {
    version: 1, recordedAt: before.assessedAt, project: before.projectName, wave: fr.wave, model: 'Claude',
    durationMs: events.length ? events[events.length - 1].at : 0,
    packages: plan && plan.type === 'plan' ? plan.packages : [], events, changes: fr.changes,
    outcome: { before: readinessBy(before), after: after ? readinessBy(after) : readinessBy(before), verdictBefore: before.verdict, verdictAfter: after?.verdict ?? before.verdict },
  };
}

const DISABLED_MSG = 'Live fixing is off on this deployment';
const WORKING = /run|pend|queue|start|prepar|generat|verif|appl|work|propos/i;
const AWAITING = /await|review|ready|propos/i;

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
  const qc = useQueryClient();
  const { signedIn, run: gated } = useGate();
  const cfg = useGetGreenlightConfig();
  const q = useGetAssessment(id, { query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id) } });
  const [wave, setWave] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  // The live fix screen takes over while a run is in flight (or when replaying a finished one).
  const [screen, setScreen] = useState<{ kind: 'live'; fixId: string } | { kind: 'replay'; recording: FixRecording } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const start = useStartFix();
  const fixes = useListFixRuns(id, {
    query: {
      enabled: !!id,
      queryKey: getListFixRunsQueryKey(id),
      refetchInterval: (query) => (query.state.data?.some((f) => WORKING.test(f.status) && !AWAITING.test(f.status) && !f.error) ? 2500 : false),
    },
  });
  const run = q.data;
  const enabled = !!cfg.data?.fixingEnabled;
  const reason = (cfg.data as { fixingDisabledReason?: string } | undefined)?.fixingDisabledReason;
  useEffect(() => {
    if (run && !wave) setWave(run.waves.find((w) => w.fixCount > 0)?.number ?? run.waves[0]?.number ?? 0);
  }, [run, wave]);
  const w = run?.waves.find((x) => x.number === wave);
  const base = run ? tally(run, Object.fromEntries(run.findings.map((f) => [f.key, f.status]))) : null;
  const err = start.error as { message?: string } | null;
  const waveFixes = (fixes.data ?? []).filter((fix) => fix.wave === wave);
  const selectedFix = waveFixes[waveFixes.length - 1];
  const inFlight = (fixes.data ?? []).find((f) => WORKING.test(f.status) && !AWAITING.test(f.status) && !f.error);
  useEffect(() => {
    if (inFlight && !screen && dismissed !== inFlight.id) setScreen({ kind: 'live', fixId: inFlight.id });
  }, [inFlight?.id, screen, dismissed]);
  const verificationId = selectedFix?.verificationRunId;
  const after = useGetAssessment(verificationId ?? '', {
    query: { enabled: !!verificationId, queryKey: getGetAssessmentQueryKey(verificationId ?? '') },
  });
  const reports = useListReports(verificationId ?? '', {
    query: { enabled: !!verificationId, queryKey: getListReportsQueryKey(verificationId ?? '') },
  });
  const verificationPdf = (reports.data ?? []).find((report) => report.formats.includes('pdf'));
  const selectedFinding = after.data?.findings.find((finding) => finding.key === picked) ?? run?.findings.find((finding) => finding.key === picked);

  return (
    <Shell runId={id} runMeta={run ? `${run.projectName} · ${new Date(run.assessedAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}` : undefined}>
      {q.isLoading ? <div className="flex flex-1 items-center p-8"><Skeleton className="h-full w-full" /></div> : q.isError || !run ? <div className="flex flex-1 items-center justify-center"><ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /></div> : screen ? (
        <FixConsole key={screen.kind === 'live' ? screen.fixId : 'replay'} source={screen} project={run.projectName} wave={screen.kind === 'replay' ? screen.recording.wave : wave} onExit={() => { if (screen.kind === 'live') setDismissed(screen.fixId); setScreen(null); qc.invalidateQueries({ queryKey: getListFixRunsQueryKey(id) }); }} />
      ) : (
        <div className="fix-layout">
          <section className="glass fix-status">
            <div className="min-w-0">
              <div className="lbl">FIX AND VERIFY · {run.projectName}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-head text-lg font-semibold">{verificationId && after.data ? 'Verification complete' : selectedFix?.status ?? 'Plan ready'}</span>
                <span className="lbl !normal-case !tracking-normal">{verificationId && after.data ? `${pc(after.data.readiness)}% measured · ${after.data.verdict}` : 'No fresh verification run yet'}</span>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              <a className={`btn !px-2.5 !py-2 text-xs ${selectedFix?.pullRequestUrl ? '' : 'pointer-events-none opacity-40'}`} href={selectedFix?.pullRequestUrl} target="_blank" rel="noreferrer" aria-disabled={!selectedFix?.pullRequestUrl} data-testid="button-review-pr"><GitPullRequest size={14} /> Review pull request</a>
              <button className="btn !px-2.5 !py-2 text-xs" disabled={!selectedFix?.downloadUrl} onClick={() => selectedFix?.downloadUrl && download(selectedFix.downloadUrl)} data-testid="button-fixed-code"><Package size={14} /> Fixed code (.zip)</button>
              <button className="btn !px-2.5 !py-2 text-xs" disabled={!verificationPdf} onClick={() => verificationPdf && download(reportUrl(verificationPdf.url, 'pdf'))} data-testid="button-verification-report"><FileCheck2 size={14} /> Verification report (PDF)</button>
            </div>
          </section>

          <div className="fix-controls">
            {run.waves.map((item) => <button key={item.number} onClick={() => { setWave(item.number); setPicked(null); }} className="lbl rounded-full border px-3 py-1.5 !text-[10px]" style={{ borderColor: wave === item.number ? '#00E5FF' : 'rgba(124,201,232,.3)', background: wave === item.number ? 'rgba(0,229,255,.13)' : 'rgba(11,31,42,.46)' }} data-testid={`button-wave-${item.number}`}>Wave {item.number} · {item.fixCount}</button>)}
            {inFlight && <button className="btn !px-3 !py-1.5 text-xs" onClick={() => { setDismissed(null); setScreen({ kind: 'live', fixId: inFlight.id }); }} data-testid="button-open-console"><MonitorPlay size={14} /> Watch the fix</button>}
            <Link href={`/replay/${DEMO_RECORDING}`} className="btn ml-auto !px-3 !py-1.5 text-xs" data-testid="link-recorded-fix"><MonitorPlay size={14} /> Watch the recorded fix</Link>
            <Link href={`/results/${id}`} className="btn !px-3 !py-1.5 text-xs" data-testid="link-back-results">Back to results</Link>
          </div>

          <div className="fix-columns">
            <section className="glass fix-panel">
              <div className="lbl mb-2 flex-none">What happened · Wave {wave}</div>
              <div className="fix-timeline flex-1 space-y-2 pr-1">
                {w && <div className="space-y-2">
                  {w.fixes.map((f) => <div key={f.key} className="tile p-2.5" data-testid={`card-package-${f.key}`}>
                    <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{f.title}</span><span className="lbl !text-[9px]">{f.kind} · {f.theme}</span></div>
                    <p className="mt-1 text-xs text-[#CFE3EE]">{f.acceptance}</p><div className="lbl mt-1 !text-[9px]">Closes {f.itemKeys.length} requirement{f.itemKeys.length === 1 ? '' : 's'}</div>
                  </div>)}
                  {!w.fixes.length && <p className="text-sm text-[#CFE3EE]">No work packages in this wave.</p>}
                </div>}
                {fixes.isLoading ? <Skeleton className="h-24" /> : fixes.isError ? <ErrorBlock message="Fix runs unavailable." onRetry={() => fixes.refetch()} /> : waveFixes.length ? waveFixes.map((fr) => <FixRunCard key={fr.id} fr={fr} runId={id} baseline={run} onReplay={(recording) => setScreen({ kind: 'replay', recording })} />) : <div className="tile p-3 text-sm text-[#CFE3EE]">No fix run for this wave yet.</div>}
              </div>
            </section>

            <section className="glass fix-panel">
              <div className="mb-2 flex flex-none items-center justify-between gap-2"><div className="lbl">After-fix orbit</div><span className="lbl !text-[9px] !normal-case !tracking-normal">{after.data ? 'Measured verification' : 'Baseline orbit · no fresh verification'}</span></div>
              <div className="fix-orbit flex-1 rounded-2xl border border-[#7CC9E8]/20">
                {after.data ? <OrbitView run={after.data} statuses={Object.fromEntries(after.data.findings.map((f) => [f.key, f.status]))} selected={picked} onPick={setPicked} /> :
                  <OrbitView run={run} statuses={Object.fromEntries(run.findings.map((f) => [f.key, f.status]))} selected={picked} onPick={setPicked} />}
              </div>
              {selectedFinding && <div className="tile mt-2 max-h-24 flex-none overflow-auto p-2 text-xs"><div className="lbl">{selectedFinding.id} · {selectedFinding.statusText}</div><div className="mt-1">{selectedFinding.title}</div><p className="mt-1 text-[#CFE3EE]">{selectedFinding.why}</p></div>}
            </section>

            <section className="glass fix-panel">
              <div className="lbl mb-1 flex-none">Plan vs result</div>
              <p className="mb-3 flex-none text-[10px] text-[#CFE3EE]">Projected is a forecast. Actual appears only after verification.</p>
              <div className="fix-bars flex-1 space-y-3 pr-1">
                {run.standards.map((standard) => {
                  const baseline = pc(standard.readiness);
                  const projected = pc(w?.readiness[standard.id] ?? standard.readiness);
                  const actual = after.data ? pc(after.data.standards.find((item) => item.id === standard.id)?.readiness) : null;
                  return <div key={standard.id} className="space-y-1.5" data-testid={`bars-${standard.id}`}>
                    <div className="font-head text-xs">{standard.short}</div>
                    {[
                      { label: 'Baseline', value: baseline, color: '#7CC9E8' },
                      { label: 'Projected', value: projected, color: '#00E5FF' },
                      ...(actual == null ? [] : [{ label: 'Actual', value: actual, color: '#4FD99A' }]),
                    ].map((bar) => <div key={bar.label} className="flex items-center gap-2 text-[10px]">
                      <span className="w-[58px] text-[#CFE3EE]">{bar.label}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${bar.value}%`, background: bar.color }} /></div><span className="w-8 text-right font-mono">{bar.value}%</span>
                    </div>)}
                  </div>;
                })}
              </div>
              {base && <div className="lbl mt-2 flex-none !text-[9px]">Baseline · {base.failed} failing · {base.partial} partial · {base.blocking} must-fix</div>}
              <div className="mt-3 flex flex-none flex-wrap gap-2">
                <button className="btn !px-2.5 !py-2 text-xs" onClick={() => download(`${import.meta.env.BASE_URL}api/greenlight/runs/${run.id}/reports/fix-prompt?format=md`)} data-testid="button-download-prompt"><FileText size={14} /> Fix prompt (.md)</button>
                <button className="btn btn-primary !px-2.5 !py-2 text-xs" disabled={!enabled || !wave || start.isPending} onClick={() => gated(() => start.mutate({ id, data: { wave } }, { onSuccess: (fr) => { setDismissed(null); setScreen({ kind: 'live', fixId: fr.id }); qc.invalidateQueries({ queryKey: getListFixRunsQueryKey(id) }); } }))} data-testid="button-start-fix">
                  {start.isPending ? 'Starting' : enabled && !signedIn ? 'Sign in to fix' : 'Start AI fix'}
                </button>
              </div>
              {!cfg.isLoading && !enabled && <p className="mt-2 flex-none text-xs" data-testid="text-fix-disabled"><Dot color="#FFA62B" word={DISABLED_MSG} /><span className="mt-1 block text-[10px] text-[#CFE3EE]">{reason || 'The recorded session shows the same run end to end.'} <Link href={`/replay/${DEMO_RECORDING}`} className="underline" style={{ color: '#00E5FF' }}>Watch it</Link>.</span></p>}
              {start.isError && <p className="mt-2 flex-none text-xs"><Dot color="#FF5C6E" word={err?.message || 'Could not start the fix'} />{/expire|working copy|re-?upload/i.test(err?.message ?? '') && <span className="mt-1 block text-[10px]">The working copy expired. <Link href="/start" className="underline">Upload the zip again</Link> to continue.</span>}</p>}
              {selectedFix?.pullRequestUrl && <div className="lbl mt-2 flex-none !text-[9px]">Pull request opened. Greenlight never merges it for you; review and merge it yourself.</div>}
            </section>
          </div>
        </div>
      )}
    </Shell>
  );
}
