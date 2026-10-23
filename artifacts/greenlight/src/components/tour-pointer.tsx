import { useEffect, useRef, useState } from 'react';

/**
 * A DDG-styled arrow from the tour caption to whatever the caption is about:
 * a button in a corner, a panel, or a dot or link arc on the orbit. Viewers
 * watch the middle of the screen; the arrow takes their eye to the edge.
 *
 * Positions are re-measured every frame, so it follows the camera and any
 * layout change. Nothing here is interactive (pointer-events: none).
 */
export type PointerTarget =
  | { kind: 'dom'; selector: string; label?: string }
  | { kind: 'point'; resolve: () => { x: number; y: number } | null; label?: string };

type Geometry = {
  o: { x: number; y: number };
  c: { x: number; y: number };
  e: { x: number; y: number };
  angle: number;
  box?: { x: number; y: number; w: number; h: number };
  dot?: { x: number; y: number };
  label?: { x: number; y: number; anchor: 'start' | 'end' | 'middle' };
};

const CAPTION = '[data-testid="tour-caption"]';
const PAD = 10;

function edgePoint(from: { x: number; y: number }, r: DOMRect, pad: number) {
  // Where the line from `from` to the box centre crosses the (padded) box edge.
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hw = r.width / 2 + pad, hh = r.height / 2 + pad;
  const dx = from.x - cx, dy = from.y - cy;
  const t = 1 / Math.max(Math.abs(dx) / hw || 0, Math.abs(dy) / hh || 0, 1e-6);
  return { x: cx + dx * Math.min(1, t), y: cy + dy * Math.min(1, t) };
}

function measure(target: PointerTarget): Geometry | null {
  const cap = document.querySelector(CAPTION)?.getBoundingClientRect();
  let tx: number, ty: number, box: Geometry['box'], dot: Geometry['dot'], rect: DOMRect | null = null;
  if (target.kind === 'dom') {
    const el = document.querySelector(target.selector) as HTMLElement | null;
    if (!el) return null;
    rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    tx = rect.left + rect.width / 2; ty = rect.top + rect.height / 2;
    box = { x: rect.left - PAD / 2, y: rect.top - PAD / 2, w: rect.width + PAD, h: rect.height + PAD };
  } else {
    const p = target.resolve();
    if (!p) return null;
    tx = p.x; ty = p.y; dot = p;
  }
  // Start on the caption edge facing the target, or low centre when there is no caption.
  const vw = window.innerWidth, vh = window.innerHeight;
  let o: { x: number; y: number };
  if (cap && cap.width) {
    // Leave from the caption edge that faces the target: top or bottom when the
    // target is clearly above or below, otherwise the nearer side. A target that
    // sits inside the caption's own column (the control row under it) gets the
    // side exit too, so the arrow sweeps round instead of stubbing through text.
    const ccx = cap.left + cap.width / 2, ccy = cap.top + cap.height / 2;
    const dx = tx - ccx, dy = ty - ccy;
    const vertical = Math.abs(dy) > cap.height / 2 + 40 && Math.abs(dx) < cap.width / 2 + 60;
    if (vertical) o = { x: Math.max(cap.left + 36, Math.min(cap.right - 36, tx)), y: dy < 0 ? cap.top - 4 : cap.bottom + 4 };
    else o = { x: dx < 0 ? cap.left - 4 : cap.right + 4, y: Math.max(cap.top + 18, Math.min(cap.bottom - 18, ty)) };
  } else o = { x: vw / 2, y: vh * 0.72 };
  // Stop short of the target so the head does not cover it.
  let e: { x: number; y: number };
  if (rect) e = edgePoint(o, rect, PAD + 6);
  else {
    const d = Math.hypot(tx - o.x, ty - o.y) || 1;
    e = { x: tx - ((tx - o.x) / d) * 26, y: ty - ((ty - o.y) / d) * 26 };
  }
  const dx = e.x - o.x, dy = e.y - o.y;
  const len = Math.hypot(dx, dy);
  if (len < 30) return null;
  // Bow the line gently so it reads as a gesture, not a ruler.
  const bow = Math.min(120, len * 0.22) * (dx >= 0 ? -1 : 1);
  const c = { x: o.x + dx / 2 + (-dy / len) * bow, y: o.y + dy / 2 + (dx / len) * bow };
  const angle = Math.atan2(e.y - c.y, e.x - c.x);
  // Labels go where they cover nothing: under things in the header, over things
  // in the bottom bar, beside everything else.
  let label: Geometry['label'];
  if (target.label) {
    if (rect && ty < vh * 0.14) label = { x: Math.min(vw - 140, Math.max(140, tx)), y: rect.bottom + 26, anchor: 'middle' };
    else if (rect && ty > vh * 0.8) label = { x: Math.min(vw - 140, Math.max(140, tx)), y: rect.top - 26, anchor: 'middle' };
    else if (rect) label = { x: tx > vw / 2 ? rect.left - 12 : rect.right + 12, y: rect.top + rect.height / 2, anchor: tx > vw / 2 ? 'end' : 'start' };
    else label = { x: tx + (tx > vw / 2 ? -40 : 40), y: ty - 34, anchor: tx > vw / 2 ? 'end' : 'start' };
  }
  return { o, c, e, angle, box, dot, label };
}

