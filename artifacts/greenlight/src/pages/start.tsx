import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { FileArchive, GitCompare, RefreshCw } from 'lucide-react';
import {
  getListProjectsQueryKey,
  useCreateAssessment,
  useGetGreenlightConfig,
  useListProjects,
  type Project,
} from '@workspace/api-client-react';
import { SignIn, SignUp } from '@clerk/react';
import { useGate } from '@/hooks/use-gate';
import { Modal } from '@/components/gl';
import { Shell } from '@/components/shell';
import { CompareModal } from '@/components/compare';
import { Dot, ErrorBlock, Gauge, Skeleton } from '@/components/gl';
import { pc, uploadZip } from '@/lib/greenlight';

const CLASSES = ['Non-classified', 'OFFICIAL: Sensitive', 'PROTECTED', 'SECRET', 'TOP SECRET'];

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function Start({ auth }: { auth?: 'in' | 'up' }) {
  const { signedIn, run: gated } = useGate();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const cfg = useGetGreenlightConfig();
  const projects = useListProjects();
  const create = useCreateAssessment();
  const [mode, setMode] = useState<'github' | 'zip'>('github');
  const [github, setGithub] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [classification, setClassification] = useState('PROTECTED');
  const [maturity, setMaturity] = useState(2);
  const [reassess, setReassess] = useState<Project | null>(null);
  const [cmp, setCmp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const standards = cfg.data?.standards ?? [];
  useEffect(() => {
    if (!standards.length) return;
    setSel((current) => Object.keys(current).length ? current : Object.fromEntries(
      standards.map((s) => [s.id, !/42001|ai.?management/i.test(`${s.id} ${s.name} ${s.short}`)]),
    ));
    setLevels((current) => Object.keys(current).length ? current : Object.fromEntries(
      standards.filter((s) => s.levels?.length).map((s) => {
        const preferred = /asvs/i.test(s.id) ? '2' : /ed153/i.test(s.id) ? '3' : undefined;
        const level = preferred && s.levels?.includes(preferred) ? preferred : s.defaultLevel ?? s.levels![0];
        return [s.id, level];
      }),
    ));
  }, [standards]);
  const chosen = useMemo(() => standards.filter((s) => sel[s.id]), [standards, sel]);
  const needsIsm = chosen.some((s) => /ism/i.test(s.id));
  const needsE8 = chosen.some((s) => /e8|essential|ism/i.test(s.id));
  const sourceOk = mode === 'github' ? /github\.com\//i.test(github) || /^[\w.-]+\/[\w.-]+$/.test(github.trim()) : !!file;
  const canGo = !!chosen.length && sourceOk && !busy;

  const run = async () => {
    setErr(null);
    const lv: Record<string, string> = {};
    for (const s of chosen) if (s.levels?.length) lv[s.id] = levels[s.id] ?? s.defaultLevel ?? s.levels[0];
    const opts = {
      standards: chosen.map((s) => s.id),
      levels: lv,
      classification: needsIsm ? classification : undefined,
      maturity: needsE8 ? maturity : undefined,
      projectId: reassess?.id,
    };
    setBusy(true);
    try {
      if (mode === 'zip' && file) {
        const r = await uploadZip(file, opts);
        qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        nav(`/results/${r.id}`);
      } else {
        create.mutate(
          { data: { github: github.trim(), ...opts } },
          {
            onSuccess: (r) => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); nav(`/results/${r.id}`); },
            onError: (e) => { setErr(e instanceof Error ? e.message : 'Assessment failed'); setBusy(false); },
          },
        );
        return;
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Assessment failed');
    }
    setBusy(false);
  };

  const startReassess = (p: Project) => {
    if (!signedIn) return nav('/sign-in');
    setReassess(p);
    if (/^https?:\/\/|github\.com/i.test(p.source)) { setMode('github'); setGithub(p.source); }
    else { setMode('zip'); setTimeout(() => fileRef.current?.click(), 50); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Shell bg="glacier-night.webp">
      <div className="start-layout">
        <section className="glass start-form">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="lbl">Assessment setup · written rules, no AI</div>
            {reassess && <div className="lbl !text-[#00E5FF]">Re-assessing {reassess.name} <button className="underline" onClick={() => setReassess(null)} data-testid="button-clear-reassess">clear</button></div>}
          </div>
          <h1 className="font-head text-2xl font-semibold leading-tight">Is your software fit for regulation?</h1>
          <div className="rounded-2xl border p-3" style={{ borderColor: 'rgba(124,201,232,.2)', background: 'rgba(6,19,26,.24)' }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="lbl">1 · CODE</div>
              <div className="flex gap-1.5">
              {(['github', 'zip'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className="lbl rounded-xl border px-3 py-1.5" style={{ borderColor: mode === m ? '#00E5FF' : 'rgba(124,201,232,.3)', background: mode === m ? 'rgba(0,229,255,.14)' : 'transparent', color: mode === m ? '#F7FBFF' : '#CFE3EE' }} data-testid={`button-mode-${m}`}>
                  {m === 'github' ? 'GitHub URL' : 'Zip upload'}
                </button>
              ))}
              </div>
            </div>
            {mode === 'github' ? (
              <input className="field !py-2" placeholder="https://github.com/owner/repo" value={github} onChange={(e) => setGithub(e.target.value)} data-testid="input-github" />
            ) : (
              <button className="field flex items-center gap-3 !py-2 text-left" onClick={() => fileRef.current?.click()} data-testid="button-choose-zip">
                <FileArchive size={18} /> {file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : 'Choose a .zip of the source'}
              </button>
            )}
            <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-zip" />
            {mode === 'github' && cfg.data && !cfg.data.githubEnabled && <p className="lbl mt-2 !normal-case !tracking-normal">GitHub access is not configured; public repositories only.</p>}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between"><div className="lbl">2 · STANDARDS</div><div className="lbl">{chosen.length} selected</div></div>
            {cfg.isLoading ? <div className="standard-list">{[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-16" />)}</div> : cfg.isError ? <ErrorBlock message="Standards unavailable." onRetry={() => cfg.refetch()} /> : (
              <div className="standard-list">
                {standards.map((s) => {
                  const on = !!sel[s.id];
                  const isIsm = /ism/i.test(s.id);
                  return (
                    <div key={s.id} className="standard-row border" style={{ borderColor: on ? 'rgba(0,229,255,.6)' : 'rgba(124,201,232,.2)', background: on ? 'rgba(0,229,255,.06)' : 'rgba(6,19,26,.18)' }} data-testid={`row-standard-${s.id}`}>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <input type="checkbox" className="h-4 w-4 shrink-0 accent-[#00E5FF]" checked={on} onChange={(e) => setSel({ ...sel, [s.id]: e.target.checked })} data-testid={`checkbox-standard-${s.id}`} aria-label={`Select ${s.name}`} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{s.short}</span><span className="lbl !text-[9px]">{s.items} requirements</span></span>
                        {on && !!s.levels?.length && <select aria-label={`${s.short} level`} className="field !w-auto !max-w-[112px] !px-2 !py-1 text-xs" value={levels[s.id] ?? s.defaultLevel ?? s.levels[0]} onChange={(e) => setLevels({ ...levels, [s.id]: e.target.value })} data-testid={`select-level-${s.id}`}>{s.levels.map((l) => <option key={l} value={l}>{/ed153/i.test(s.id) ? `SWAL ${l}` : /asvs/i.test(s.id) ? `Level ${l}` : l}</option>)}</select>}
                        {on && isIsm && <select aria-label="ISM classification" className="field !w-auto !max-w-[135px] !px-2 !py-1 text-xs" value={classification} onChange={(e) => setClassification(e.target.value)} data-testid="select-classification">{CLASSES.map((c) => <option key={c}>{c}</option>)}</select>}
                        {on && /e8|essential|ism/i.test(s.id) && <select aria-label="Essential Eight maturity" className="field !w-auto !max-w-[170px] !px-2 !py-1 text-xs" value={maturity} onChange={(e) => setMaturity(Number(e.target.value))} data-testid="select-maturity">{[1,2,3].map(m => <option key={m} value={m}>Maturity Level {['One', 'Two', 'Three'][m - 1]}</option>)}</select>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button className="btn btn-primary w-full flex-none justify-center !py-3 text-base" disabled={!canGo} onClick={() => gated(run)} data-testid="button-assess">
            {busy ? 'Reading the code and running the rules' : `Assess against ${chosen.length} standard${chosen.length === 1 ? '' : 's'}`}
          </button>
          {busy && (
            <div className="glass p-4 text-sm" style={{ color: '#CFE3EE' }}>
              <div className="h-1 overflow-hidden rounded-full" style={{ background: 'rgba(124,201,232,.2)' }}><motion.div className="h-full w-1/3" style={{ background: '#00E5FF' }} animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} /></div>
              <p className="mt-3">This can take about 30 seconds. Intake is rules only; no AI is involved.</p>
            </div>
          )}
          {err && <div className="glass flex-none px-3 py-2" data-testid="text-error"><Dot color="#FF5C6E" word={err} /></div>}
        </section>

        <aside className="glass flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-head text-lg font-semibold">Saved projects</h2><span className="lbl">{projects.data?.length ?? 0}</span></div>
          <div className="projects-list flex-1 space-y-2">
            {projects.isLoading ? <Skeleton className="h-28" /> : projects.isError ? <ErrorBlock message="Projects unavailable." onRetry={() => projects.refetch()} /> : !projects.data?.length ? (
              <div className="tile p-5 text-center"><p className="font-head text-lg">Nothing saved yet</p><p className="mt-1 text-sm" style={{ color: '#CFE3EE' }}>Your first assessment will appear here, ready to re-assess and compare.</p></div>
            ) : projects.data.map((p) => (
              <div key={p.id} className="tile p-3" data-testid={`card-project-${p.id}`}>
                <div className="flex items-center gap-4">
                  <Gauge value={pc(p.readiness)} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="font-head truncate text-lg">{p.name}</div>
                    <div className="lbl truncate !normal-case !tracking-normal">{p.source}</div>
                    <div className="mt-1 text-xs"><Dot color={/not|fail/i.test(p.verdict) ? '#FF5C6E' : /ready|clear/i.test(p.verdict) ? '#4FD99A' : '#F5C451'} word={p.verdict} /> <span className="lbl ml-2">{p.runCount} runs</span></div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Link href={`/results/${p.latestRunId}`} className="btn !px-2 !py-1.5 text-xs" data-testid={`link-open-${p.id}`}>Open</Link>
                  <button className="btn !px-2 !py-1.5 text-xs" onClick={() => startReassess(p)} data-testid={`button-reassess-${p.id}`}><RefreshCw size={13} /> Re-assess</button>
                  <button className="btn !px-2 !py-1.5 text-xs" onClick={() => setCmp(p.id)} data-testid={`button-compare-${p.id}`}><GitCompare size={13} /> Compare</button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[#CFE3EE]">Projects keep every assessment. Re-assessing compares the new result with the plan, item by item.</p>
        </aside>
      </div>
      <Modal open={!!auth} onClose={() => nav('/start')} title={auth === 'up' ? 'Create your account' : 'Sign in to Greenlight'}>
        <div className="flex justify-center">
          {auth === 'up' ? (
            <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} fallbackRedirectUrl={`${basePath}/start`} />
          ) : (
            <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} fallbackRedirectUrl={`${basePath}/start`} />
          )}
        </div>
      </Modal>
      <CompareModal projectId={cmp} open={!!cmp} onClose={() => setCmp(null)} />
    </Shell>
  );
}
