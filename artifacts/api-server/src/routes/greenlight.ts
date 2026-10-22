import express, { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, greenlightProjects, greenlightFixes, eq } from "@workspace/db";
import { CreateAssessmentBody, UpdateAssessmentBody, StartFixBody, ApproveFixBody, CreateAssessmentResponse } from "@workspace/api-zod";
import { catalogues, furtherTesting, engine, classifications } from "../lib/greenlight-engine";
import { getRun, listProjects, createFromGithub, createFromZip, updateRun, compareProject, fixRuns, seedDemo } from "../lib/greenlight-store";
import { listReports, generateReport, mime, readObject } from "../lib/greenlight-reports";
import { startFix, approveFix, sandboxStatus } from "../lib/greenlight-fixes";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const prefix = "/greenlight";
const initialized = seedDemo().catch(error => { logger.error({ error }, "Demo seed failed"); });
const user = (req: express.Request) => getAuth(req).userId || undefined;
function requireUser(req: express.Request) {
  const id = user(req);
  if (!id) throw Object.assign(new Error("Sign in to assess code and save private projects"), { status: 401 });
  return id;
}
async function accessProject(id: string, ownerId?: string, write = false) {
  const [p] = await db.select().from(greenlightProjects).where(eq(greenlightProjects.id, id));
  if (!p || (p.ownerId && p.ownerId !== ownerId) || (write && !p.ownerId))
    throw Object.assign(new Error("Project not found or read-only demo"), { status: 404 });
  return p;
}
async function accessRun(req: express.Request, id: string, write = false) {
  const held = await getRun(id);
  await accessProject(held.result.projectId, user(req), write);
  return held;
}
const hits = new Map<string, number[]>();
function limit(req: express.Request) {
  const key = requireUser(req);
  const times = (hits.get(key) || []).filter(n => n > Date.now() - 600_000);
  if (times.length >= 8) throw Object.assign(new Error("Assessment limit reached. Try again in a few minutes."), { status: 429 });
  times.push(Date.now()); hits.set(key, times);
}
function validateContext(body: any) {
  if (body.classification && !classifications.includes(body.classification)) throw Object.assign(new Error("Invalid classification"), { status: 400 });
}

