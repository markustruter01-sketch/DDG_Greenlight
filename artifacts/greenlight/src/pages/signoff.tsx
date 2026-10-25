import { useMemo, useState } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { Check, Download, FileCheck2, GitPullRequest, Home, Package } from 'lucide-react';
import { getGetAssessmentQueryKey, useGetAssessment } from '@workspace/api-client-react';
import { Shell, DEMO_RECORDING } from '@/components/shell';
import { ErrorBlock, Modal, Skeleton } from '@/components/gl';
import { useAfter } from '@/lib/after';
import { STATUS_WORD, download, reportUrl } from '@/lib/greenlight';
import { fmtClock } from '@/lib/fix-events';

/**
 * Step 6 · Sign-off: the feel-good page. Final percentages for every
 * standard, everything that was fixed, one Export button, back to start.
 */
export default function Signoff() {
  const { id = '' } = useParams<{ id: string }>();
  const search = useSearch();
  const q = useGetAssessment(id, { query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id) } });
  const run = q.data;
  const after = useAfter(run, search);
  const [exportOpen, setExportOpen] = useState(false);
  const changed = useMemo(() => {
    if (!run) return [];
    const by = new Map(run.findings.map((f) => [f.key, f]));
    return after.changedKeys.map((k) => ({ key: k, f: by.get(k), to: after.statusesAfter[k] })).filter((x) => x.f);
  }, [run, after.changedKeys, after.statusesAfter]);
  const greened = changed.filter((x) => /^(L|C)$/.test(x.to ?? '')).length;
  const overallBefore = run ? Math.round(Object.values(after.readinessBefore).reduce((n, v) => n + v, 0) / Math.max(1, Object.keys(after.readinessBefore).length)) : 0;
  const overallAfter = run ? Math.round(Object.values(after.readinessAfter).reduce((n, v) => n + v, 0) / Math.max(1, Object.keys(after.readinessAfter).length)) : 0;
  const nextWave = run?.waves.find((w) => w.number > after.wave && w.fixCount > 0);
  const noSource = run && after.mode == null;

  const guide = {
    steps: ["Export the fixed code. That's the whole job done.", nextWave ? `Come back for wave ${nextWave.number} whenever you're ready` : 'Every wave is done'],
    current: 0,
    tone: 'ok' as const,
  };

  return (
    <Shell runId={id} guide={run && !noSource ? guide : undefined} runMeta={run ? `${run.projectName} · wave ${after.wave || ''} sign-off` : undefined}>
      {q.isLoading || after.loading ? <div className="flex flex-1 items-center p-8"><Skeleton className="h-full w-full" /></div> : q.isError || !run ? <div className="flex flex-1 items-center justify-center"><ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /></div> : noSource ? (
        <div className="plan-layout" style={{ gridTemplateColumns: 'minmax(0,720px)' }}>
          <section className="glass plan-main">
            <div className="lbl">Step 6 of 6 · Sign-off</div>
            <h1 className="font-head text-3xl font-semibold">Nothing to sign off yet</h1>
            <div className="ink p-4 text-sm leading-relaxed" style={{ color: '#EAF3F8' }}>
              <p>This page appears once a wave has been fixed and verified. Start from <Link href={`/plan/${id}`} className="underline" style={{ color: '#00E5FF' }}>Step 3 · Plan</Link>, or see it with <Link href={`/signoff/${id}?after=${DEMO_RECORDING}`} className="underline" style={{ color: '#00E5FF' }}>the recorded fix</Link>.</p>
            </div>
          </section>
        </div>
      ) : (
        <div className="sign-layout">
          <section className="glass plan-main" style={{ borderColor: 'rgba(79,217,154,.6)', boxShadow: '0 8px 32px rgba(0,0,0,.35), 0 0 60px rgba(79,217,154,.18)' }}>
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2" style={{ background: '#1E9E62', borderColor: '#4FD99A', boxShadow: '0 0 30px rgba(79,217,154,.6)' }}><Check size={28} /></span>
              <div><div className="lbl !text-[#4FD99A]">Step 6 of 6 · Signed off</div><h1 className="font-head mt-1 text-3xl font-bold leading-tight">Wave {after.wave} is fixed and proven.</h1></div>
            </div>
            <p className="ink p-3 text-sm leading-relaxed" style={{ color: '#EAF3F8' }}>
              {greened} requirement{greened === 1 ? '' : 's'} went from red or amber to green. Every one was re-checked by the same written rules that found it, on the fixed code{after.tests ? `, with ${after.tests.pass} of ${after.tests.total} tests passing` : ''}. Nothing was merged for you.
            </p>
            <div className="ink flex flex-col gap-2.5 p-3.5">
              <div className="lbl !text-[10px]">Final readiness · wave {after.wave}</div>
              {Object.keys(after.readinessAfter).map((k) => {
                const b = after.readinessBefore[k] ?? 0, a = after.readinessAfter[k] ?? b;
                return (
                  <div key={k} className="grid items-center gap-3 text-sm" style={{ gridTemplateColumns: '130px minmax(0,1fr) 110px' }} data-testid={`final-${k}`}>
                    <span className="font-head font-semibold">{k}</span>
                    <div className="bar" style={{ overflow: 'hidden' }}><i style={{ width: `${a}%`, background: a > b ? '#4FD99A' : '#7CC9E8' }} /></div>
                    <span className="text-right font-mono tabular">{b} → <b style={{ color: a > b ? '#4FD99A' : '#F7FBFF' }}>{a}%</b></span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between border-t pt-2 text-sm" style={{ borderColor: 'rgba(255,255,255,.15)' }}><span className="font-head font-semibold">Overall</span><span className="font-mono tabular">{overallBefore}% → <b style={{ color: '#4FD99A', fontSize: 17 }}>{overallAfter}%</b></span></div>
            </div>
            <div className="mt-auto flex flex-col gap-2">
              <button className="btn btn-go justify-center !py-4 text-lg font-semibold" onClick={() => setExportOpen(true)} data-testid="button-export"><Download size={18} /> Export the fixed code</button>
              <span className="lbl text-center !text-[9px]">Pull request on GitHub · or a .zip of the fixed repository</span>
              <div className="flex gap-2">
                <button className="btn flex-1 justify-center text-xs" disabled={!after.verificationPdfUrl} onClick={() => after.verificationPdfUrl && download(reportUrl(after.verificationPdfUrl, 'pdf'))} data-testid="button-verification-report"><FileCheck2 size={14} /> Verification report (PDF)</button>
                <Link href="/start" className="btn flex-1 justify-center text-xs" data-testid="link-back-start"><Home size={14} /> Back to start</Link>
              </div>
            </div>
          </section>

          <section className="glass plan-main">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-head text-lg font-semibold">Everything that was fixed</span><span className="lbl">{changed.length} requirement{changed.length === 1 ? '' : 's'} · {after.filesChanged} files</span></div>
            <div className="ink plan-list !gap-0 px-1.5 py-1" data-testid="fixed-list">
              <div className="sign-row lbl !text-[9px]"><span /><span>Requirement</span><span>What it asks for</span><span className="text-right">Now</span></div>
              {changed.map(({ key, f, to }) => {
                const ok = /^(L|C)$/.test(to ?? '');
                return (
                  <div key={key} className="sign-row" data-testid={`fixed-${key}`}>
                    <span style={{ color: ok ? '#4FD99A' : '#FFA62B' }}>{ok ? '✓' : '◐'}</span>
                    <span className="id">{f!.standardShort} {f!.id}</span>
                    <span className="truncate" title={f!.title}>{f!.title}</span>
                    <span className="text-right" style={{ color: ok ? '#4FD99A' : '#FFA62B' }}>{STATUS_WORD[to ?? ''] ?? to}</span>
                  </div>
                );
              })}
              {!changed.length && <div className="sign-row" style={{ borderBottom: 0 }}><span /><span className="id">—</span><span style={{ color: '#B9DCEA' }}>No requirement changed status in this wave.</span><span /></div>}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="ink px-3 py-2 text-xs"><b style={{ color: '#4FD99A' }}>+{after.linesAdded.toLocaleString()}</b> lines added</span>
              <span className="ink px-3 py-2 text-xs"><b style={{ color: '#FF8C9A' }}>−{after.linesRemoved.toLocaleString()}</b> removed</span>
              <span className="ink px-3 py-2 text-xs"><b>{after.filesChanged}</b> files changed</span>
              {after.tests && <span className="ink px-3 py-2 text-xs"><b>{after.tests.pass.toLocaleString()} / {after.tests.total.toLocaleString()}</b> tests pass</span>}
              {(after.durationMs || after.costUsd != null) && <span className="ink px-3 py-2 text-xs">{after.durationMs ? <b>{fmtClock(after.durationMs)}</b> : null}{after.durationMs && after.costUsd != null ? ' · ' : ''}{after.costUsd != null ? <b>${after.costUsd.toFixed(2)}</b> : null}</span>}
              {nextWave && <Link href={`/plan/${id}`} className="ink ml-auto px-3 py-2 text-xs" style={{ borderColor: 'rgba(0,229,255,.5)' }} data-testid="link-next-wave">Next · <b style={{ color: '#00E5FF' }}>Wave {nextWave.number}</b> · {nextWave.fixCount} fixes</Link>}
            </div>
          </section>
        </div>
      )}

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="Export the fixed code">
        <div className="space-y-2">
          {after.mode === 'fix' ? (
            <>
              <a className={`btn btn-primary w-full justify-center !py-3 ${after.pullRequestUrl ? '' : 'pointer-events-none opacity-40'}`} href={after.pullRequestUrl ?? undefined} target="_blank" rel="noreferrer" data-testid="button-export-pr"><GitPullRequest size={16} /> Open the pull request on GitHub</a>
              <button className="btn w-full justify-center !py-3" disabled={!after.downloadUrl} onClick={() => after.downloadUrl && download(after.downloadUrl)} data-testid="button-export-zip"><Package size={16} /> Download the fixed repository (.zip)</button>
              <p className="ink p-3 text-xs leading-relaxed" style={{ color: '#EAF3F8' }}>The pull request contains only the files you approved. Greenlight never merges; your team reviews and merges it.</p>
            </>
          ) : (
            <p className="ink p-3 text-sm leading-relaxed" style={{ color: '#EAF3F8' }}>This is the recorded session, so there is no pull request to open. On a live run this button opens the pull request on GitHub or downloads the fixed repository as a zip. <Link href={`/replay/${DEMO_RECORDING}`} className="underline" style={{ color: '#00E5FF' }}>Replay the session</Link> to see the changes it made.</p>
          )}
        </div>
      </Modal>
    </Shell>
  );
}
