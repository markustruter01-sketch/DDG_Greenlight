import { type ReactNode, useState } from 'react';
import { Link } from 'wouter';
import { FileText } from 'lucide-react';
import { Show, UserButton } from '@clerk/react';
import { useListProjects } from '@workspace/api-client-react';
import { ReportsModal } from '@/components/reports';

const base = import.meta.env.BASE_URL;

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
  bg = 'glacier-night.webp',
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
  return (
    <div className="app-shell relative flex flex-col">
      <div
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundColor: '#06131A', backgroundImage: `linear-gradient(180deg,rgba(6,19,26,.5),rgba(6,19,26,.35) 50%,rgba(6,19,26,.6)),url(${base}${bg})` }}
      />
      {chrome && <header className="screen-header glass relative z-20 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3" data-testid="link-home">
          <Logo />
          <span className="font-head text-lg font-semibold">Greenlight</span>
          {runMeta && <span className="lbl hidden truncate !normal-case !tracking-normal sm:block">{runMeta}</span>}
        </Link>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <span className="lbl rounded-xl border px-3 py-2" style={{ borderColor: 'rgba(124,201,232,.3)' }} data-testid="text-checks" data-tour-target="rules-badge" data-tour-highlight={tourHeaderHighlight ? 'true' : undefined}>
            Checks: rules, no AI
          </span>
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
      {chrome && <footer className="screen-footer relative z-10 flex items-center justify-between gap-2">
        <nav className="lbl flex items-center gap-3" aria-label="Footer">
          <Link href="/start" className="hover:text-[#00E5FF]" data-testid="link-footer-start">Start</Link>
          <span>·</span>
          <Link href={rid ? `/results/${rid}` : '/start'} className="hover:text-[#00E5FF]" data-testid="link-footer-results">Results</Link>
          <span>·</span>
          <Link href={rid ? `/fix/${rid}` : '/start'} className="hover:text-[#00E5FF]" data-testid="link-footer-fix">Fix and verify</Link>
        </nav>
        <span className="lbl opacity-70">DDG Greenlight</span>
      </footer>}
      {runId && <ReportsModal runId={runId} open={reports} onClose={() => setReports(false)} />}
    </div>
  );
}
