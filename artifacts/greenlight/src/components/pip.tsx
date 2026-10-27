import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { TourPointer } from '@/components/tour-pointer';

/**
 * Freya: the small white guide who tells a viewer, in a line or two, what
 * this screen is and what to press next, with a thin pointer from her bubble
 * to that button. For a viewer opening the link alone at their desk.
 *
 * Where she sits is measured, not chosen by hand: a few times a second she
 * tries each corner of the screen (top corners sit under the header) and
 * takes the one where her bubble covers the least that matters: the button
 * she points at most of all, then anything you can press, tour targets,
 * marked areas (`data-important`), headings and text, and last of all the
 * planet canvas. She only moves when another corner is clearly better, and
 * glides there. She steps aside while a dialog is open or in full screen.
 *
 * The × above her head stops the guidance for the session (the one-line
 * guide strip comes back instead); a small button brings her back.
 * `?nopip` (or `?nocoach`) starts with her off.
 */
export type PipCorner = 'bl' | 'br' | 'tl' | 'tr';
export type PipSpec = {
  id: string;
  /** What this screen is, in one line (optional). */
  what?: string;
  /** What to press, for the walk-through. */
  press: string;
  /** CSS selector of that button. */
  target: string;
  /** One more thing they can do here (optional). */
  also?: string;
  /** The first meeting: she introduces herself. */
  intro?: boolean;
  /** Preferred corner when two are equally clear (default top left). */
  corner?: PipCorner;
};

const OFF = 'ddg-pip-off';
const AV = 52; // avatar size
const GAP = 16; // distance from the screen edges

// ── on / off, shared with the shell (which shows the guide strip when she is off) ──
const listeners = new Set<() => void>();
let offCache: boolean | null = null;
function readOff(): boolean {
  if (offCache != null) return offCache;
  try {
    const q = new URLSearchParams(window.location.search);
    offCache = q.has('nopip') || q.has('nocoach') || window.sessionStorage.getItem(OFF) === '1';
  } catch { offCache = false; }
  return offCache;
}
function setOff(v: boolean) {
  offCache = v;
  try { if (v) window.sessionStorage.setItem(OFF, '1'); else window.sessionStorage.removeItem(OFF); } catch { /* per-session */ }
  listeners.forEach((l) => l());
}
export function usePipOff(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, readOff, () => false);
}

// ── placement ────────────────────────────────────────────────────────────────
type Box = { x: number; y: number; w: number; h: number };
const WEIGHTS: [string, number][] = [
  ['button, a[href], input, select, textarea, [role="tab"], [role="slider"]', 3],
  ['[data-tour-target], [data-important], [role="progressbar"], video', 2.5],
  ['h1, h2, h3, .jbig', 2],
  ['p, li, label, .jnote, .lbl', 1],
  ['canvas', 0.35],
];
function overlap(a: Box, r: DOMRect): number {
  const w = Math.min(a.x + a.w, r.right) - Math.max(a.x, r.left);
  const h = Math.min(a.y + a.h, r.bottom) - Math.max(a.y, r.top);
  return w > 0 && h > 0 ? w * h : 0;
}
function topLimit(): number {
  let y = 0;
  for (const el of document.querySelectorAll('.screen-header, .guide')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) y = Math.max(y, r.bottom);
  }
  return y + 12;
}
function candidates(w: number, h: number): Record<PipCorner, Box> {
  const vw = window.innerWidth, vh = window.innerHeight, top = topLimit();
  return {
    tl: { x: GAP, y: top, w, h },
    tr: { x: vw - w - GAP, y: top, w, h },
    bl: { x: GAP, y: vh - h - GAP, w, h },
    br: { x: vw - w - GAP, y: vh - h - GAP, w, h },
  };
}
function score(box: Box, target: string, self: Element | null): number {
  let s = 0;
  const seen = new Set<Element>();
  const t = document.querySelector(target);
  if (t) s += overlap(box, t.getBoundingClientRect()) * 12;
  for (const [sel, wt] of WEIGHTS) {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el) || (self && self.contains(el)) || el.closest('[role="dialog"]')) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // Large containers (a whole card that happens to be a link) count by their edge, not their area.
      const a = r.width * r.height > 400000 ? overlap(box, r) * 0.05 : overlap(box, r);
      s += a * wt;
    }
  }
  return s;
}

