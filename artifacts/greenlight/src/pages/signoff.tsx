import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { ArrowRight, Download, Eye, FileCheck2, FileSearch, FileSpreadsheet, GitPullRequest, Package, ShieldAlert, Table2 } from 'lucide-react';
import { getGetAssessmentQueryKey, getListReportsQueryKey, useGetAssessment, useListReports } from '@workspace/api-client-react';
import type { AssessmentRun, Report } from '@workspace/api-client-react';
import { Shell, DEMO_RECORDING, DEMO_WAVES } from '@/components/shell';
import { ErrorBlock, Modal, Skeleton } from '@/components/gl';
import { useAfter, type AfterView } from '@/lib/after';
import { STATUS_WORD, countFiles, download, isGood, reportUrl } from '@/lib/greenlight';
import { STANDARD_INFO, levelDisplay, plainName } from '@/lib/standard-info';
import { fmtClock } from '@/lib/fix-events';
import { downloadAuditCsv, openAuditDocument } from '@/lib/audit-doc';
import { buildFinalReport, riskRegisterCsv, type FinalReport, type RiskRating } from '@/lib/final-report';
import { PdfViewer, afterReport } from '@/components/reports';

const PAGES = 5;
const RISK_COLOR: Record<RiskRating, string> = { High: '#C2283B', Medium: '#B86A00', Low: '#5B6770' };
const STATUS_INK: Record<string, string> = { C: '#1E8F5B', L: '#1E8F5B', P: '#B86A00', N: '#8E3A8E', UN: '#5B6770', NA: '#9AA3AA' };