const same = (a: Geometry | null, b: Geometry | null) =>
  !!a && !!b && Math.abs(a.o.x - b.o.x) < 0.5 && Math.abs(a.o.y - b.o.y) < 0.5 && Math.abs(a.e.x - b.e.x) < 0.5 && Math.abs(a.e.y - b.e.y) < 0.5;

export function TourPointer({ target, targetKey }: { target: PointerTarget | null; targetKey: string }) {
  const [g, setG] = useState<Geometry | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    let raf = 0;
    let last: Geometry | null = null;
    const tick = () => {
      const t = targetRef.current;
      const next = t ? measure(t) : null;
      if (!same(next, last)) { last = next; setG(next); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!g || !target) return null;
  const d = `M ${g.o.x} ${g.o.y} Q ${g.c.x} ${g.c.y} ${g.e.x} ${g.e.y}`;
  const head = 16;
  const a1 = g.angle + Math.PI - 0.42, a2 = g.angle + Math.PI + 0.42;
  const tip = `M ${g.e.x + Math.cos(a1) * head} ${g.e.y + Math.sin(a1) * head} L ${g.e.x} ${g.e.y} L ${g.e.x + Math.cos(a2) * head} ${g.e.y + Math.sin(a2) * head}`;
  const labelText = target.label?.toUpperCase();
  const labelW = labelText ? labelText.length * 7.6 + 22 : 0;
  return (
    <svg className="tour-pointer" aria-hidden="true">
      <defs>
        <linearGradient id="tp-grad" gradientUnits="userSpaceOnUse" x1={g.o.x} y1={g.o.y} x2={g.e.x} y2={g.e.y}>
          <stop offset="0" stopColor="#7CC9E8" stopOpacity=".35" />
          <stop offset=".55" stopColor="#00E5FF" stopOpacity=".95" />
          <stop offset="1" stopColor="#F7FBFF" />
        </linearGradient>
        <filter id="tp-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g key={targetKey} className="tp-draw" filter="url(#tp-glow)">
        <circle cx={g.o.x} cy={g.o.y} r="4" fill="#00E5FF" />
        <path d={d} pathLength={1} className="tp-line" stroke="url(#tp-grad)" />
        <path d={d} pathLength={1} className="tp-flow" />
        <path d={tip} className="tp-head" />
        {g.box && <rect x={g.box.x} y={g.box.y} width={g.box.w} height={g.box.h} rx="12" className="tp-box" />}
        {g.dot && <>
          <circle cx={g.dot.x} cy={g.dot.y} r="15" className="tp-ring" />
          <circle cx={g.dot.x} cy={g.dot.y} r="15" className="tp-ping" />
        </>}
        {g.label && labelText && (
          <g className="tp-label">
            <rect x={g.label.anchor === 'end' ? g.label.x - labelW : g.label.anchor === 'middle' ? g.label.x - labelW / 2 : g.label.x} y={g.label.y - 15} width={labelW} height="30" rx="15" />
            <text x={g.label.anchor === 'end' ? g.label.x - 11 : g.label.anchor === 'middle' ? g.label.x : g.label.x + 11} y={g.label.y + 4.5} textAnchor={g.label.anchor}>{labelText}</text>
          </g>
        )}
      </g>
    </svg>
  );
}
