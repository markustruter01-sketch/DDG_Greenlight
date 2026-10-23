import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowRight, ChevronLeft, ChevronRight, GitCompare, Pause, Play, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
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
import { TourPointer, type PointerTarget } from '@/components/tour-pointer';
import { TourProgress } from '@/components/tour-progress';
import { createNarrator } from '@/lib/narrator';
import { ANNUNCIATORS, findingsFor, pc, statusMap, tally, tone, waveOf } from '@/lib/greenlight';

const RING_COLORS = ['#7CC9E8', '#00E5FF', '#CFE3EE'];
const CLASSES = ['Non-classified', 'OFFICIAL: Sensitive', 'PROTECTED', 'SECRET', 'TOP SECRET'];
const TOUR_SEEN_KEY = 'ddg-greenlight-results-tour-seen';
const TOUR_STEPS = [
  { title: 'This is your software', body: 'The glass planet represents the software being assessed.', seconds: 12 },
  { title: 'Three rings, three kinds of requirement', body: 'Safety is the inner ring, security is the middle ring, and AI requirements are the outer ring.', seconds: 14 },
  { title: 'Every dot is one requirement', body: 'Green means met, amber means partial, red means failed, and dim dots are not applicable.', seconds: 14 },
  { title: 'Raised pins are must-fix', body: 'Raised red pins mark blocking items that must be addressed before release.', seconds: 14 },
  { title: 'Links show shared evidence', body: 'A link joins requirements in different standards that rest on the same evidence. One fix can close all of them.', seconds: 15 },
  { title: 'Readiness per standard', body: 'Each ring shows readiness against a standard. Select one to see its controls and further testing.', seconds: 14 },
  { title: 'The plan, wave by wave', body: 'Waves show projected progress. The same rules check the code again after fixes.', seconds: 20 },
  { title: 'Click anything for its evidence', body: 'A finding shows its rating, evidence files and rule, and proof of fix.', seconds: 15 },
  { title: 'Fix it with Claude', body: 'Checking is rules, never AI. Only fixing uses Claude, and you approve every change.', seconds: 18 },
];
const TOUR_TOTAL_SECONDS = TOUR_STEPS.reduce((n, s) => n + s.seconds, 0);
const VOICE_KEY = 'ddg-greenlight-tour-voice';
/** One timed moment in a tour step: camera, layers or the arrow. */
type Cue = { at: number; run: () => void };
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
  const [pointer, setPointer] = useState<{ key: string; target: PointerTarget } | null>(null);
  const [voiceOn, setVoiceOn] = useState(() => {
    try { return window.localStorage.getItem(VOICE_KEY) !== 'off'; } catch { return true; }
  });
  const narrator = useMemo(() => createNarrator(), []);
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
    narrator.stop();
    orbitControls.current?.showcaseLinks(null);
    setPointer(null);
    setTourStatus('closed');
    setTourIndex(-1);
    setReadinessHighlight(false);
    void restoreTourState(false);
  };
  const toggleVoice = () => {
    setVoiceOn((on) => {
      const next = !on;
      try { window.localStorage.setItem(VOICE_KEY, next ? 'on' : 'off'); } catch { /* per-viewer convenience only */ }
      if (!next) { narrator.stop(); spokenStep.current = ''; }
      return next;
    });
  };
  const advanceTour = (next: number) => {
    if (next < 0) return;
    if (next >= TOUR_STEPS.length) {
      setTourStatus('complete');
      setPointer(null);
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
  const tourFocusing = tourActive && [0, 1, 2, 3, 4, 7].includes(tourIndex);

  useEffect(() => {
    if (tourStatus !== 'playing' || tourIndex < 0) return;
    tourDeadline.current = performance.now() + tourRemaining;
    const timer = window.setTimeout(() => {
      if (tourIndex >= TOUR_STEPS.length - 1) {
        setTourStatus('complete');
        setPointer(null);
        orbitControls.current?.pausePlayback(false);
      } else {
        const next = tourIndex + 1;
        setTourIndex(next);
        setTourRemaining(TOUR_STEPS[next].seconds * 1000);
      }
    }, tourRemaining);
    return () => window.clearTimeout(timer);
  }, [tourStatus, tourIndex, tourRunId, tourRemaining]);

  /**
   * The tour as a timeline. Each slide is a list of cues (seconds from the
   * start of the slide): camera moves, layers, link highlights and the arrow.
   * Cues at 0 set the slide up; later ones play while the slide runs, pause
   * with it, and are not repeated on resume.
   */
  const cuesFor = (index: number): Cue[] => {
    const controls = orbitControls.current;
    if (!run || !controls) return [];
    const baselineStatuses = statusMap(run, 0);
    const pin = run.findings.find((finding) => finding.blocking && ['N', 'P'].includes(baselineStatuses[finding.key]))
      ?? run.findings.find((finding) => finding.blocking)
      ?? run.findings[0];
    const pinKey = pin?.key;
    const nameOf = (key: string) => {
      const f = run.findings.find((x) => x.key === key);
      return f ? `${f.standardShort} ${f.id}` : '';
    };
    const dom = (target: string, label?: string, key = target) =>
      setPointer({ key, target: { kind: 'dom', selector: target.startsWith('[') ? target : `[data-tour-target="${target}"]`, label } });
    const at = (target: string | { linkTheme: number } | { world: [number, number, number] }, label?: string, key = JSON.stringify(target)) =>
      setPointer({ key, target: { kind: 'point', resolve: () => orbitControls.current?.screenOf(target) ?? null, label } });
    const clear = () => setPointer(null);
    // Every slide starts from a clean scene, then sets up its own.
    const reset: Cue = {
      at: 0,
      run: () => {
        controls.pauseAuto(true);
        controls.select(null);
        controls.showcaseLinks(null);
        setTarget(null);
        setPicked(null);
        setReadinessHighlight(false);
        setWave(0);
        clear();
      },
    };
    const steps: Cue[][] = [
      // 0 · This is your software
      [
        { at: 0, run: () => { controls.emphasis('core'); controls.pulse('core', 6200); void controls.shot({ target: [0, 0, 0], az: 0, el: 10, dist: 8, seconds: 2.1, lift: 0.08 }); } },
        { at: 1.2, run: () => at({ world: [0, 0, 0] }, 'Your software') },
        { at: 5, run: () => { void controls.shot({ target: [0, 0, 0], az: 55, el: 22, dist: 12, seconds: 6, drift: 3 }); } },
      ],
      // 1 · Three rings
      [
        { at: 0, run: () => { void controls.home(); controls.emphasis('saf'); controls.pulse('saf', 3000); dom('ring-saf', 'Safety · inner ring'); } },
        { at: 4.5, run: () => { controls.emphasis('sec'); controls.pulse('sec', 3000); dom('ring-sec', 'Security · middle ring'); void controls.shot({ target: [0, 0, 0], az: 30, el: 26, dist: 26, seconds: 3, drift: 1 }); } },
        { at: 9, run: () => { controls.emphasis('ai'); controls.pulse('ai', 3000); dom('ring-ai', 'AI · outer ring'); void controls.shot({ target: [0, 0, 0], az: 70, el: 32, dist: 30, seconds: 3, drift: 1.5 }); } },
      ],
      // 2 · Every dot is one requirement
      [
        { at: 0, run: () => { controls.emphasis('sec'); void controls.shot({ target: [0, -0.4, 0], az: 34, el: 20, dist: 23, seconds: 2.5, drift: 1.2 }); dom('status-legend', 'Colour = status'); } },
        { at: 7, run: () => { controls.setLayer('passing', true); dom('layer-passing', 'Show passing items'); void controls.shot({ target: [0, -0.4, 0], az: 80, el: 34, dist: 20, seconds: 4, drift: 2 }); } },
      ],
      // 3 · Raised pins are must-fix
      [
        { at: 0, run: () => { controls.emphasis('mustfix'); if (pinKey) { setPicked(pinKey); controls.select(pinKey); void controls.focus(pinKey); } } },
        { at: 1.6, run: () => { if (pinKey) at(pinKey, `Must fix · ${nameOf(pinKey)}`); } },
        { at: 8, run: () => dom('layer-mustfix', 'Must-fix layer') },
      ],
      // 4 · Links show shared evidence
      (() => {
        const themes = controls.linkThemes();
        const first = themes[0]?.theme;
        const second = themes[1]?.theme;
        const ends = first == null ? null : controls.linkEnds(first);
        if (first == null) return [{ at: 0, run: () => { controls.setLayer('links', true); controls.emphasis('links'); dom('layer-links', 'Links layer'); } }];
        return [
          { at: 0, run: () => { controls.setLayer('links', true); controls.emphasis('links'); void controls.showcaseLinks(first, { az: 24, el: 34, dist: 12, seconds: 2.4 }); } },
          { at: 1.8, run: () => at({ linkTheme: first }, `Shared evidence · ${themes[0].count} link${themes[0].count === 1 ? '' : 's'}`) },
          ...(ends ? [
            { at: 5, run: () => { void controls.focus(ends.a); at(ends.a, nameOf(ends.a)); } },
            { at: 8.5, run: () => { void controls.focus(ends.b); at(ends.b, nameOf(ends.b)); } },
          ] : []),
          ...(second != null ? [
            { at: 12, run: () => { controls.select(null); void controls.showcaseLinks(second, { az: -40, el: 30, dist: 13, seconds: 2.2 }); at({ linkTheme: second }, 'Another shared fix'); } },
          ] : [{ at: 12, run: () => dom('layer-links', 'Links layer') }]),
        ];
      })(),
      // 5 · Readiness per standard
      [
        { at: 0, run: () => { controls.emphasis(null); void controls.home(); setReadinessHighlight(true); dom('[data-testid="readiness-rings"]', 'Readiness per standard'); } },
        { at: 3, run: () => setReadinessHighlight(false) },
        ...(run.standards[0] ? [{ at: 7, run: () => dom(`[data-testid="button-standard-${run.standards[0].id}"]`, `${run.standards[0].short} · select for detail`) }] : []),
      ],
      // 6 · The plan, wave by wave
      [
        { at: 0, run: () => { controls.emphasis(null); void controls.home(); dom('[data-testid="wave-switch"]', 'Fix plan, wave by wave'); } },
        ...[1, 2, 3, 4].map((n, i) => ({
          at: 3 + i * 3,
          run: () => {
            setWave(n);
            dom(`[data-testid="button-wave-${n}"]`, `Wave ${n}`);
            if (i === 0) void controls.shot({ target: [0, 0, 0], az: 40, el: 30, dist: 28, seconds: 11, drift: 3 });
          },
        })),
        { at: 15.5, run: () => dom('[data-testid="text-verdict"]', 'Projected verdict') },
      ],
      // 7 · Click anything for its evidence
      [
        { at: 0, run: () => { controls.emphasis('mustfix'); if (pinKey) { setPicked(pinKey); setTarget({ kind: 'finding', key: pinKey }); controls.select(pinKey); void controls.focus(pinKey); } } },
        { at: 1.5, run: () => dom('detail-panel', 'Rating, evidence, rule, proof of fix') },
        { at: 8, run: () => { if (pinKey) at(pinKey, 'Click any dot'); } },
      ],
      // 8 · Fix it with Claude
      [
        { at: 0, run: () => { controls.emphasis('core'); void controls.home(); dom('rules-badge', 'Checked by rules · no AI'); } },
        { at: 7, run: () => dom('fix-button', 'Fix it with Claude') },
        { at: 13, run: () => dom('nav-replay', 'Watch a recorded fix') },
      ],
    ];
    return [reset, ...(steps[index] ?? [])];
  };

  // Which cues of the current slide have run (reset when the slide or the run changes).
  const firedCues = useRef<{ key: string; done: Set<number> }>({ key: '', done: new Set() });
  const cueList = useRef<Cue[]>([]);
  useEffect(() => {
    if (!run || tourIndex < 0 || !['playing', 'paused'].includes(tourStatus)) return;
    const key = `${tourRunId}:${tourIndex}`;
    if (firedCues.current.key === key) return;
    cueList.current = cuesFor(tourIndex);
    firedCues.current = { key, done: new Set() };
    cueList.current.forEach((cue, i) => {
      if (cue.at <= 0) { firedCues.current.done.add(i); cue.run(); }
    });
    lastTourStep.current = tourIndex;
  }, [run, tourIndex, tourRunId, tourStatus]);

  useEffect(() => {
    if (tourStatus !== 'playing' || tourIndex < 0) return;
    const elapsed = TOUR_STEPS[tourIndex].seconds * 1000 - tourRemaining;
    const timers = cueList.current.map((cue, i) => {
      if (firedCues.current.done.has(i)) return 0;
      return window.setTimeout(() => {
        if (firedCues.current.done.has(i)) return;
        firedCues.current.done.add(i);
        cue.run();
      }, Math.max(0, cue.at * 1000 - elapsed));
    });
    return () => timers.forEach((t) => t && window.clearTimeout(t));
  }, [tourStatus, tourIndex, tourRunId, tourRemaining]);

  // The voice reads each slide once; pause and resume follow the tour.
  const spokenStep = useRef('');
  useEffect(() => {
    if (tourIndex < 0) return;
    if (tourStatus === 'paused') { narrator.pause(); return; }
    if (tourStatus !== 'playing' || !voiceOn) return;
    const key = `${tourRunId}:${tourIndex}`;
    if (spokenStep.current === key) { narrator.resume(); return; }
    spokenStep.current = key;
    void narrator.speak(`${TOUR_STEPS[tourIndex].title}. ${TOUR_STEPS[tourIndex].body}`);
  }, [tourStatus, tourIndex, tourRunId, voiceOn]);
  useEffect(() => () => narrator.stop(), [narrator]);

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
                    <div className="tour-cap-kicker lbl">{tourIndex + 1} / {TOUR_STEPS.length} · Guided tour</div>
                    <div className="tour-cap-title font-head">{TOUR_STEPS[tourIndex].title}</div>
                    <p className="tour-cap-body">{TOUR_STEPS[tourIndex].body}</p>
                    <div className="orbit-tour-caption-controls">
                      {narrator.supported && (
                        <button className={`btn tour-cap-btn ${voiceOn ? 'is-on' : ''}`} onClick={toggleVoice} aria-pressed={voiceOn} aria-label={voiceOn ? 'Mute the voice' : 'Turn the voice on'} data-testid="button-tour-voice">
                          {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />} Voice
                        </button>
                      )}
                      <span className="flex-1" />
                      {tourStatus === 'complete' ? (
                        <>
                          <button className="btn tour-cap-btn" onClick={startTour} data-testid="button-tour-replay">Replay</button>
                          <button className="btn btn-primary tour-cap-btn" onClick={finishTour} data-testid="button-tour-done">Done</button>
                        </>
                      ) : (
                        <>
                          <button className="btn tour-cap-btn" onClick={() => advanceTour(tourIndex - 1)} disabled={tourIndex === 0} aria-label="Previous slide" data-testid="button-tour-previous"><ChevronLeft size={16} /> Previous</button>
                          <button className="btn tour-cap-btn" onClick={toggleTourPlayback} data-testid="button-tour-pause">{tourStatus === 'paused' ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}</button>
                          <button className="btn tour-cap-btn" onClick={() => advanceTour(tourIndex + 1)} aria-label="Next slide" data-testid="button-tour-next">Next <ChevronRight size={16} /></button>
                          <button className="btn tour-cap-btn" onClick={finishTour} data-testid="button-tour-exit">Exit</button>
                        </>
                      )}
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
                        <button className="btn btn-primary" onClick={startTour} data-testid="button-tour-play">Play the tour ({Math.round(TOUR_TOTAL_SECONDS / 60)} min, with voice)</button>
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
      {tourActive && pointer && <TourPointer target={pointer.target} targetKey={pointer.key} />}
      {tourActive && <TourProgress steps={TOUR_STEPS.map((step) => step.seconds)} index={tourIndex} playing={tourStatus === 'playing'} remainingMs={tourRemaining} deadline={tourDeadline} />}
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
