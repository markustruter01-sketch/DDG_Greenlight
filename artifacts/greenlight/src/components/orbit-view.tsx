import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, Mouse, Plus, RotateCcw } from 'lucide-react';
import type { AssessmentRun } from '@workspace/api-client-react';
import { THREE, createOrbitScene } from '../orbit/scene.js';
import { layout, linkedIds } from '../orbit/model.js';
import { homeRig, interpolateRig, rigFromPosition, rigPose } from '../orbit/cameraMath.js';
import { orbitItems, orbitThemes } from '@/lib/greenlight';
import { OrbitCompatibility } from './orbit-compatibility';

type Layers = Record<string, boolean>;
const FOV = Math.PI / 6;
const LAYER_DEFS = [
  { id: 'mustfix', name: 'Must fix' },
  { id: 'gaps', name: 'Other gaps' },
  { id: 'passing', name: 'Passing' },
  { id: 'links', name: 'Links' },
];

export type OrbitShot = {
  target?: string | number[];
  az?: number;
  el?: number;
  dist?: number;
  seconds?: number;
  lift?: number;
  drift?: number;
};

export type OrbitSnapshot = {
  rig: { target: number[]; az: number; el: number; dist: number };
  longitude: number;
  autoStopped: boolean;
  compatibilityAngle?: number;
  compatibilityZoom?: number;
  compatibilityFocus?: string | null;
};

