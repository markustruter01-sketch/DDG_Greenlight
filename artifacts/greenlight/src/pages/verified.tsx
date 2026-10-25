import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { FileCheck2, GitPullRequest, Package, PenLine } from 'lucide-react';
import { getGetAssessmentQueryKey, useGetAssessment } from '@workspace/api-client-react';
import { Shell, DEMO_RECORDING } from '@/components/shell';
import { ErrorBlock, Skeleton } from '@/components/gl';
import { OrbitView } from '@/components/orbit-view';
import { useAfter } from '@/lib/after';
import { download, reportUrl, tally } from '@/lib/greenlight';
import { fmtClock } from '@/lib/fix-events';

/**
 * Step 5 · Verified: before → after, measured by the same rules. The orbit
 * shows the baseline for a moment, then the clauses the fix closed turn green.
 */
export default function Verified() {
  const { id = '' } = useParams<{ id: string }>();
  const search = useSearch();
  const q = useGetAssessment(id, { query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id) } });
  const run = q.data;
  const after = useAfter(run, search);
  const [showAfter, setShowAfter] = useState(true);
  const [applied, setApplied] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (after.mode == null || after.loading) return;
    const t = window.setTimeout(() => setApplied(true), 1400);
    return () => clearTimeout(t);
  }, [after.mode, after.loading]);
  const statuses = showAfter && applied ? after.statusesAfter : after.statusesBefore;
  const counts = useMemo(() => (run ? tally(run, after.statusesAfter) : null), [run, after.statusesAfter]);
  const greened = after.changedKeys.filter((k) => /^(L|C)$/.test(after.statusesAfter[k] ?? '')).length;
  const noSource = run && after.mode == null;
  const nextWave = run?.waves.find((w) => w.number > after.wave && w.fixCount > 0);

  const guide = {
    steps: [
      after.mode === 'recording' ? 'This is the recorded run. The orbit turns green where the fix closed a clause.' : 'Open the pull request and merge it when your team is happy. Greenlight never merges for you.',
      'Download the verification report for your assurance file',
      'Go to Step 6 to sign the wave off',
    ],
    current: 0,
    tone: 'ok' as const,
  };

  return (
    <Shell runId={id} guide={run && !noSource ? guide : undefined} runMeta={run ? `${run.projectName} · wave ${after.wave || ''} verified` : undefined}>
      {q.isLoading || after.loading ? <div className="flex flex-1 items-center p-8"><Skeleton className="h-full w-full" /></div> : q.isError || !run ? <div className="flex flex-1 items-center justify-center"><ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /></div> : noSource ? (
        <div className="plan-layout" style={{ gridTemplateColumns: 'minmax(0,720px)' }}>
          <section className="glass plan-main">
            <div className="lbl">Step 5 of 6 · Verified</div>
            <h1 className="font-head text-3xl font-semibold">Nothing verified yet</h1>
            <div className="ink p-4 text-sm leading-relaxed" style={{ color: '#EAF3F8' }}>
              <p>A wave is verified when Claude's changes have been approved and the same written rules have checked the fixed code again. That has not happened for this assessment.</p>
              <p className="mt-2">Start from <Link href={`/plan/${id}`} className="underline" style={{ color: '#00E5FF' }}>Step 3 · Plan</Link>, or see what a verified wave looks like with <Link href={`/verified/${id}?after=${DEMO_RECORDING}`} className="underline" style={{ color: '#00E5FF' }}>the recorded fix</Link>.</p>
            </div>
          </section>
        </div>
      ) : (
        <div className="ver-layout">
          <section className="glass ver-col">
            <div className="lbl">Step 5 of 6 · Before → after, measured</div>
            {Object.keys(after.readinessAfter).map((k) => {
              const b = after.readinessBefore[k] ?? 0, a = after.readinessAfter[k] ?? b;
              const ceil = Math.max(a, Math.round(((run.waves[run.waves.length - 1]?.readiness ?? {})[run.standards.find((s) => s.short === k)?.id ?? ''] ?? 0) * 100));
              return (
                <div key={k} className="ink p-3" data-testid={`after-${k}`}>
                  <div className="lbl !text-[10px]">{k}</div>
                  <div className="mt-1 flex items-baseline gap-2"><span className="big" style={{ fontSize: 28, color: '#EAF3F8' }}>{b}%</span><span className="text-xl">→</span><span className="big" style={{ color: a > b ? '#4FD99A' : '#F7FBFF' }}>{a}%</span></div>
                  <div className="bar mt-2"><i style={{ width: `${a}%`, background: '#4FD99A' }} />{ceil > a && <span className="tick" style={{ left: `${ceil}%` }} title={`Code can reach ${ceil}%`} />}</div>
                  <div className="lbl mt-1.5 !text-[9px]">{a > b ? `+${a - b} points` : 'No change'}{ceil > a ? ` · code can reach ${ceil}% · the rest is process evidence` : ''}</div>
                </div>
              );
            })}
            <div className="ink mt-auto p-3 text-xs leading-relaxed" style={{ color: '#EAF3F8' }}>
              <b style={{ color: '#4FD99A' }}>{greened}</b> clause{greened === 1 ? '' : 's'} turned green · {after.filesChanged} files changed · <b style={{ color: '#4FD99A' }}>+{after.linesAdded.toLocaleString()}</b> / <b style={{ color: '#FF8C9A' }}>−{after.linesRemoved.toLocaleString()}</b> lines{after.tests ? ` · ${after.tests.pass} of ${after.tests.total} tests pass` : ''}{after.durationMs ? ` · ${fmtClock(after.durationMs)}` : ''}{after.costUsd != null ? ` · $${after.costUsd.toFixed(2)}` : ''}
              <br />{after.verdictBefore} → <b style={{ color: /ready|clear/i.test(after.verdictAfter) && !/not/i.test(after.verdictAfter) ? '#4FD99A' : '#F7FBFF' }}>{after.verdictAfter}</b>{counts ? ` · ${counts.blocking} must-fix left for the next waves` : ''}
            </div>
          </section>

          <section className="glass relative overflow-hidden" style={{ minHeight: 0 }}>
            <div className="absolute left-4 top-3 z-10 lbl">{after.mode === 'recording' ? 'After-fix orbit · recorded run' : 'After-fix orbit · measured'}</div>
            <div className="absolute right-3 top-3 z-10 flex gap-1.5">
              <button className={`btn !px-3 !py-1.5 text-xs ${showAfter ? '' : 'fc-on'}`} onClick={() => setShowAfter(false)} data-testid="button-show-before">Before</button>
              <button className={`btn !px-3 !py-1.5 text-xs ${showAfter ? 'fc-on' : ''}`} onClick={() => { setShowAfter(true); setApplied(true); }} data-testid="button-show-after">After</button>
            </div>
            <div className="h-full w-full"><OrbitView run={run} statuses={statuses} selected={picked} onPick={setPicked} /></div>
          </section>

          <aside className="glass ver-col">
            <div className="lbl">Your outputs</div>
            {after.mode === 'fix' ? (
              <>
                <a className={`btn btn-primary justify-center !py-3.5 text-base ${after.pullRequestUrl ? '' : 'pointer-events-none opacity-40'}`} href={after.pullRequestUrl ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!after.pullRequestUrl} data-testid="button-review-pr"><GitPullRequest size={16} /> Review the pull request</a>
                <button className="btn justify-center" disabled={!after.downloadUrl} onClick={() => after.downloadUrl && download(after.downloadUrl)} data-testid="button-fixed-code"><Package size={15} /> Fixed code (.zip)</button>
                <button className="btn justify-center" disabled={!after.verificationPdfUrl} onClick={() => after.verificationPdfUrl && download(reportUrl(after.verificationPdfUrl, 'pdf'))} data-testid="button-verification-report"><FileCheck2 size={15} /> Verification report (PDF)</button>
              </>
            ) : (
              <div className="ink p-3 text-xs leading-relaxed" style={{ color: '#EAF3F8' }}><span className="lbl !text-[#FFA62B]">Recorded session</span><br />On a live run this panel holds the pull request, the fixed code as a zip and the signed verification report. <Link href={`/replay/${DEMO_RECORDING}`} className="underline" style={{ color: '#00E5FF' }}>Replay the session</Link>.</div>
            )}
            <div className="ink p-3 text-xs leading-relaxed" style={{ color: '#EAF3F8' }}><span className="lbl !text-[#4FD99A]">What the report says</span><br />Every requirement that changed, the rule that re-checked it, the file and line, and the commit. Signed by the engine version, not by a model.</div>
            <div className="ink mt-auto flex flex-col gap-2 p-3" style={{ borderColor: 'rgba(0,229,255,.5)' }}>
              <span className="lbl !text-[#00E5FF]">Next</span>
              <Link href={`/signoff/${id}${search}`} className="btn btn-go justify-center !py-3 text-base" data-testid="link-signoff"><PenLine size={16} /> Sign this wave off</Link>
              {nextWave && <Link href={`/plan/${id}`} className="btn justify-center text-xs" data-testid="link-next-wave">Then wave {nextWave.number} · {nextWave.fixCount} fixes</Link>}
            </div>
          </aside>
        </div>
      )}
    </Shell>
  );
}
