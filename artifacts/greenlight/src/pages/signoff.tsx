import { useMemo, useState } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { ArrowRight, Download, FileCheck2, FileSearch, FileSpreadsheet, GitPullRequest, Package, Table2 } from 'lucide-react';
import { getGetAssessmentQueryKey, getListReportsQueryKey, useGetAssessment, useListReports } from '@workspace/api-client-react';
import { Shell, DEMO_RECORDING, DEMO_WAVES } from '@/components/shell';
import { WaveSwitch } from '@/components/wave-switch';
import { ErrorBlock, Modal, Skeleton } from '@/components/gl';
import { useAfter } from '@/lib/after';
import { STATUS_WORD, download, reportUrl } from '@/lib/greenlight';
import { plainName } from '@/lib/standard-info';
import { fmtClock } from '@/lib/fix-events';
import { downloadAuditCsv, openAuditDocument } from '@/lib/audit-doc';

/**
 * Step 7 · Done: the number, everything that was fixed, and what you can take
 * away: pull requests, the zip, the report, the clause-by-clause sheet.
 */
export default function Signoff() {
  const { id = '' } = useParams<{ id: string }>();
  const search = useSearch();
  const q = useGetAssessment(id, { query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id) } });
  const run = q.data;
  const after = useAfter(run, search);
  const reports = useListReports(id, { query: { enabled: !!id, queryKey: getListReportsQueryKey(id) } });
  const afterParam = useMemo(() => new URLSearchParams(search).get('after'), [search]);
  const recWaves = afterParam ? DEMO_WAVES.filter((w) => afterParam.split(',').includes(w.name)) : [];
  const [exportOpen, setExportOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const changed = useMemo(() => {
    if (!run) return [];
    const by = new Map(run.findings.map((f) => [f.key, f]));
    return after.changedKeys.map((k) => ({ key: k, f: by.get(k), to: after.statusesAfter[k] })).filter((x) => x.f);
  }, [run, after.changedKeys, after.statusesAfter]);
  const greened = changed.filter((x) => /^(L|C)$/.test(x.to ?? '')).length;
  const keys = Object.keys(after.readinessAfter);
  const avg = (m: Record<string, number>) => Math.round(keys.reduce((n, v) => n + (m[v] ?? 0), 0) / Math.max(1, keys.length));
  const before = avg(after.readinessBefore), now = avg(after.readinessAfter);
  const left = run ? run.findings.filter((f) => f.status === 'UN').length : 0;
  const nextWave = run?.waves.find((w) => w.number > after.wave && w.fixCount > 0);
  const noSource = run && after.mode == null;
  const idOf = (short: string) => run?.standards.find((s) => s.short === short)?.id ?? short;
  const report = (fmt: string) => { const all = (reports.data ?? []).filter((r) => r.formats.includes(fmt)); return all.find((r) => r.kind === 'verification') ?? all.find((r) => r.kind === 'findings') ?? all[0]; };
  const prs = after.mode === 'fix' ? (after.pullRequestUrl ? [{ wave: after.wave, url: after.pullRequestUrl }] : []) : recWaves.filter((w) => w.pullRequest).map((w) => ({ wave: w.wave, url: w.pullRequest! }));

  const guide = { steps: ['Export the fixed code. That is the whole job done.', nextWave ? `Come back for round ${nextWave.number} whenever you are ready` : 'Every round is done'], current: 0, tone: 'ok' as const };

  return (
    <Shell runId={id} guide={run && !noSource ? guide : undefined} roadDone={!!run && !noSource} runMeta={run ? `${run.projectName} · done` : undefined} pip={run && !noSource ? { id: 'done', corner: 'br', what: 'Done. Everything you can take away is on the right.', press: 'Press Export the fixed code.', target: '[data-testid="button-export"]', also: `Answer the ${left} takes you to the questions only a person can answer.` } : null}>
      <div className="jl">
        {q.isLoading ? <Skeleton className="h-80 w-full" /> : q.isError || !run ? <ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /> : after.loading ? (
          <section className="glass jcard is-ok" data-testid="screen-done-loading"><h1 className="jh" style={{ fontSize: 48 }}>You made it.</h1><p className="jp">Adding up what was fixed…</p><Skeleton className="h-40 w-full" /></section>
        ) : noSource ? (
          <section className="glass jcard" data-testid="screen-done-empty">
            <h1 className="jh">Nothing to sign off yet.</h1>
            <p className="jp">This screen appears once a round has been fixed and proven. Start from the plan, or see it with the recorded fix.</p>
            <div className="flex flex-wrap gap-3"><Link href={`/plan/${id}`} className="btn btn-go btn-big" data-testid="link-plan">Go to the plan <ArrowRight size={20} /></Link><Link href={`/signoff/${id}?after=${DEMO_RECORDING}`} className="btn btn-quiet" data-testid="link-recorded-signoff">See the recorded sign-off</Link></div>
          </section>
        ) : (
          <section className="glass jcard is-ok" style={{ boxShadow: '0 20px 60px rgba(0,0,0,.35), 0 0 60px rgba(79,217,154,.15)' }} data-testid="screen-done">
            <div className="jsplit" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
              <div className="flex min-w-0 flex-col gap-3">
                <h1 className="jh" style={{ fontSize: 48 }}>You made it.</h1>
                <p className="jp" data-testid="text-done-summary">{run.projectName} went from <b style={{ color: '#8A939B' }}>{before}%</b> to <b style={{ color: '#4FD99A' }}>{now}%</b>. {greened} fix{greened === 1 ? '' : 'es'}, every one checked by code and approved by you.{left ? ` The last ${left} are questions only your team can answer: the standards ask for sign-offs, documents and decisions a person must make. Code can't do those, and shouldn't.` : ''}</p>
                <WaveSwitch page="signoff" runId={id} after={afterParam} />
                <div className="flex flex-col items-start gap-3">
                  <button className="btn btn-go btn-big" style={{ fontSize: 24, padding: '20px 36px' }} onClick={() => setExportOpen(true)} data-testid="button-export"><Download size={22} /> Export the fixed code</button>
                  <div className="flex flex-wrap gap-2">
                    {left > 0 && <Link href={`/orbit/${id}?answers`} className="btn btn-quiet" data-testid="link-answers">Answer the {left}</Link>}
                    <button className="btn btn-quiet" onClick={() => setListOpen(true)} data-testid="button-fixed-list"><Table2 size={15} /> Everything that was fixed</button>
                    {nextWave && <Link href={`/plan/${id}`} className="btn btn-quiet" data-testid="link-next-wave">Round {nextWave.number} next · {nextWave.fixCount} fixes</Link>}
                    <Link href="/start" className="btn btn-quiet" data-testid="link-back-start">Start again</Link>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                <span className="jnote">What you can take away</span>
                {prs.map((p) => <a key={p.url} className="jout" href={p.url} target="_blank" rel="noreferrer" data-testid={`link-pr-${p.wave}`}><GitPullRequest size={18} style={{ color: '#4FD99A' }} /> Round {p.wave} as a pull request on your GitHub</a>)}
                {!prs.length && <span className="jout" style={{ opacity: .6 }}><GitPullRequest size={18} /> No pull request for this run</span>}
                <button className="jout" disabled={!after.downloadUrl} onClick={() => after.downloadUrl && download(after.downloadUrl)} data-testid="button-export-zip"><Package size={18} style={{ color: '#7CC9E8' }} /> The fixed code as a zip{after.downloadUrl ? '' : ' · live runs only'}</button>
                <button className="jout" onClick={() => openAuditDocument(run, after, download)} data-testid="button-audit-document"><FileSearch size={18} style={{ color: '#00E5FF' }} /> The audit document: every requirement and every line changed, before and after</button>
                <button className="jout" disabled={!after.verificationPdfUrl && !report('pdf')} onClick={() => { const u = after.verificationPdfUrl ?? report('pdf')?.url; if (u) download(reportUrl(u, 'pdf')); }} data-testid="button-verification-report"><FileCheck2 size={18} style={{ color: '#FFA62B' }} /> The report for your assurance team (PDF)</button>
                <button className="jout" onClick={() => downloadAuditCsv(run, after, download)} data-testid="button-trace-sheet"><FileSpreadsheet size={18} style={{ color: '#B9C3CC' }} /> Every requirement, before and after, as a spreadsheet</button>
                <span className="jnote" style={{ marginTop: 6 }}>{after.filesChanged} files · <span style={{ color: '#4FD99A' }}>+{after.linesAdded.toLocaleString()}</span> / <span style={{ color: '#FF8C9A' }}>−{after.linesRemoved.toLocaleString()}</span>{after.tests ? ` · ${after.tests.pass.toLocaleString()} / ${after.tests.total.toLocaleString()} tests` : ''}{after.durationMs ? ` · ${fmtClock(after.durationMs)}` : ''}{after.costUsd != null ? ` · $${after.costUsd.toFixed(2)}` : ''}</span>
              </div>
            </div>
          </section>
        )}
      </div>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="Export the fixed code">
        <div className="space-y-2">
          {prs.map((p) => <a key={p.url} className="btn btn-primary w-full justify-center !py-3" href={p.url} target="_blank" rel="noreferrer" data-testid={`button-export-pr-${p.wave}`}><GitPullRequest size={16} /> Round {p.wave} · open the pull request on GitHub</a>)}
          <button className="btn w-full justify-center !py-3" disabled={!after.downloadUrl} onClick={() => after.downloadUrl && download(after.downloadUrl)} data-testid="button-export-zip-modal"><Package size={16} /> Download the fixed repository (.zip)</button>
          <p className="ink p-3 text-sm leading-relaxed" style={{ color: '#EAF3F8' }}>{prs.length ? 'Each pull request holds exactly the files that round changed, opened on the real repository. Greenlight never merges; your team reviews and merges it.' : 'This run has no pull request. '}{after.mode === 'recording' ? ' On a live run this also downloads the fixed repository as a zip.' : ''}</p>
        </div>
      </Modal>

      <Modal open={listOpen} onClose={() => setListOpen(false)} title={`Everything that was fixed · ${changed.length}`} wide>
        <div className="jfixed" data-testid="fixed-list">
          <div className="sign-row lbl !text-[9px]"><span /><span>Requirement</span><span>What it asks for</span><span className="text-right">Now</span></div>
          {changed.map(({ key, f, to }) => {
            const ok = /^(L|C)$/.test(to ?? '');
            return (
              <div key={key} className="sign-row" data-testid={`fixed-${key}`}>
                <span style={{ color: ok ? '#4FD99A' : '#FFA62B' }}>{ok ? '✓' : '◐'}</span>
                <span className="id">{plainName(idOf(f!.standardShort), f!.standardShort)} {f!.id}</span>
                <span className="truncate" title={f!.title}>{f!.title}</span>
                <span className="text-right" style={{ color: ok ? '#4FD99A' : '#FFA62B' }}>{STATUS_WORD[to ?? ''] ?? to}</span>
              </div>
            );
          })}
          {!changed.length && <div className="sign-row" style={{ borderBottom: 0 }}><span /><span className="id">—</span><span style={{ color: '#B9DCEA' }}>No requirement changed status in this round.</span><span /></div>}
        </div>
      </Modal>
    </Shell>
  );
}
