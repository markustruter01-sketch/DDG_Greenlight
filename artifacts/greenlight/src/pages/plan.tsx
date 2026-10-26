import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileText, MonitorPlay, Wrench } from 'lucide-react';
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

const ROUND_NAMES: Record<string, string> = {
  access: 'Lock the doors', secrets: 'Lock the doors', appsec: 'Check what comes in', supply: 'Check what comes in', build: 'Check what comes in',
  logging: 'Keep a record', ops: 'Keep a record', safety: 'Prove it is safe', testing: 'Prove it is safe', docs: 'Prove it is safe', governance: 'Write it down', ai: 'Write it down',
};

/**
 * Step 4 · The plan: the rounds as cards, what each one does to the score,
 * and one green button that starts the first one with Claude.
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

  const doneWaves = useMemo(() => new Set((fixes.data ?? []).filter((f) => f.verificationRunId).map((f) => f.wave)), [fixes.data]);
  useEffect(() => {
    if (run && !wave) setWave(run.waves.find((w) => w.fixCount > 0 && !doneWaves.has(w.number))?.number ?? run.waves.find((w) => w.fixCount > 0)?.number ?? run.waves[0]?.number ?? 0);
  }, [run, wave, doneWaves]);

  const w = run?.waves.find((x) => x.number === wave);
  const pkgs = ((w?.fixes ?? []) as unknown as Pkg[]);
  const base = run ? tally(run, Object.fromEntries(run.findings.map((f) => [f.key, f.status]))) : null;
  const inFlight = (fixes.data ?? []).find((f) => WORKING.test(f.status) && !AWAITING.test(f.status) && !f.error);
  const err = start.error as { message?: string } | null;
  const demoRec = DEMO_WAVES.find((d) => d.wave === wave);
  const codeWaves = run?.waves.filter((x) => x.fixCount > 0) ?? [];
  const humanLeft = base ? base.unanswered : 0;
  const overallOf = (readiness: Record<string, number> | undefined) => run ? Math.round(run.standards.reduce((n, s) => n + pc(readiness?.[s.id] ?? s.readiness), 0) / Math.max(1, run.standards.length)) : 0;
  const baseline = run ? Math.round(run.standards.reduce((n, s) => n + pc(s.readiness), 0) / Math.max(1, run.standards.length)) : 0;

  const roundName = (n: number) => {
    const themes = (run?.waves.find((x) => x.number === n)?.fixes ?? []).map((f) => f.theme);
    const names = [...new Set(themes.map((t) => ROUND_NAMES[t] ?? t))];
    return names[0] ?? `Round ${n}`;
  };
  const roundBlurb = (n: number) => {
    const list = ((run?.waves.find((x) => x.number === n)?.fixes ?? []) as unknown as Pkg[]);
    return list.slice(0, 4).map((f) => f.title.replace(/\.$/, '')).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '') + '.';
  };

  const startFix = () => gated(() => start.mutate({ id, data: { wave } }, {
    onSuccess: (fr) => { qc.invalidateQueries({ queryKey: getListFixRunsQueryKey(id) }); nav(`/fix/${id}?fix=${fr.id}`); },
  }));

  const guide = {
    steps: [`Read what round ${wave || 1} will fix. Nothing changes yet.`, enabled ? `Press Fix round ${wave || 1} with Claude` : 'Press Watch the recorded fix to see a real run', 'Watch, then approve the changes'],
    current: 0,
  };

  return (
    <Shell runId={id} guide={guide} runMeta={run ? `${run.projectName} · the plan` : undefined}>
      <div className="jl">
        {q.isLoading ? <Skeleton className="h-80 w-full" /> : q.isError || !run ? <ErrorBlock message="Assessment unavailable." onRetry={() => q.refetch()} /> : (
          <section className="glass jcard" data-testid="screen-plan">
            <div className="jrow">
              <h1 className="jh">{codeWaves.length === 0 ? 'Nothing for code to fix.' : codeWaves.length === 1 ? 'One round. Then your answers.' : `${['', '', 'Two', 'Three', 'Four'][codeWaves.length] ?? codeWaves.length} rounds. Round 1 is the big one.`}</h1>
              <span className="jnote">Each round opens a pull request · you approve it</span>
            </div>
            <div className="jrounds" role="tablist" aria-label="Rounds">
              {codeWaves.map((item, i) => {
                const prev = i === 0 ? baseline : overallOf(codeWaves[i - 1].readiness);
                const to = overallOf(item.readiness);
                const done = doneWaves.has(item.number);
                return (
                  <button key={item.number} role="tab" aria-selected={wave === item.number} className={`jround ${wave === item.number ? 'is-on' : ''} ${done ? 'is-done' : ''}`} onClick={() => setWave(item.number)} data-testid={`button-wave-${item.number}`}>
                    <span className="n">{done ? '✓' : item.number}</span>
                    <b>{roundName(item.number)}</b>
                    <small>{roundBlurb(item.number)}</small>
                    <span className="to">{prev}% → {to}%{done ? ' · done' : ''}</span>
                  </button>
                );
              })}
              <div className="jround is-human" aria-label="After the rounds">
                <span className="n" style={{ color: '#6F7A84' }}>{codeWaves.length + 1}</span>
                <b style={{ color: '#B9C3CC' }}>Your answers</b>
                <small>{humanLeft} item{humanLeft === 1 ? '' : 's'} need a person: sign-offs, documents, choices. Greenlight asks, you answer.</small>
                <span className="to" style={{ color: '#B9C3CC' }}>{codeWaves.length ? overallOf(codeWaves[codeWaves.length - 1].readiness) : baseline}% → 100%</span>
              </div>
            </div>
            {pkgs.length > 0 && (
              <div className="jpkgs" data-testid="plan-packages">
                {pkgs.map((f, i) => {
                  const blocking = f.items?.some((x) => x.blocking) ?? /must/i.test(f.kind);
                  return (
                    <div key={f.key} className="jpkg" data-testid={`card-package-${f.key}`}>
                      <span className="n">{i + 1}</span>
                      <span className="min-w-0"><span className="block truncate font-medium">{f.title}</span><span className="block truncate text-xs" style={{ color: '#B9C3CC' }}>{f.found ? `${f.found} ` : ''}Closes {f.itemKeys.length} requirement{f.itemKeys.length === 1 ? '' : 's'}{f.where?.length ? ` · ${f.where[0]}` : ''}</span></span>
                      <span className="jnote" style={{ color: blocking ? '#FF8C9A' : '#FFA62B' }}>{blocking ? 'Serious' : 'Should fix'}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="jrow">
              <div className="flex flex-wrap items-center gap-3">
                {inFlight ? (
                  <Link href={`/fix/${id}?fix=${inFlight.id}`} className="btn btn-go btn-big" data-testid="link-open-console"><MonitorPlay size={18} /> Watch round {inFlight.wave} being fixed</Link>
                ) : (
                  <button className="btn btn-go btn-big" disabled={!enabled || !wave || start.isPending} onClick={startFix} data-testid="button-start-fix">
                    <Wrench size={18} /> {start.isPending ? 'Starting…' : enabled && !signedIn ? 'Sign in to fix' : `Fix round ${wave || 1} with Claude`}
                  </button>
                )}
                <Link href={`/replay/${demoRec?.name ?? DEMO_RECORDING}`} className="btn btn-quiet" data-testid="link-recorded-fix"><MonitorPlay size={15} /> {demoRec ? `Watch round ${demoRec.wave} recorded` : 'Watch a recorded fix'}</Link>
                <button className="btn btn-quiet" onClick={() => download(`${import.meta.env.BASE_URL}api/greenlight/runs/${run.id}/reports/fix-prompt?format=md`)} data-testid="button-download-prompt"><FileText size={15} /> The fix as a prompt</button>
                {doneWaves.size > 0 && <Link href={`/verified/${id}?fix=${(fixes.data ?? []).filter((f) => f.verificationRunId).slice(-1)[0]?.id}`} className="btn btn-quiet" data-testid="link-verified">See the proof <ArrowRight size={15} /></Link>}
              </div>
              <span className="jnote">Round {wave || 1} · {w?.fixCount ?? 0} fixes · about 10 minutes · about $1 · never merged for you</span>
            </div>
            {!cfg.isLoading && !enabled && <p className="text-sm" data-testid="text-fix-disabled"><Dot color="#FFA62B" word="Live fixing is off on this deployment" /><span className="ml-2" style={{ color: '#DCE3E8' }}>{reason || 'The recorded session shows the same run end to end.'}</span></p>}
            {start.isError && <p className="text-sm"><Dot color="#FF5C6E" word={err?.message || 'Could not start the fix'} />{/expire|working copy|re-?upload/i.test(err?.message ?? '') && <span className="ml-2">The working copy expired. <Link href="/start" className="underline">Upload the zip again</Link> to continue.</span>}</p>}
          </section>
        )}
      </div>
    </Shell>
  );
}
