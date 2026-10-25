import { randomUUID } from "node:crypto";
import { db, greenlightProjects, greenlightRuns, greenlightFixes, eq, desc, or, isNull } from "@workspace/db";
import { engine, assessEvidence, suggestClassification, classifications, classificationRules } from "./greenlight-engine";
import { saveObject } from "./greenlight-reports";

export async function getRun(id: string) {
  const [row] = await db.select().from(greenlightRuns).where(eq(greenlightRuns.id, id));
  if (!row) throw Object.assign(new Error("Assessment not found"), { status: 404 });
  return { result: row.result as any, evidence: row.evidence as any };
}
export async function listProjects(ownerId?: string) {
  const rows = await db.select().from(greenlightProjects).where(ownerId ?
    or(eq(greenlightProjects.ownerId, ownerId), isNull(greenlightProjects.ownerId)) : isNull(greenlightProjects.ownerId)).orderBy(desc(greenlightProjects.updatedAt));
  return Promise.all(rows.map(async p => {
    const runs = await db.select().from(greenlightRuns).where(eq(greenlightRuns.projectId, p.id)).orderBy(desc(greenlightRuns.createdAt));
    const last = runs[0]?.result as any;
    return { id: p.id, name: p.name, source: p.source, updatedAt: p.updatedAt.toISOString(), runCount: runs.length,
      latestRunId: runs[0]?.id || "", readiness: last?.readiness || 0, verdict: last?.verdict || "Pending" };
  }));
}
export async function saveAssessment(held: any, options: any, projectId?: string) {
  const assessed = await assessEvidence(held, options);
  const id = randomUUID();
  let pid = projectId;
  if (pid) {
    const [p] = await db.select().from(greenlightProjects).where(eq(greenlightProjects.id, pid));
    if (!p) throw Object.assign(new Error("Project not found"), { status: 404 });
    if (p.source !== held.source) throw Object.assign(new Error("Re-assess the same source to compare this project"), { status: 400 });
    await db.update(greenlightProjects).set({ updatedAt: new Date() }).where(eq(greenlightProjects.id, pid));
  } else {
    pid = randomUUID();
    await db.insert(greenlightProjects).values({ id: pid, name: held.name.split("/").pop(), source: held.source, ownerId: options.ownerId || null });
  }
  const classification = { ...held.classification, current: options.classification || held.classification.current || "Non-classified" };
  if (!classifications.includes(classification.current)) throw Object.assign(new Error("Invalid classification"), { status: 400 });
  if (options.classificationAccepted) {
    classification.accepted = true;
    classification.attribution = classification.current === classification.suggested ?
      "Suggested by Greenlight, confirmed by the user" : "Suggested by Greenlight, overridden and confirmed by the user";
  }
  const result = { id, projectId: pid, projectName: held.name.split("/").pop(), source: held.source,
    assessedAt: new Date().toISOString(), ...assessed, classification, isDemo: !!held.isDemo };
  await db.insert(greenlightRuns).values({ id, projectId: pid!, result, evidence: held });
  return result;
}
export async function createFromGithub(options: any) {
  const e = await engine;
  const archive = await e.fetchGithubArchive(e.parseGithubUrl(options.github), { token: process.env.GITHUB_TOKEN });
  const target = e.parseGithubUrl(options.github);
  const source = `https://github.com/${target.owner}/${target.repo}${target.ref ? `/tree/${target.ref}` : ""}`;
  const snapshot = e.snapshotFromZip(archive, { name: `${target.owner}/${target.repo}`, source });
  if (!snapshot.files.length) throw Object.assign(new Error("No readable files in this repository"), { status: 422 });
  const archivePath = await saveObject(`sources/${randomUUID()}.zip`, archive, "application/zip");
  const held = { name: snapshot.name, source: snapshot.source, archivePath, evidence: e.gatherEvidence(snapshot), classification: suggestClassification(snapshot) };
  return saveAssessment(held, options, options.projectId);
}
export async function createFromZip(bytes: Buffer, name: string, options: any) {
  const e = await engine;
  const snapshot = e.snapshotFromZip(bytes, { name, source: `Uploaded archive: ${name}` });
  if (!snapshot.files.length) throw Object.assign(new Error("No readable files in this archive"), { status: 422 });
  const archivePath = await saveObject(`sources/${randomUUID()}.zip`, bytes, "application/zip");
  return saveAssessment({ name, source: snapshot.source, archivePath, evidence: e.gatherEvidence(snapshot), classification: suggestClassification(snapshot) }, options, options.projectId);
}
export async function updateRun(id: string, update: any) {
  const { result, evidence } = await getRun(id);
  return saveAssessment({ ...evidence, classification: result.classification }, {
    standards: result.standards.map((s: any) => s.id), facts: { ...result.facts, ...update.facts },
    levels: { ...result.levels, ...update.levels }, classification: update.classification || result.classification.current,
    classificationAccepted: update.classificationAccepted, maturity: update.maturity || result.maturity,
  }, result.projectId);
}
export async function compareProject(id: string) {
  const rows = await db.select().from(greenlightRuns).where(eq(greenlightRuns.projectId, id)).orderBy(greenlightRuns.createdAt);
  const runs = rows.map(r => r.result as any);
  const first = runs[0], last = runs.at(-1);
  return { runs, items: first ? first.findings.map((f: any) => ({ key: f.key, title: f.title, baseline: f.status,
    projected: first.waves.at(-1)?.statuses[f.key] || f.status, actual: last.findings.find((i: any) => i.key === f.key)?.status || "Out of scope" })) : [] };
}
export async function fixRuns(runId: string) {
  const rows = await db.select().from(greenlightFixes).where(eq(greenlightFixes.runId, runId)).orderBy(desc(greenlightFixes.createdAt));
  return rows.map(r => r.result);
}
/**
 * The public sample project: God's Eye View at a pinned commit, assessed with
 * the same options the recorded fix sessions used, so the sample's "before"
 * matches the recordings. The pin keeps the baseline still while the wave
 * pull requests are merged on the real repository. Override with
 * GREENLIGHT_DEMO_REF (a branch, tag or commit) to move it.
 */
export const DEMO_REPO = "https://github.com/pierretruter07-sudo/gods-eye-view";
export const DEMO_REF = process.env.GREENLIGHT_DEMO_REF || "109f5d9";
export const DEMO_OPTIONS = {
  standards: ["asvs5", "iso27001", "nist-ssdf", "ism-e8", "ed153", "mil882e"],
  levels: { asvs5: "2", ed153: "3" },
  classification: "PROTECTED",
  maturity: 2,
};
export async function seedDemo() {
  const existing = await listProjects();
  const previous = existing.find(p => p.name === "gods-eye-view");
  const source = `${DEMO_REPO}/tree/${DEMO_REF}`;
  if (previous) {
    const latest = await getRun(previous.latestRunId);
    const sameRules = latest.result.classification.rulesVersion === classificationRules.version;
    const samePin = previous.source === source;
    const sameOptions = JSON.stringify((latest.result.standards ?? []).map((s: any) => s.id)) === JSON.stringify(DEMO_OPTIONS.standards) && latest.result.maturity === DEMO_OPTIONS.maturity;
    if (sameRules && samePin && sameOptions) return;
  }
  const options = { github: source, ...DEMO_OPTIONS };
  const e = await engine;
  const snapshot = await e.snapshotFromGithub(options.github);
  await saveAssessment({ name: snapshot.name, source: snapshot.source, evidence: e.gatherEvidence(snapshot), classification: suggestClassification(snapshot), isDemo: true }, options, previous?.id);
}
