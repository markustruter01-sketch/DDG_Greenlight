import { useEffect, useState } from 'react';
import { Compass, X } from 'lucide-react';

/**
 * "Now do this": the follow-the-ball instructions shown on every product
 * screen. Each page passes its own steps and which one is current; the ball
 * sits on that step. Hiding it is remembered per browser; a small button
 * brings it back.
 */
export type GuideSpec = {
  steps: string[];
  current: number;           // 0-based; steps before it are done
  tone?: 'cyan' | 'ok';
  /** Something to show at the right end (a button, a link). */
  aside?: React.ReactNode;
};

const KEY = 'ddg-greenlight-guide-hidden';

export function useGuideHidden(): [boolean, (v: boolean) => void] {
  const [hidden, setHidden] = useState(() => {
    try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  const set = (v: boolean) => {
    setHidden(v);
    try { window.localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* fine */ }
  };
  return [hidden, set];
}

export function Guide({ spec }: { spec: GuideSpec }) {
  const [hidden, setHidden] = useGuideHidden();
  const [announce, setAnnounce] = useState('');
  useEffect(() => { setAnnounce(spec.steps[spec.current] ?? ''); }, [spec.current, spec.steps]);
  if (hidden) {
    return (
      <button className="btn guide-show !px-3 !py-2 text-xs" onClick={() => setHidden(false)} data-testid="button-guide-show" aria-label="Show the guide">
        <Compass size={14} /> Guide
      </button>
    );
  }
  const now = spec.steps[spec.current] ?? spec.steps[spec.steps.length - 1] ?? '';
  const next = spec.steps[spec.current + 1];
  return (
    <div className={`glass guide tone-${spec.tone ?? 'cyan'}`} role="region" aria-label="Now do this" data-testid="guide">
      <div className="guide-k"><span className="guide-ball" aria-hidden="true" /><span className="lbl" style={{ color: spec.tone === 'ok' ? '#4FD99A' : '#00E5FF' }}>Now</span></div>
      <ol className="guide-steps">
        <li className="guide-step is-now" aria-current="step" data-testid={`guide-step-${spec.current + 1}`}><span className="guide-n">{spec.current + 1}</span><span>{now}</span></li>
        {next && <li className="guide-step guide-next" data-testid={`guide-step-${spec.current + 2}`}><span className="guide-n">{spec.current + 2}</span><span>{next}</span></li>}
      </ol>
      <span className="sr-only" aria-live="polite">{announce}</span>
      {spec.aside}
      <button className="lbl guide-hide hover:text-[#00E5FF]" onClick={() => setHidden(true)} data-testid="button-guide-hide" aria-label="Hide the guide"><X size={12} className="mr-1 inline" />Hide</button>
    </div>
  );
}
