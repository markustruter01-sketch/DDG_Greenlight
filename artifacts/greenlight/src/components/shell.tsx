import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { FileText } from 'lucide-react';
import { Show, UserButton } from '@clerk/react';
import { useListProjects } from '@workspace/api-client-react';
import { ReportsModal } from '@/components/reports';
import { Guide, type GuideSpec } from '@/components/guide';

const base = import.meta.env.BASE_URL;

/** The recorded fix sessions of the sample project, in wave order (public/demo/<name>.json). */
export const DEMO_WAVES: { name: string; wave: number; pullRequest?: string }[] = [
  { name: 'gev-wave1', wave: 1, pullRequest: 'https://github.com/pierretruter07-sudo/gods-eye-view/pull/39' },
  { name: 'gev-wave2', wave: 2, pullRequest: 'https://github.com/pierretruter07-sudo/gods-eye-view/pull/40' },
  { name: 'gev-wave3', wave: 3, pullRequest: 'https://github.com/pierretruter07-sudo/gods-eye-view/pull/38' },
];
/** The recording opened from "Watch the recorded fix". */
export const DEMO_RECORDING = DEMO_WAVES[0].name;
/** `?after=` value that shows every recorded wave applied in order. */
export const DEMO_ALL_WAVES = DEMO_WAVES.map((w) => w.name).join(',');

export function Logo() {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border"
      style={{ borderColor: 'rgba(255,255,255,.6)', boxShadow: '0 0 0 1px rgba(255,255,255,.2)' }}
    >
      <img src={`${base}ddg-mark.png`} alt="Digital Dynamics Group" className="h-full w-full object-cover" />
    </span>
  );
}

/**
 * The road: seven stops, in order. Every product screen shows it; the big dot
 * is where you are, green ticks are where you have been.
 */
export const STEPS = [
  { key: 'start', label: 'Your code', path: () => '/start' },
  { key: 'standards', label: 'Standards', path: () => '/start/standards' },
  { key: 'results', label: "What's wrong", path: (rid?: string) => (rid ? `/results/${rid}` : '/start') },
  { key: 'plan', label: 'The plan', path: (rid?: string) => (rid ? `/plan/${rid}` : '/start') },
  { key: 'fix', label: 'Fixing', path: (rid?: string) => (rid ? `/fix/${rid}` : '/start') },
  { key: 'verified', label: 'Proof', path: (rid?: string) => (rid ? `/verified/${rid}` : '/start') },
  { key: 'signoff', label: 'Done', path: (rid?: string) => (rid ? `/signoff/${rid}` : '/start') },
] as const;
export type StepKey = (typeof STEPS)[number]['key'];

function stepOfPath(path: string): number {
  if (path === '/' || path === '/start' || path.startsWith('/sign-')) return 0;
  if (path.startsWith('/start/')) return 1;
  if (path.startsWith('/results/') || path.startsWith('/orbit/')) return 2;
  if (path.startsWith('/plan/')) return 3;
  if (path.startsWith('/fix/') || path.startsWith('/replay')) return 4;
  if (path.startsWith('/verified/')) return 5;
  if (path.startsWith('/signoff/')) return 6;
  return -1;
}

export function Road({ runId, done, current }: { runId?: string; done?: boolean; current?: number }) {
  const [path] = useLocation();
  const now = current ?? stepOfPath(path);
  return (
    <nav className={`road ${done ? 'is-done' : ''}`} aria-label="Where you are">
      {STEPS.map((s, i) => {
        const state = i === now ? 'now' : done || i < now ? 'ok' : 'todo';
        const reachable = i <= 1 || !!runId;
        const inner = (
          <>
            <i>{state === 'ok' ? '✓' : i + 1}</i>
            <span>{s.label}</span>
          </>
        );
        return reachable ? (
          <Link key={s.key} href={s.path(runId)} className={`stop is-${state}`} aria-current={state === 'now' ? 'step' : undefined} aria-label={`Step ${i + 1}: ${s.label}`} data-testid={`link-footer-${s.key}`} data-tour-target={`nav-${s.key}`}>
            {inner}
          </Link>
        ) : (
          <span key={s.key} className={`stop is-${state}`} aria-label={`Step ${i + 1}: ${s.label}`} data-testid={`link-footer-${s.key}`}>{inner}</span>
        );
      })}
    </nav>
  );
}

export function Shell({
  children,
  runId,
  chrome = true,
  runMeta,
  tourHeaderHighlight = false,
  guide,
  headerActions,
  roadDone = false,
  roadStep,
}: {
  children: ReactNode;
  runId?: string;
  bg?: string;
  chrome?: boolean;
  runMeta?: string;
  tourHeaderHighlight?: boolean;
  guide?: GuideSpec;
  headerActions?: ReactNode;
  /** Every stop green (the Done screen). */
  roadDone?: boolean;
  /** Force which stop is current (sub-screens of a step). */
  roadStep?: number;
}) {
  const [reports, setReports] = useState(false);
  const projects = useListProjects();
  const latest = projects.data?.[0]?.latestRunId;
  const rid = runId ?? latest;
  return (
    <div className="app-shell relative flex flex-col">
      <div
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundColor: '#16181C', backgroundImage: 'radial-gradient(1100px 700px at 18% 0%,rgba(255,255,255,.06),transparent 60%),radial-gradient(900px 600px at 90% 100%,rgba(255,255,255,.04),transparent 60%),linear-gradient(180deg,#1A1D21,#121417)' }}
      />
      {chrome && <header className="screen-header glass relative z-20 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3" data-testid="link-home">
          <Logo />
          <span className="font-head text-lg font-semibold">Greenlight</span>
          {runMeta && <span className="lbl hidden truncate !normal-case !tracking-normal sm:block">{runMeta}</span>}
        </Link>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <Link href="/how-it-checks" className="lbl rounded-xl border px-3 py-2 hover:text-[#00E5FF]" style={{ borderColor: 'rgba(255,255,255,.2)', background: 'rgba(0,0,0,.28)' }} data-testid="text-checks" data-tour-target="rules-badge" data-tour-highlight={tourHeaderHighlight ? 'true' : undefined} title="How Greenlight checks">
            Checks: code, not AI
          </Link>
          {!runId && <Link href="/start" className="btn !px-3 !py-2" data-testid="link-saved-projects">Saved projects</Link>}
          <Show when="signed-in">
            <UserButton />
          </Show>
          {headerActions}
          {runId && (
            <button className="btn" onClick={() => setReports(true)} data-testid="button-reports">
              <FileText size={16} /> Reports
            </button>
          )}
        </div>
      </header>}
      {chrome && <Road runId={rid} done={roadDone} current={roadStep} />}
      {chrome && guide && <Guide spec={guide} />}
      <main className="app-main relative z-10 flex flex-1 flex-col">{children}</main>
      {runId && <ReportsModal runId={runId} open={reports} onClose={() => setReports(false)} />}
    </div>
  );
}