/**
 * Step 7 · Done: the report itself, as a page you scroll. It starts with one
 * number and gets more detailed as you go down: the verdict, then each
 * standard, then what was fixed, then the risks left, then every requirement.
 * Everything you can take away sits in the rail beside it.
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
  const [viewReport, setViewReport] = useState<Report | null>(null);
  const noSource = run && after.mode == null;
  const r = useMemo(() => (run && !after.loading && after.mode ? buildFinalReport(run, after) : null), [run, after]);
  const changed = useMemo(() => {
    if (!run) return [];
    const by = new Map(run.findings.map((f) => [f.key, f]));
    return after.changedKeys.map((k) => ({ key: k, f: by.get(k), to: after.statusesAfter[k] })).filter((x) => x.f);
  }, [run, after.changedKeys, after.statusesAfter]);
  const nextWave = run?.waves.find((w) => w.number > after.wave && w.fixCount > 0);
  const prs = after.mode === 'fix' ? (after.pullRequestUrl ? [{ wave: after.wave, url: after.pullRequestUrl }] : []) : recWaves.filter((w) => w.pullRequest).map((w) => ({ wave: w.wave, url: w.pullRequest! }));
  const verification: Report | null = after.mode === 'recording' && afterParam ? afterReport(id, afterParam) : null;
  const verificationPdf = () => { if (verification) return download(reportUrl(verification.url, 'pdf')); if (after.verificationPdfUrl) download(reportUrl(after.verificationPdfUrl, 'pdf')); };
  const riskCsv = () => {
    if (!run || !r) return;
    const url = URL.createObjectURL(new Blob(['﻿' + riskRegisterCsv(run.projectName, r)], { type: 'text/csv;charset=utf-8' }));
    download(url, `${run.projectName}-risk-register.csv`);
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <Shell runId={id} reportsAfter={after.mode === 'recording' ? afterParam : null} roadDone={!!run && !noSource} runMeta={run ? `${run.projectName} · report` : undefined} pip={r ? { id: 'report', what: 'Your report. Scroll down: it starts simple and gets more detailed.', press: 'Press Export the fixed code.', target: '[data-testid="button-export"]', also: 'Every download is in the rail.' } : null}>
      {q.isLoading || (run && after.loading) ? (
        <div className="jl"><Skeleton className="h-80 w-full" /></div>
      ) : q.isError || !run ? (
        <div className="jl"><ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /></div>
      ) : noSource || !r ? (
        <div className="jl">
          <section className="glass jcard" data-testid="screen-done-empty">
            <h1 className="jh">Nothing to sign off yet.</h1>
            <p className="jp">The report appears once a round has been fixed and proven. Start from the plan, or see it with the recorded fix.</p>
            <div className="flex flex-wrap gap-3"><Link href={`/plan/${id}`} className="btn btn-go btn-big" data-testid="link-plan">Go to the plan <ArrowRight size={20} /></Link><Link href={`/signoff/${id}?after=${DEMO_RECORDING}`} className="btn btn-quiet" data-testid="link-recorded-signoff">See the recorded sign-off</Link></div>
          </section>
        </div>
      ) : (
        <div className="rp" data-testid="screen-done">
          <div className="rp-grid">
            <aside className="rp-rail" data-important>
              <nav className="rp-toc" aria-label="Report sections">
                {['Summary', 'Standards', 'What was fixed', 'Risks', 'In depth'].map((t, i) => <a key={t} href={`#rp-${i + 1}`} onClick={(e) => { e.preventDefault(); document.getElementById(`rp-${i + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><span>{i + 1}</span>{t}</a>)}
              </nav>
              <button className="btn btn-go w-full justify-center" style={{ fontSize: 18, padding: '14px 18px' }} onClick={() => setExportOpen(true)} data-testid="button-export"><Download size={19} /> Export the fixed code</button>

              <span className="jnote">Your report</span>
              <div className="rp-dl">
                <div className="rp-dl-main"><FileCheck2 size={18} style={{ color: '#4FD99A' }} /><span><b>Verification report</b><small>After the fixes · for your assurance team</small></span></div>
                <div className="rp-dl-fmts">
                  {verification && <button onClick={() => setViewReport(verification)} data-testid="button-view-report"><Eye size={13} /> View</button>}
                  <button disabled={!verification && !after.verificationPdfUrl} onClick={verificationPdf} data-testid="button-verification-report">PDF</button>
                  {verification && <button onClick={() => download(reportUrl(verification.url, 'docx'))} data-testid="button-verification-docx">Word</button>}
                </div>
              </div>
              <button className="jout" onClick={riskCsv} data-testid="button-risk-register"><ShieldAlert size={18} style={{ color: '#FFA62B' }} /> Risk register · {r.risks.length} open (spreadsheet)</button>
              <button className="jout" onClick={() => openAuditDocument(run, after, download)} data-testid="button-audit-document"><FileSearch size={18} style={{ color: '#00E5FF' }} /> Audit document: every line changed</button>
              <button className="jout" onClick={() => downloadAuditCsv(run, after, download)} data-testid="button-trace-sheet"><FileSpreadsheet size={18} style={{ color: '#B9C3CC' }} /> Every requirement, before and after (spreadsheet)</button>

              {!!reports.data?.length && <>
                <span className="jnote">The audits, per standard · before the fixes</span>
                {reports.data.map((rep) => (
                  <div key={rep.kind + rep.standardId} className="rp-dl rp-dl-small" data-testid={`row-audit-${rep.kind}-${rep.standardId}`}>
                    <span className="truncate" title={rep.title}>{rep.standardId ? plainName(rep.standardId, rep.title) : rep.title}</span>
                    <div className="rp-dl-fmts">{rep.formats.map((f) => <button key={f} onClick={() => download(reportUrl(rep.url, f))}>{f === 'docx' ? 'Word' : f === 'xlsx' ? 'Excel' : f.toUpperCase()}</button>)}</div>
                  </div>
                ))}
              </>}

              <span className="jnote">The code</span>
              {prs.map((p) => <a key={p.url} className="jout" href={p.url} target="_blank" rel="noreferrer" data-testid={`link-pr-${p.wave}`}><GitPullRequest size={18} style={{ color: '#4FD99A' }} /> Round {p.wave} · pull request</a>)}
              <button className="jout" disabled={!after.downloadUrl} onClick={() => after.downloadUrl && download(after.downloadUrl)} data-testid="button-export-zip"><Package size={18} style={{ color: '#7CC9E8' }} /> Fixed code (.zip){after.downloadUrl ? '' : ' · live runs only'}</button>
              <button className="jout" onClick={() => setListOpen(true)} data-testid="button-fixed-list"><Table2 size={18} style={{ color: '#B9C3CC' }} /> Everything that was fixed · {changed.length}</button>
              <div className="flex flex-wrap gap-2 pt-1">
                {r.now.unanswered > 0 && <Link href={`/orbit/${id}?answers`} className="btn btn-quiet" data-testid="link-answers">Answer the {r.now.unanswered}</Link>}
                {nextWave && <Link href={`/plan/${id}`} className="btn btn-quiet" data-testid="link-next-wave">Round {nextWave.number} next</Link>}
                <Link href="/start" className="btn btn-quiet" data-testid="link-back-start">Start again</Link>
              </div>
            </aside>

            <div className="rp-pages">
              <Sheet n={1} project={run.projectName} title="Summary">
                <ReportSummary r={r} projectName={run.projectName} assessedAt={run.assessedAt} after={after} />
              </Sheet>
              <Sheet n={2} project={run.projectName} title="Standard by standard">
                <ReportStandards r={r} levels={run.levels} />
              </Sheet>
              <Sheet n={3} project={run.projectName} title="What was fixed">
                <ReportFixed r={r} after={after} run={run} prs={prs} />
              </Sheet>
              <Sheet n={4} project={run.projectName} title="Risks: what is left">
                <ReportRisks r={r} onRegister={riskCsv} />
              </Sheet>
              <Sheet n={5} project={run.projectName} title="In depth">
                <ReportDepth r={r} run={run} after={after} />
              </Sheet>
            </div>
          </div>
        </div>
      )}

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
                <span className="id">{plainName(f!.standardId, f!.standardShort)} {f!.id}</span>
                <span className="truncate" title={f!.title}>{f!.title}</span>
                <span className="text-right" style={{ color: ok ? '#4FD99A' : '#FFA62B' }}>{STATUS_WORD[to ?? ''] ?? to}</span>
              </div>
            );
          })}
        </div>
      </Modal>
      <PdfViewer report={viewReport} onClose={() => setViewReport(null)} />
    </Shell>
  );
}

function Sheet({ n, project, title, children }: { n: number; project: string; title: string; children: ReactNode }) {
  return (
    <article className="rp-sheet" id={`rp-${n}`} data-testid={`report-page-${n}`}>
      <header className="rp-sheet-head">
        <span>Greenlight report · {project}</span>
        <span className="rp-mark">Marking not assigned · originator to determine</span>
        <span>{n} / {PAGES}</span>
      </header>
      <p className="rp-kicker">{String(n).padStart(2, '0')} · {title}</p>
      {children}
      <footer className="rp-sheet-foot"><span>Checked by code, not AI. Same input, same answer.</span><span>Page {n} of {PAGES}</span></footer>
    </article>
  );
}

function Gauge({ before, after }: { before: number; after: number }) {
  const R = 88, C = 2 * Math.PI * R;
  return (
    <svg viewBox="0 0 220 220" className="rp-gauge" role="img" aria-label={`Ready: ${before}% before, ${after}% now`}>
      <circle cx="110" cy="110" r={R} fill="none" stroke="#E6E9EC" strokeWidth="16" />
      <circle cx="110" cy="110" r={R} fill="none" stroke="#B9C1C7" strokeWidth="16" strokeDasharray={`${(before / 100) * C} ${C}`} transform="rotate(-90 110 110)" strokeLinecap="round" />
      <circle cx="110" cy="110" r={R} fill="none" stroke="#1E8F5B" strokeWidth="16" strokeDasharray={`${(after / 100) * C} ${C}`} transform="rotate(-90 110 110)" strokeLinecap="round" className="rp-gauge-arc" />
      <text x="110" y="112" textAnchor="middle" className="rp-gauge-num">{after}%</text>
      <text x="110" y="142" textAnchor="middle" className="rp-gauge-sub">ready · was {before}%</text>
    </svg>
  );
}

function Stack({ c }: { c: FinalReport['now'] }) {
  const parts = [
    { k: 'Passing', v: c.compliant, color: '#1E8F5B' },
    { k: 'Partly met', v: c.partial, color: '#D9922B' },
    { k: 'Failing', v: c.failed, color: '#8E3A8E' },
    { k: 'Needs a person', v: c.unanswered, color: '#9AA3AA' },
  ];
  return (
    <div className="rp-stack-wrap">
      <div className="rp-stack" role="img" aria-label={parts.map((p) => `${p.k} ${p.v}`).join(', ')}>{parts.map((p) => p.v > 0 && <i key={p.k} style={{ flexGrow: p.v, background: p.color }} />)}</div>
      <div className="rp-legend">{parts.map((p) => <span key={p.k}><i style={{ background: p.color }} />{p.k} <b>{p.v}</b></span>)}</div>
    </div>
  );
}

function ReportSummary({ r, projectName, assessedAt, after }: { r: FinalReport; projectName: string; assessedAt: string; after: AfterView }) {
  const clear = r.now.blocking === 0 && r.now.failed === 0;
  return (
    <div className="rp-summary">
      <div className="rp-hero">
        <div className="min-w-0">
          <h1 className="rp-title">{projectName}</h1>
          <p className="rp-verdict" style={{ color: clear ? '#1E8F5B' : '#C2283B' }}>{clear ? 'No blocking problems left.' : `${r.now.blocking} must-fix problem${r.now.blocking === 1 ? '' : 's'} still open.`}</p>
          <p className="rp-lead">Greenlight checked every file against {r.standards.length} standards and {r.now.total.toLocaleString()} requirements. {r.fixed} problem{r.fixed === 1 ? ' was' : 's were'} fixed and checked again by the same rules. {r.now.unanswered ? `${r.now.unanswered} questions need your team: the standards ask for decisions only a person can make.` : ''}</p>
          <p className="rp-meta">Assessed {new Date(assessedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}{after.filesChanged ? ` · ${after.filesChanged} files changed` : ''}{after.durationMs ? ` · fixed in ${fmtClock(after.durationMs)}` : ''}</p>
        </div>
        <Gauge before={r.readinessBefore} after={r.readinessAfter} />
      </div>
      <div className="rp-kpis">
        <Kpi big={`${r.readinessAfter}%`} label="Ready" sub={`was ${r.readinessBefore}%`} color="#1E8F5B" />
        <Kpi big={String(r.fixed)} label="Fixed" sub="proven by the same rules" />
        <Kpi big={String(r.now.blocking)} label="Must-fix left" sub={`was ${r.before.blocking}`} color={r.now.blocking ? '#C2283B' : '#1E8F5B'} />
        <Kpi big={String(r.now.unanswered)} label="Need a person" sub="sign-offs and decisions" />
      </div>
      <h3 className="rp-h3">Every requirement, now</h3>
      <Stack c={r.now} />
      <div className="rp-takeaway">
        <b>In one line:</b> {r.verdict.word === 'Ready' ? 'ready for your assurance team to review and sign.' : clear ? 'ready for review, with conditions: the partly met items and the questions below.' : 'not ready yet: fix the must-fix items first.'}
      </div>
    </div>
  );
}

function Kpi({ big, label, sub, color }: { big: string; label: string; sub: string; color?: string }) {
  return <div className="rp-kpi"><b style={color ? { color } : undefined}>{big}</b><span>{label}</span><small>{sub}</small></div>;
}

function Bar({ before, after }: { before: number; after: number }) {
  return (
    <div className="rp-bar"><i className="rp-bar-before" style={{ width: `${before}%` }} /><i className="rp-bar-after" style={{ width: `${after}%`, background: after < 40 ? '#C2283B' : after < 75 ? '#D9922B' : '#1E8F5B' }} /></div>
  );
}

function ReportStandards({ r, levels }: { r: FinalReport; levels: Record<string, string> }) {
  return (
    <div className="rp-stds">
      <p className="rp-lead">Each standard is a different yardstick. The grey bar is where you started; the coloured bar is where you are now.</p>
      {r.standards.map((s) => (
        <div key={s.short} className="rp-std" data-testid={`report-std-${s.short}`}>
          <div className="rp-std-head">
            <div className="min-w-0"><h3>{s.plain}</h3><p className="rp-small">{s.name}{levels[s.id] ? ` · ${levelDisplay(s.id, levels[s.id])}` : ''}</p></div>
            <div className="rp-std-num"><span>{s.before}%</span> → <b>{s.after}%</b></div>
          </div>
          <Bar before={s.before} after={s.after} />
          <div className="rp-std-foot">
            <span className="rp-chip" style={{ color: s.color === '#4FD99A' ? '#1E8F5B' : s.color === '#FFA62B' ? '#B86A00' : '#C2283B' }}>{s.word}</span>
            <span>{s.passing} passing · {s.partial} partly · {s.failing} failing · {s.person} need a person</span>
          </div>
          {STANDARD_INFO[s.id]?.what && <p className="rp-small rp-what">{STANDARD_INFO[s.id].what}</p>}
        </div>
      ))}
    </div>
  );
}

function ReportFixed({ r, after, run, prs }: { r: FinalReport; after: AfterView; run: AssessmentRun; prs: { wave: number; url: string }[] }) {
  const rounds = after.mode === 'recording'
    ? after.recordings.map((rec) => ({ wave: rec.wave, title: run.waves.find((w) => w.number === rec.wave)?.title ?? `Round ${rec.wave}`, packages: rec.packages.map((p) => p.title), files: rec.changes.length, ms: rec.durationMs }))
    : [{ wave: after.wave, title: run.waves.find((w) => w.number === after.wave)?.title ?? `Round ${after.wave}`, packages: [], files: after.filesChanged, ms: after.durationMs }];
  const max = Math.max(1, ...r.fixedByArea.map((a) => a.count));
  return (
    <div className="rp-fixed">
      <p className="rp-lead">Claude wrote the fixes, one round at a time. Each round became a pull request for your team to review; nothing was merged for you. Then the same rules checked the code again.</p>
      <div className="rp-rounds">
        {rounds.map((x) => (
          <div key={x.wave} className="rp-round">
            <span className="rp-round-n">Round {x.wave}</span>
            <h3>{x.title}</h3>
            {!!x.packages.length && <ul>{x.packages.slice(0, 4).map((p) => <li key={p}>{p}</li>)}{x.packages.length > 4 && <li>+{x.packages.length - 4} more</li>}</ul>}
            <p className="rp-small">{x.files} files{x.ms ? ` · ${fmtClock(x.ms)}` : ''}{prs.find((p) => p.wave === x.wave) ? ' · pull request opened' : ''}</p>
          </div>
        ))}
      </div>
      <h3 className="rp-h3">Fixed, by area</h3>
      <div className="rp-areas">
        {r.fixedByArea.map((a) => <div key={a.id} className="rp-area"><span>{a.label}</span><div className="rp-area-bar"><i style={{ width: `${(a.count / max) * 100}%` }} /></div><b>{a.count}</b></div>)}
        {!r.fixedByArea.length && <p className="rp-small">No requirement changed rating.</p>}
      </div>
      <div className="rp-codestats">
        <div><b>{after.filesChanged}</b><span>files changed</span></div>
        <div><b style={{ color: '#1E8F5B' }}>+{after.linesAdded.toLocaleString()}</b><span>lines added</span></div>
        <div><b style={{ color: '#8E3A8E' }}>−{after.linesRemoved.toLocaleString()}</b><span>lines removed</span></div>
        {after.tests && <div><b>{after.tests.pass.toLocaleString()} / {after.tests.total.toLocaleString()}</b><span>tests pass</span></div>}
      </div>
    </div>
  );
}

function ReportRisks({ r, onRegister }: { r: FinalReport; onRegister: () => void }) {
  const shown = r.risks.slice(0, 12);
  return (
    <div className="rp-risks">
      <p className="rp-lead">What is still open after the fixes, worst first. High means it must be fixed before release. How likely each one is cannot be read from code, so your team rates that.</p>
      <div className="rp-riskcounts">
        {(['High', 'Medium', 'Low'] as RiskRating[]).map((k) => <div key={k} style={{ borderTopColor: RISK_COLOR[k] }}><b style={{ color: RISK_COLOR[k] }}>{r.riskCounts[k]}</b><span>{k}</span></div>)}
        <div style={{ borderTopColor: '#9AA3AA' }}><b>{r.now.unanswered}</b><span>Need a person</span></div>
      </div>
      {shown.length ? (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead><tr><th>Rating</th><th>Requirement</th><th>What it asks for</th><th>Area</th></tr></thead>
            <tbody>{shown.map((x) => (
              <tr key={x.key}><td><span className="rp-pill" style={{ background: RISK_COLOR[x.rating] }}>{x.rating}</span></td><td className="rp-mono">{x.standard} {x.id}</td><td>{x.title}<div className="rp-small">{x.status}</div></td><td>{x.area}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="rp-takeaway">Nothing failing or partly met. Only the questions for your team remain.</p>}
      {r.risks.length > shown.length && <button className="rp-link" onClick={onRegister}>All {r.risks.length} are in the risk register (spreadsheet) →</button>}
      {!!r.needsPerson.length && <>
        <h3 className="rp-h3">Questions only your team can answer</h3>
        <div className="rp-tags">{r.needsPerson.map((a) => <span key={a.id}>{a.label} <b>{a.count}</b></span>)}</div>
      </>}
      <p className="rp-statement">Greenlight does not accept risk on anyone’s behalf. Each item is treated, transferred or accepted by the people who sign this report.</p>
    </div>
  );
}

function ReportDepth({ r, run, after }: { r: FinalReport; run: AssessmentRun; after: AfterView }) {
  const files = countFiles(run.inventory);
  return (
    <div className="rp-depth">
      <div className="rp-two">
        <div>
          <h3 className="rp-h3">How it was checked</h3>
          <ul className="rp-list">
            <li>Every file was read and tested against written rules, one or more per requirement.</li>
            <li>No AI decides a rating. The same code always gets the same findings and the same score.</li>
            <li>After each round of fixes, the same rules ran again on the changed code.</li>
            <li>Requirements that need a document, a sign-off or a decision are marked “needs a person”, never guessed.</li>
          </ul>
        </div>
        <div>
          <h3 className="rp-h3">Scope</h3>
          <dl className="rp-dl-grid">
            <dt>Software</dt><dd>{run.projectName}</dd>
            {files != null && <><dt>Files read</dt><dd>{files.toLocaleString()}</dd></>}
            <dt>Standards</dt><dd>{r.standards.map((s) => s.short).join(', ')}</dd>
            <dt>Requirements</dt><dd>{r.now.total.toLocaleString()} rated</dd>
            <dt>Rounds</dt><dd>{after.mode === 'recording' ? after.recordings.length : 1} of fixes</dd>
            <dt>Run</dt><dd className="rp-mono">{run.id.slice(0, 12)}</dd>
          </dl>
        </div>
      </div>
      <h3 className="rp-h3">Every requirement</h3>
      <p className="rp-small">Open a standard to see each requirement, where it started and where it is now.</p>
      <div className="rp-reqs">
        {r.standards.map((s) => {
          const own = run.findings.filter((f) => f.standardShort === s.short);
          return (
            <details key={s.short} className="rp-req">
              <summary><span>{s.plain}</span><span className="rp-small">{own.length} requirements · {s.after}%</span></summary>
              <div className="rp-req-rows">
                {own.map((f) => {
                  const b = after.statusesBefore[f.key] ?? f.status, a = after.statusesAfter[f.key] ?? b;
                  return (
                    <div key={f.key} className="rp-req-row">
                      <span className="rp-mono">{f.id}</span>
                      <span className="min-w-0">{f.title}</span>
                      <span className="rp-req-st">{b !== a && <><i style={{ color: STATUS_INK[b] }}>{STATUS_WORD[b] ?? b}</i> → </>}<b style={{ color: STATUS_INK[a] }}>{STATUS_WORD[a] ?? a}</b>{b !== a && isGood(a) && ' ✓'}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
      <h3 className="rp-h3">Sign-off</h3>
      <div className="rp-sign">
        {['System owner', 'Security / safety assurance lead', 'Development lead'].map((role) => (
          <div key={role}><span className="rp-small">{role}</span><i /><span className="rp-small">Name · signature · date</span></div>
        ))}
      </div>
    </div>
  );
}
