import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { TourPointer } from '@/components/tour-pointer';

/**
 * Pip: the small white guide that flies to the button you should press next
 * and says, in a line or two, what this screen is and what to do. For a
 * viewer opening the link alone at their desk. The × above Pip's head stops
 * the guidance for the session; a small button brings Pip back.
 * `?nopip` (or `?nocoach`) starts with Pip off.
 */
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
  /** Show a "drag here" sweep over this element as well. */
  drag?: string;
  /** The first meeting: Pip introduces itself. */
  intro?: boolean;
};

const OFF = 'ddg-pip-off';
const W = 300; // bubble width
const AV = 64; // avatar size

function startsOff(): boolean {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.has('nopip') || q.has('nocoach') || window.sessionStorage.getItem(OFF) === '1';
  } catch { return false; }
}

function useRect(selector: string | undefined) {
  const [r, setR] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selector) { setR(null); return; }
    let t = 0;
    const tick = () => {
      const el = document.querySelector(selector);
      const next = el ? el.getBoundingClientRect() : null;
      setR((cur) => (cur && next && Math.abs(cur.left - next.left) < 1 && Math.abs(cur.top - next.top) < 1 && Math.abs(cur.width - next.width) < 1 && Math.abs(cur.height - next.height) < 1 ? cur : next));
      t = window.setTimeout(tick, 250);
    };
    tick();
    return () => window.clearTimeout(t);
  }, [selector]);
  return r;
}

/** Where Pip hovers: beside the button, on the side with more room, never over it. */
function placeNear(r: DOMRect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const left = cx > vw / 2;
  let x = left ? r.left - W - 40 : r.right + 40;
  let y = cy - 30;
  // Above the button when it sits low; below when it sits high.
  if (cy > vh * 0.62) y = r.top - 230;
  else if (cy < vh * 0.3) y = r.bottom + 24;
  x = Math.max(16, Math.min(vw - W - 16, x));
  y = Math.max(96, Math.min(vh - 250, y));
  return { x, y };
}

export function Pip({ spec }: { spec: PipSpec | null }) {
  const [off, setOff] = useState(startsOff);
  const target = useRect(spec?.target);
  const drag = useRect(spec?.drag);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [eyes, setEyes] = useState({ x: 0, y: 0 });
  const [flying, setFlying] = useState(false);
  const flyTimer = useRef(0);
  useEffect(() => {
    if (!target) return;
    const next = placeNear(target);
    setPos((cur) => {
      if (cur && Math.abs(cur.x - next.x) < 2 && Math.abs(cur.y - next.y) < 2) return cur;
      setFlying(true);
      window.clearTimeout(flyTimer.current);
      flyTimer.current = window.setTimeout(() => setFlying(false), 950);
      return next;
    });
    // Eyes look at the button.
    const ax = next.x + AV / 2, ay = next.y + AV / 2;
    const dx = target.left + target.width / 2 - ax, dy = target.top + target.height / 2 - ay;
    const d = Math.hypot(dx, dy) || 1;
    setEyes({ x: (dx / d) * 3.2, y: (dy / d) * 2.4 });
  }, [target]);
  const stop = () => {
    setOff(true);
    try { window.sessionStorage.setItem(OFF, '1'); } catch { /* per-session */ }
  };
  const back = () => {
    setOff(false);
    try { window.sessionStorage.removeItem(OFF); } catch { /* per-session */ }
  };
  const sweep = useMemo(() => {
    if (!drag || drag.width < 200) return null;
    const cx = drag.left + drag.width / 2, cy = drag.top + drag.height * 0.56, r = Math.min(drag.width * 0.22, 260);
    return `M ${cx - r} ${cy + 26} Q ${cx} ${cy - 70} ${cx + r} ${cy + 26}`;
  }, [drag]);

  if (!spec) return null;
  if (off) {
    return <button className="pip-back" onClick={back} aria-label="Bring Pip back" data-testid="button-pip-back"><PipFace eyes={{ x: 0, y: 0 }} small /> Pip</button>;
  }
  if (!pos) return null;
  return (
    <>
      <div className={`pip ${flying ? 'is-flying' : ''}`} style={{ left: pos.x, top: pos.y }} data-testid={`pip-${spec.id}`}>
        <button className="pip-x" onClick={stop} aria-label="Stop the guidance" title="Stop the guidance" data-testid="button-pip-stop"><X size={14} /></button>
        <div className="pip-body"><PipFace eyes={eyes} /></div>
        <div className="pip-bubble" role="dialog" aria-label="Pip says" data-pip-bubble>
          {spec.intro ? (
            <>
              <p className="pip-what"><b>Hi, I'm Pip.</b> I'll show you what to press on each screen. Press the <b>×</b> above my head and I'll leave you to it.</p>
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
      {target && <TourPointer from="[data-pip-bubble]" target={{ kind: 'dom', selector: spec.target }} targetKey={`pip-${spec.id}`} />}
      {sweep && (
        <svg className="tour-pointer" aria-hidden="true">
          <path d={sweep} className="coach-sweep-line" />
          <circle r="7" className="coach-sweep-dot"><animateMotion dur="2.4s" repeatCount="indefinite" path={sweep} keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="linear" /></circle>
        </svg>
      )}
    </>
  );
}

/** The face: a soft white rounded body and two eyes that blink and look. */
function PipFace({ eyes, small = false }: { eyes: { x: number; y: number }; small?: boolean }) {
  const s = small ? 22 : AV;
  return (
    <svg className="pip-face" width={s} height={s} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="pip-skin" cx="38%" cy="32%" r="75%"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#D9E3EA" /></radialGradient>
      </defs>
      <path d="M32 4c15 0 26 10 26 25 0 17-11 31-26 31S6 46 6 29C6 14 17 4 32 4z" fill="url(#pip-skin)" />
      <g className="pip-eyes" style={{ transform: `translate(${eyes.x}px,${eyes.y}px)` }}>
        <ellipse className="pip-eye" cx="23" cy="30" rx="4" ry="6.5" fill="#101418" />
        <ellipse className="pip-eye" cx="41" cy="30" rx="4" ry="6.5" fill="#101418" />
        <circle cx="24.5" cy="27.5" r="1.3" fill="#fff" /><circle cx="42.5" cy="27.5" r="1.3" fill="#fff" />
      </g>
    </svg>
  );
}
