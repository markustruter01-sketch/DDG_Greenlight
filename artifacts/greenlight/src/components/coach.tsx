import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { TourPointer } from '@/components/tour-pointer';

/**
 * "Do this": one small card per screen that says which button to press next,
 * with a glowing line drawn to that button. It stays until the × is pressed
 * (once per browser session per step), so a first-time viewer at their own
 * desk is never left guessing. `?nocoach` turns the cards off.
 */
export type CoachSpec = {
  id: string;
  /** A few words. */
  text: string;
  /** CSS selector of the button to press. */
  target: string;
  /** Show a "drag here" sweep over this element as well. */
  drag?: string;
};

const KEY = (id: string) => `ddg-coach-${id}`;

function offByUrl(): boolean {
  try { return new URLSearchParams(window.location.search).has('nocoach'); } catch { return false; }
}

/** Mark a card as done from elsewhere (the button it pointed at was pressed). */
export function dismissCoach(id: string) {
  try { window.sessionStorage.setItem(KEY(id), '1'); } catch { /* per-session nicety only */ }
}

export function useCoachDismissed(id: string): [boolean, () => void] {
  const [done, setDone] = useState(() => {
    try { return offByUrl() || window.sessionStorage.getItem(KEY(id)) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { setDone(offByUrl() || window.sessionStorage.getItem(KEY(id)) === '1'); } catch { setDone(false); }
  }, [id]);
  const dismiss = () => {
    setDone(true);
    try { window.sessionStorage.setItem(KEY(id), '1'); } catch { /* per-session nicety only */ }
  };
  return [done, dismiss];
}

/** Where the drag sweep sits: over the element's middle, a third of its width wide. */
function useRect(selector: string | undefined) {
  const [r, setR] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selector) { setR(null); return; }
    let raf = 0;
    const tick = () => {
      const el = document.querySelector(selector);
      const next = el ? el.getBoundingClientRect() : null;
      setR((cur) => (cur && next && Math.abs(cur.left - next.left) < 1 && Math.abs(cur.top - next.top) < 1 && Math.abs(cur.width - next.width) < 1 && Math.abs(cur.height - next.height) < 1 ? cur : next));
      raf = window.setTimeout(tick, 250);
    };
    tick();
    return () => window.clearTimeout(raf);
  }, [selector]);
  return r;
}

export function Coach({ spec }: { spec: CoachSpec | null }) {
  const id = spec?.id ?? '';
  const [done, dismiss] = useCoachDismissed(id);
  const drag = useRect(spec?.drag);
  // The card sits where it covers nothing: top right when the button is low on
  // the screen, bottom right when it is high.
  const targetRect = useRect(spec?.target);
  const low = useMemo(() => !!targetRect && targetRect.top + targetRect.height / 2 > window.innerHeight * 0.5, [targetRect]);
  if (!spec || done || !targetRect) return null;
  const sweep = drag && drag.width > 200 ? (() => {
    const cx = drag.left + drag.width / 2, cy = drag.top + drag.height * 0.56, r = Math.min(drag.width * 0.22, 260);
    return `M ${cx - r} ${cy + 26} Q ${cx} ${cy - 70} ${cx + r} ${cy + 26}`;
  })() : null;
  return (
    <>
      <div className={`coach ${low ? 'coach-top' : 'coach-bottom'}`} role="dialog" aria-label="What to do next" data-coach-card data-testid={`coach-${spec.id}`}>
        <span className="coach-k">Do this</span>
        <p className="coach-t">{spec.text}</p>
        <button className="coach-x" onClick={dismiss} aria-label="Close" data-testid="button-coach-close"><X size={16} /></button>
      </div>
      <TourPointer from="[data-coach-card]" target={{ kind: 'dom', selector: spec.target }} targetKey={`coach-${spec.id}`} />
      {sweep && (
        <svg className="tour-pointer" aria-hidden="true">
          <g className="coach-sweep">
            <path d={sweep} className="coach-sweep-line" />
            <circle r="7" className="coach-sweep-dot">
              <animateMotion dur="2.4s" repeatCount="indefinite" path={sweep} keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="linear" />
            </circle>
          </g>
        </svg>
      )}
    </>
  );
}
