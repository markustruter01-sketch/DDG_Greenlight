import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { FileText, Rocket, Orbit, Wrench, ListChecks, BadgeCheck, PenLine } from 'lucide-react';
import { Show, UserButton } from '@clerk/react';
import { useListProjects } from '@workspace/api-client-react';
import { ReportsModal } from '@/components/reports';
import { Guide, type GuideSpec } from '@/components/guide';

const base = import.meta.env.BASE_URL;

/** The recorded fix session shown from the plan (public/demo/<name>.json). */
export const DEMO_RECORDING = 'gev-wave3';

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

/** The six steps of the product, in order. */
export const STEPS = [
  { key: 'start', label: 'Start', icon: Rocket, path: () => '/start' },
  { key: 'results', label: 'Results', icon: Orbit, path: (rid?: string) => (rid ? `/results/${rid}` : '/start') },
  { key: 'plan', label: 'Plan', icon: ListChecks, path: (rid?: string) => (rid ? `/plan/${rid}` : '/start') },
  { key: 'fix', label: 'Fixing', icon: Wrench, path: (rid?: string) => (rid ? `/fix/${rid}` : '/start') },
  { key: 'verified', label: 'Verified', icon: BadgeCheck, path: (rid?: string) => (rid ? `/verified/${rid}` : '/start') },
  { key: 'signoff', label: 'Sign-off', icon: PenLine, path: (rid?: string) => (rid ? `/signoff/${rid}` : '/start') },
] as const;

export function Shell({
  children,
  runId,
  bg = 'vestrahorn.webp',
  chrome = true,
  runMeta,
  tourHeaderHighlight = false,
  guide,
  headerActions,
}: {
  children: ReactNode;
  runId?: string;
  bg?: string;
  chrome?: boolean;
  runMeta?: string;
  tourHeaderHighlight?: boolean;
  guide?: GuideSpec;
  headerActions?: ReactNode;
}) {
  const [reports, setReports] = useState(false);
  const projects = useListProjects();
  const latest = projects.data?.[0]?.latestRunId;
  const rid = runId ?? latest;
  const [path] = useLocation();
  const onStep = (key: string) => (key === 'start' ? path === '/start' || path === '/' : path.startsWith(`/${key}/`) || (key === 'fix' && path.startsWith('/replay')));
  return (
    <div className="app-shell relative flex flex-col">
      <div
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundColor: '#06131A', backgroundImage: `linear-gradient(180deg,rgba(6,19,26,.42),rgba(6,19,26,.3) 45%,rgba(6,19,26,.55)),url(${base}${bg})`, backgroundPosition: 'center 38%' }}
      />
      {chrome && <header className="screen-header glass relative z-20 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3" data-testid="link-home">
          <Logo />
          <span className="font-head text-lg font-semibold">Greenlight</span>
          {runMeta && <span className="lbl hidden truncate !normal-case !tracking-normal sm:block">{runMeta}</span>}
        </Link>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <Link href="/how-it-checks" className="lbl rounded-xl border px-3 py-2 hover:text-[#00E5FF]" style={{ borderColor: 'rgba(255,255,255,.45)', background: 'rgba(6,19,26,.5)' }} data-testid="text-checks" data-tour-target="rules-badge" data-tour-highlight={tourHeaderHighlight ? 'true' : undefined} title="How Greenlight checks">
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
      {chrome && guide && <Guide spec={guide} />}
      <main className="app-main relative z-10 flex flex-1 flex-col">{children}</main>
      {chrome && <nav className="float-nav" aria-label="Main">
        {STEPS.map(({ key, label, icon: Icon, path: to }, i) => {
          const on = onStep(key);
          return (
            <Link key={key} href={to(rid)} className={`float-nav-btn ${on ? 'is-on' : ''}`} aria-label={`Step ${i + 1}: ${label}`} aria-current={on ? 'page' : undefined} data-testid={`link-footer-${key}`} data-tour-target={`nav-${key}`}>
              <span className="float-nav-step">Step {i + 1}</span>
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>}
      {runId && <ReportsModal runId={runId} open={reports} onClose={() => setReports(false)} />}
    </div>
  );
}
