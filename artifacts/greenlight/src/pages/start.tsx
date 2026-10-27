import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileArchive, GitCompare, RefreshCw, Upload } from 'lucide-react';
import {
  getListProjectsQueryKey,
  useCreateAssessment,
  useGetGreenlightConfig,
  useListProjects,
  type Project,
} from '@workspace/api-client-react';
import { SignIn, SignUp } from '@clerk/react';
import { useGate } from '@/hooks/use-gate';
import { Shell } from '@/components/shell';
import { CompareModal } from '@/components/compare';
import { Dot, ErrorBlock, Gauge, Modal, Skeleton } from '@/components/gl';
import { pc, publicSource, uploadZip } from '@/lib/greenlight';
import { CLASSIFICATION_CHOICES, LEVEL_CHOICES, MATURITY_CHOICES, STANDARD_INFO, levelDisplay, plainName, type LevelChoice } from '@/lib/standard-info';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

type Std = { id: string; name: string; short: string; items: number; levels?: string[]; defaultLevel?: string };
type Stage = 'code' | 'standards' | 'levels';

/** The choices survive moving between the three screens and a sign-in round trip. */
const draft: {
  mode: 'github' | 'zip'; github: string; file: File | null; sel: Record<string, boolean>; levels: Record<string, string>;
  classification: string; maturity: number; reassess: Project | null;
} = { mode: 'github', github: '', file: null, sel: {}, levels: {}, classification: 'PROTECTED', maturity: 2, reassess: null };

