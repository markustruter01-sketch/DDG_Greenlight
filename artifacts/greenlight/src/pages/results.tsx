import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowRight, GitCompare, SlidersHorizontal } from 'lucide-react';
import {
  getGetAssessmentQueryKey,
  useGetAssessment,
  useGetGreenlightConfig,
  useUpdateAssessment,
} from '@workspace/api-client-react';
import { useGate } from '@/hooks/use-gate';
import { Shell } from '@/components/shell';
import { Dot, ErrorBlock, Gauge, Modal, Skeleton } from '@/components/gl';
import { OrbitView, type OrbitControlApi, type OrbitSnapshot } from '@/components/orbit-view';
import { DetailPanel, type Target } from '@/components/detail-panel';
import { CompareModal } from '@/components/compare';
import { ANNUNCIATORS, findingsFor, pc, statusMap, tally, tone, waveOf } from '@/lib/greenlight';

const RING_COLORS = ['#7CC9E8', '#00E5FF', '#CFE3EE'];
const CLASSES = ['Non-classified', 'OFFICIAL: Sensitive', 'PROTECTED', 'SECRET', 'TOP SECRET'];
const TOUR_SEEN_KEY = 'ddg-greenlight-results-tour-seen';
const TOUR_STEPS = [
  { title: 'This is your software', body: 'The glass planet represents the software being assessed.', seconds: 7 },
  { title: 'Three rings, three kinds of requirement', body: 'Safety is the inner ring, security is the middle ring, and AI requirements are the outer ring.', seconds: 9 },
  { title: 'Every dot is one requirement', body: 'Green means met, amber means partial, red means failed, and dim dots are not applicable.', seconds: 9 },
  { title: 'Raised pins are must-fix', body: 'Raised red pins mark blocking items that must be addressed before release.', seconds: 9 },
  { title: 'Links show shared evidence', body: 'One fix can close related requirements across more than one standard.', seconds: 9 },
  { title: 'Readiness per standard', body: 'Each ring shows readiness against a standard. Select one to see its controls and further testing.', seconds: 9 },
  { title: 'The plan, wave by wave', body: 'Waves show projected progress. The same rules check the code again after fixes.', seconds: 15 },
  { title: 'Click anything for its evidence', body: 'A finding shows its rating, evidence files and rule, and proof of fix.', seconds: 10 },
  { title: 'Fix it with Claude', body: 'Checking is rules, never AI. Only fixing uses Claude, and you approve every change.', seconds: 13 },
];
type TourStatus = 'closed' | 'prompt' | 'playing' | 'paused' | 'complete';
type SavedTourState = {
  camera: OrbitSnapshot;
  wave: number;
  target: Target;
  picked: string | null;
  layers: Record<string, boolean>;
};
const countFiles = (inventory: unknown) => {
  if (Array.isArray(inventory)) return inventory.length;
  if (inventory && typeof inventory === 'object') {
    const data = inventory as Record<string, unknown>;
    if (typeof data.files === 'number') return data.files;
    if (Array.isArray(data.files)) return data.files.length;
    if (typeof data.fileCount === 'number') return data.fileCount;
  }
  return null;
};