export type OrbitControlApi = {
  shot: (shot: OrbitShot) => Promise<boolean>;
  home: () => Promise<boolean>;
  focus: (key: string) => Promise<boolean>;
  pulse: (key: string, ms?: number) => void;
  emphasis: (key: string | null) => void;
  select: (key: string | null) => void;
  setLayer: (id: string, enabled: boolean) => void;
  getLayer: (id: string) => boolean;
  beginManual: () => void;
  endManual: () => void;
  zoom: (factor: number) => void;
  tickFallback: (now: number, dt: number) => void;
  pauseAuto: (paused: boolean) => void;
  pausePlayback: (paused: boolean) => void;
  stopAuto: () => void;
  snapshot: () => OrbitSnapshot;
  restore: (snapshot: OrbitSnapshot) => Promise<boolean>;
  /** Shared-evidence themes that have links, most links first. */
  linkThemes: () => { theme: number; count: number }[];
  /** Draw one theme's links bold and fly the camera to them (null clears). */
  showcaseLinks: (theme: number | null, shot?: { az?: number; el?: number; dist?: number; seconds?: number; drift?: number }) => Promise<boolean>;
  /** The two requirement keys at the ends of a theme's longest link. */
  linkEnds: (theme: number) => { a: string; b: string } | null;
  /** Where a requirement dot (by key), a theme's link arc or a scene point is on screen, in client pixels. */
  screenOf: (target: string | { linkTheme: number } | { world: [number, number, number] }) => { x: number; y: number } | null;
};

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export function OrbitView({
  run,
  statuses,
  selected,
  onPick,
  controlsCenter,
  tourButton,
  tourCaption,
  tourPrompt,
  hint = true,
  onControlsReady,
}: {
  run: AssessmentRun;
  statuses: Record<string, string>;
  selected: string | null;
  onPick: (key: string | null) => void;
  controlsCenter?: ReactNode;
  tourButton?: ReactNode;
  tourCaption?: ReactNode;
  tourPrompt?: ReactNode;
  /** Show "drag to look around" until the viewer has moved the planet. */
  hint?: boolean;
  onControlsReady?: (controls: OrbitControlApi | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Once the viewer has moved the planet themselves, the hint shrinks to a corner.
  const [moved, setMoved] = useState<boolean>(() => { try { return window.sessionStorage.getItem('ddg-orbit-moved') === '1'; } catch { return false; } });
  const markMoved = () => { setMoved(true); try { window.sessionStorage.setItem('ddg-orbit-moved', '1'); } catch { /* per-session */ } };
  const markMovedRef = useRef(markMoved);
  markMovedRef.current = markMoved;
  const api = useRef<any>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onControlsReadyRef = useRef(onControlsReady);
  onControlsReadyRef.current = onControlsReady;
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const hoverRef = useRef<string | null>(null);
  const [layers, setLayers] = useState<Layers>({ mustfix: true, gaps: false, passing: false, links: true });
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const [hover, setHover] = useState<{ x: number; y: number; id: string } | null>(null);
  const [compatibility, setCompatibility] = useState(false);
  const [compatAngle, setCompatAngle] = useState(0.25);
  const [compatZoom, setCompatZoom] = useState(1);
  const [compatFocus, setCompatFocus] = useState<string | null>(null);
  const [compatEmphasis, setCompatEmphasis] = useState<string | null>(null);
  const compatAngleRef = useRef(compatAngle);
  const compatZoomRef = useRef(compatZoom);
  const compatFocusRef = useRef(compatFocus);
  compatAngleRef.current = compatAngle;
  compatZoomRef.current = compatZoom;
  compatFocusRef.current = compatFocus;
  const byKey = useMemo(() => new Map(run.findings.map((f) => [f.key, f])), [run]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setCompatibility(false);
    const items = orbitItems(run, statusesRef.current);
    const themes = orbitThemes(run);
    const { nodes, groups } = layout(items);
    const scene = createOrbitScene({ nodes, groups, themes });
    scene.setLongitude(0);
    scene.setMorph(1);
    scene.setLayers({ ...layersRef.current, fixed: true, na: false });
    scene.setItems(items, { flash: false });
    const camera = new THREE.PerspectiveCamera((FOV * 180) / Math.PI, 1, 0.1, 1200);
    const home = homeRig(FOV);
    const homePose = rigPose(home, 0);
    const rig = rigFromPosition(homePose.position, 0, [0, 0, 0]);
    const homeCentered = { ...rig, target: [...rig.target] };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = media.matches;
    let fallback = false;
    let renderer: any = null;
    let flight: {
      from: any; to: any; start: number; duration: number; lift: number; drift: number;
      arrivedAt: number | null; pausedAt: number | null; resolve: (arrived: boolean) => void;
    } | null = null;
    let fallbackFlight: {
      fromAngle: number; toAngle: number; fromZoom: number; toZoom: number; focus: string | null;
      start: number; duration: number; pausedAt: number | null; resolve: (arrived: boolean) => void;
    } | null = null;
    let dragging: { x: number; y: number; moved: number } | null = null;
    let autoStopped = false;
    let autoPaused = false;
    let playbackPaused = false;
    let resumeAt = 0;
    let spin = 0;
    let spinElapsed = 0;
    let lastNow = 0;
    let raf = 0;
    let canvasEl: HTMLCanvasElement | null = null;
    const projected = new THREE.Vector3();

    const copyRig = (value: any) => ({ ...value, target: [...value.target] });
    const stopFlight = () => {
      const active = flight;
      flight = null;
      active?.resolve(false);
    };
    const markManual = () => { resumeAt = performance.now() + 3000; };
    const rigPoint = (key: string) => {
      const world = scene.worldOf(key);
      return world ? [world.y, world.z, world.x] : null;
    };
    const flyFallback = (angle: number, zoom: number, focus: string | null, seconds: number) => {
      const duration = Math.max(0, seconds * 1000);
      const current = fallbackFlight;
      fallbackFlight = null;
      current?.resolve(false);
      if (reducedMotion || !duration) {
        setCompatAngle(angle);
        setCompatZoom(zoom);
        setCompatFocus(focus);
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        fallbackFlight = {
          fromAngle: compatAngleRef.current,
          toAngle: angle,
          fromZoom: compatZoomRef.current,
          toZoom: zoom,
          focus,
          start: performance.now(),
          duration,
          pausedAt: null,
          resolve,
        };
      });
    };
    const toRig = (shot: OrbitShot) => {
      const itemTarget = typeof shot.target === 'string' ? scene.worldOf(shot.target) : null;
      const target = itemTarget
        ? [itemTarget.y, itemTarget.z, itemTarget.x]
        : Array.isArray(shot.target) ? [...shot.target] : [0, 0, 0];
      const azimuth = ((shot.az ?? 0) * Math.PI) / 180 +
        (itemTarget ? Math.atan2(target[0], target[2]) : 0);
      return {
        target,
        az: azimuth,
        el: ((shot.el ?? 30) * Math.PI) / 180,
        dist: shot.dist ?? homeCentered.dist,
      };
    };
    const flyTo = (to: any, options: { seconds?: number; lift?: number; drift?: number } = {}) => {
      stopFlight();
      if (reducedMotion || fallback) {
        Object.assign(rig, copyRig(to));
        return Promise.resolve(true);
      }
      const seconds = Math.max(0, options.seconds ?? 2.4);
      return new Promise<boolean>((resolve) => {
        flight = {
          from: copyRig(rig),
          to: copyRig(to),
          start: performance.now(),
          duration: seconds * 1000,
          lift: options.lift ?? 0,
          drift: ((options.drift ?? 0) * Math.PI) / 180,
          arrivedAt: null,
          pausedAt: null,
          resolve,
        };
        if (!seconds) {
          Object.assign(rig, copyRig(to));
          flight.arrivedAt = performance.now();
          resolve(true);
          if (!flight.drift) flight = null;
        }
      });
    };
    const focusKey = (key: string) => {
      autoStopped = true;
      if (fallback) {
        const target = rigPoint(key);
        const angle = target ? Math.atan2(target[0], target[2]) : compatAngleRef.current;
        return flyFallback(angle, 1.18, key, 1.4);
      }
      const point = scene.worldOf(key);
      if (!point) return Promise.resolve(false);
      const target = [point.y, point.z, point.x];
      const from = copyRig(rig);
      const outward = Math.atan2(target[0], target[2]);
      scene.select(key, linkedIds(themes, key));
      return flyTo({
        target,
        az: outward,
        el: Math.max(from.el, (22 * Math.PI) / 180),
        dist: 10,
      }, { seconds: 1.4 });
    };
    const controls: OrbitControlApi = {
      shot: (shot) => {
        if (fallback) {
          const target = typeof shot.target === 'string' ? shot.target : null;
          const angle = typeof shot.az === 'number' ? (shot.az * Math.PI) / 180 : compatAngleRef.current;
          const zoom = typeof shot.dist === 'number' ? Math.max(0.6, Math.min(1.2, homeCentered.dist / shot.dist)) : compatZoomRef.current;
          return flyFallback(angle, zoom, target, shot.seconds ?? 2.4);
        }
        return flyTo(toRig(shot), { seconds: shot.seconds, lift: shot.lift, drift: shot.drift });
      },
      home: () => {
        autoStopped = false;
        autoPaused = false;
        resumeAt = performance.now() + 3000;
        if (fallback) {
          return flyFallback(0.25, 1, null, 1.2);
        }
        return flyTo(homeCentered, { seconds: 1.2, lift: 0.08 });
      },
      focus: focusKey,
      pulse: (key, ms) => { if (!fallback) scene.pulse(key, ms); },
      emphasis: (key) => {
        setCompatEmphasis(key);
        if (!fallback) scene.setEmphasis(key);
      },
      select: (key) => {
        if (fallback) setCompatFocus(key);
        else scene.select(key, key ? linkedIds(themes, key) : new Set());
      },
      setLayer: (id, enabled) => setLayers((current) => ({ ...current, [id]: enabled })),
      getLayer: (id) => !!layersRef.current[id],
      beginManual: () => { stopFlight(); resumeAt = Infinity; },
      endManual: markManual,
      zoom: (factor) => {
        markManual();
        if (fallback) setCompatZoom((value) => Math.max(0.6, Math.min(1.2, value / factor)));
        else rig.dist = Math.max(8, Math.min(60, rig.dist * factor));
      },
      pauseAuto: (paused) => {
        autoPaused = paused;
        if (!paused) resumeAt = performance.now() + 3000;
      },
      pausePlayback: (paused) => {
        if (paused === playbackPaused) return;
        const now = performance.now();
        if (paused) {
          if (flight) flight.pausedAt = now;
          if (fallbackFlight) fallbackFlight.pausedAt = now;
        } else if (flight?.pausedAt != null) {
          const duration = now - flight.pausedAt;
          flight.start += duration;
          if (flight.arrivedAt != null) flight.arrivedAt += duration;
          flight.pausedAt = null;
        } else if (fallbackFlight?.pausedAt != null) {
          fallbackFlight.start += now - fallbackFlight.pausedAt;
          fallbackFlight.pausedAt = null;
        }
        playbackPaused = paused;
      },
      stopAuto: () => { autoStopped = true; },
      tickFallback: (now, dt) => {
        if (fallbackFlight && !playbackPaused) {
          const active = fallbackFlight;
          const progress = Math.min(1, Math.max(0, (now - active.start) / active.duration));
          const delta = Math.atan2(Math.sin(active.toAngle - active.fromAngle), Math.cos(active.toAngle - active.fromAngle));
          setCompatAngle(active.fromAngle + delta * smooth(progress));
          setCompatZoom(active.fromZoom + (active.toZoom - active.fromZoom) * smooth(progress));
          setCompatFocus(active.focus);
          if (progress >= 1) {
            fallbackFlight = null;
            active.resolve(true);
          }
          return;
        }
        if (reducedMotion || autoStopped || autoPaused || playbackPaused || now < resumeAt) return;
        const delta = (dt * Math.PI * 2) / 90000;
        spin = (spin + delta) % (Math.PI * 2);
        setCompatAngle((angle) => angle + delta);
      },
      snapshot: () => ({
        rig: copyRig(rig),
        longitude: spin,
        autoStopped,
        compatibilityAngle: compatAngleRef.current,
        compatibilityZoom: compatZoomRef.current,
        compatibilityFocus: compatFocusRef.current,
      }),
      restore: (snapshot) => {
        autoStopped = snapshot.autoStopped;
        spin = snapshot.longitude;
        if (fallback) {
          return flyFallback(snapshot.compatibilityAngle ?? 0.25, snapshot.compatibilityZoom ?? 1, snapshot.compatibilityFocus ?? null, 1.1);
        }
        scene.setLongitude(spin);
        return flyTo(snapshot.rig, { seconds: 1.1, lift: 0.08 });
      },
      linkThemes: () => (fallback ? [] : scene.linkThemes()),
      showcaseLinks: (theme, shot = {}) => {
        if (fallback) return Promise.resolve(false);
        scene.showcaseLinks(theme);
        if (theme === null) return Promise.resolve(true);
        const apex = scene.linkApex(theme);
        if (!apex) return Promise.resolve(false);
        autoStopped = true;
        const target = [apex.y, apex.z, apex.x];
        const outward = Math.atan2(target[0], target[2]);
        return flyTo({
          target,
          az: outward + ((shot.az ?? 24) * Math.PI) / 180,
          el: ((shot.el ?? 34) * Math.PI) / 180,
          dist: shot.dist ?? 12,
        }, { seconds: shot.seconds ?? 2.4, drift: shot.drift ?? 2.5, lift: 0.05 });
      },
      linkEnds: (theme) => (fallback ? null : scene.linkEnds(theme)),
      screenOf: (target) => {
        if (fallback || !canvasEl) return null;
        const world = typeof target === 'string' ? scene.worldOf(target) : 'world' in target ? scene.worldOf(target.world) : scene.linkApex(target.linkTheme);
        if (!world) return null;
        projected.copy(world).project(camera);
        if (projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05) return null;
        const r = canvasEl.getBoundingClientRect();
        return { x: r.left + ((projected.x + 1) / 2) * r.width, y: r.top + ((1 - projected.y) / 2) * r.height };
      },
    };
    api.current = { scene, rig, themes, home: homeCentered, controls };
    onControlsReadyRef.current?.(controls);

    const onMotionChange = (event: MediaQueryListEvent) => { reducedMotion = event.matches; };
    media.addEventListener('change', onMotionChange);
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      fallback = true;
      api.current.fallback = true;
      setCompatibility(true);
      return () => {
        stopFlight();
        media.removeEventListener('change', onMotionChange);
        scene.dispose();
        api.current = null;
        onControlsReadyRef.current?.(null);
      };
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
    const size = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);

    const cv = renderer.domElement as HTMLCanvasElement;
    canvasEl = cv;
    const rect = () => cv.getBoundingClientRect();
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = { x: e.clientX, y: e.clientY, moved: 0 };
      stopFlight();
      resumeAt = Infinity;
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      const r = rect();
      if (dragging) {
        const dx = e.clientX - dragging.x;
        const dy = e.clientY - dragging.y;
        dragging.moved += Math.abs(dx) + Math.abs(dy);
        dragging.x = e.clientX;
        dragging.y = e.clientY;
        rig.az -= dx * 0.006;
        rig.el = Math.max(-1.3, Math.min(1.45, rig.el + dy * 0.006));
        setHover(null);
        scene.setHovered(null);
      } else {
        const id = scene.pick(camera, e.clientX - r.left, e.clientY - r.top, r.width, r.height, 14);
        if (id !== hoverRef.current) {
          hoverRef.current = id;
          scene.setHovered(id);
        }
        setHover(id ? { x: e.clientX - r.left, y: e.clientY - r.top, id } : null);
      }
    };
    const up = (e: PointerEvent) => {
      cv.style.cursor = 'grab';
      const click = dragging && dragging.moved < 5;
      if (dragging && dragging.moved >= 5) markMovedRef.current();
      dragging = null;
      markManual();
      if (click) {
        const r = rect();
        const id = scene.pick(camera, e.clientX - r.left, e.clientY - r.top, r.width, r.height, 16);
        if (id) {
          autoStopped = true;
          onPickRef.current(id);
          void focusKey(id);
        }
      }
    };
    const leave = () => {
      hoverRef.current = null;
      setHover(null);
      scene.setHovered(null);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      rig.dist = Math.max(8, Math.min(60, rig.dist * Math.exp(e.deltaY * 0.0012)));
      markManual(); markMovedRef.current();
    };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointerleave', leave);
    cv.addEventListener('wheel', wheel, { passive: false });

    const loop = (now: number) => {
      const dt = lastNow ? Math.min(100, now - lastNow) : 0;
      lastNow = now;
      const autoMotion = !reducedMotion && !autoStopped && !autoPaused &&
        !dragging && !flight && now >= resumeAt;
      if (autoMotion) {
        spin = (spin + (dt * Math.PI * 2) / 90000) % (Math.PI * 2);
        spinElapsed += dt;
        scene.setLongitude(spin);
      }
      let viewRig = rig;
      if (flight && !playbackPaused) {
        const active = flight;
        const progress = active.duration ? (now - active.start) / active.duration : 1;
        if (progress < 1) {
          Object.assign(rig, interpolateRig(active.from, active.to, smooth(progress), { lift: active.lift }));
        } else {
          Object.assign(rig, active.to);
          if (active.arrivedAt == null) {
            active.arrivedAt = now;
            active.resolve(true);
          }
          if (!active.drift) flight = null;
          else viewRig = { ...active.to, az: active.to.az + active.drift * ((now - active.arrivedAt) / 1000) };
        }
      }
      if (autoMotion && !flight) {
        viewRig = {
          ...rig,
          target: [rig.target[0], rig.target[1] + Math.sin(spinElapsed * 0.00018) * 0.035, rig.target[2]],
          el: rig.el + Math.sin(spinElapsed * 0.00013) * 0.009,
        };
      }
      const p = rigPose(viewRig, 0, { radiusM: 1 });
      camera.position.set(p.position[0], p.position[1], p.position[2]);
      camera.up.set(p.up[0], p.up[1], p.up[2]);
      camera.lookAt(p.position[0] + p.direction[0], p.position[1] + p.direction[1], p.position[2] + p.direction[2]);
      scene.frame(camera, now);
      renderer.render(scene.scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      stopFlight();
      media.removeEventListener('change', onMotionChange);
      ro.disconnect();
      scene.dispose();
      renderer.dispose();
      canvasEl = null;
      cv.remove();
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointerleave', leave);
      cv.removeEventListener('wheel', wheel);
      api.current = null;
      onControlsReadyRef.current?.(null);
    };
  }, [run]);

  useEffect(() => {
    if (!compatibility) return;
    let raf = 0;
    let last = performance.now();
    let lastUpdate = last;
    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (now - lastUpdate > 50) {
        api.current?.controls.tickFallback(now, dt);
        lastUpdate = now;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [compatibility]);

  useEffect(() => {
    if (api.current && !api.current.fallback) api.current.scene.setItems(orbitItems(run, statuses), { flash: true });
  }, [statuses, run]);

  useEffect(() => {
    if (api.current && !api.current.fallback) api.current.scene.setLayers({ ...layers, fixed: true, na: false });
  }, [layers]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    if (a.fallback) setCompatFocus(selected);
    else a.scene.select(selected, selected ? linkedIds(a.themes, selected) : new Set());
  }, [selected, run]);

  const zoom = (k: number) => {
    api.current?.controls.zoom(k);
  };
  const pickCompatibility = (key: string | null) => {
    if (key) {
      api.current?.controls.stopAuto();
      setCompatFocus(key);
      onPickRef.current(key);
      void api.current?.controls.focus(key);
    } else {
      onPickRef.current(null);
    }
  };
  const reset = () => { void api.current?.controls.home(); };
  // Full screen: the stage around the planet (so pop-ups come too), else this view.
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen?.(); return; }
    const el = (host.current?.closest('.jorbit-stage') ?? host.current?.closest('.orbit-view-root')) as HTMLElement | null;
    void el?.requestFullscreen?.().catch(() => { /* not allowed here: nothing to do */ });
  };
  const hf = hover ? byKey.get(hover.id) : null;

  return (
    <div className="orbit-view-root" data-testid="orbit-view">
      <div className="orbit-visual">
        {compatibility ? (
          <OrbitCompatibility
            run={run} statuses={statuses} onPick={pickCompatibility}
            angle={compatAngle} setAngle={setCompatAngle} zoom={compatZoom} setZoom={setCompatZoom}
            focusKey={compatFocus} emphasis={compatEmphasis} layers={layers}
            onDragStart={() => api.current?.controls.beginManual()}
            onDragEnd={() => api.current?.controls.endManual()}
            onWheel={() => api.current?.controls.endManual()}
          />
        ) : (
          <>
            <div ref={host} className="absolute inset-0" />
            {hover && hf && (
              <div
                className="glass pointer-events-none absolute z-10 max-w-[260px] px-3 py-2 text-xs"
                style={{ left: Math.min(hover.x + 14, (host.current?.clientWidth ?? 400) - 270), top: hover.y + 14, borderRadius: 12 }}
                data-testid="orbit-tooltip"
              >
                <div className="lbl !text-[#00E5FF]">{hf.standardShort} · {hf.id}</div>
                <div className="mt-1">{hf.title}</div>
              </div>
            )}
          </>
        )}
        <div className="lbl pointer-events-none absolute left-4 top-3 hidden gap-4 sm:flex">
          <span style={{ color: '#7CC9E8' }} data-tour-target="ring-saf">Safety</span>
          <span style={{ color: '#00E5FF' }} data-tour-target="ring-sec">Security</span>
          <span style={{ color: '#F7FBFF' }} data-tour-target="ring-ai">AI</span>
        </div>
        {tourButton && <div className="absolute right-3 top-3 z-20 flex items-center gap-2">{fullscreen && <button className="btn !px-3 !py-1.5 text-xs" onClick={toggleFullscreen} data-testid="button-exit-fullscreen"><Minimize2 size={14} /> Exit full screen</button>}{tourButton}</div>}
        {tourCaption}
        {tourPrompt}
        {!compatibility && hint && !moved && (
          <div className="orbit-hint" data-testid="orbit-hint" aria-hidden="true">
            <Mouse className="orbit-hint-mouse" size={26} strokeWidth={1.6} />
            <div className="orbit-hint-title">Drag to look around</div>
            <div className="orbit-hint-keys"><span><b>Drag</b> · turn the view</span><span><b>Scroll</b> · zoom</span><span><b>Click a light</b> · open it</span></div>
          </div>
        )}
        {!compatibility && moved && (
          <div className="orbit-hint-mini" data-testid="orbit-hint-mini" aria-hidden="true"><span><b>Drag</b> turn</span><span><b>Scroll</b> zoom</span><span><b>Click</b> open</span></div>
        )}
      </div>
      <div className="orbit-controls-row">
        <div className="orbit-controls-left" aria-label="Orbit layers">
          {LAYER_DEFS.map((layer) => (
            <button key={layer.id}
              onClick={() => setLayers((current) => ({ ...current, [layer.id]: !current[layer.id] }))}
              className={`orbit-layer-pill ${layers[layer.id] ? 'is-active' : ''}`}
              aria-pressed={layers[layer.id]} data-testid={`button-layer-${layer.id}`} data-tour-target={`layer-${layer.id}`}>
              <span className="orbit-layer-dot" style={{ background: layer.id === 'mustfix' ? '#FF5C6E' : layer.id === 'gaps' ? '#FFA62B' : layer.id === 'passing' ? '#4FD99A' : '#00E5FF' }} />
              {layer.name}
            </button>
          ))}
        </div>
        <div className="orbit-controls-center">{controlsCenter}</div>
        <div className="orbit-controls-right">
          <div className="orbit-legend" aria-label="Requirement status legend" data-tour-target="status-legend">
            <span><i style={{ background: '#FF5C6E' }} />Must fix</span>
            <span><i style={{ background: '#FFA62B' }} />Partial</span>
            <span><i style={{ background: '#4FD99A' }} />Met</span>
            <span><i style={{ background: '#00E5FF' }} />Links</span>
          </div>
          <div className="orbit-zoom">
            <button className="btn !p-1.5" onClick={() => zoom(0.8)} aria-label="Zoom in" data-testid="button-orbit-zoom-in"><Plus size={14} /></button>
            <button className="btn !p-1.5" onClick={() => zoom(1.25)} aria-label="Zoom out" data-testid="button-orbit-zoom-out"><Minus size={14} /></button>
            <button className="btn !p-1.5" onClick={reset} aria-label="Reset view" title="Reset view" data-testid="button-orbit-reset"><RotateCcw size={14} /></button>
            <button className="btn !p-1.5" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title={fullscreen ? 'Exit full screen' : 'Full screen'} data-testid="button-orbit-fullscreen">{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