export function Pip({ spec }: { spec: PipSpec | null }) {
  const off = usePipOff();
  const ref = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<PipCorner>(spec?.corner ?? 'tl');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [hasTarget, setHasTarget] = useState(false);
  const cornerRef = useRef(corner);
  cornerRef.current = corner;
  const placed = useRef(false);

  useLayoutEffect(() => { placed.current = false; }, [spec?.id]);

  useEffect(() => {
    if (!spec || off) return;
    let t = 0;
    const tick = () => {
      const fs = document.fullscreenElement;
      const dialog = !!document.querySelector('[role="dialog"][aria-modal="true"]') || (!!fs && fs !== document.documentElement);
      setHidden(dialog);
      const el = document.querySelector(spec.target);
      const r = el?.getBoundingClientRect();
      setHasTarget(!!r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight);
      const me = ref.current;
      if (me && !dialog) {
        const w = me.offsetWidth, h = me.offsetHeight;
        const c = candidates(w, h);
        const order: PipCorner[] = [spec.corner ?? 'tl', 'tl', 'bl', 'tr', 'br'];
        const scores = Object.fromEntries((Object.keys(c) as PipCorner[]).map((k) => [k, score(c[k], spec.target, me)])) as Record<PipCorner, number>;
        let best = cornerRef.current;
        for (const k of order) if (scores[k] < scores[best] - 1) best = k;
        // Move only when the new corner is clearly better than where she is.
        const cur = cornerRef.current;
        const next = !placed.current || scores[best] < scores[cur] * 0.7 - 400 ? best : cur;
        placed.current = true;
        if (next !== cur) setCorner(next);
        const b = c[next];
        setPos((p) => (p && Math.abs(p.x - b.x) < 1 && Math.abs(p.y - b.y) < 1 ? p : { x: b.x, y: b.y }));
      }
      t = window.setTimeout(tick, 400);
    };
    tick();
    return () => window.clearTimeout(t);
  }, [spec?.id, spec?.target, spec?.corner, off]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!spec) return null;
  if (off) {
    return <button className="pip-back" onClick={() => setOff(false)} aria-label="Bring Freya back" data-testid="button-pip-back"><PipFace small /> Freya</button>;
  }
  const right = corner === 'tr' || corner === 'br';
  return (
    <>
      <div ref={ref} className={`pip is-${corner} ${right ? 'is-right' : ''} ${pos ? 'is-placed' : ''}`} style={pos ? { left: pos.x, top: pos.y, visibility: hidden ? 'hidden' : undefined } : { visibility: 'hidden' }} data-testid={`pip-${spec.id}`} data-corner={corner}>
        <div className="pip-avatar">
          <button className="pip-x" onClick={() => setOff(true)} aria-label="Stop the guidance" title="Stop the guidance" data-testid="button-pip-stop"><X size={12} /></button>
          <div className="pip-body"><PipFace /></div>
          <span className="pip-name" aria-hidden="true">FREYA</span>
        </div>
        <div className="pip-bubble" role="note" aria-label="Freya says" data-pip-bubble>
          {spec.intro ? (
            <>
              <p className="pip-what"><b>Hi, I'm Freya.</b> I'll show you what to press on each screen. Press the <b>×</b> above my head and I'll leave you to it.</p>
              <p className="pip-press"><span className="pip-arrow">→</span> {spec.press}</p>
            </>
          ) : (
            <>
              {spec.what && <p className="pip-what">{spec.what}</p>}
              <p className="pip-press"><span className="pip-arrow">→</span> {spec.press}</p>
              {spec.also && <p className="pip-also">{spec.also}</p>}
            </>
          )}
        </div>
      </div>
      {pos && !hidden && hasTarget && <TourPointer from="[data-pip-bubble]" target={{ kind: 'dom', selector: spec.target }} targetKey={`pip-${spec.id}-${corner}`} />}
    </>
  );
}

/** The face: a soft white rounded body and two eyes that blink. */
function PipFace({ small = false }: { small?: boolean }) {
  const s = small ? 22 : AV;
  return (
    <svg className="pip-face" width={s} height={s} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="pip-skin" cx="38%" cy="32%" r="75%"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#D9E3EA" /></radialGradient>
      </defs>
      <path d="M32 4c15 0 26 10 26 25 0 17-11 31-26 31S6 46 6 29C6 14 17 4 32 4z" fill="url(#pip-skin)" />
      <g className="pip-eyes">
        <ellipse className="pip-eye" cx="23" cy="30" rx="4" ry="6.5" fill="#101418" />
        <ellipse className="pip-eye" cx="41" cy="30" rx="4" ry="6.5" fill="#101418" />
        <circle cx="24.5" cy="27.5" r="1.3" fill="#fff" /><circle cx="42.5" cy="27.5" r="1.3" fill="#fff" />
      </g>
    </svg>
  );
}
