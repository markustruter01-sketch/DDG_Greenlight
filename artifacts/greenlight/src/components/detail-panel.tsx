import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Download, X } from 'lucide-react';
import {
  getListReportsQueryKey,
  useListReports,
  useUpdateAssessment,
  type AssessmentRun,
  type AssessmentUpdate,
  type Finding,
  type GreenlightConfig,
} from '@workspace/api-client-react';
import { useGate } from '@/hooks/use-gate';
import { Dot, StatusPill } from '@/components/gl';
import { ANNUNCIATORS, STATUS_COLOR, download, findingsFor, pc, reportUrl } from '@/lib/greenlight';

export type Target = { kind: 'theme'; id: string } | { kind: 'standard'; id: string } | { kind: 'finding'; key: string } | null;

const ORDER: Record<string, number> = { N: 0, P: 1, UN: 2, L: 3, C: 4, NA: 5 };
const CLASSES = ['Non-classified', 'OFFICIAL: Sensitive', 'PROTECTED', 'SECRET', 'TOP SECRET'];

function FindingRow({ f, status, projected, defaultOpen, onSelect }: { f: Finding; status: string; projected: boolean; defaultOpen?: boolean; onSelect?: (key: string) => void }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const changed = status !== f.status;
  return (
    <div className="rounded-xl border" style={{ borderColor: 'rgba(124,201,232,.2)', background: 'rgba(6,19,26,.35)' }} data-testid={`row-finding-${f.key}`}>
      <div className="flex items-center gap-2 p-2">
        <button className="flex min-w-0 flex-1 items-center justify-between gap-3 p-1 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="min-w-0">
            <span className="lbl block !text-[#7CC9E8]">{f.id}</span>
            <span className="block text-sm">{f.title}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <StatusPill status={status} text={changed ? undefined : f.statusText} small />
            <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
          </span>
        </button>
        {onSelect && <button className="btn shrink-0 !px-3 !py-2 text-xs" onClick={() => onSelect(f.key)}>Select</button>}
      </div>
      {open && (
        <div className="space-y-4 border-t p-4 text-sm" style={{ borderColor: 'rgba(124,201,232,.15)' }}>
          <section>
            <div className="lbl mb-1">Rating</div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={f.status} text={f.statusText} small />
              {f.severity && <span className="lbl">Severity {f.severity}</span>}
              {f.blocking && <Dot color="#FF5C6E" word="Must fix" />}
            </div>
            {changed && projected && (
              <div className="lbl mt-2 !text-[#00E5FF]">Projected after this wave: {status}</div>
            )}
          </section>
          <section>
            <div className="lbl mb-1">Why</div>
            <p style={{ color: '#CFE3EE' }}>{f.why}</p>
          </section>
          <section>
            <div className="lbl mb-1">How we know</div>
            {f.evidence.length ? (
              <ul className="space-y-2">
                {f.evidence.map((e, i) => (
                  <li key={i} className="rounded-lg p-2" style={{ background: 'rgba(0,0,0,.25)' }}>
                    <div className="font-mono text-xs" style={{ color: '#00E5FF' }}>{e.file}{e.line ? `:${e.line}` : ''}{e.ruleId ? `  ·  rule ${e.ruleId}` : ''}</div>
                    <div style={{ color: '#CFE3EE' }}>{e.note}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: '#CFE3EE' }}>No file evidence. This rating comes from an answer or from the absence of a signal.</p>
            )}
          </section>
          <section>
            <div className="lbl mb-1">Proof of fix</div>
            <p style={{ color: '#CFE3EE' }}>{f.proofOfFix}</p>
          </section>
          {f.closedBy.length > 0 && (
            <section className="flex flex-wrap gap-2">
              {f.closedBy.map((c) => <Chip key={c}>{c}</Chip>)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: string }) {
  return <span className="lbl rounded-lg border px-2 py-1 !text-[#F7FBFF]" style={{ borderColor: 'rgba(0,229,255,.4)', background: 'rgba(0,229,255,.08)' }}>{children}</span>;
}

function Grouped({ list, st, projected, open, onSelectFinding }: { list: Finding[]; st: Record<string, string>; projected: boolean; open?: string | null; onSelectFinding?: (key: string) => void }) {
  const by = new Map<string, Finding[]>();
  for (const f of [...list].sort((a, b) => ORDER[st[a.key]] - ORDER[st[b.key]])) by.set(f.standardShort, [...(by.get(f.standardShort) ?? []), f]);
  if (!list.length) return <p className="text-sm" style={{ color: '#CFE3EE' }}>Nothing in this area.</p>;
  return (
    <div className="space-y-5">
      {[...by.entries()].map(([std, fs]) => (
        <div key={std}>
          <div className="lbl mb-2">{std} · {fs.length}</div>
          <div className="space-y-2">{fs.map((f) => <FindingRow key={f.key} f={f} status={st[f.key]} projected={projected} defaultOpen={open === f.key} onSelect={onSelectFinding} />)}</div>
        </div>
      ))}
    </div>
  );
}

function StandardView({ run, config, id, st, projected, onRun, readiness, onSelectFinding }: { run: AssessmentRun; config?: GreenlightConfig; id: string; st: Record<string, string>; projected: boolean; onRun: (id: string) => void; readiness: number; onSelectFinding?: (key: string) => void }) {
  const s = run.standards.find((x) => x.id === id)!;
  const cfg = config?.standards.find((x) => x.id === id);
  const reports = useListReports(run.id, { query: { enabled: true, queryKey: getListReportsQueryKey(run.id) } });
  const upd = useUpdateAssessment();
  const list = run.findings.filter((f) => f.standardId === id);
  const { run: gated } = useGate();
  const apply = (data: AssessmentUpdate) => gated(() => upd.mutate({ id: run.id, data }, { onSuccess: (r) => onRun(r.id) }));
  const isIsm = /ism/i.test(id);
  const isE8 = /e8|essential/i.test(id);
  const levels = cfg?.levels ?? [];
  const groups = new Map<string, Finding[]>();
  for (const f of list) groups.set(f.group || 'Other', [...(groups.get(f.group || 'Other') ?? []), f]);
  const top = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  const max = top[0]?.[1].length || 1;
  const rows: [string, number, string][] = [
    ['Compliant', list.filter((f) => st[f.key] === 'C' || st[f.key] === 'L').length, STATUS_COLOR.C],
    ['Partial', list.filter((f) => st[f.key] === 'P').length, STATUS_COLOR.P],
    ['Failing', list.filter((f) => st[f.key] === 'N').length, STATUS_COLOR.N],
    ['Needs answer', list.filter((f) => st[f.key] === 'UN').length, STATUS_COLOR.UN],
  ];
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-head text-4xl">{readiness}%</div>
          <div className="lbl mt-1">{projected ? 'Projected readiness' : 'Readiness'}</div>
        </div>
        <Dot color={s.blocking ? '#FF5C6E' : s.partial || s.unanswered ? '#F5C451' : '#4FD99A'} word={s.verdict} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map(([n, v, c]) => (
          <div key={n} className="tile p-3"><Dot color={c} word={n} /><div className="font-head mt-1 text-2xl">{v}</div></div>
        ))}
      </div>
      {s.blocking > 0 && <div className="text-sm"><Dot color="#FF5C6E" word={`${s.blocking} must-fix`} /></div>}

      <section className="space-y-3">
        <div className="lbl">Controls</div>
        {levels.length > 0 && !isIsm && (
          <label className="block text-sm">
            <span className="lbl">{cfg?.short} level</span>
            <select className="field mt-1" value={run.levels[id] ?? cfg?.defaultLevel ?? levels[0]} disabled={upd.isPending} onChange={(e) => apply({ levels: { [id]: e.target.value } })} data-testid={`select-level-${id}`}>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
        {isIsm && (
          <label className="block text-sm">
            <span className="lbl">ISM classification</span>
            <select className="field mt-1" value={run.classification.current} disabled={upd.isPending} onChange={(e) => apply({ classification: e.target.value, classificationAccepted: true })} data-testid="select-panel-classification">
              {[...new Set([run.classification.current, ...CLASSES])].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        )}
        {(isE8 || isIsm) && (
          <label className="block text-sm">
            <span className="lbl">Essential Eight maturity</span>
            <select className="field mt-1" value={run.maturity} disabled={upd.isPending} onChange={(e) => apply({ maturity: Number(e.target.value) })} data-testid="select-panel-maturity">
              {[1, 2, 3].map((m) => <option key={m} value={m}>Maturity {m}</option>)}
            </select>
          </label>
        )}
        {!levels.length && !isIsm && !isE8 && <p className="text-sm" style={{ color: '#CFE3EE' }}>This standard has no adjustable options.</p>}
        {upd.isError && <Dot color="#FF5C6E" word="Update failed. Try again." />}
        {upd.isPending && <div className="lbl !text-[#00E5FF]">Re-running the rules</div>}
      </section>

      <section>
        <div className="lbl mb-2">Largest guidelines</div>
        <div className="space-y-2">
          {top.map(([g, fs]) => {
            const bad = fs.filter((f) => st[f.key] === 'N' || st[f.key] === 'P').length;
            const good = fs.filter((f) => st[f.key] === 'C' || st[f.key] === 'L').length;
            return (
              <div key={g} data-testid={`bar-group-${g}`}>
                <div className="mb-1 flex justify-between text-xs"><span className="truncate pr-2">{g}</span><span className="font-mono">{good}/{fs.length}</span></div>
                <div className="flex h-2 overflow-hidden rounded-full" style={{ width: `${(fs.length / max) * 100}%`, background: 'rgba(124,201,232,.15)', minWidth: 40 }}>
                  <div style={{ width: `${(good / fs.length) * 100}%`, background: STATUS_COLOR.C }} />
                  <div style={{ width: `${(bad / fs.length) * 100}%`, background: STATUS_COLOR.P }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="lbl mb-2">Reports</div>
        <div className="space-y-2">
          {(reports.data ?? []).filter((r) => r.standardId === id).map((r) => (
            <div key={r.kind} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{r.title}</span>
              <span className="flex gap-1">{r.formats.map((f) => <button key={f} className="btn !px-2 !py-1" onClick={() => download(reportUrl(r.url, f))}><Download size={12} /><span className="lbl !text-[#F7FBFF]">{f}</span></button>)}</span>
            </div>
          ))}
          {!reports.isLoading && !(reports.data ?? []).some((r) => r.standardId === id) && <p className="text-sm" style={{ color: '#CFE3EE' }}>No standalone report for this standard.</p>}
        </div>
      </section>

      <section>
        <div className="lbl mb-2">Further testing</div>
        <p className="text-sm" style={{ color: '#CFE3EE' }}>{s.furtherTesting || cfg?.furtherTesting || 'None recorded.'}</p>
        {cfg?.note && <p className="mt-2 text-sm" style={{ color: '#CFE3EE' }}>{cfg.note}</p>}
      </section>

      <section>
        <div className="lbl mb-2">Requirements</div>
        <Grouped list={list} st={st} projected={projected} onSelectFinding={onSelectFinding} />
      </section>
    </div>
  );
}

function Answers({ run, config, onRun }: { run: AssessmentRun; config?: GreenlightConfig; onRun: (id: string) => void }) {
  const upd = useUpdateAssessment();
  const { run: gated } = useGate();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const qs = config?.questions ?? [];
  const pending = qs.filter((q) => !run.facts[q.id] || run.facts[q.id] === 'unknown');
  const shown = [...pending, ...qs.filter((q) => !pending.includes(q))];
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: '#CFE3EE' }}>Code cannot answer these. Your answers go into the same rules and the assessment runs again.</p>
      {!qs.length && <p className="text-sm">No questions available.</p>}
      {shown.map((q) => {
        const cur = draft[q.id] ?? run.facts[q.id] ?? '';
        const opts = q.options?.length ? q.options : ['yes', 'no'];
        return (
          <div key={q.id} className="tile p-4" data-testid={`card-question-${q.id}`}>
            <div className="lbl mb-1">{q.theme}{pending.includes(q) ? ' · open' : ' · answered'}</div>
            <div className="mb-3 text-sm">{q.question}</div>
            <div className="flex flex-wrap gap-2">
              {opts.map((o) => (
                <button key={o} className="btn capitalize" style={cur === o ? { borderColor: '#00E5FF', background: 'rgba(0,229,255,.14)' } : undefined} onClick={() => setDraft({ ...draft, [q.id]: o })} aria-pressed={cur === o} data-testid={`button-answer-${q.id}-${o}`}>{o}</button>
              ))}
            </div>
          </div>
        );
      })}
      <button className="btn btn-primary w-full justify-center" disabled={!Object.keys(draft).length || upd.isPending} onClick={() => gated(() => upd.mutate({ id: run.id, data: { facts: draft } }, { onSuccess: (r) => onRun(r.id) }))} data-testid="button-submit-answers">
        {upd.isPending ? 'Re-running the rules' : `Submit ${Object.keys(draft).length || ''} answers and re-check`}
      </button>
      {upd.isError && <Dot color="#FF5C6E" word="Could not save answers" />}
    </div>
  );
}

export function DetailPanel({ run, config, target, st, projected, onClose, onRun, onSelectFinding }: { run: AssessmentRun; config?: GreenlightConfig; target: Target; st: Record<string, string>; projected: boolean; onClose: () => void; onRun: (id: string) => void; onSelectFinding?: (key: string) => void }) {
  let title = '';
  let body: ReactNode = null;
  if (target?.kind === 'theme') {
    const a = ANNUNCIATORS.find((x) => x.id === target.id)!;
    title = a.label;
    if (a.id === 'answers') body = <Answers run={run} config={config} onRun={onRun} />;
    else {
      const list = findingsFor(run, a.id);
      const closed = [...new Set(list.flatMap((f) => f.closedBy))];
      body = (
        <div className="space-y-6">
          <section><div className="lbl mb-1">Why</div><p className="text-sm" style={{ color: '#CFE3EE' }}>{a.why}</p></section>
          <section>
            <div className="lbl mb-2">Closed by</div>
            <div className="flex flex-wrap gap-2">{closed.length ? closed.map((c) => <Chip key={c}>{c}</Chip>) : <span className="text-sm" style={{ color: '#CFE3EE' }}>Nothing to close.</span>}</div>
          </section>
          <section><div className="lbl mb-2">Findings</div><Grouped list={list} st={st} projected={projected} onSelectFinding={onSelectFinding} /></section>
        </div>
      );
    }
  } else if (target?.kind === 'standard') {
    const s = run.standards.find((x) => x.id === target.id);
    title = s?.name ?? 'Standard';
    if (s) body = <StandardView run={run} config={config} id={s.id} st={st} projected={projected} onRun={onRun} readiness={pc(s.readiness)} onSelectFinding={onSelectFinding} />;
  } else if (target?.kind === 'finding') {
    const f = run.findings.find((x) => x.key === target.key);
    if (f) {
      title = `${f.standardShort} ${f.id}`;
      body = <FindingRow f={f} status={st[f.key]} projected={projected} defaultOpen onSelect={onSelectFinding} />;
    }
  }
  return (
    <AnimatePresence>
      {target && (
        <>
          <motion.div className="absolute inset-0 z-40 bg-[rgba(3,10,14,.45)] lg:bg-transparent lg:pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="glass absolute bottom-0 right-0 top-0 z-50 flex w-full flex-col sm:w-[460px] sm:max-w-[92vw]"
            style={{ borderRadius: '20px 0 0 20px', background: 'rgba(8,24,33,.82)' }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 300 }}
            data-testid="panel-detail"
          >
            <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'rgba(124,201,232,.2)' }}>
              <h2 className="font-head text-xl font-semibold">{title}</h2>
              <button className="btn !p-2" onClick={onClose} aria-label="Close panel" data-testid="button-close-panel"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">{body}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