function Seg({ label, choices, value, onChange, testId }: { label: string; choices: LevelChoice[]; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {choices.map((c) => (
        <button key={c.value} type="button" className={c.value === value ? 'is-on' : ''} aria-pressed={c.value === value} onClick={() => onChange(c.value)} data-testid={`${testId}-${c.value.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>
          {c.label}<em>{c.hint}</em>
        </button>
      ))}
    </div>
  );
}

function StandardInfoModal({ std, level, classification, maturity, onClose }: { std: Std | null; level?: string; classification: string; maturity: number; onClose: () => void }) {
  const info = std ? STANDARD_INFO[std.id] : undefined;
  return (
    <Modal open={!!std} onClose={onClose} title={std ? `${info?.plain ?? std.short} · ${std.short}` : ''}>
      {std && (
        <div className="space-y-3 text-sm">
          <div className="ink p-3"><div className="lbl mb-1">What it is</div><p className="leading-relaxed">{info?.what ?? std.name}</p></div>
          <div className="ink p-3"><div className="lbl mb-1">Who it is for</div><p className="leading-relaxed">{info?.who ?? 'Teams that need to show this standard is met.'}</p></div>
          <div className="ink p-3"><div className="lbl mb-1">What Greenlight checks</div><p className="leading-relaxed">{std.items} requirements from this standard, each by a written rule in code that reads the repository. Requirements that need process evidence rather than code are asked as questions, never guessed.</p></div>
          {info?.levels && (
            <div>
              <div className="lbl mb-2">{info.levelName}</div>
              <div className="space-y-2">
                {info.levels.map((l) => {
                  const now = l.value === 'classification' ? classification : l.value === 'maturity' ? `Level ${maturity}` : null;
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

/**
 * Steps 1 and 2 · three screens on one road: where the code is, which
 * standards to check it against, and how strict each one should be.
 */
export default function Start({ auth }: { auth?: 'in' | 'up' }) {
  const { stage: stageParam } = useParams<{ stage?: string }>();
  const stage: Stage = stageParam === 'standards' ? 'standards' : stageParam === 'levels' ? 'levels' : 'code';
  const { signedIn, run: gated } = useGate();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const cfg = useGetGreenlightConfig();
  const projects = useListProjects();
  const create = useCreateAssessment();
  const [mode, setMode] = useState(draft.mode);
  const [github, setGithub] = useState(draft.github);
  const [file, setFile] = useState<File | null>(draft.file);
  const [sel, setSel] = useState(draft.sel);
  const [levels, setLevels] = useState(draft.levels);
  const [classification, setClassification] = useState(draft.classification);
  const [maturity, setMaturity] = useState(draft.maturity);
  const [reassess, setReassess] = useState<Project | null>(draft.reassess);
  const [cmp, setCmp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<Std | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { Object.assign(draft, { mode, github, file, sel, levels, classification, maturity, reassess }); }, [mode, github, file, sel, levels, classification, maturity, reassess]);

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
  const needsIsm = chosen.some((s) => /ism/i.test(s.id));
  const needsE8 = chosen.some((s) => /e8|essential|ism/i.test(s.id));
  const sourceOk = mode === 'github' ? /github\.com\//i.test(github) || /^[\w.-]+\/[\w.-]+$/.test(github.trim()) : !!file;
  const repoName = mode === 'github' ? (github.trim().match(/([\w.-]+?)(?:\.git)?\/?$/)?.[1] ?? '') : file?.name.replace(/\.zip$/i, '') ?? '';
  const leveled = chosen.filter((s) => s.levels?.length && LEVEL_CHOICES[s.id]);
  const demo = (projects.data ?? []).find((p) => /gods.?eye/i.test(p.name) || /gods-eye-view/i.test(p.source)) ?? (projects.data ?? [])[0];
  const questions = leveled.length + (needsIsm ? 1 : 0) + (needsE8 ? 1 : 0);

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
    setSaved(false);
    if (/^https?:\/\/|github\.com/i.test(p.source)) { setMode('github'); setGithub(p.source); }
    else { setMode('zip'); setTimeout(() => fileRef.current?.click(), 50); }
  };

  const guide = stage === 'code'
    ? { steps: [mode === 'github' ? 'Paste the GitHub link of the software you want checked' : 'Choose the zip of the source folder', 'Pick the standards (already chosen for you)', 'Press Check my code'], current: 0 }
    : stage === 'standards'
      ? { steps: ['Keep the standards that apply; tap one to turn it off', questions ? 'Set how strict, or skip' : 'Press Check my code'], current: 0 }
      : { steps: ['Only change a level if you know the answer', busy ? 'Reading the code and running the rules, about a minute' : 'Press Check my code'], current: busy ? 1 : 0 };

  const checkButton = (
    <button className="btn btn-go btn-big" disabled={!chosen.length || !sourceOk || busy} onClick={() => gated(run)} data-testid="button-assess">
      {busy ? 'Reading the code…' : `Check ${repoName || 'my code'}`} {!busy && <ArrowRight size={20} />}
    </button>
  );

  return (
    <Shell guide={guide} roadStep={stage === 'code' ? 0 : 1} pip={
      stage === 'code'
        ? (saved && demo
          ? { id: 'start-open', what: 'The sample project is already checked.', press: `Press Open on ${demo.name}.`, target: `[data-testid="link-open-${demo.id}"]` }
          : { id: 'start-saved', what: 'This is where your code goes in: a GitHub link or a zip.', press: 'For the walk-through, press Saved projects.', target: '[data-testid="button-saved-toggle"]', also: 'Next · pick the standards is the normal path for your own code.' })
        : stage === 'standards'
          ? { id: 'standards', what: 'The standards your code is checked against. Six are chosen for you.', press: questions ? 'Keep them. Press Next.' : 'Keep them. Press Check my code.', target: questions ? '[data-testid="link-next-levels"]' : '[data-testid="button-assess"]', also: 'ⓘ explains any of them in plain words.' }
          : { id: 'levels', what: 'How strict each standard is. The usual is already set.', press: 'Press Check my code.', target: '[data-testid="button-assess"]' }
    }>
      <div className="jl">
        {stage === 'code' && (
          <section className="glass jcard" data-testid="screen-code">
            <div className="jrow">
              <h1 className="jh">Where is your code?</h1>
              {reassess && <span className="jnote !text-[#00E5FF]">Re-checking {reassess.name} · <button className="underline" onClick={() => { setReassess(null); setGithub(''); setFile(null); }} data-testid="button-clear-reassess">clear</button></span>}
            </div>
            <p className="jp">Paste a GitHub link, or drop in a zip. Nothing is changed until you say so.</p>
            <div className="flex flex-wrap items-stretch gap-3">
              {mode === 'github' ? (
                <label className={`jfield flex-1 ${sourceOk ? 'is-ok' : ''}`}><span className="jnote" style={{ color: '#7CC9E8' }}>GitHub</span><input type="url" placeholder="https://github.com/your-team/your-project" aria-label="GitHub address" value={reassess && github === reassess.source ? publicSource(github) : github} onChange={(e) => { if (reassess && github === reassess.source) setReassess(null); setGithub(e.target.value); }} data-testid="input-github" /></label>
              ) : (
                <button type="button" className={`jfield flex-1 text-left ${file ? 'is-ok' : ''}`} onClick={() => fileRef.current?.click()} data-testid="button-choose-zip"><FileArchive size={20} /><span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16 }}>{file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : 'Choose a .zip of the source folder'}</span></button>
              )}
              <button type="button" className="btn btn-quiet" onClick={() => { if (mode === 'github') { setMode('zip'); if (!file) setTimeout(() => fileRef.current?.click(), 50); } else setMode('github'); }} data-testid={mode === 'github' ? 'button-mode-zip' : 'button-mode-github'}>
                <Upload size={16} /> {mode === 'github' ? 'Zip instead' : 'GitHub link instead'}
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMode('zip'); }} data-testid="input-zip" />
            {cfg.data && !cfg.data.githubEnabled && mode === 'github' && <span className="jnote">Public repositories only on this deployment.</span>}
            <div className="jrow">
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/start/standards" className={`btn btn-go btn-big ${sourceOk ? '' : 'pointer-events-none opacity-40'}`} aria-disabled={!sourceOk} data-testid="link-next-standards">Next · pick the standards <ArrowRight size={20} /></Link>
                <button className={`btn btn-quiet ${saved ? '' : 'btn-attn'}`} onClick={() => setSaved((v) => !v)} data-testid="button-saved-toggle">{saved ? 'Hide saved projects' : `Saved projects${projects.data?.length ? ` · ${projects.data.length}` : ''}`}</button>
              </div>
              {demo && <span className="jnote">Try the sample · <Link href={`/results/${demo.latestRunId}`} className="underline" style={{ color: '#00E5FF' }} data-testid="link-sample">{demo.name}</Link></span>}
            </div>
            {err && <div className="ink px-3 py-2" data-testid="text-error"><Dot color="#FF5C6E" word={err} /></div>}
            {saved && (
              <div className="ink p-3" data-testid="panel-saved">
                {projects.isLoading ? <Skeleton className="h-20" /> : projects.isError ? <ErrorBlock message="Projects unavailable." onRetry={() => projects.refetch()} /> : !projects.data?.length ? (
                  <p className="text-sm" style={{ color: '#DCE3E8' }}>Nothing saved yet. Your first check will appear here, ready to check again and compare.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {projects.data.map((p) => (
                      <div key={p.id} className="tile flex items-center gap-3 p-3" data-testid={`card-project-${p.id}`}>
                        <Gauge value={pc(p.readiness)} size={44} />
                        <div className="min-w-0 flex-1">
                          <div className="font-head truncate text-base">{p.name}</div>
                          <div className="text-xs" style={{ color: '#B9C3CC' }}>{p.verdict} · {p.runCount} runs</div>
                        </div>
                        <Link href={`/results/${p.latestRunId}`} className="btn !px-2 !py-1.5 text-xs" data-testid={`link-open-${p.id}`}>Open</Link>
                        <button className="btn !px-2 !py-1.5 text-xs" onClick={() => startReassess(p)} aria-label={`Check ${p.name} again`} data-testid={`button-reassess-${p.id}`}><RefreshCw size={13} /></button>
                        <button className="btn !px-2 !py-1.5 text-xs" onClick={() => setCmp(p.id)} aria-label={`Compare runs of ${p.name}`} data-testid={`button-compare-${p.id}`}><GitCompare size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {stage === 'standards' && (
          <section className="glass jcard" data-testid="screen-standards">
            <div className="jrow">
              <h1 className="jh">Check it against what?</h1>
              <span className="jnote">Tap to turn one off · ⓘ explains it</span>
            </div>
            <p className="jp">We picked the six a defence project usually needs. Keep them, or switch some off.</p>
            {cfg.isError ? <ErrorBlock message="Standards unavailable." onRetry={() => cfg.refetch()} /> : cfg.isLoading ? <Skeleton className="h-40" /> : (
              <div className="jgrid3" data-testid="panel-standards">
                {standards.map((s) => {
                  const on = !!sel[s.id];
                  return (
                    <div key={s.id} className={`jstd ${on ? '' : 'is-off'}`}>
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" style={{ background: 'none', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }} aria-pressed={on} onClick={() => setSel({ ...sel, [s.id]: !on })} data-testid={`checkbox-standard-${s.id}`}>
                        <span className="tick">{on ? '✓' : ''}</span>
                        <span className="min-w-0"><b>{plainName(s.id, s.short)}</b><small>{s.short} · {s.items} requirements</small></span>
                      </button>
                      <button type="button" className="info-btn" aria-label={`About ${s.short}`} onClick={() => setInfo(s)} data-testid={`button-info-${s.short.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>i</button>
                    </div>
                  );
                })}
              </div>
            )}
            {!chosen.length && !cfg.isLoading && <span className="text-sm" style={{ color: '#FFA62B' }}>Keep at least one standard on.</span>}
            <div className="jrow">
              <div className="flex flex-wrap items-center gap-3">
                {questions ? <Link href="/start/levels" className={`btn btn-go btn-big ${chosen.length ? '' : 'pointer-events-none opacity-40'}`} data-testid="link-next-levels">Next · how strict? <ArrowRight size={20} /></Link> : checkButton}
                <Link href="/start" className="btn btn-quiet" data-testid="link-back-code">Back</Link>
              </div>
              {questions ? <button className="btn btn-quiet" disabled={!chosen.length || !sourceOk || busy} onClick={() => gated(run)} data-testid="button-skip-levels">Skip · use the usual settings</button> : null}
            </div>
            {err && <div className="ink px-3 py-2" data-testid="text-error"><Dot color="#FF5C6E" word={err} /></div>}
          </section>
        )}

        {stage === 'levels' && (
          <section className="glass jcard" data-testid="screen-levels">
            <div className="jrow">
              <h1 className="jh">{questions === 1 ? 'One of your standards comes in levels.' : `${['', 'One', 'Two', 'Three', 'Four'][questions] ?? questions} of your standards come in levels.`}</h1>
              <span className="jnote">Each level changes which rules run</span>
            </div>
            <p className="jp">We've set the usual for a defence project. Only change one if you know the answer.</p>
            <div className="flex flex-col">
              {needsIsm && (
                <div className="jq" data-testid="q-classification"><span><span className="std">ISM + Essential Eight</span><b>What classification is the data it handles?</b><small>Picks which ISM controls must be met</small></span>
                  <Seg label="Classification" choices={CLASSIFICATION_CHOICES} value={classification} onChange={setClassification} testId="select-classification" /></div>
              )}
              {needsE8 && (
                <div className="jq" data-testid="q-maturity"><span><span className="std">Essential Eight</span><b>How hardened must the setup be?</b><small>Maturity level for patching, backups, admin rights and MFA</small></span>
                  <Seg label="Essential Eight maturity" choices={MATURITY_CHOICES} value={String(maturity)} onChange={(v) => setMaturity(Number(v))} testId="select-maturity" /></div>
              )}
              {leveled.map((s) => {
                const lc = LEVEL_CHOICES[s.id];
                const choices = lc.choices.filter((c) => s.levels!.includes(c.value));
                return (
                  <div key={s.id} className="jq" data-testid={`q-${s.id}`}><span><span className="std">{s.short}</span><b>{lc.question}</b><small>{lc.sets}</small></span>
                    <Seg label={`${s.short} level`} choices={choices.length ? choices : s.levels!.map((l) => ({ value: l, label: levelDisplay(s.id, l), hint: '' }))} value={levels[s.id] ?? s.defaultLevel ?? s.levels![0]} onChange={(v) => setLevels({ ...levels, [s.id]: v })} testId={`select-level-${s.id}`} /></div>
                );
              })}
            </div>
            <div className="jrow">
              <div className="flex flex-wrap items-center gap-3">{checkButton}<Link href="/start/standards" className="btn btn-quiet" data-testid="link-back-standards">Back</Link></div>
              <span className="jnote">About a minute · checks are code, not AI</span>
            </div>
            {err && <div className="ink px-3 py-2" data-testid="text-error"><Dot color="#FF5C6E" word={err} /></div>}
          </section>
        )}
      </div>

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
