import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { FileArchive, GitCompare, Github, RefreshCw } from 'lucide-react';
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
import { STANDARD_INFO, levelDisplay } from '@/lib/standard-info';

const CLASSES = ['Non-classified', 'OFFICIAL: Sensitive', 'PROTECTED', 'SECRET', 'TOP SECRET'];
const MATURITY = ['One', 'Two', 'Three'];

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

type Std = { id: string; name: string; short: string; items: number; levels?: string[]; defaultLevel?: string };

/** ⓘ: what a standard is and what the chosen level means, in plain words. */
function InfoButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" className="info-btn" onClick={onClick} aria-label={`About ${label}`} data-testid={`button-info-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>i</button>;
}

function StandardInfoModal({ std, level, classification, maturity, onClose }: { std: Std | null; level?: string; classification: string; maturity: number; onClose: () => void }) {
  const info = std ? STANDARD_INFO[std.id] : undefined;
  return (
    <Modal open={!!std} onClose={onClose} title={std ? `${std.short} · what it is and what the level means` : ''}>
      {std && (
        <div className="space-y-3 text-sm">
          <div className="ink p-3"><div className="lbl mb-1">What it is</div><p className="leading-relaxed">{info?.what ?? std.name}</p></div>
          <div className="ink p-3"><div className="lbl mb-1">Who it is for</div><p className="leading-relaxed">{info?.who ?? 'Teams that need to show this standard is met.'}</p></div>
          <div className="ink p-3"><div className="lbl mb-1">What Greenlight checks</div><p className="leading-relaxed">{std.items} requirements from this standard, each by a written rule that reads the repository. Requirements that need process evidence rather than code are asked as questions, never guessed.</p></div>
          {info?.levels && (
            <div>
              <div className="lbl mb-2">{info.levelName}</div>
              <div className="space-y-2">
                {info.levels.map((l) => {
                  const now = l.value === 'classification' ? classification : l.value === 'maturity' ? `Maturity Level ${MATURITY[maturity - 1]}` : null;
                  const chosen = l.value === level;
                  return (
                    <div key={l.value} className="ink p-3" style={chosen ? { borderColor: '#00E5FF' } : undefined}>
                      <div className="flex items-center justify-between gap-2"><span className="font-head font-semibold">{l.label}</span>{chosen && <span className="lbl !text-[#00E5FF]">Chosen</span>}{now && <span className="lbl !text-[#00E5FF]">Now: {now}</span>}</div>
                      <p className="mt-1 leading-relaxed">{l.means}</p>
                      <p className="mt-1 text-xs" style={{ color: '#B9DCEA' }}>Pick it for: {l.pick}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

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
  const [change, setChange] = useState(false);
  const [info, setInfo] = useState<Std | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const standards = (cfg.data?.standards ?? []) as Std[];
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
  const totalItems = chosen.reduce((n, s) => n + s.items, 0);
  const needsIsm = chosen.some((s) => /ism/i.test(s.id));
  const needsE8 = chosen.some((s) => /e8|essential|ism/i.test(s.id));
  const sourceOk = mode === 'github' ? /github\.com\//i.test(github) || /^[\w.-]+\/[\w.-]+$/.test(github.trim()) : !!file;
  const canGo = !!chosen.length && sourceOk && !busy;
  const repoName = mode === 'github' ? (github.trim().match(/([\w.-]+?)(?:\.git)?\/?$/)?.[1] ?? '') : file?.name.replace(/\.zip$/i, '') ?? '';

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

  const levelChip = (s: Std) => {
    const parts: string[] = [];
    if (s.levels?.length) parts.push(levelDisplay(s.id, levels[s.id] ?? s.defaultLevel ?? s.levels[0]));
    if (/ism/i.test(s.id)) parts.push(classification, `E8 Maturity ${MATURITY[maturity - 1]}`);
    return parts.length ? ` · ${parts.join(' · ')}` : '';
  };

  const guide = {
    steps: [
      mode === 'github' ? 'Paste the GitHub link of the software you want checked' : 'Choose the zip of the source folder',
      'Standards are already chosen for you; change them only if you need to',
      busy ? 'Reading the code and running the rules, about 30 seconds' : 'Press Assess',
    ],
    current: busy || sourceOk ? 2 : 0,
    aside: <Link href="/how-it-checks" className="lbl hover:text-[#00E5FF]" data-testid="link-guide-how">How it checks</Link>,
  };

  return (
    <Shell guide={guide}>
      <div className="start-layout">
        <section className="glass start-form">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="lbl">Step 1 of 6 · Start</div>
            {reassess && <div className="lbl !text-[#00E5FF]">Re-assessing {reassess.name} <button className="underline" onClick={() => setReassess(null)} data-testid="button-clear-reassess">clear</button></div>}
          </div>
          <h1 className="font-head text-3xl font-semibold leading-tight">Where is the code?</h1>

          <div className="grid grid-cols-2 gap-3">
            <button type="button" className={`choice ${mode === 'github' ? 'is-on' : ''}`} onClick={() => setMode('github')} aria-pressed={mode === 'github'} data-testid="button-mode-github">
              <span className="lbl" style={{ color: mode === 'github' ? '#00E5FF' : undefined }}>{mode === 'github' ? 'Option A · chosen' : 'Option A'}</span>
              <span className="choice-title flex items-center gap-2"><Github size={20} /> A GitHub link</span>
              <span className="choice-sub">Public repositories. Paste the address of the repo.</span>
            </button>
            <button type="button" className={`choice ${mode === 'zip' ? 'is-on' : ''}`} onClick={() => { setMode('zip'); if (!file) setTimeout(() => fileRef.current?.click(), 50); }} aria-pressed={mode === 'zip'} data-testid="button-mode-zip">
              <span className="lbl" style={{ color: mode === 'zip' ? '#00E5FF' : undefined }}>{mode === 'zip' ? 'Option B · chosen' : 'Option B'}</span>
              <span className="choice-title flex items-center gap-2"><FileArchive size={20} /> Upload a zip</span>
              <span className="choice-sub">A zip of the source folder, straight from your machine.</span>
            </button>
          </div>

          {mode === 'github' ? (
            <div className="flex flex-col gap-1.5">
              <label className="lbl" htmlFor="github-url">GitHub address</label>
              <input id="github-url" className="field !py-3" style={sourceOk ? { borderColor: '#00E5FF' } : undefined} placeholder="https://github.com/owner/repo" value={github} onChange={(e) => setGithub(e.target.value)} data-testid="input-github" />
              {cfg.data && !cfg.data.githubEnabled && <p className="lbl !normal-case !tracking-normal">Public repositories only on this deployment.</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="lbl">Zip file</span>
              <button className="field flex items-center gap-3 !py-3 text-left" style={file ? { borderColor: '#00E5FF' } : undefined} onClick={() => fileRef.current?.click()} data-testid="button-choose-zip">
                <FileArchive size={18} /> {file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : 'Choose a .zip of the source'}
              </button>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-zip" />

          <div className="ink flex flex-col gap-2.5 p-3.5" data-testid="panel-standards">
            <div className="flex items-center justify-between gap-2">
              <span className="lbl">{cfg.isLoading ? 'Loading standards' : `Checked against · ${chosen.length} standard${chosen.length === 1 ? '' : 's'} · ${totalItems} requirements`}</span>
              <button className="btn !px-3 !py-1.5 text-xs" onClick={() => setChange(true)} disabled={!standards.length} data-testid="button-change-standards">Change</button>
            </div>
            {cfg.isError ? <ErrorBlock message="Standards unavailable." onRetry={() => cfg.refetch()} /> : (
              <div className="flex flex-wrap gap-1.5">
                {chosen.map((s) => (
                  <span key={s.id} className="chip" data-testid={`chip-standard-${s.id}`}>{s.short}{levelChip(s)} <InfoButton label={s.short} onClick={() => setInfo(s)} /></span>
                ))}
                {!chosen.length && !cfg.isLoading && <span className="text-xs" style={{ color: '#FFA62B' }}>No standards chosen. Press Change to pick at least one.</span>}
              </div>
            )}
            <p className="text-xs leading-relaxed" style={{ color: '#B9DCEA' }}>Press ⓘ on any chip to read what the standard is and what its level means.</p>
          </div>

          <button className="btn btn-primary mt-auto w-full flex-none justify-center !py-3.5 text-base" disabled={!canGo} onClick={() => gated(run)} data-testid="button-assess">
            {busy ? 'Reading the code and running the rules' : `Assess${repoName ? ` ${repoName}` : ''} against ${chosen.length} standard${chosen.length === 1 ? '' : 's'}`}
          </button>
          <span className="lbl text-center">About 30 seconds · written rules read the code · no AI</span>
          {busy && (
            <div className="ink p-3 text-sm">
              <div className="h-1 overflow-hidden rounded-full" style={{ background: 'rgba(124,201,232,.2)' }}><motion.div className="h-full w-1/3" style={{ background: '#00E5FF' }} animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} /></div>
              <p className="mt-2">Every file is read by the rules. Nothing is sent to a model.</p>
            </div>
          )}
          {err && <div className="ink flex-none px-3 py-2" data-testid="text-error"><Dot color="#FF5C6E" word={err} /></div>}
        </section>

        <aside className="glass flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-head text-lg font-semibold">Saved projects</h2><span className="lbl">{projects.data?.length ?? 0}</span></div>
          <div className="projects-list flex-1 space-y-2">
            {projects.isLoading ? <Skeleton className="h-28" /> : projects.isError ? <ErrorBlock message="Projects unavailable." onRetry={() => projects.refetch()} /> : !projects.data?.length ? (
              <div className="tile p-5 text-center"><p className="font-head text-lg">Nothing saved yet</p><p className="mt-1 text-sm" style={{ color: '#EAF3F8' }}>Your first assessment will appear here, ready to re-assess and compare.</p></div>
            ) : projects.data.map((p) => (
              <div key={p.id} className="tile p-3" data-testid={`card-project-${p.id}`}>
                <div className="flex items-center gap-4">
                  <Gauge value={pc(p.readiness)} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="font-head truncate text-lg">{p.name}</div>
                    <div className="lbl truncate !normal-case !tracking-normal">{p.source}</div>
                    <div className="mt-1 text-xs"><Dot color={/not|fail/i.test(p.verdict) ? '#FF5C6E' : /ready|clear/i.test(p.verdict) ? '#4FD99A' : '#FFA62B'} word={p.verdict} /> <span className="lbl ml-2">{p.runCount} runs</span></div>
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
          <p className="ink mt-3 p-2.5 text-xs leading-relaxed" style={{ color: '#EAF3F8' }}>Projects keep every assessment. Re-assessing compares the new result with the plan, item by item.</p>
        </aside>
      </div>

      <Modal open={change} onClose={() => setChange(false)} title="Which standards to check against" wide>
        <p className="mb-3 text-sm" style={{ color: '#EAF3F8' }}>Tick the standards that apply. Where a standard has levels, choose the one your context requires; press ⓘ if you are not sure what a level means.</p>
        <div className="standard-list !max-h-[60vh]">
          {standards.map((s) => {
            const on = !!sel[s.id];
            const isIsm = /ism/i.test(s.id);
            return (
              <div key={s.id} className="standard-row ink" style={{ borderColor: on ? 'rgba(0,229,255,.6)' : undefined }} data-testid={`row-standard-${s.id}`}>
                <div className="flex min-w-0 flex-wrap items-center gap-2 py-1">
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-[#00E5FF]" checked={on} onChange={(e) => setSel({ ...sel, [s.id]: e.target.checked })} data-testid={`checkbox-standard-${s.id}`} aria-label={`Select ${s.name}`} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{s.short} <span className="font-normal" style={{ color: '#B9DCEA' }}>· {s.name}</span></span><span className="lbl !text-[9px]">{s.items} requirements</span></span>
                  <InfoButton label={s.short} onClick={() => setInfo(s)} />
                  {on && !!s.levels?.length && <select aria-label={`${s.short} level`} className="field !w-auto !max-w-[120px] !px-2 !py-1 text-xs" value={levels[s.id] ?? s.defaultLevel ?? s.levels[0]} onChange={(e) => setLevels({ ...levels, [s.id]: e.target.value })} data-testid={`select-level-${s.id}`}>{s.levels.map((l) => <option key={l} value={l}>{levelDisplay(s.id, l)}</option>)}</select>}
                  {on && isIsm && <select aria-label="ISM classification" className="field !w-auto !max-w-[150px] !px-2 !py-1 text-xs" value={classification} onChange={(e) => setClassification(e.target.value)} data-testid="select-classification">{CLASSES.map((c) => <option key={c}>{c}</option>)}</select>}
                  {on && /e8|essential|ism/i.test(s.id) && <select aria-label="Essential Eight maturity" className="field !w-auto !max-w-[170px] !px-2 !py-1 text-xs" value={maturity} onChange={(e) => setMaturity(Number(e.target.value))} data-testid="select-maturity">{[1, 2, 3].map((m) => <option key={m} value={m}>Maturity Level {MATURITY[m - 1]}</option>)}</select>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end"><button className="btn btn-primary" onClick={() => setChange(false)} data-testid="button-standards-done">Done · {chosen.length} selected</button></div>
      </Modal>
      <StandardInfoModal std={info} level={info ? (levels[info.id] ?? info.defaultLevel) : undefined} classification={classification} maturity={maturity} onClose={() => setInfo(null)} />

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
