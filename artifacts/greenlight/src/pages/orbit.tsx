import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
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
import { useCaptionSlot } from '@/lib/caption-slot';
import { useRecording } from '@/pages/replay';
import { pc, statusMap, tally, tone, waveOf } from '@/lib/greenlight';

const RING_COLORS = ['#7CC9E8', '#00E5FF', '#CFE3EE'];
const CLASSES = ['Non-classified', 'OFFICIAL: Sensitive', 'PROTECTED', 'SECRET', 'TOP SECRET'];
const TOUR_SEEN_KEY = 'ddg-greenlight-results-tour-seen';
const TOUR_STEPS = [
  { title: 'This is your software', body: 'The glass planet represents the software being assessed.', seconds: 12 },
  { title: 'Three rings, three kinds of requirement', body: 'The inner blue ring is safety, the middle cyan ring is security, and the outer white ring is AI requirements. Each lights up in turn.', seconds: 14 },
  { title: 'Every dot is one requirement', body: 'Green means met, amber means partial, red means failed, and dim dots are not applicable.', seconds: 14 },
  { title: 'Raised pins are must-fix', body: 'Raised red pins mark blocking items that must be addressed before release.', seconds: 14 },
  { title: 'Links show shared evidence', body: 'A link joins requirements in different standards that rest on the same evidence. One fix can close all of them.', seconds: 15 },
  { title: 'A score per standard', body: 'The pills above the planet show how much of each standard already passes. Tap one to see its requirements.', seconds: 14 },
  { title: 'The plan, round by round', body: 'Each round is a batch of fixes. The switch above the planet shows what the lights look like after each one; the same rules check the code again for real after a fix.', seconds: 20 },
  { title: 'Tap any light for its evidence', body: 'The pop-up shows what is wrong, the rule that found it, the file and the line, and what will fix it.', seconds: 15 },
  { title: 'Checked by code. Fixed with Claude.', body: 'Every check you just saw is code: written rules that read the repository, with no AI involved. Claude is used for one thing only, writing the fixes, and you approve each change before the same code checks again. Next: Show me the plan.', seconds: 18 },
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

/**
 * Step 3b · See each one: the planet, its rings and every requirement as a
 * light. Controls sit above the planet; tapping a light opens its pop-up.
 */
export default function Orbit() {
  const { id = '' } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  // ?after=<recording>: show the orbit as the recorded fix left it, lights turning green a moment after load.
  const search = useSearch();
  const afterName = useMemo(() => new URLSearchParams(search).get('after'), [search]);
  const afterRec = useRecording(afterName);
  const [afterOn, setAfterOn] = useState(true);
  const [afterApplied, setAfterApplied] = useState(false);
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
  const tourActiveNow = ['playing', 'paused', 'complete'].includes(tourStatus) && tourIndex >= 0;
  // The caption keeps out of the way of whatever the arrow points at.
  const captionPlace = useCaptionSlot(tourActiveNow, pointer?.target ?? null, 'bc', `${tourRunId}:${tourIndex}`);
  const captionSlot = captionPlace.slot;
  const orbitControls = useRef<OrbitControlApi | null>(null);
  const savedTour = useRef<SavedTourState | null>(null);
  const tourDeadline = useRef(0);
  const lastTourStep = useRef(-1);
  const run = q.data;

  useEffect(() => {
    setWave(0);
    setTarget(new URLSearchParams(search).has('answers') ? { kind: 'theme', id: 'answers' } : null);
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

  const baseSt = useMemo(() => (run ? statusMap(run, wave) : {}), [run, wave]);
  const st = useMemo(() => (afterOn && afterApplied && afterRec.rec?.outcome.changed ? { ...baseSt, ...afterRec.rec.outcome.changed } : baseSt), [baseSt, afterOn, afterApplied, afterRec.rec]);
  useEffect(() => {
    if (!afterRec.rec || !orbitReady) return;
    const t = window.setTimeout(() => setAfterApplied(true), 1400);
    return () => window.clearTimeout(t);
  }, [afterRec.rec, orbitReady]);
  const afterReadiness = afterOn && afterApplied ? afterRec.rec?.outcome.after : undefined;
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
    // A dot on each ring to point at: a failing must-fix item if there is one, else any rated item.
    const ringDot = (lens: string) => {
      const onRing = run.findings.filter((f) => f.lens === lens && baselineStatuses[f.key] !== 'NA');
      return (onRing.find((f) => f.blocking && baselineStatuses[f.key] === 'N') ?? onRing.find((f) => baselineStatuses[f.key] === 'N') ?? onRing[0])?.key;
    };
    const ring = (lens: string, label: string) => {
      const key = ringDot(lens);
      if (key) at(key, label); else dom(`ring-${lens}`, label);
    };
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
        { at: 0, run: () => { void controls.home(); controls.emphasis('saf'); controls.pulse('saf', 3000); } },
        { at: 1.3, run: () => ring('saf', 'Safety · inner ring') },
        { at: 4.5, run: () => { controls.emphasis('sec'); controls.pulse('sec', 3000); void controls.shot({ target: [0, 0, 0], az: 30, el: 26, dist: 26, seconds: 3, drift: 1 }); } },
        { at: 6, run: () => ring('sec', 'Security · middle ring') },
        { at: 9, run: () => { controls.emphasis('ai'); controls.pulse('ai', 3000); void controls.shot({ target: [0, 0, 0], az: 70, el: 32, dist: 30, seconds: 3, drift: 1.5 }); } },
        { at: 10.5, run: () => ring('ai', 'AI · outer ring') },
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
        // A handful of links reads as "these connect"; dozens read as noise. Prefer
        // groups of 3 to 12 links, closest to 6.
        const all = controls.linkThemes();
        const themes = [...all].sort((x, y) => {
          const score = (n: number) => (n >= 3 && n <= 12 ? Math.abs(n - 6) : 100 + Math.abs(n - 6));
          return score(x.count) - score(y.count);
        });
        const first = themes[0]?.theme;
        const second = themes[1]?.theme;
        const ends = first == null ? null : controls.linkEnds(first);
        if (first == null) return [{ at: 0, run: () => { controls.setLayer('links', true); controls.emphasis('links'); dom('layer-links', 'Links layer'); } }];
        return [
          { at: 0, run: () => { controls.setLayer('links', true); controls.emphasis('links'); void controls.showcaseLinks(first, { az: 24, el: 40, dist: 20, seconds: 2.4 }); } },
          { at: 1.8, run: () => at({ linkTheme: first }, `Shared evidence · ${themes[0].count} link${themes[0].count === 1 ? '' : 's'}`) },
          ...(ends ? [
            { at: 5, run: () => { void controls.focus(ends.a); at(ends.a, nameOf(ends.a)); } },
            { at: 8.5, run: () => { void controls.focus(ends.b); at(ends.b, nameOf(ends.b)); } },
          ] : []),
          ...(second != null ? [
            { at: 12, run: () => { controls.select(null); void controls.showcaseLinks(second, { az: -40, el: 36, dist: 20, seconds: 2.2 }); at({ linkTheme: second }, 'Another shared fix'); } },
          ] : [{ at: 12, run: () => dom('layer-links', 'Links layer') }]),
        ];
      })(),
      // 5 · Readiness per standard
      [
        { at: 0, run: () => { controls.emphasis(null); void controls.home(); setReadinessHighlight(true); dom('[data-testid="readiness-rings"]', 'A score per standard'); } },
        { at: 3, run: () => setReadinessHighlight(false) },
        ...(run.standards[0] ? [{ at: 7, run: () => dom(`[data-testid="button-standard-${run.standards[0].id}"]`, `${run.standards[0].short} · select for detail`) }] : []),
      ],
      // 6 · The plan, wave by wave
      [
        { at: 0, run: () => { controls.emphasis(null); void controls.home(); dom('[data-testid="wave-switch"]', 'The plan, round by round'); } },
        ...[1, 2, 3, 4].map((n, i) => ({
          at: 3 + i * 3,
          run: () => {
            setWave(n);
            dom(`[data-testid="button-wave-${n}"]`, `After round ${n}`);
            if (i === 0) void controls.shot({ target: [0, 0, 0], az: 40, el: 30, dist: 28, seconds: 11, drift: 3 });
          },
        })),
        { at: 15.5, run: () => dom('[data-testid="text-verdict"]', 'Projected verdict') },
      ],
      // 7 · Click anything for its evidence
      [
        { at: 0, run: () => { controls.emphasis('mustfix'); if (pinKey) { setPicked(pinKey); setTarget({ kind: 'finding', key: pinKey }); controls.select(pinKey); void controls.focus(pinKey); } } },
        { at: 1.5, run: () => dom('detail-panel', 'What, where, which rule, how to fix') },
        { at: 8, run: () => { if (pinKey) at(pinKey, 'Tap any light'); } },
      ],
      // 8 · Fix it with Claude
      [
        { at: 0, run: () => { controls.emphasis('core'); void controls.home(); dom('rules-badge', 'Checked by code, not AI'); } },
        { at: 7, run: () => dom('fix-button', 'Show me the plan') },
        { at: 13, run: () => dom('nav-plan', 'Step 4 · the plan') },
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

  const serious = counts?.blocking ?? 0;
  const openCount = counts ? counts.failed + counts.partial : 0;
  const t = counts ? tone(counts) : null;

  return (
    <Shell runId={id} roadStep={2} pip={run && tourStatus === 'closed' && !target ? { id: 'orbit', what: 'Every light is one requirement. Red is serious; raised pins must be fixed.', press: 'Drag the planet, tap a light, then press Show me the plan.', target: '[data-testid="link-header-plan"]', drag: '.orbit-visual', also: 'What am I looking at? plays a two-minute tour. Needs your answers holds the questions only a person can answer.' } : null} tourHeaderHighlight={tourIndex === 8 && !['closed', 'prompt'].includes(tourStatus)}
      guide={run && !afterName ? {
        steps: tourActiveNow
          ? ['Watch the guided tour; press Exit on the caption to take over', 'Tap any light to read what is wrong and where', 'Press Show me the plan']
          : ['Drag to turn the planet. Tap a light to read what is wrong and where', 'Raised red pins are the serious ones', 'Press Show me the plan'],
        current: tourActiveNow ? 0 : picked ? 1 : 0,
        aside: !tourActiveNow && tourStatus !== 'playing' ? <button className="lbl hover:text-[#00E5FF]" onClick={startTour} data-testid="button-guide-tour">What am I looking at?</button> : undefined,
      } : undefined}
      headerActions={<Link href={`/plan/${id}`} className="btn btn-go hidden sm:inline-flex" data-testid="link-header-plan" data-tour-target="fix-button" data-tour-highlight={tourIndex === 8 && !['closed', 'prompt'].includes(tourStatus) ? 'true' : undefined}>Show me the plan <ArrowRight size={15} /></Link>}
      runMeta={run ? `${run.projectName}${fileCount == null ? '' : ` · ${fileCount} files`}` : undefined}>
      {q.isLoading || !run || !counts ? (
        q.isError ? <div className="flex flex-1 items-center justify-center"><ErrorBlock message="This assessment could not be loaded." onRetry={() => q.refetch()} /></div> :
          <div className="jorbit"><Skeleton className="h-16" /><Skeleton className="flex-1" /></div>
      ) : (
        <div className={`jorbit ${tourFocusing ? 'tour-focusing' : ''}`}>
          <section className="glass jorbit-bar result-band" data-testid="orbit-bar">
            <div className="flex min-w-0 items-center gap-3">
              <span className="h-5 w-5 shrink-0 rounded-full" style={{ background: t!.color, boxShadow: `0 0 18px ${t!.color}90` }} data-testid="verdict-light" />
              <div className="min-w-0">
                <div className="font-head text-lg font-semibold leading-tight" data-testid="text-verdict">{projected ? t!.word : `${openCount} to fix · ${serious} serious`}</div>
                <div className="jnote">{projected ? `Projected after wave ${wave} · not measured` : run.isDemo ? 'Sample project · every light is one requirement' : 'Every light is one requirement'}</div>
              </div>
            </div>
            <div className={`flex min-w-0 flex-1 flex-wrap items-center gap-2 ${readinessHighlight ? 'is-tour-highlight rounded-xl p-1' : ''}`} data-testid="readiness-rings">
              {run.standards.map((s, i) => {
                const value = afterReadiness?.[s.short] ?? pc(w ? w.readiness[s.id] ?? s.readiness : s.readiness);
                return <button key={s.id} onClick={() => setTarget({ kind: 'standard', id: s.id })} className="jpill !py-1 !pl-1 !pr-3 !text-[13px] !font-medium" title={s.name} data-testid={`button-standard-${s.id}`}>
                  <Gauge value={value} size={30} color={RING_COLORS[i % RING_COLORS.length]} label="" /> {s.short} <b style={{ color: value < 40 ? '#FF5C6E' : value < 75 ? '#FFA62B' : '#4FD99A' }}>{value}%</b>
                </button>;
              })}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn !px-3 !py-2 text-xs" onClick={() => setTarget({ kind: 'theme', id: 'answers' })} data-testid="button-annunciator-answers">Needs your answers · {counts.unanswered}</button>
              {run.classification.suggested && <button className="btn !px-3 !py-2 text-xs" onClick={() => setClassifyOpen(true)} data-testid="button-classification-details"><SlidersHorizontal size={13} /> Classification{run.classification.accepted ? '' : ' · decide'}</button>}
              <button className="btn !px-3 !py-2 text-xs" onClick={() => setCompare(true)} data-testid="button-compare"><GitCompare size={13} /> Compare runs</button>
            </div>
          </section>

          {afterRec.rec && (
            <div className="after-banner glass" data-testid="after-banner">
              <span className="lbl !text-[#4FD99A]">After the recorded fix · re-checked by the same rules</span>
              <span className="text-sm">{Object.entries(afterRec.rec.outcome.after).map(([k, v]) => `${k} ${afterRec.rec!.outcome.before[k]}% → ${v}%`).join(' · ')}</span>
              <span className="flex-1" />
              <button className={`btn !px-3 !py-1.5 text-xs ${afterOn ? '' : 'fc-on'}`} onClick={() => setAfterOn(false)} data-testid="button-show-before">Before</button>
              <button className={`btn !px-3 !py-1.5 text-xs ${afterOn ? 'fc-on' : ''}`} onClick={() => { setAfterOn(true); setAfterApplied(true); }} data-testid="button-show-after">After</button>
            </div>
          )}

          <div className="glass jorbit-stage orbit-workspace" style={{ background: 'rgba(0,0,0,.22)' }}>
            <OrbitView
              run={run}
              statuses={st}
              selected={picked}
              onPick={(key) => {
                setPicked(key);
                setTarget(key ? { kind: 'finding', key } : null);
              }}
              onControlsReady={onOrbitControlsReady}
              tourButton={<button className="btn btn-attn-soft !px-3 !py-1.5 text-xs" onClick={startTour} data-testid="button-play-tour">What am I looking at?</button>}
              controlsCenter={
                <div className="orbit-wave-switch glass" role="tablist" data-testid="wave-switch" aria-label="Readiness projection">
                  {[0, 1, 2, 3, 4].map((n) => {
                    const available = n === 0 || run.waves.some((item) => item.number === n);
                    const tourWave = tourIndex === 6 && ['playing', 'paused'].includes(tourStatus);
                    return <button key={n} role="tab" aria-selected={wave === n} disabled={!available && !tourWave}
                      onClick={() => setWave(n)} className="orbit-wave-pill"
                      style={{ background: wave === n ? 'rgba(0,229,255,.16)' : 'transparent', color: wave === n ? '#F7FBFF' : '#CFE3EE' }}
                      data-testid={`button-wave-${n}`}>{n === 0 ? 'Now' : `After round ${n}`}</button>;
                  })}
                </div>
              }
              tourCaption={tourIndex >= 0 && ['playing', 'paused', 'complete'].includes(tourStatus) ? (
                <div className={`glass orbit-tour-caption cap-${captionSlot} ${captionPlace.ready ? 'is-placed' : ''}`} data-slot={captionSlot} data-testid="tour-caption"
                  style={captionPlace.ready ? { transform: `translate3d(${captionPlace.x}px,${captionPlace.y}px,0)`, transition: captionPlace.moves === 0 ? 'none' : undefined } : { visibility: 'hidden' }}>
                  <div className="tour-cap-kicker lbl">{tourIndex + 1} / {TOUR_STEPS.length} · What am I looking at?</div>
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
                    <div className="lbl !text-[#00E5FF]">First time here?</div>
                    <h2 className="font-head mt-2 text-xl font-semibold">What am I looking at?</h2>
                    <p className="mt-2 text-sm text-[#CFE3EE]">A {Math.round(TOUR_TOTAL_SECONDS / 60)}-minute walk around the planet: what the rings, lights and pins mean, and where the plan comes from.</p>
                    <div className="mt-5 flex items-center gap-3">
                      <button className="btn btn-primary" onClick={startTour} data-testid="button-tour-play">Show me</button>
                      <button className="lbl rounded-lg px-3 py-2 hover:text-[#00E5FF]" onClick={finishTour} data-testid="button-tour-skip">I know this</button>
                    </div>
                  </div>
                </div>
              ) : null}
            />
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
