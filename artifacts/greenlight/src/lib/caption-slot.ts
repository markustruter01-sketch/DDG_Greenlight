import { useEffect, useRef, useState } from 'react';
import type { PointerTarget } from '@/components/tour-pointer';

/**
 * Where the tour caption sits. Six slots inside the orbit area; each frame
 * the one that covers nothing the slide is about wins. The caption only
 * moves when its current slot would overlap the target (or the detail
 * panel), so it stays put through small camera drift and glides when it must.
 *
 * The caption is positioned with one translate() from the stage's top-left,
 * never with left/right/top/bottom swaps, so every move is one smooth
 * transition instead of a jump between anchors.
 */
export type CaptionSlot = 'bc' | 'tc' | 'bl' | 'br' | 'tl' | 'tr';
export type CaptionPlace = { slot: CaptionSlot; x: number; y: number; ready: boolean; moves: number };

const ORDER: CaptionSlot[] = ['bc', 'bl', 'br', 'tc', 'tl', 'tr'];
const MARGIN = 14;
/** Breathing room around the target so the arrow head and label stay visible. */
const TARGET_PAD = 56;
const STAGE = '.orbit-visual';
const CAPTION = '[data-testid="tour-caption"]';
const AVOID = ['[data-tour-target="detail-panel"]'];

type Box = { x: number; y: number; w: number; h: number };

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function slotBox(slot: CaptionSlot, stage: DOMRect, w: number, h: number): Box {
  const x = slot.endsWith('c') ? stage.left + stage.width / 2 - w / 2 : slot.endsWith('l') ? stage.left + MARGIN : stage.right - w - MARGIN;
  const y = slot.startsWith('t') ? stage.top + MARGIN : stage.bottom - h - MARGIN;
  return { x, y, w, h };
}

function targetBox(target: PointerTarget | null): Box | null {
  if (!target) return null;
  if (target.kind === 'dom') {
    const r = (document.querySelector(target.selector) as HTMLElement | null)?.getBoundingClientRect();
    if (!r || r.width < 2) return null;
    return { x: r.left - TARGET_PAD, y: r.top - TARGET_PAD, w: r.width + TARGET_PAD * 2, h: r.height + TARGET_PAD * 2 };
  }
  const p = target.resolve();
  return p ? { x: p.x - TARGET_PAD, y: p.y - TARGET_PAD, w: TARGET_PAD * 2, h: TARGET_PAD * 2 } : null;
}

export function pickSlot(current: CaptionSlot, target: PointerTarget | null, preferred: CaptionSlot = 'bc'): CaptionSlot {
  const stage = document.querySelector(STAGE)?.getBoundingClientRect();
  const cap = document.querySelector(CAPTION)?.getBoundingClientRect();
  if (!stage || !cap || !cap.width) return current;
  const t = targetBox(target);
  const avoid = AVOID.map((s) => (document.querySelector(s) as HTMLElement | null)?.getBoundingClientRect()).filter((r): r is DOMRect => !!r && r.width > 2)
    .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  const cost = (slot: CaptionSlot) => {
    const b = slotBox(slot, stage, cap.width, cap.height);
    let c = (t ? overlap(b, t) : 0) * 4;
    for (const a of avoid) c += overlap(b, a);
    // Keep the caption inside the stage.
    if (b.x < stage.left || b.x + b.w > stage.right) c += 1e6;
    return c;
  };
  const now = cost(current);
  if (now === 0 && current === preferred) return current;
  const order = [preferred, ...ORDER.filter((s) => s !== preferred)];
  let best = current, bestCost = now === 0 ? 0 : Infinity;
  for (const s of order) {
    const c = cost(s) + order.indexOf(s) * 0.5; // tiny tie-breaker toward the preferred order
    if (c < bestCost - 1) { best = s; bestCost = c; }
  }
  return best;
}

/** Pixel offset of a slot from the stage's top-left corner, for the caption's current size. */
function placeOf(slot: CaptionSlot): { x: number; y: number } | null {
  const stage = document.querySelector(STAGE)?.getBoundingClientRect();
  const cap = document.querySelector(CAPTION)?.getBoundingClientRect();
  if (!stage || !cap || !cap.width) return null;
  const b = slotBox(slot, stage, cap.width, cap.height);
  return { x: Math.round(b.x - stage.left), y: Math.round(b.y - stage.top) };
}

/** Re-evaluates a few times a second while the tour runs; a slot change glides, a size change follows. */
export function useCaptionSlot(active: boolean, target: PointerTarget | null, preferred: CaptionSlot = 'bc', resetKey = ''): CaptionPlace {
  const [place, setPlace] = useState<CaptionPlace>({ slot: preferred, x: 0, y: 0, ready: false, moves: 0 });
  const targetRef = useRef(target);
  targetRef.current = target;
  const placeRef = useRef(place);
  placeRef.current = place;
  useEffect(() => {
    // A new slide starts in the preferred slot; the first measure after mount sets the pixels.
    setPlace((p) => (p.slot === preferred ? p : { ...p, slot: preferred }));
  }, [resetKey, preferred]);
  useEffect(() => {
    if (!active) return;
    let raf = 0, last = -1e9;
    const tick = (now: number) => {
      if (now - last > 180) {
        last = now;
        const cur = placeRef.current;
        const slot = pickSlot(cur.slot, targetRef.current, preferred);
        const px = placeOf(slot);
        if (px && (slot !== cur.slot || !cur.ready || Math.abs(px.x - cur.x) > 1 || Math.abs(px.y - cur.y) > 1)) {
          setPlace({ slot, x: px.x, y: px.y, ready: true, moves: cur.ready ? cur.moves + 1 : 0 });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, preferred]);
  return place;
}
