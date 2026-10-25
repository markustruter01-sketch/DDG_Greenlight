import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const engineRoot = path.resolve(process.cwd(), process.cwd().endsWith("api-server") ? "../../lib/greenlight-engine" : "lib/greenlight-engine");
const load = (file: string): Promise<any> => import(pathToFileURL(path.join(engineRoot, file)).href);
export const engine = Promise.all([
  load("engine/assess.js"), load("engine/signals.js"), load("engine/plan.js"),
  load("engine/facts.js"), load("server/intake.js"), load("engine/snapshot.js"),
]).then(([a, s, p, f, i, snapshot]) => ({ ...a, ...s, ...p, ...f, ...i, ...snapshot }));

export const catalogues: any[] = fs.readdirSync(path.join(engineRoot, "catalogues"))
  .filter(f => f.endsWith(".json")).map(f => JSON.parse(fs.readFileSync(path.join(engineRoot, "catalogues", f), "utf8")));
const order = ["asvs5", "iso27001", "nist-ssdf", "ism-e8", "ed153", "mil882e", "iso42001"];
catalogues.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
export const classificationRules = JSON.parse(fs.readFileSync(path.join(engineRoot, "classification-rules.json"), "utf8"));
export const classifications = ["Non-classified", "OFFICIAL: Sensitive", "PROTECTED", "SECRET", "TOP SECRET"];
export const furtherTesting: Record<string, string> = {
  "asvs5": "Independent application security verification and penetration testing are required. Static pattern matches are not ASVS verification.",
  "ism-e8": "IRAP assessment by an ASD-endorsed assessor where required. Topic-level catalogue: map to the control numbers of the applicable ISM release. Confirm classification and Essential Eight maturity with the system owner.",
  "iso27001": "An accredited auditor must assess the organisation's ISMS. This software-only Annex A worksheet is not an ISO 27001 certification.",
  "nist-ssdf": "Validate organisation-wide secure-development practices and supporting evidence. This worksheet is not an official attestation.",
  "mil882e": "Independent system-safety analysis, hazard validation and authorised risk acceptance are required. Code cannot establish a safety case.",
  "ed153": "Independent software safety assessment, requirements traceability, SWAL confirmation and competent authority review are required. This catalogue uses paraphrased objectives.",
  "iso42001": "Independent review of the AI management system and organisational governance is required. Detecting AI dependencies does not verify AI safety.",
};

export function suggestClassification(snapshot: any) {
  const evidence: any[] = [];
  const matches = new Map<string, any>();
  const excluded = new RegExp(classificationRules.excludePaths || "(^|/)(node_modules|vendor|catalogues|dist)/", "i");
  for (const rule of classificationRules.rules) {
    const re = new RegExp(rule.pattern, "i");
    let found = 0;
    for (const file of snapshot.files) {
      if (!file.text || excluded.test(file.path)) continue;
      const lines = file.text.split("\n");
      for (let n = 0; n < lines.length && found < 5; n++) {
        if (!re.test(lines[n])) continue;
        evidence.push({ file: file.path, line: n + 1, note: `Pattern indicates ${rule.kind}; context requires human confirmation.`, ruleId: rule.id });
        matches.set(rule.id, rule);
        found++;
      }
      if (found >= 5) break;
    }
  }
  const highest: any = [...matches.values()].sort((a, b) => b.impactLevel - a.impactLevel)[0];
  return {
    suggested: highest?.classification || "Non-classified",
    rulesVersion: classificationRules.version,
    impactLevel: highest?.impactLevel || 1,
    reason: matches.size ? [...matches.values()].map(r => r.kind).join(", ") : "No configured sensitive-data patterns found; absence of matches is not proof of low impact.",
    evidence, accepted: false, current: "Non-classified",
    attribution: "Suggested by Greenlight; not yet confirmed by the user. " + classificationRules.notice,
  };
}