export default function Results() {
  const { id = '' } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const q = useGetAssessment(id, { query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id) } });
  const cfg = useGetGreenlightConfig();
  const upd = useUpdateAssessment();
  const { run: gated, signedIn } = useGate();
  const [wave, setWave] = useState(0);
  const [target, setTarget] = useState<Target>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [override, setOverride] = useState(false);
  const [ovr, setOvr] = useState(CLASSES[0]);
  const [orbitReady, setOrbitReady] = useState(false);
  const [tourStatus, setTourStatus] = useState<TourStatus>('closed');
  const [tourIndex, setTourIndex] = useState(-1);
  const [tourRunId, setTourRunId] = useState(0);
  const [tourRemaining, setTourRemaining] = useState(0);
  const [readinessHighlight, setReadinessHighlight] = useState(false);
  const orbitControls = useRef<OrbitControlApi | null>(null);
  const savedTour = useRef<SavedTourState | null>(null);
  const tourDeadline = useRef(0);
  const lastTourStep = useRef(-1);
  const run = q.data;

  useEffect(() => {
    setWave(0);
    setTarget(null);
    setPicked(null);
    setTourStatus('closed');
    setTourIndex(-1);
    savedTour.current = null;
  }, [id]);

  useEffect(() => {
    if (!run || !orbitReady) return;
    let seen = false;
    try { seen = window.localStorage.getItem(TOUR_SEEN_KEY) === '1'; } catch { seen = true; }
    if (!seen) setTourStatus('prompt');
  }, [run?.id, orbitReady]);

  const rememberTour = () => {
    try { window.localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch { /* tour still works if storage is blocked */ }
  };
  const restoreTourState = (keepSnapshot = false) => {
    const saved = savedTour.current;
    const controls = orbitControls.current;
    if (!saved || !controls) return Promise.resolve(false);
    controls.pausePlayback(false);
    for (const [layer, enabled] of Object.entries(saved.layers)) controls.setLayer(layer, enabled);
    setWave(saved.wave);
    setTarget(saved.target);
    setPicked(saved.picked);
    const restore = controls.restore(saved.camera);
    controls.pauseAuto(false);
    if (!keepSnapshot) savedTour.current = null;
    return restore;
  };
  const beginTourPlayback = () => {
    const controls = orbitControls.current;
    if (!run || !controls) return;
    if (!savedTour.current) {
      savedTour.current = {
        camera: controls.snapshot(),
        wave,
        target,
        picked,
        layers: Object.fromEntries(['mustfix', 'gaps', 'passing', 'links'].map((layer) => [layer, controls.getLayer(layer)])),
      };
    }
    controls.pauseAuto(true);
    controls.pausePlayback(false);
    setWave(0);
    setTarget(null);
    setPicked(null);
    setTourRemaining(TOUR_STEPS[0].seconds * 1000);
    setTourIndex(0);
    setTourRunId((value) => value + 1);
    setTourStatus('playing');
  };
  const startTour = () => {
    if (tourStatus === 'complete' && savedTour.current) {
      void restoreTourState(true).then(beginTourPlayback);
    } else beginTourPlayback();
  };
  const finishTour = () => {
    rememberTour();
    setTourStatus('closed');
    setTourIndex(-1);
    setReadinessHighlight(false);
    void restoreTourState(false);
  };
  const advanceTour = (next: number) => {
    if (next < 0) return;
    if (next >= TOUR_STEPS.length) {
      setTourStatus('complete');
      setTourRemaining(0);
      orbitControls.current?.pausePlayback(false);
      return;
    }
    setTourIndex(next);
    setTourRemaining(TOUR_STEPS[next].seconds * 1000);
    setTourStatus('playing');
    orbitControls.current?.pausePlayback(false);
  };
  const toggleTourPlayback = () => {
    if (tourStatus === 'playing') {
      setTourRemaining(Math.max(0, tourDeadline.current - performance.now()));
      orbitControls.current?.pausePlayback(true);
      setTourStatus('paused');
    } else if (tourStatus === 'paused') {
      orbitControls.current?.pausePlayback(false);
      setTourStatus('playing');
    }
  };

  const st = useMemo(() => (run ? statusMap(run, wave) : {}), [run, wave]);
  const counts = useMemo(() => (run ? tally(run, st) : null), [run, st]);
  const w = run ? waveOf(run, wave) : undefined;
  const projected = wave > 0;
  const goRun = (rid: string) => nav(`/results/${rid}`);
  const onOrbitControlsReady = (controls: OrbitControlApi | null) => {
    orbitControls.current = controls;
    setOrbitReady(!!controls);
  };
  const doClass = (accept: boolean) => {
    if (!run) return;
    if (!signedIn) return nav('/sign-in');
    upd.mutate(
      { id: run.id, data: accept ? { classification: run.classification.suggested, classificationAccepted: true } : { classification: ovr, classificationAccepted: true } },
      { onSuccess: (r) => { setOverride(false); setClassifyOpen(false); goRun(r.id); } },
    );
  };
  const fileCount = run ? countFiles(run.inventory) : null;
  const tourActive = ['playing', 'paused'].includes(tourStatus) && tourIndex >= 0;
  const tourFocusing = tourActive && [0, 1, 2, 3, 4, 6, 7].includes(tourIndex);

  useEffect(() => {
    if (tourStatus !== 'playing' || tourIndex < 0) return;
    tourDeadline.current = performance.now() + tourRemaining;
    const timer = window.setTimeout(() => {
      if (tourIndex >= TOUR_STEPS.length - 1) {
        setTourStatus('complete');
        orbitControls.current?.pausePlayback(false);
      } else {
        const next = tourIndex + 1;
        setTourIndex(next);
        setTourRemaining(TOUR_STEPS[next].seconds * 1000);
      }
    }, tourRemaining);
    return () => window.clearTimeout(timer);
  }, [tourStatus, tourIndex, tourRunId, tourRemaining]);

  useEffect(() => {
    if (!run || tourIndex < 0 || !['playing', 'paused'].includes(tourStatus)) return;
    const controls = orbitControls.current;
    if (!controls) return;
    controls.pauseAuto(true);
    const previous = lastTourStep.current;
    if (previous === 7 && tourIndex !== 7) {
      setTarget(null);
      setPicked(null);
    }
    lastTourStep.current = tourIndex;
    const baselineStatuses = statusMap(run, 0);
    const pin = run.findings.find((finding) => finding.blocking && ['N', 'P'].includes(baselineStatuses[finding.key]))
      ?? run.findings.find((finding) => finding.blocking)
      ?? run.findings[0];
    const pinKey = pin?.key;

    if (tourIndex === 0) {
      controls.emphasis('core');
      controls.pulse('core', 6200);
      void controls.shot({ target: [0, 0, 0], az: 0, el: 10, dist: 8, seconds: 2.1, lift: 0.08 });
    } else if (tourIndex === 1) {
      void controls.home();
      controls.emphasis('saf');
      controls.pulse('saf', 2700);
    } else if (tourIndex === 2) {
      controls.emphasis('sec');
      void controls.shot({ target: [0, -0.4, 0], az: 34, el: 20, dist: 23, seconds: 2.5, drift: 1.2 });
    } else if (tourIndex === 3) {
      controls.emphasis('mustfix');
      if (pinKey) {
        setPicked(pinKey);
        controls.select(pinKey);
        void controls.focus(pinKey);
      }
    } else if (tourIndex === 4) {
      controls.setLayer('links', true);
      controls.emphasis('links');
      if (pinKey) {
        setPicked(pinKey);
        controls.select(pinKey);
        void controls.focus(pinKey);
      }
    } else if (tourIndex === 5) {
      controls.emphasis(null);
      controls.select(null);
      setWave(0);
      void controls.home();
      setReadinessHighlight(true);
    } else if (tourIndex === 6) {
      controls.emphasis(null);
      controls.select(null);
      setTarget(null);
      setPicked(null);
      setWave(0);
      void controls.home();
    } else if (tourIndex === 7) {
      controls.emphasis('mustfix');
      if (pinKey) {
        setPicked(pinKey);
        setTarget({ kind: 'finding', key: pinKey });
        controls.select(pinKey);
        void controls.focus(pinKey);
      }
    } else if (tourIndex === 8) {
      controls.emphasis('core');
      setTarget(null);
      setPicked(null);
      void controls.home();
    }
  }, [run, tourIndex, tourRunId]);

  useEffect(() => {
    if (tourStatus !== 'playing' || tourIndex < 0) return;
    const timers: number[] = [];
    let interval = 0;
    if (tourIndex === 1) {
      const controls = orbitControls.current;
      timers.push(window.setTimeout(() => { controls?.emphasis('sec'); controls?.pulse('sec', 2700); }, 3000));
      timers.push(window.setTimeout(() => { controls?.emphasis('ai'); controls?.pulse('ai', 2700); }, 6000));
    }
    if (tourIndex === 5) {
      setReadinessHighlight(true);
      timers.push(window.setTimeout(() => setReadinessHighlight(false), 2000));
    }
    if (tourIndex === 6) {
      const sequence = [1, 2, 3, 4];
      let step = 0;
      interval = window.setInterval(() => {
        if (step < sequence.length) setWave(sequence[step++]);
      }, 3000);
    }
    return () => {
      timers.forEach(window.clearTimeout);
      if (interval) window.clearInterval(interval);
    };
  }, [tourStatus, tourIndex, tourRunId]);

  useEffect(() => {
    if (tourStatus === 'closed') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finishTour();
      } else if (event.key === 'ArrowRight' && ['playing', 'paused'].includes(tourStatus)) {
        event.preventDefault();
        advanceTour(tourIndex + 1);
      } else if (event.key === 'ArrowLeft' && ['playing', 'paused', 'complete'].includes(tourStatus)) {
        event.preventDefault();
        advanceTour(tourIndex - 1);
      } else if (event.key === ' ' && ['playing', 'paused'].includes(tourStatus)) {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'BUTTON') return;
        event.preventDefault();
        toggleTourPlayback();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tourStatus, tourIndex]);

  return (
    <Shell runId={id} bg="glacier-ice.webp" tourHeaderHighlight={tourIndex === 8 && !['closed', 'prompt'].includes(tourStatus)} runMeta={run ? `${run.projectName} · ${new Date(run.assessedAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}${fileCount == null ? '' : ` · ${fileCount} files`}` : undefined}>
      {q.isLoading || !run || !counts ? (
        q.isError ? <div className="flex flex-1 items-center justify-center"><ErrorBlock message="This assessment could not be loaded." onRetry={() => q.refetch()} /></div> :
          <div className="grid flex-1 gap-4 px-4 py-4 lg:grid-cols-[214px_1fr]"><Skeleton className="h-24 lg:col-span-2" /><Skeleton className="h-full" /><Skeleton className="h-full" /></div>
      ) : (
        <div className={`result-layout ${tourFocusing ? 'tour-focusing' : ''}`}>
          <section className="glass result-band">
            {(() => {
              const t = tone(counts);
              return <div className="flex min-w-0 items-center gap-3">
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center" data-testid="verdict-light">
                  <span className="absolute inset-0 rounded-full" style={{ background: t.color, opacity: .35, animation: 'pulse-ring 2.4s infinite' }} />
                  <span className="h-9 w-9 rounded-full" style={{ background: `radial-gradient(circle at 35% 30%,#fff9,${t.color} 55%)`, boxShadow: `0 0 22px ${t.color}70` }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="lbl truncate">{run.projectName}{run.isDemo && <span className="ml-2 rounded px-1.5 py-0.5 text-white" style={{ background: '#B5128F', fontSize: 9 }} data-testid="badge-example-data">EXAMPLE DATA</span>}</div>
                  <div className="font-head text-2xl font-semibold leading-tight" data-testid="text-verdict">{projected ? t.word : run.verdict}</div>
                  <div className="lbl !text-[9px]" style={{ color: projected ? '#00E5FF' : undefined }}>{projected ? `Projected after wave ${wave} · not measured` : `${counts.blocking} must-fix · ${counts.failed + counts.partial} open · ${Math.max(0, counts.total - counts.unanswered)} rated`}</div>
                  {run.classification.suggested && <button className="lbl mt-1 inline-flex items-center gap-1 !text-[9px] !text-[#00E5FF]" onClick={() => setClassifyOpen(true)} data-testid="button-classification-details"><SlidersHorizontal size={11} /> ISM classification · {run.classification.accepted ? 'accepted' : 'decision needed'}</button>}
                </div>
              </div>;
            })()}
            <div className="ann-grid" data-testid="annunciators">
              {ANNUNCIATORS.map((a) => {
                const list = findingsFor(run, a.id);
                const open = list.filter((f) => ['P', 'N', 'UN'].includes(st[f.key]));
                const bad = list.some((f) => st[f.key] === 'N' || (f.blocking && st[f.key] === 'P'));
                const color = !list.length ? '#7F98A8' : bad ? '#FF5C6E' : open.length ? '#F5C451' : '#4FD99A';
                return (
                  <button key={a.id} className="tile ann-item" onClick={() => setTarget({ kind: 'theme', id: a.id })} data-testid={`button-annunciator-${a.id}`}>
                    <span className="dotx" style={{ background: color }} />
                    <span className="min-w-0 flex-1 truncate lbl !text-[9px] !tracking-[.04em]">{a.label}</span>
                    <span className="font-mono text-xs">{open.length}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="result-workspace relative">
            <aside className={`glass readiness-column ${readinessHighlight ? 'is-tour-highlight' : ''}`} data-testid="readiness-rings">
              <div className="lbl flex-none">{projected ? `Readiness · wave ${wave}` : 'Readiness'}</div>
              {run.standards.map((s, i) => {
                const value = pc(w ? w.readiness[s.id] ?? s.readiness : s.readiness);
                return <button key={s.id} onClick={() => setTarget({ kind: 'standard', id: s.id })} className="tile flex shrink-0 items-center gap-2 p-2 text-left" data-testid={`button-standard-${s.id}`}>
                  <Gauge value={value} size={42} color={RING_COLORS[i % RING_COLORS.length]} label={`${value}`} />
                  <span className="min-w-0"><span className="block truncate font-head text-xs font-medium">{s.short}</span><span className="lbl !text-[9px]">{s.blocking ? `${s.blocking} must-fix` : s.verdict}</span></span>
                </button>;
              })}
              <div className="mt-auto flex flex-none flex-col gap-1.5 pt-1">
                <button className="btn justify-center !px-2 !py-2 text-xs" onClick={() => setCompare(true)} data-testid="button-compare"><GitCompare size={14} /> Compare runs</button>
                <Link href={`/fix/${run.id}`} className="btn btn-primary justify-center !px-2 !py-2 text-xs" data-testid="link-fix">Fix and verify <ArrowRight size={14} /></Link>
              </div>
            </aside>
            <div className="glass orbit-workspace" style={{ background: 'rgba(6,19,26,.38)' }}>
              <OrbitView
                run={run}
                statuses={st}
                selected={picked}
                onPick={(key) => {
                  setPicked(key);
                  setTarget(key ? { kind: 'finding', key } : null);
                }}
                onControlsReady={onOrbitControlsReady}
                tourButton={<button className="btn !px-3 !py-1.5 text-xs" onClick={startTour} data-testid="button-play-tour">Tour</button>}
                controlsCenter={
                  <div className="orbit-wave-switch glass" role="tablist" data-testid="wave-switch" aria-label="Readiness projection">
                    {[0, 1, 2, 3, 4].map((n) => {
                      const available = n === 0 || run.waves.some((item) => item.number === n);
                      const tourWave = tourIndex === 6 && ['playing', 'paused'].includes(tourStatus);
                      return <button key={n} role="tab" aria-selected={wave === n} disabled={!available && !tourWave}
                        onClick={() => setWave(n)} className="orbit-wave-pill"
                        style={{ background: wave === n ? 'rgba(0,229,255,.16)' : 'transparent', color: wave === n ? '#F7FBFF' : '#CFE3EE' }}
                        data-testid={`button-wave-${n}`}>{n === 0 ? 'Baseline' : `Wave ${n}`}</button>;
                    })}
                  </div>
                }
                tourCaption={tourIndex >= 0 && ['playing', 'paused', 'complete'].includes(tourStatus) ? (
                  <div className={`glass orbit-tour-caption ${tourIndex === 7 ? 'tour-caption-left' : ''}`} data-testid="tour-caption">
                    <div className="orbit-tour-caption-row">
                      <div className="min-w-0">
                        <div className="lbl !text-[#00E5FF]">{tourIndex + 1} / {TOUR_STEPS.length} · GUIDED TOUR</div>
                        <div className="font-head text-sm font-semibold">{TOUR_STEPS[tourIndex].title}</div>
                        <p className="text-xs text-[#CFE3EE]">{TOUR_STEPS[tourIndex].body}</p>
                      </div>
                      <div className="orbit-tour-caption-controls">
                        {tourStatus === 'complete' ? (
                          <>
                            <button className="btn !px-3 !py-1.5 text-xs" onClick={startTour} data-testid="button-tour-replay">Replay</button>
                            <button className="btn btn-primary !px-3 !py-1.5 text-xs" onClick={finishTour} data-testid="button-tour-done">Done</button>
                          </>
                        ) : (
                          <>
                            <button className="btn !px-2 !py-1.5 text-xs" onClick={() => advanceTour(tourIndex - 1)} disabled={tourIndex === 0} data-testid="button-tour-previous">Previous</button>
                            <button className="btn !px-2 !py-1.5 text-xs" onClick={toggleTourPlayback} data-testid="button-tour-pause">{tourStatus === 'paused' ? 'Resume' : 'Pause'}</button>
                            <button className="btn !px-2 !py-1.5 text-xs" onClick={() => advanceTour(tourIndex + 1)} data-testid="button-tour-next">Next</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
                tourPrompt={tourStatus === 'prompt' ? (
                  <div className="orbit-tour-shade" data-testid="tour-first-load-prompt">
                    <div className="glass orbit-tour-card">
                      <div className="lbl !text-[#00E5FF]">RESULTS WALKTHROUGH</div>
                      <h2 className="font-head mt-2 text-xl font-semibold">How to read this</h2>
                      <p className="mt-2 text-sm text-[#CFE3EE]">Take a guided tour of the live orbit, the standards, and the fix plan.</p>
                      <div className="mt-5 flex items-center gap-3">
                        <button className="btn btn-primary" onClick={startTour} data-testid="button-tour-play">Play the tour (90 s)</button>
                        <button className="lbl rounded-lg px-3 py-2 hover:text-[#00E5FF]" onClick={finishTour} data-testid="button-tour-skip">Skip</button>
                      </div>
                    </div>
                  </div>
                ) : null}
              />
            </div>
            <DetailPanel run={run} config={cfg.data} target={target} st={st} projected={projected} onClose={() => { setTarget(null); setPicked(null); }} onRun={goRun}
              onSelectFinding={(key) => { setPicked(key); setTarget({ kind: 'finding', key }); void orbitControls.current?.focus(key); }} />
          </div>
        </div>
      )}
      {run && <>
        <Modal open={classifyOpen} onClose={() => setClassifyOpen(false)} title="Suggested ISM classification">
          <div className="space-y-4">
            <div className="tile p-4"><div className="lbl">Suggested · {run.classification.accepted ? 'accepted' : 'needs your decision'}</div><div className="font-head mt-2 text-xl">{run.classification.suggested} <span className="lbl">current {run.classification.current}</span></div><p className="mt-2 text-sm text-[#CFE3EE]">{run.classification.reason}</p>
              {run.classification.evidence.slice(0, 3).map((e, i) => <div key={i} className="mt-2 font-mono text-xs text-[#00E5FF]">{e.file}{e.line ? `:${e.line}` : ''} <span className="text-[#CFE3EE]">{e.note}</span></div>)}
              <div className="lbl mt-2 !normal-case !tracking-normal">{run.classification.attribution}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={upd.isPending || run.classification.accepted} onClick={() => doClass(true)} data-testid="button-accept-classification">Accept suggestion</button>
              <button className="btn" disabled={upd.isPending} onClick={() => gated(() => setOverride(true))} data-testid="button-override-classification">Override</button>
            </div>
            {upd.isError && <Dot color="#FF5C6E" word="Update failed" />}
          </div>
        </Modal>
        <Modal open={override} onClose={() => setOverride(false)} title="Override classification">
          <select className="field" value={ovr} onChange={(e) => setOvr(e.target.value)} data-testid="select-override-classification">{CLASSES.map((c) => <option key={c}>{c}</option>)}</select>
          <button className="btn btn-primary mt-4" disabled={upd.isPending} onClick={() => doClass(false)} data-testid="button-confirm-override">{upd.isPending ? 'Re-running the rules' : 'Apply and re-assess'}</button>
        </Modal>
        <CompareModal projectId={run.projectId} open={compare} onClose={() => setCompare(false)} />
      </>}
    </Shell>
  );
}
