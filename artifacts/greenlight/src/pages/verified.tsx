import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { ArrowRight, FileCheck2, GitPullRequest, Orbit as OrbitIcon, Package } from 'lucide-react';
import { getGetAssessmentQueryKey, useGetAssessment } from '@workspace/api-client-react';
import { Shell, DEMO_RECORDING, DEMO_WAVES } from '@/components/shell';
import { WaveSwitch } from '@/components/wave-switch';
import { ErrorBlock, Skeleton } from '@/components/gl';
import { useAfter } from '@/lib/after';
import { download, reportUrl, tally } from '@/lib/greenlight';
import { plainName } from '@/lib/standard-info';
import { fmtClock } from '@/lib/fix-events';

const colorFor = (v: number) => (v < 40 ? '#FF5C6E' : v < 75 ? '#FFA62B' : '#4FD99A');

/**
 * Step 6 · Proof: before → after, measured by the same rules. The bars grow
 * from the old number to the new one a moment after the screen opens.
 */
export default function Verified() {
  const { id = '' } = useParams<{ id: string }>();
  const search = useSearch();
  const q = useGetAssessment(id, { query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id) } });
  const run = q.data;
  const after = useAfter(run, search);
  const afterParam = useMemo(() => new URLSearchParams(search).get('after'), [search]);
  const lastRec = afterParam ? DEMO_WAVES.find((w) => w.name === afterParam.split(',').pop()) : undefined;
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (after.mode == null || after.loading) return;
    const t = window.setTimeout(() => setApplied(true), 600);
    return () => clearTimeout(t);
  }, [after.mode, after.loading]);
  const counts = useMemo(() => (run ? tally(run, after.statusesAfter) : null), [run, after.statusesAfter]);
  const greened = after.changedKeys.filter((k) => /^(L|C)$/.test(after.statusesAfter[k] ?? '')).length;
  const noSource = run && after.mode == null;
  const keys = Object.keys(after.readinessAfter);
  const avg = (m: Record<string, number>) => Math.round(keys.reduce((n, k) => n + (m[k] ?? 0), 0) / Math.max(1, keys.length));
  const before = avg(after.readinessBefore), now = avg(after.readinessAfter);
  const idOf = (short: string) => run?.standards.find((s) => s.short === short)?.id ?? short;
  const orbitHref = `/orbit/${id}${afterParam ? `?after=${encodeURIComponent(afterParam.split(',').pop() ?? '')}` : ''}`;

  const guide = {
    steps: [after.mode === 'recording' ? 'This is the recorded run. The number is measured by the same code that found the problems.' : 'Open the pull request and merge it when your team is happy. Nothing is merged for you.', 'Press Sign it off'],
    current: 0,
    tone: 'ok' as const,
  };

  return (
    <Shell runId={id} guide={run && !noSource ? guide : undefined} runMeta={run ? `${run.projectName} · proof` : undefined} coach={run && !noSource ? (afterParam && !afterParam.includes(',') && DEMO_WAVES.length > 1 ? { id: 'proof-all', text: 'Press All rounds.', target: '[data-testid="button-waves-all-rounds"]' } : { id: 'proof', text: 'Press Sign it off.', target: '[data-testid="link-signoff"]' }) : null}>
      <div className="jl">
        {q.isLoading || after.loading ? <Skeleton className="h-80 w-full" /> : q.isError || !run ? <ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /> : noSource ? (
          <section className="glass jcard" data-testid="screen-proof-empty">
            <h1 className="jh">Nothing to prove yet.</h1>
            <p className="jp">A round is proven when its changes have been kept and the same written rules have checked the fixed code again. That has not happened for this project yet.</p>
            <div className="flex flex-wrap gap-3"><Link href={`/plan/${id}`} className="btn btn-go btn-big" data-testid="link-plan">Go to the plan <ArrowRight size={20} /></Link><Link href={`/verified/${id}?after=${DEMO_RECORDING}`} className="btn btn-quiet" data-testid="link-recorded-proof">See the recorded proof</Link></div>
          </section>
        ) : (
          <section className="glass jcard is-ok" data-testid="screen-proof">
            <div className="jsplit">
              <div className="flex min-w-0 flex-col gap-3">
                <span className="jnote">Checked again by the same code{after.durationMs ? ` · fix took ${fmtClock(after.durationMs)}` : ''}</span>
                <h1 className="jh">Checked again. Proven.</h1>
                <div className="flex items-center gap-4"><span className="jbig" style={{ color: '#8A939B', fontSize: 84 }} data-testid="text-before">{before}%</span><span style={{ fontSize: 40, color: '#4FD99A' }}>→</span><span className="jbig" style={{ color: colorFor(now), fontSize: 84 }} data-testid="text-after">{applied ? now : before}%</span></div>
                <p className="jp" data-testid="text-proof-summary">{greened} problem{greened === 1 ? '' : 's'} gone{counts ? ` · ${counts.unanswered} need your answers` : ''}{after.tests ? ` · ${after.tests.pass.toLocaleString()} of ${after.tests.total.toLocaleString()} tests pass` : ''}{after.filesChanged ? ` · ${after.filesChanged} files` : ''}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/signoff/${id}${search ? `?${search.replace(/^\?/, '')}` : ''}`} className="btn btn-go btn-big" data-testid="link-signoff">Sign it off <ArrowRight size={20} /></Link>
                  <Link href={orbitHref} className="btn btn-quiet" data-testid="link-before-after"><OrbitIcon size={15} /> Before and after on the planet</Link>
                </div>
                <div className="flex flex-wrap gap-2">
                  {after.mode === 'fix' ? (
                    <>
                      {after.pullRequestUrl && <a className="btn btn-quiet" href={after.pullRequestUrl} target="_blank" rel="noreferrer" data-testid="button-review-pr"><GitPullRequest size={15} /> The pull request</a>}
                      {after.downloadUrl && <button className="btn btn-quiet" onClick={() => after.downloadUrl && download(after.downloadUrl)} data-testid="button-fixed-code"><Package size={15} /> Fixed code (.zip)</button>}
                      {after.verificationPdfUrl && <button className="btn btn-quiet" onClick={() => after.verificationPdfUrl && download(reportUrl(after.verificationPdfUrl, 'pdf'))} data-testid="button-verification-report"><FileCheck2 size={15} /> Verification report (PDF)</button>}
                    </>
                  ) : lastRec?.pullRequest ? <a className="btn btn-quiet" href={lastRec.pullRequest} target="_blank" rel="noreferrer" data-testid="button-review-pr"><GitPullRequest size={15} /> The pull request for round {lastRec.wave}</a> : null}
                </div>
              </div>
              <div className="jbars">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="jnote">Per standard · before → after</span><WaveSwitch page="verified" runId={id} after={afterParam} /></div>
                {keys.map((k) => {
                  const b = after.readinessBefore[k] ?? 0, a = after.readinessAfter[k] ?? b;
                  return (
                    <div key={k} className="jbar" data-testid={`after-${k}`}>
                      <span className="truncate">{plainName(idOf(k), k)}</span>
                      <div className="track"><i style={{ width: `${applied ? a : b}%`, background: colorFor(applied ? a : b) }} /><i style={{ width: `${Math.min(a, b)}%`, background: 'rgba(255,255,255,.3)' }} /></div>
                      <b>{b} → <span style={{ color: a > b ? '#4FD99A' : '#F7FBFF' }}>{a}</span></b>
                    </div>
                  );
                })}
                <span className="jnote">Grey = before · colour = now · the rest needs a person, not code</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </Shell>
  );
}
