import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { FileText, Rocket, Orbit, Wrench, MonitorPlay } from 'lucide-react';
import { Show, UserButton } from '@clerk/react';
import { useListProjects } from '@workspace/api-client-react';
import { ReportsModal } from '@/components/reports';

const base = import.meta.env.BASE_URL;

/** The recorded fix session shown from the navigation (public/demo/<name>.json). */
export const DEMO_RECORDING = 'gev-wave3';

export function Logo() {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border"
      style={{ borderColor: 'rgba(124,201,232,.5)', boxShadow: '0 0 0 1px rgba(124,201,232,.2)' }}
    >
      <img src={`${base}ddg-mark.png`} alt="Digital Dynamics Group" className="h-full w-full object-cover" />
    </span>
  );
}

export function Shell({
  children,
  runId,
  bg = 'vestrahorn.webp',
  chrome = true,
  runMeta,
  tourHeaderHighlight = false,
}: {
  children: ReactNode;
  runId?: string;
  bg?: string;
  chrome?: boolean;
  runMeta?: string;
  tourHeaderHighlight?: boolean;
}) {
  const [reports, setReports] = useState(false);
  const projects = useListProjects();
  const latest = projects.data?.[0]?.latestRunId;
  const rid = runId ?? latest;
  const [path] = useLocation();
  const nav = [
    { href: '/start', label: 'Start', icon: Rocket, on: path === '/start' || path === '/', test: 'start', tour: 'nav-start' },
    { href: rid ? `/results/${rid}` : '/start', label: 'Results', icon: Orbit, on: path.startsWith('/results'), test: 'results', tour: 'nav-results' },
    { href: rid ? `/fix/${rid}` : '/start', label: 'Fix and verify', icon: Wrench, on: path.startsWith('/fix'), test: 'fix', tour: 'nav-fix' },
    { href: `/replay/${DEMO_RECORDING}`, label: 'Recorded fix', icon: MonitorPlay, on: path.startsWith('/replay'), test: 'replay', tour: 'nav-replay' },
  ];
  return (
    <div className="app-shell relative flex flex-col">
      <div
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundColor: '#06131A', backgroundImage: `linear-gradient(180deg,rgba(6,19,26,.55),rgba(6,19,26,.42) 45%,rgba(6,19,26,.72)),url(${base}${bg})`, backgroundPosition: 'center 38%' }}
      />
      {chrome && <header className="screen-header glass relative z-20 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3" data-testid="link-home">
          <Logo />
          <span className="font-head text-lg font-semibold">Greenlight</span>
          {runMeta && <span className="lbl hidden truncate !normal-case !tracking-normal sm:block">{runMeta}</span>}
        </Link>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <Link href="/how-it-checks" className="lbl rounded-xl border px-3 py-2 hover:text-[#00E5FF]" style={{ borderColor: 'rgba(124,201,232,.3)' }} data-testid="text-checks" data-tour-target="rules-badge" data-tour-highlight={tourHeaderHighlight ? 'true' : undefined} title="How Greenlight checks">
            Checks: code, not AI
          </Link>
          {!runId && <Link href="/start" className="btn !px-3 !py-2" data-testid="link-saved-projects">Saved projects</Link>}
          <Show when="signed-in">
            <UserButton />
          </Show>
          {runId && <Link href={`/fix/${runId}`} className="btn hidden sm:inline-flex" data-testid="link-header-fix" data-tour-target="fix-button" data-tour-highlight={tourHeaderHighlight ? 'true' : undefined}>Fix it with Claude <span className="lbl !text-[#00E5FF]">[AI]</span></Link>}
          {runId && (
            <button className="btn" onClick={() => setReports(true)} data-testid="button-reports">
              <FileText size={16} /> Reports
            </button>
          )}
        </div>
      </header>}
      <main className="app-main relative z-10 flex flex-1 flex-col">{children}</main>
      {chrome && <nav className="float-nav" aria-label="Main">
        {nav.map(({ href, label, icon: Icon, on, test, tour }, i) => (
          <Link key={test} href={href} className={`float-nav-btn ${on ? 'is-on' : ''}`} aria-label={`Step ${i + 1}: ${label}`} aria-current={on ? 'page' : undefined} data-testid={`link-footer-${test}`} data-tour-target={tour}>
            <span className="float-nav-step">Step {i + 1}</span>
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>}
      {runId && <ReportsModal runId={runId} open={reports} onClose={() => setReports(false)} />}
    </div>
  );
}