router.get(`${prefix}/config`, async (_req, res) => {
  const e = await engine;
  res.json({
    standards: catalogues.map(c => ({ id: c.id, name: c.name, short: c.short, lens: c.id === "iso42001" ? "ai" : c.scale === "safety" ? "saf" : "sec",
      items: c.items.length, levels: c.levels || [], defaultLevel: c.defaultLevel || "", note: c.note || "", furtherTesting: furtherTesting[c.id] })),
    questions: e.FACTS.map((f: any) => ({ id: f.id, question: f.question, theme: f.theme || "governance", kind: f.kind,
      options: f.options?.map((o: any) => Array.isArray(o) ? o[0] : o) || [] })),
    fixingEnabled: !!process.env.ANTHROPIC_API_KEY && sandboxStatus().available,
    githubEnabled: !!process.env.GITHUB_TOKEN, checks: "rules, no AI", engineVersion: "Greenlight / CrossCheck standalone 1.0",
    fixingDisabledReason: !process.env.ANTHROPIC_API_KEY ? "Add an Anthropic API key to enable fixing" : sandboxStatus().reason,
  });
});
router.get(`${prefix}/projects`, async (req, res) => {
  await initialized;
  res.json(await listProjects(user(req)));
});
router.post(`${prefix}/assess`, async (req, res) => {
  limit(req);
  const data = CreateAssessmentBody.parse(req.body);
  validateContext(data);
  if (data.projectId) {
    const p = await accessProject(data.projectId, user(req));
    if (!p.ownerId) data.projectId = undefined;
  }
  const result = await createFromGithub({ ...data, ownerId: requireUser(req) });
  res.status(201).json(CreateAssessmentResponse.parse(result));
});
router.post(`${prefix}/upload`, express.raw({ type: ["application/zip", "application/octet-stream", "application/x-zip-compressed"], limit: "100mb" }), async (req, res) => {
  limit(req);
  if (!Buffer.isBuffer(req.body)) throw Object.assign(new Error("Upload a ZIP archive"), { status: 415 });
  const data = CreateAssessmentBody.parse({ github: "upload", ...JSON.parse(String(req.headers["x-options"] || "{}")) });
  validateContext(data);
  if (data.projectId) await accessProject(data.projectId, user(req), true);
  const name = String(req.headers["x-filename"] || "upload.zip").replace(/[^\w.\- ]/g, "").slice(0, 120);
  res.status(201).json(await createFromZip(req.body, name.replace(/\.zip$/i, ""), { ...data, ownerId: requireUser(req) }));
});
router.get(`${prefix}/runs/:id`, async (req, res) => {
  const held = await accessRun(req, String(req.params.id));
  res.json(held.result);
});
router.patch(`${prefix}/runs/:id`, async (req, res) => {
  requireUser(req);
  const id = String(req.params.id);
  const { result, evidence } = await accessRun(req, id);
  const data = UpdateAssessmentBody.parse(req.body);
  validateContext(data);
  if (result.isDemo) {
    // Public demo is immutable; changing it creates a private project.
    const { saveAssessment } = await import("../lib/greenlight-store");
    res.json(await saveAssessment({ ...evidence, isDemo: false }, { ...data, ownerId: requireUser(req),
      standards: result.standards.map((s: any) => s.id), facts: { ...result.facts, ...data.facts }, levels: { ...result.levels, ...data.levels },
      classification: data.classification || result.classification.current, maturity: data.maturity || result.maturity }));
  } else res.json(await updateRun(id, data));
});
router.get(`${prefix}/projects/:id/compare`, async (req, res) => {
  await accessProject(String(req.params.id), user(req));
  res.json(await compareProject(String(req.params.id)));
});
router.get(`${prefix}/runs/:id/reports`, async (req, res) => {
  await accessRun(req, String(req.params.id));
  res.json(await listReports(String(req.params.id)));
});
router.get(`${prefix}/runs/:id/reports/:kind`, async (req, res) => {
  const id = String(req.params.id);
  await accessRun(req, id);
  const format = String(req.query.format || "pdf");
  const output = await generateReport(id, String(req.params.kind), format);
  res.setHeader("Content-Type", mime[format] || "application/octet-stream");
  res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${output.filename.replace(/["\r\n]/g, "")}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(output.buffer);
});
router.get(`${prefix}/runs/:id/fixes`, async (req, res) => {
  await accessRun(req, String(req.params.id));
  res.json(await fixRuns(String(req.params.id)));
});
router.post(`${prefix}/runs/:id/fixes`, async (req, res) => {
  requireUser(req); limit(req);
  const id = String(req.params.id);
  await accessRun(req, id, true);
  const data = StartFixBody.parse(req.body);
  res.status(202).json(await startFix(id, data.wave));
});
router.post(`${prefix}/fixes/:id/approve`, async (req, res) => {
  requireUser(req);
  const id = String(req.params.id);
  const [f] = await db.select().from(greenlightFixes).where(eq(greenlightFixes.id, id));
  if (!f) throw Object.assign(new Error("Fix run not found"), { status: 404 });
  await accessRun(req, f.runId, true);
  res.json(await approveFix(id, ApproveFixBody.parse(req.body)));
});
router.get(`${prefix}/fixes/:id/download`, async (req, res) => {
  const [row] = await db.select().from(greenlightFixes).where(eq(greenlightFixes.id, String(req.params.id)));
  if (!row) throw Object.assign(new Error("Fix not found"), { status: 404 });
  await accessRun(req, row.runId);
  const result = row.result as any;
  if (!result.archivePath) throw Object.assign(new Error("No approved archive available"), { status: 404 });
  res.type("application/zip").attachment("greenlight-verified.zip").send(await readObject(result.archivePath));
});
export default router;
