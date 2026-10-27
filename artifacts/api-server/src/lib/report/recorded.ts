import fs from "node:fs";
import path from "node:path";
import type { Verification } from "./model";

/**
 * The recorded fix rounds of the sample project and the engine's own
 * re-assessment after them (public/demo: gev-wave1..3.json, gev-final.json),
 * so the verification report after the recorded rounds is built from measured
 * results, exactly as the Proof and Done screens show them.
 */
export function recordedAfter(run: any, after: string, DEMO_DIR: string | undefined) {
  const names = after.split(",").map((x) => x.trim()).filter(Boolean);
  if (!run.isDemo || !DEMO_DIR || !names.length || names.some((n) => !/^gev-wave\d$/.test(n))) throw Object.assign(new Error("No recorded fix for this assessment"), { status: 400 });
  const recs = names.map((n) => JSON.parse(fs.readFileSync(path.join(DEMO_DIR, `${n}.json`), "utf8")));
  // The measured re-assessment exists for all three rounds; for fewer rounds, apply the recorded changes to the baseline.
  const all = names.length === 3 && names.join() === "gev-wave1,gev-wave2,gev-wave3";
  let final: any;
  if (all) final = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, "gev-final.json"), "utf8"));
  else {
    const changed: Record<string, string> = Object.assign({}, ...recs.map((r) => r.outcome.changed || {}));
    const last = recs[recs.length - 1].outcome;
    final = { ...run, findings: run.findings.map((f: any) => (changed[f.key] ? { ...f, status: changed[f.key], statusText: ({ C: "Compliant", L: "Largely compliant", P: "Partial", N: "Non-compliant" } as any)[changed[f.key]] ?? f.statusText, blocking: changed[f.key] === "N" ? f.blocking : false } : f)),
      verdict: last.verdictAfter, standards: run.standards.map((s: any) => ({ ...s, readiness: Math.round(last.after[s.short] ?? s.readiness) })) };
    const sts = final.findings.map((f: any) => f.status);
    final.counts = { total: sts.length, compliant: sts.filter((x: string) => x === "C" || x === "L").length, partial: sts.filter((x: string) => x === "P").length, failed: sts.filter((x: string) => x === "N").length, unanswered: sts.filter((x: string) => x === "UN").length, blocking: final.findings.filter((f: any) => f.blocking && f.status !== "C" && f.status !== "L").length };
    final.readiness = Math.round(final.standards.reduce((n: number, s: any) => n + s.readiness, 0) / Math.max(1, final.standards.length));
  }
  const tests = (r: any) => { const m = [...r.events].reverse().map((e: any) => String(e.output || "").match(/(\d+) of (\d+) passed/)).find(Boolean); return m ? `${m[1]} of ${m[2]} passed` : "not recorded"; };
  const rounds = recs.map((r) => ({ wave: r.wave, recordedAt: r.recordedAt, files: (r.changes || []).length, changed: Object.keys(r.outcome.changed || {}).length, before: r.outcome.before, after: r.outcome.after, verdictBefore: r.outcome.verdictBefore, verdictAfter: r.outcome.verdictAfter, tests: tests(r), minutes: Math.round((r.durationMs || 0) / 60000) }));
  const afterRun = { ...final, id: run.id, projectId: run.projectId, projectName: run.projectName, source: run.source, isDemo: true, classification: run.classification,
    assessedAt: recs[recs.length - 1].recordedAt, verificationOf: run.id, testResult: rounds[rounds.length - 1].tests, inventory: final.inventory || run.inventory, levels: final.levels || run.levels, maturity: final.maturity ?? run.maturity };
  const verification: Verification = { baseline: run, rounds, measured: all };
  return { afterRun, verification };
}

