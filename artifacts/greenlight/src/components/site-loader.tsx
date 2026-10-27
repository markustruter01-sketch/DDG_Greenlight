import { useEffect, useState } from 'react';

/**
 * The 5-second DDG loader, played once per browser session on first
 * arrival: the animated graphics alone on the app's dark-grey ground. The
 * transparent VP9 render sits directly on that ground; browsers without VP9
 * alpha (Safari) get an H.264 render composited onto the same ground. When it
 * ends (or 6 s pass, whichever first) it fades and the app is already there.
 */
const SEEN = 'ddg-greenlight-loader-played';
const base = import.meta.env.BASE_URL;

function shouldPlay() {
  try {
    if (window.sessionStorage.getItem(SEEN) === '1') return false;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    if (new URLSearchParams(window.location.search).has('nointro')) return false;
    window.sessionStorage.setItem(SEEN, '1');
    return true;
  } catch { return false; }
}

export function SiteLoader() {
  const [state, setState] = useState<'idle' | 'playing' | 'fading' | 'done'>(() => (shouldPlay() ? 'playing' : 'done'));
  useEffect(() => {
    if (state !== 'playing') return;
    const t = window.setTimeout(() => setState('fading'), 6000);
    return () => window.clearTimeout(t);
  }, [state]);
  useEffect(() => {
    if (state !== 'fading') return;
    const t = window.setTimeout(() => setState('done'), 700);
    return () => window.clearTimeout(t);
  }, [state]);
  if (state === 'done' || state === 'idle') return null;
  return (
    <div className={`site-loader ${state === 'fading' ? 'is-fading' : ''}`} aria-hidden="true" data-testid="site-loader">
      <video
        className="site-loader-video"
        autoPlay muted playsInline preload="auto"
        onEnded={() => setState('fading')}
        onError={() => setState('fading')}
      >
        <source src={`${base}loader.webm`} type="video/webm; codecs=vp9" />
        <source src={`${base}loader.mp4`} type="video/mp4" />
      </video>
      <button className="site-loader-skip lbl" onClick={() => setState('fading')} aria-hidden="false" aria-label="Skip intro">Skip</button>
    </div>
  );
}
