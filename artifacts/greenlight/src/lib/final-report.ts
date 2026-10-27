import type { AssessmentRun, Finding } from '@workspace/api-client-react';
import type { AfterView } from '@/lib/after';
import { ANNUNCIATORS, STATUS_WORD, isGood, tally, tone } from '@/lib/greenlight';
import { plainName } from '@/lib/standard-info';

/**
 * The Step 7 report, worked out from the same data as every other screen.
 * Plain arithmetic over the rule results: no AI, no estimates. The page reads
 * it top to bottom, from the one number down to every requirement.
 */
export type RiskRating = 'High' | 'Medium' | 'Low';
export type OpenRisk = { key: string; rating: RiskRating; standard: string; id: string; title: string; area: string; status: string; why: string };
export type StandardRow = { id: string; short: string; plain: string; name: string; before: number; after: number; passing: number; partial: number; failing: number; person: number; total: number; word: string; color: string };
export type AreaCount = { id: string; label: string; count: number };

const SERIOUS = ['S1', 'S2', 'SC', 'SH'];

export function areaOf(f: Finding): string {
  const t = (f.theme || '').toLowerCase();
  return ANNUNCIATORS.find((a) => a.themes.includes(t))?.label ?? 'Other';
}

/**
 * High: must be fixed before release and still open. Medium: failing, or
 * partly met on a serious-severity item. Low: partly met otherwise. Severity
 * comes from the findings; likelihood is not something code can establish.
 */
export function ratingOf(f: Finding, status: string): RiskRating {
  if (f.blocking) return 'High';
  if (status === 'N' || SERIOUS.includes(f.severity ?? '')) return 'Medium';
  return 'Low';
}

const ORDER: Record<RiskRating, number> = { High: 0, Medium: 1, Low: 2 };

export function buildFinalReport(run: AssessmentRun, after: AfterView) {
  const before = tally(run, after.statusesBefore);
  const now = tally(run, after.statusesAfter);
  const keys = Object.keys(after.readinessAfter);
  const avg = (m: Record<string, number>) => Math.round(keys.reduce((n, k) => n + (m[k] ?? 0), 0) / Math.max(1, keys.length));
  const readinessBefore = avg(after.readinessBefore);
  const readinessAfter = avg(after.readinessAfter);
  const verdict = tone(now);

  const fixedKeys = after.changedKeys.filter((k) => isGood(after.statusesAfter[k] ?? '') && !isGood(after.statusesBefore[k] ?? ''));
  const fixedSet = new Set(fixedKeys);

  const standards: StandardRow[] = run.standards.map((s) => {
    const own = run.findings.filter((f) => f.standardShort === s.short);
    const c = { passing: 0, partial: 0, failing: 0, person: 0, total: 0, blocking: 0 };
    for (const f of own) {
      const st = after.statusesAfter[f.key] ?? f.status;
      if (st === 'NA') continue;
      c.total++;
      if (isGood(st)) c.passing++;
      else if (st === 'P') c.partial++;
      else if (st === 'N') c.failing++;
      else if (st === 'UN') c.person++;
      if (f.blocking && (st === 'P' || st === 'N')) c.blocking++;
    }
    const t = tone({ failed: c.failing, blocking: c.blocking, partial: c.partial, unanswered: c.person });
    const b = after.readinessBefore[s.short] ?? 0;
    return { id: s.id, short: s.short, plain: plainName(s.id, s.short), name: s.name, before: b, after: after.readinessAfter[s.short] ?? b, passing: c.passing, partial: c.partial, failing: c.failing, person: c.person, total: c.total, word: t.word, color: t.color };
  });

  const count = (list: Finding[]) => {
    const m = new Map<string, number>();
    for (const f of list) m.set(areaOf(f), (m.get(areaOf(f)) ?? 0) + 1);
    return [...m.entries()].map(([label, n]) => ({ id: label, label, count: n })).sort((a, b) => b.count - a.count);
  };
  const fixedByArea: AreaCount[] = count(run.findings.filter((f) => fixedSet.has(f.key)));

  const risks: OpenRisk[] = run.findings
    .filter((f) => { const st = after.statusesAfter[f.key] ?? f.status; return st === 'P' || st === 'N'; })
    .map((f) => {
      const st = after.statusesAfter[f.key] ?? f.status;
      return { key: f.key, rating: ratingOf(f, st), standard: plainName(f.standardId, f.standardShort), id: f.id, title: f.title, area: areaOf(f), status: STATUS_WORD[st] ?? st, why: f.why };
    })
    .sort((a, b) => ORDER[a.rating] - ORDER[b.rating] || a.area.localeCompare(b.area) || a.id.localeCompare(b.id));
  const riskCounts = { High: 0, Medium: 0, Low: 0 } as Record<RiskRating, number>;
  for (const r of risks) riskCounts[r.rating]++;

  const needsPerson = count(run.findings.filter((f) => (after.statusesAfter[f.key] ?? f.status) === 'UN'));

  return { before, now, readinessBefore, readinessAfter, verdict, fixed: fixedKeys.length, standards, fixedByArea, risks, riskCounts, needsPerson };
}

export type FinalReport = ReturnType<typeof buildFinalReport>;

const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** The open risks as a spreadsheet anyone can open. */
export function riskRegisterCsv(projectName: string, r: FinalReport): string {
  const head = ['Rating', 'Standard', 'Requirement', 'What it asks for', 'Area', 'Status now', 'Why it matters', 'Owner', 'Decision (treat / transfer / accept)', 'Due'];
  const rows = r.risks.map((x) => [x.rating, x.standard, x.id, x.title, x.area, x.status, x.why, '', '', '']);
  const intro = [`Greenlight risk register: ${projectName}`, 'Ratings come from the rules, not AI. Greenlight does not accept risk; the people named here decide.'];
  return [...intro.map((l) => cell(l)), '', head.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n');
}
