import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, MonitorPlay, Wrench } from 'lucide-react';
import {
  getGetAssessmentQueryKey,
  getListFixRunsQueryKey,
  useGetAssessment,
  useGetGreenlightConfig,
  useListFixRuns,
  useStartFix,
} from '@workspace/api-client-react';
import { Shell, DEMO_RECORDING, DEMO_WAVES } from '@/components/shell';
import { Dot, ErrorBlock, Skeleton } from '@/components/gl';
import { useGate } from '@/hooks/use-gate';
import { download, pc, tally } from '@/lib/greenlight';

/** Fields the engine adds to a wave's fixes after the client was generated. */
type Pkg = { key: string; title: string; acceptance: string; kind: string; theme: string; itemKeys: string[]; found?: string; where?: string[]; items?: { standard: string; id: string; blocking: boolean }[] };

const WORKING = /run|pend|queue|start|prepar|generat|verif|appl|work|propos/i;
const AWAITING = /await|review|ready|propos/i;

/**
 * Step 3 · Plan: the waves in plain English, what each one closes, what it
 * does to readiness and the one button that starts the fix. No orbit, no
 * result bars; those live on Verified.
 */
export default function Plan() {
  const { id = '' } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { signedIn, run: gated } = useGate();
  const cfg = useGetGreenlightConfig();
  const q = useGetAssessment(id, { query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id) } });
  const fixes = useListFixRuns(id, { query: { enabled: !!id, queryKey: getListFixRunsQueryKey(id) } });
  const start = useStartFix();
  const [wave, setWave] = useState(0);
  const run = q.data;
  const enabled = !!cfg.data?.fixingEnabled;
  const reason = (cfg.data as { fixingDisabledReason?: string } | undefined)?.fixingDisabledReason;

  useEffect(() => {
    if (run && !wave) setWave(run.waves.find((w) => w.fixCount > 0)?.number ?? run.waves[0]?.number ?? 0);
  }, [run, wave]);

  const w = run?.waves.find((x) => x.number === wave);
  const pkgs = ((w?.fixes ?? []) as unknown as Pkg[]);
  const totalClosed = useMemo(() => run?.waves.reduce((n, x) => n + x.fixes.reduce((m, f) => m + f.itemKeys.length, 0), 0) ?? 0, [run]);
  const totalFixes = run?.waves.reduce((n, x) => n + x.fixCount, 0) ?? 0;
  const base = run ? tally(run, Object.fromEntries(run.findings.map((f) => [f.key, f.status]))) : null;
  const last = run?.waves[run.waves.length - 1];
  const inFlight = (fixes.data ?? []).find((f) => WORKING.test(f.status) && !AWAITING.test(f.status) && !f.error);
  const doneWaves = new Set((fixes.data ?? []).filter((f) => f.verificationRunId).map((f) => f.wave));
  const err = start.error as { message?: string } | null;
  const demoRec = DEMO_WAVES.find((d) => d.wave === wave);

  const waveName = (n: number) => {
    const themes = [...new Set((run?.waves.find((x) => x.number === n)?.fixes ?? []).map((f) => f.theme))].slice(0, 2);
    return themes.length ? themes.join(' and ') : `wave ${n}`;
  };

  const startFix = () => gated(() => start.mutate({ id, data: { wave } }, {
    onSuccess: (fr) => { qc.invalidateQueries({ queryKey: getListFixRunsQueryKey(id) }); nav(`/fix/${id}?fix=${fr.id}`); },
  }));

  const guide = {
    steps: [
      `Read what wave ${wave || 1} will fix. Nothing changes yet.`,
      enabled ? `Press Fix wave ${wave || 1} with Claude` : 'Press Watch the recorded fix to see a real run',
      'Watch, then approve the changed files',
    ],
    current: 0,
  };

  return (
    <Shell runId={id} guide={guide} runMeta={run ? `${run.projectName} · plan` : undefined}>
      {q.isLoading ? <div className="flex flex-1 items-center p-8"><Skeleton className="h-full w-full" /></div> : q.isError || !run ? <div className="flex flex-1 items-center justify-center"><ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /></div> : (
        <div className="plan-layout">
          <section className="glass plan-main">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div><div className="lbl">Step 3 of 6 · The plan</div><h1 className="font-head mt-1 text-3xl font-semibold leading-tight">{run.waves.length} wave{run.waves.length === 1 ? '' : 's'}, biggest wins first</h1></div>
              <span className="ink px-3 py-2 text-sm" style={{ color: '#EAF3F8' }}>{totalFixes} fixes close {totalClosed} of {run.findings.length} requirements</span>
            </div>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Waves">
              {run.waves.map((item) => (
                <button key={item.number} role="tab" aria-selected={wave === item.number} onClick={() => setWave(item.number)} className={`float-nav-btn !py-2 !px-3 ${wave === item.number ? 'is-on' : ''}`} data-testid={`button-wave-${item.number}`}>
                  <span className="float-nav-step">Wave {item.number}</span><span className="capitalize">{waveName(item.number)}</span><span className="lbl !text-[9px]">· {item.fixCount}</span>{doneWaves.has(item.number) && <span className="lbl !text-[9px] !text-[#4FD99A]">· verified</span>}
                </button>
              ))}
            </div>
            <div className="plan-list" data-testid="plan-packages">
              {pkgs.map((f, i) => {
                const blocking = f.items?.some((x) => x.blocking) ?? /must/i.test(f.kind);
                const standards = [...new Set((f.items ?? []).map((x) => x.standard))];
                return (
                  <div key={f.key} className="ink pkg" data-testid={`card-package-${f.key}`}>
                    <span className="pkg-n">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="font-head text-base font-semibold leading-snug">{f.title}</div>
                      <p className="mt-1 text-xs leading-relaxed" style={{ color: '#EAF3F8' }}>
                        {f.found ? <>{f.found} </> : null}
                        Done when: {f.acceptance} Closes <b style={{ color: '#F7FBFF' }}>{f.itemKeys.length} requirement{f.itemKeys.length === 1 ? '' : 's'}</b>{standards.length ? ` across ${standards.join(', ')}` : ''}.
                      </p>
                      {f.where && f.where.length > 0 && <p className="mt-1 font-mono text-[10px]" style={{ color: '#B9DCEA' }}>{f.where.slice(0, 3).join('  ')}{f.where.length > 3 ? `  +${f.where.length - 3}` : ''}</p>}
                    </div>
                    <span className="lbl" style={{ color: blocking ? '#FF5C6E' : '#FFA62B' }}>{blocking ? 'Must fix' : 'Partial'}</span>
                  </div>
                );
              })}
              {!pkgs.length && <p className="ink p-3 text-sm">No work packages in this wave.</p>}
            </div>
          </section>

          <aside className="glass plan-side">
            <div className="lbl">What wave {wave} does to readiness</div>
            <div className="flex flex-col gap-3">
              {run.standards.map((s) => {
                const baseline = pc(s.readiness);
                const projected = pc(w?.readiness[s.id] ?? s.readiness);
                const ceiling = pc(last?.readiness[s.id] ?? s.readiness);
                return (
                  <div key={s.id} className="ink p-3" data-testid={`bars-${s.id}`}>
                    <div className="flex items-center justify-between text-sm"><span className="font-head font-semibold">{s.short}</span><span className="font-mono tabular">{baseline}% → <b style={{ color: '#4FD99A' }}>{projected}%</b></span></div>
                    <div className="bar mt-2"><i style={{ width: `${projected}%`, background: 'rgba(79,217,154,.45)' }} /><i style={{ width: `${baseline}%`, background: '#7CC9E8' }} /><span className="tick" style={{ left: `${ceiling}%` }} title={`All waves reach ${ceiling}%`} /></div>
                    <div className="lbl mt-1.5 !text-[9px]">{ceiling >= 98 ? 'All waves reach the top' : `All ${run.waves.length} waves reach ${ceiling}% · the rest is process evidence, not code`}</div>
                  </div>
                );
              })}
            </div>
            {base && <div className="lbl !text-[9px]">Baseline · {base.failed} failing · {base.partial} partial · {base.blocking} must-fix</div>}
            <div className="ink p-3 text-xs leading-relaxed" style={{ color: '#EAF3F8' }}><span className="lbl !text-[#00E5FF]">The only place AI is used</span><br />Claude writes the changes in a copy of the repository. Nothing is applied until you approve every changed file, and then the same code checks the result again.</div>
            <div className="mt-auto flex flex-col gap-2">
              {inFlight ? (
                <Link href={`/fix/${id}?fix=${inFlight.id}`} className="btn btn-primary justify-center !py-3.5 text-base" data-testid="link-open-console"><MonitorPlay size={16} /> Watch the fix in progress</Link>
              ) : (
                <button className="btn btn-primary justify-center !py-3.5 text-base" disabled={!enabled || !wave || start.isPending} onClick={startFix} data-testid="button-start-fix">
                  <Wrench size={16} /> {start.isPending ? 'Starting' : enabled && !signedIn ? 'Sign in to fix' : `Fix wave ${wave} with Claude`}
                </button>
              )}
              <div className="flex gap-2">
                <Link href={`/replay/${demoRec?.name ?? DEMO_RECORDING}`} className="btn flex-1 justify-center text-xs" data-testid="link-recorded-fix"><MonitorPlay size={14} /> {demoRec ? `Watch wave ${demoRec.wave} recorded` : 'Watch the recorded fix'}</Link>
                <button className="btn flex-1 justify-center text-xs" onClick={() => download(`${import.meta.env.BASE_URL}api/greenlight/runs/${run.id}/reports/fix-prompt?format=md`)} data-testid="button-download-prompt"><FileText size={14} /> Fix prompt (.md)</button>
              </div>
              {!cfg.isLoading && !enabled && <p className="text-[11px] leading-relaxed" data-testid="text-fix-disabled"><Dot color="#FFA62B" word="Live fixing is off on this deployment" /><span className="mt-0.5 block" style={{ color: '#EAF3F8' }}>{reason || 'The recorded session shows the same run end to end.'}</span></p>}
              {start.isError && <p className="text-xs"><Dot color="#FF5C6E" word={err?.message || 'Could not start the fix'} />{/expire|working copy|re-?upload/i.test(err?.message ?? '') && <span className="mt-1 block text-[10px]">The working copy expired. <Link href="/start" className="underline">Upload the zip again</Link> to continue.</span>}</p>}
              <span className="lbl text-center !text-[9px]">About 12 minutes · about $1 · opens a pull request, never merges</span>
            </div>
          </aside>
        </div>
      )}
    </Shell>
  );
}
