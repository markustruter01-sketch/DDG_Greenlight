import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Play } from 'lucide-react';
import { Shell, Logo, STEPS } from '@/components/shell';
import { Modal } from '@/components/gl';

/** The 90-second explainer (public/explainer.mp4), rendered from the DDG motion kit. */
const EXPLAINER = `${import.meta.env.BASE_URL}explainer.mp4`;
const EXPLAINER_POSTER = `${import.meta.env.BASE_URL}explainer-poster.jpg`;

const BLURBS: Record<string, string> = {
  start: 'A GitHub link or a zip.',
  standards: 'Six chosen for you.',
  results: 'Code reads the code. One number.',
  plan: 'Rounds, biggest wins first.',
  fix: 'Claude writes it. You approve.',
  verified: 'The same code checks again.',
  signoff: 'Export the fixed code.',
};

/**
 * The landing page in the Journey style: the brand, one line, the road of
 * seven stops with the first one lit, one green button.
 */
export default function Welcome() {
  const [watch, setWatch] = useState(false);
  return (
    <Shell chrome={false} pip={watch ? null : { id: 'welcome', intro: true, press: 'Press Watch how it works. Then Check my code.', target: '[data-testid="button-watch-how"]' }}>
      <div className="jl" data-testid="welcome-page">
        <section className="glass jcard welcome-journey" data-testid="hero-greenlight">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3"><Logo /><div><div className="font-head text-sm font-bold tracking-[.15em]">DIGITAL DYNAMICS</div><div className="jnote">DDG</div></div></div>
            <Link href="/how-it-checks" className="jnote hover:text-[#00E5FF]" data-testid="link-how-it-checks">Checks: code, not AI</Link>
          </div>
          <div className="text-center">
            <h1 className="font-head text-[72px] font-bold leading-[1.02] tracking-tight" data-testid="text-brand">
              <span className="mr-3 inline-block h-3.5 w-3.5 -translate-y-3 rounded-full" style={{ background: '#4FD99A', boxShadow: '0 0 16px #4FD99A88' }} />
              Green<span className="glitch" data-text="light">light</span>
            </h1>
            <p className="jp mt-2 text-[22px]" data-testid="text-tagline">Know if software is fit for regulation, before it ships.</p>
          </div>
          <nav className="road welcome-road" aria-label="The seven steps">
            {STEPS.map((s, i) => (
              <span key={s.key} className={`stop ${i === 0 ? 'is-now' : 'is-todo'}`} data-testid={`tile-step-${i + 1}`}>
                <i>{i + 1}</i>
                <span>{s.label}</span>
                <small>{BLURBS[s.key]}</small>
              </span>
            ))}
          </nav>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/start" className="btn btn-go btn-big" data-testid="link-start-assessment">Check my code <ArrowRight size={20} /></Link>
            <button className="btn btn-quiet btn-attn" onClick={() => setWatch(true)} data-testid="button-watch-how"><Play size={16} /> Watch how it works · 1:30</button>
          </div>
          <p className="jnote text-center">Every check is code, not AI. Claude is used for one thing: writing the fixes you approve.</p>
        </section>
      </div>
      <Modal open={watch} onClose={() => setWatch(false)} title="How Greenlight works" wide>
        {watch && (
          <video className="explainer-video" src={EXPLAINER} poster={EXPLAINER_POSTER} controls autoPlay playsInline preload="auto" data-testid="video-explainer">
            Your browser cannot play this video.
          </video>
        )}
        <p className="lbl mt-3 !normal-case !tracking-normal">Checked by code. Fixed by Claude. Re-checked by code.</p>
      </Modal>
    </Shell>
  );
}
