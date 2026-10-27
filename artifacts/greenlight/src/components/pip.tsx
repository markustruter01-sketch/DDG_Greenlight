import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { TourPointer } from '@/components/tour-pointer';

/**
 * Freya: the small white guide who sits in a corner of the screen (bottom
 * left unless the screen needs that corner) and says, in a line or two, what
 * this screen is and what to press next. A thin pointer runs from her bubble
 * to that button. For a viewer opening the link alone at their desk. The ×
 * above her head stops the guidance for the session; a small button brings
 * her back. `?nopip` (or `?nocoach`) starts with her off. She steps aside
 * while a dialog is open.
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
  /** Which corner she sits in on this screen (default bottom left). */
  corner?: PipCorner;
};

const OFF = 'ddg-pip-off';
const AV = 56; // avatar size

function startsOff(): boolean {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.has('nopip') || q.has('nocoach') || window.sessionStorage.getItem(OFF) === '1';
  } catch { return false; }
}

/** Is the target on screen, and is a dialog open? Polled, since the page moves. */
function useScreen(selector: string | undefined) {
  const [state, setState] = useState({ hasTarget: false, dialog: false });
  useEffect(() => {
    let t = 0;
    const tick = () => {
      const el = selector ? document.querySelector(selector) : null;
      const r = el?.getBoundingClientRect();
      const hasTarget = !!r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
      const dialog = !!document.querySelector('[role="dialog"][aria-modal="true"]') || !!document.fullscreenElement;
      setState((cur) => (cur.hasTarget === hasTarget && cur.dialog === dialog ? cur : { hasTarget, dialog }));
      t = window.setTimeout(tick, 250);
    };
    tick();
    return () => window.clearTimeout(t);
  }, [selector]);
  return state;
}

export function Pip({ spec }: { spec: PipSpec | null }) {
  const [off, setOff] = useState(startsOff);
  const { hasTarget, dialog } = useScreen(spec?.target);
  const stop = () => {
    setOff(true);
    try { window.sessionStorage.setItem(OFF, '1'); } catch { /* per-session */ }
  };
  const back = () => {
    setOff(false);
    try { window.sessionStorage.removeItem(OFF); } catch { /* per-session */ }
  };
  if (!spec) return null;
  if (off) {
    return <button className="pip-back" onClick={back} aria-label="Bring Freya back" data-testid="button-pip-back"><PipFace small /> Freya</button>;
  }
  if (dialog) return null;
  const corner = spec.corner ?? 'bl';
  return (
    <>
      <div className={`pip is-${corner}`} data-testid={`pip-${spec.id}`}>
        <div className="pip-avatar">
          <button className="pip-x" onClick={stop} aria-label="Stop the guidance" title="Stop the guidance" data-testid="button-pip-stop"><X size={13} /></button>
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
      {hasTarget && <TourPointer from="[data-pip-bubble]" target={{ kind: 'dom', selector: spec.target }} targetKey={`pip-${spec.id}-${corner}`} />}
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
