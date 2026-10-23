import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowDownToLine, Braces, Check, ClipboardCheck, FileSearch, ListChecks, Play, ShieldCheck } from 'lucide-react';
import { Shell, Logo } from '@/components/shell';
import { Modal } from '@/components/gl';

/** The 45-second explainer (public/explainer.mp4), rendered from the DDG motion kit. */
const EXPLAINER = `${import.meta.env.BASE_URL}explainer.mp4`;
const EXPLAINER_POSTER = `${import.meta.env.BASE_URL}explainer-poster.jpg`;

const STEPS = [
  ['Plug in the code', Braces],
  ['Pick the standards', ListChecks],
  ['See every gap', FileSearch],
  ['Get the fix plan', ClipboardCheck],
  ['Fix it', Check],
  ["Prove it's fixed", ShieldCheck],
] as const;

export default function Welcome() {
  const [watch, setWatch] = useState(false);
  return (
    <Shell chrome={false}>
      <div className="welcome-layout" data-testid="welcome-page">
        <div className="mx-auto flex items-center gap-3 rounded-full border px-5 py-2 glass" style={{ borderColor: 'rgba(124,201,232,.4)' }}>
          <Logo />
          <div>
            <div className="font-head text-sm font-bold tracking-[.15em]">DIGITAL DYNAMICS</div>
            <div className="lbl !text-[9px]">DDG</div>
          </div>
        </div>
        <section className="glass mx-auto w-full max-w-3xl px-7 py-5 text-center" data-testid="hero-greenlight">
          <h1 className="font-head text-[64px] font-bold leading-[1.03] tracking-tight" data-testid="text-brand">
            <span className="mr-2 inline-block h-3 w-3 -translate-y-2 rounded-full" style={{ background: '#4FD99A', boxShadow: '0 0 16px #4FD99A88' }} />
            Green<span className="glitch" data-text="light">light</span>
          </h1>
          <p className="mt-2 text-[19px]" style={{ color: '#CFE3EE' }} data-testid="text-tagline">Know if software is fit for regulation, before it ships.</p>
        </section>
        <div className="welcome-steps">
          {STEPS.map(([title, Icon], i) => (
            <div key={title} className="glass welcome-step" data-testid={`tile-step-${i + 1}`}>
              <div className="flex items-center justify-between">
                <span className="lbl !text-[#7CC9E8]">0{i + 1}</span>
                {(i === 2 || i === 3 || i === 5) && <span className="lbl !text-[9px]">NO AI</span>}
                {i === 4 && <span className="lbl !text-[9px] !text-[#00E5FF]">AI</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: 'rgba(124,201,232,.3)', background: 'rgba(124,201,232,.08)' }}><Icon size={23} /></span>
                <span className="min-w-0 font-head text-sm font-medium leading-tight">{title}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="welcome-proof">
          <section className="glass welcome-card" data-testid="panel-checking">
            <div className="lbl !text-[#4FD99A]">CHECKING · NO AI</div>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: '#CFE3EE' }}>Every check is a written rule in code. The same code always gives the same result, and every finding shows its evidence. <Link href="/how-it-checks" className="underline" style={{ color: '#00E5FF' }} data-testid="link-how-it-checks">How it checks</Link></p>
          </section>
          <section className="glass welcome-card" data-testid="panel-fixing">
            <div className="lbl !text-[#00E5FF]">FIXING · AI, ONLY HERE</div>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: '#CFE3EE' }}>Claude, by Anthropic, applies the fixes. You approve every change, then the same rules check it again.</p>
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href="/start" className="btn btn-primary !px-5 !py-2.5" data-testid="link-start-assessment">Start an assessment <ArrowDownToLine size={15} /></Link>
          <button className="btn !px-5 !py-2.5" onClick={() => setWatch(true)} data-testid="button-watch-how"><Play size={15} /> Watch how it works · 45 s</button>
        </div>
        <div className="mx-auto rounded-full border px-3 py-1 lbl !text-[9px]" style={{ borderColor: 'rgba(124,201,232,.25)' }}>DEVELOPED BY DIGITAL DYNAMICS</div>
      </div>
      <Modal open={watch} onClose={() => setWatch(false)} title="How Greenlight works" wide>
        {watch && (
          <video className="explainer-video" src={EXPLAINER} poster={EXPLAINER_POSTER} controls autoPlay playsInline preload="auto" data-testid="video-explainer">
            Your browser cannot play this video.
          </video>
        )}
        <p className="lbl mt-3 !normal-case !tracking-normal">Checked by rules. Fixed by Claude. Re-checked by rules.</p>
      </Modal>
    </Shell>
  );
}
