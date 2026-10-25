import { Link } from 'wouter';
import { ArrowRight, BookOpenCheck, FileSearch, ScanSearch, ShieldCheck, Sparkles } from 'lucide-react';
import { useGetGreenlightConfig, type GreenlightConfig } from '@workspace/api-client-react';
import { Shell, DEMO_RECORDING } from '@/components/shell';

type Counts = GreenlightConfig & { ruleCount?: number; factCount?: number; itemCount?: number };

/**
 * One screen for the assurance reviewer: how a rating is produced, and the
 * one place a model is used. Plain words, real counts from the engine.
 */
export default function How() {
  const cfg = useGetGreenlightConfig();
  const c = cfg.data as Counts | undefined;
  const rules = c?.ruleCount ?? 40, facts = c?.factCount ?? 0, items = c?.itemCount ?? 719, standards = c?.standards.length ?? 7;
  return (
    <Shell>
      <div className="how-layout" data-testid="how-page">
        <header className="how-head">
          <div className="lbl !text-[#4FD99A]">Checking · code, not AI</div>
          <h1 className="font-head how-title">How Greenlight checks</h1>
          <p className="how-lede">Every rating comes from written rules run over the code. The same repository gives the same findings, the same scores and the same report, every time. No model is called anywhere in checking.</p>
        </header>

        <ol className="how-steps">
          <li className="glass how-step">
            <span className="how-num">1</span>
            <FileSearch size={22} />
            <h2 className="font-head">Read</h2>
            <p>The repository is snapshotted: every file, its path, size and text. Nothing is executed.</p>
          </li>
          <li className="glass how-step">
            <span className="how-num">2</span>
            <ScanSearch size={22} />
            <h2 className="font-head">Run the rules</h2>
            <p><b>{rules}</b> written checks look for evidence: tests, CI, authentication, rate limits, secrets, HTTPS, hazard records and so on. Each check cites the file and line it matched.</p>
          </li>
          <li className="glass how-step">
            <span className="how-num">3</span>
            <BookOpenCheck size={22} />
            <h2 className="font-head">Rate each clause</h2>
            <p><b>{items}</b> requirements across <b>{standards}</b> standards each name the checks that evidence them. A clause is rated from those checks{facts ? <> and from <b>{facts}</b> intake answers a reviewer gives</> : null}. Clause numbers are cited; standard text is never reproduced.</p>
          </li>
          <li className="glass how-step">
            <span className="how-num">4</span>
            <ShieldCheck size={22} />
            <h2 className="font-head">Score and report</h2>
            <p>Readiness per standard is a weighted roll-up of the clause ratings. The report lists every finding with its rule, its evidence and its proof of fix. Re-running the rules on the same code reproduces it exactly.</p>
          </li>
        </ol>

        <section className="glass how-ai">
          <div className="flex items-center gap-2">
            <Sparkles size={18} style={{ color: '#00E5FF' }} />
            <div className="lbl !text-[#00E5FF]">Fixing · the only step that uses AI</div>
          </div>
          <p>When you choose <b>Fix it with Claude</b>, Claude edits an isolated copy of the code against the work packages the rules produced. You see every file it reads and every change it makes, you approve each change, and nothing is merged for you. Then the same rules run again, so the "after" number is measured, not claimed.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/replay/${DEMO_RECORDING}`} className="btn btn-primary !px-4 !py-2 text-xs" data-testid="link-how-replay">Watch a recorded fix <ArrowRight size={14} /></Link>
            <Link href="/start" className="btn !px-4 !py-2 text-xs">Start an assessment</Link>
          </div>
        </section>

        <p className="how-foot lbl !normal-case !tracking-normal">Determinism, in one line: same input in, same findings out. That is what makes a Greenlight result auditable.</p>
      </div>
    </Shell>
  );
}