export async function assessEvidence(held: any, options: any) {
  const e = await engine;
  const chosen = catalogues.filter(c => options.standards.includes(c.id));
  if (!chosen.length) throw new Error("Choose at least one supported standard");
  const levels: Record<string, string> = {};
  for (const c of chosen) {
    const level = String(options.levels?.[c.id] || c.defaultLevel || "");
    if (c.levels && !c.levels.includes(level)) throw new Error(`Invalid ${c.short} level`);
    if (level) levels[c.id] = level;
  }
  // Context safeguards add honest review questions, never fabricated official control IDs.
  const scoped = chosen.map(c => {
    if (c.id !== "ism-e8") return c;
    const context = options.classification || "Non-classified";
    const maturity = options.maturity || 1;
    const supplements: any[] = [
      { id: `GL-E8-M${maturity}-REVIEW`, group: "GL-SCOPE", groupName: "Greenlight scope safeguards (not official control IDs)", title: `Verify all eight strategies at Essential Eight maturity ${maturity} with operational evidence`, checks: [], facts: [], weight: "high" },
    ];
    if (context !== "Non-classified") supplements.push({
      id: `GL-CLASS-${context.replace(/\W+/g, "-")}`, group: "GL-SCOPE", groupName: "Greenlight scope safeguards (not official control IDs)",
      title: `Confirm ${context} business impact and applicable ISM controls with the responsible owner`, checks: [], facts: [], weight: context === "TOP SECRET" || context === "SECRET" ? "critical" : "high",
    });
    return { ...c, items: [...c.items, ...supplements] };
  });
  const input = { evidence: held.evidence, facts: e.cleanFacts(options.facts || {}), catalogues: scoped, levels };
  const assessment = e.assess(input);
  const plan = e.buildPlan(input, assessment);
  const fixes = plan.waves.flatMap((w: any) => w.fixes);
  const lens = (s: any) => s.id === "iso42001" ? "ai" : s.scale === "safety" ? "saf" : "sec";
  const findings = assessment.standards.flatMap((std: any) => std.items.filter((i: any) => !i.out).map((i: any) => {
    const relevant = fixes.filter((f: any) => f.items.some((r: any) => r.standard === std.standard && r.id === i.id));
    const signalInputs = (i.inputs || []).filter((x: any) => x.kind === "check");
    const evidence = signalInputs.flatMap((x: any) => (held.evidence.signals[x.id]?.evidence || []).map((r: any) => ({
      file: r.path || r.file || "Repository inventory", line: Number(r.line || 0), note: r.note || r.text || held.evidence.signals[x.id].summary || "Pattern match",
      ruleId: x.id,
    })));
    const explanations = signalInputs.map((x: any) => `${x.id}: ${held.evidence.signals[x.id]?.summary || x.state || "No evidence"}`);
    return {
      key: `${std.standard}|${i.id}`, id: i.id, title: i.title, standardId: std.standard, standardShort: std.short,
      theme: signalInputs.map((x: any) => e.SIGNALS.find((s: any) => s.id === x.id)?.theme).find(Boolean) ||
        (i.inputs || []).map((x: any) => e.FACTS.find((f: any) => f.id === x.id)?.theme).find(Boolean) ||
        (std.scale === "safety" ? "safety" : "governance"),
      lens: lens(chosen.find(c => c.id === std.standard)), group: i.groupName || i.group || "",
      status: i.status || "UN", statusText: i.status ? e.STATUS_TEXT[i.status] : "Needs your answers",
      severity: i.sev || "", blocking: e.isBlocking(i),
      why: explanations.join("\n") || (i.status === "NA" ? "Not applicable to this declared scope." : "Rules cannot establish this requirement from source code. Supply answers or independent review evidence."),
      evidence, closedBy: relevant.map((f: any) => f.title),
      proofOfFix: relevant.map((f: any) => f.acceptance).join("\n") || "Re-run the same deterministic checks and independently verify the requirement. A passing pattern is not proof of complete compliance.",
      factIds: (i.inputs || []).filter((x: any) => x.kind === "fact").map((x: any) => x.id),
    };
  }));
  const standards = assessment.standards.map((s: any) => ({
    id: s.standard, name: s.name, short: s.short, lens: lens(chosen.find(c => c.id === s.standard)),
    readiness: Math.round(s.readiness * 100), total: s.scope, compliant: s.counts.C + s.counts.L,
    partial: s.counts.P, failed: s.counts.N, unanswered: s.unrated, blocking: s.blocking, verdict: s.verdict, furtherTesting: furtherTesting[s.standard] || "",
  }));
  const cumulative: any[] = [];
  const waves = plan.waves.map((w: any) => {
    cumulative.push(...w.fixes);
    const after = e.project(input, cumulative);
    return {
      number: w.n, title: w.name, fixCount: w.fixes.length,
      readiness: Object.fromEntries(after.standards.map((s: any) => [s.standard, Math.round(s.readiness * 100)])),
      statuses: Object.fromEntries(after.standards.flatMap((s: any) => s.items.filter((i: any) => !i.out).map((i: any) => [`${s.standard}|${i.id}`, i.status || "UN"]))),
      fixes: w.fixes.map((f: any) => ({ key: f.key, title: f.title, kind: f.kind, theme: f.theme, acceptance: f.acceptance,
        itemKeys: f.items.map((i: any) => `${i.standard}|${i.id}`),
        // What the fix console shows while Claude works: the clauses it closes, what the check found and where.
        items: f.items.map((i: any) => ({ standard: i.standard, short: i.short, id: i.id, title: i.title, blocking: !!i.blocking })),
        found: f.found || undefined,
        where: (f.where || []).map((r: any) => (r.line ? `${r.path}:${r.line}` : r.path || "")).filter(Boolean),
        // What the rule's pattern check looks for (descriptive), so a fixer knows what would satisfy it.
        looksFor: f.signal ? e.SIGNALS.find((s: any) => s.id === f.signal)?.detect?.looksFor : undefined })),
    };
  });
  const active = standards.filter((s: any) => !s.verdict.startsWith("Not applicable"));
  const counts = { total: findings.length, compliant: findings.filter((f: any) => ["C", "L"].includes(f.status)).length,
    partial: findings.filter((f: any) => f.status === "P").length, failed: findings.filter((f: any) => f.status === "N").length,
    unanswered: findings.filter((f: any) => f.status === "UN").length, blocking: findings.filter((f: any) => f.blocking).length };
  return {
    verdict: counts.blocking || counts.failed ? "Not ready" : counts.unanswered ? "Needs your answers" : counts.partial ? "Ready with conditions" : "Ready",
    readiness: active.length ? Math.round(active.reduce((n: number, s: any) => n + s.readiness, 0) / active.length) : 0,
    counts, standards, findings, waves, facts: input.facts, levels, maturity: options.maturity || 1,
    inventory: held.evidence.inventory,
    planMarkdown: e.planMarkdown(plan, assessment, { project: held.name, date: new Date().toISOString().slice(0, 10) }),
  };
}
