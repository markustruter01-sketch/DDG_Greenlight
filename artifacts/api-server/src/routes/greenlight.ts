import express, { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, greenlightProjects, greenlightFixes, eq } from "@workspace/db";
import { CreateAssessmentBody, UpdateAssessmentBody, StartFixBody, ApproveFixBody, CreateAssessmentResponse } from "@workspace/api-zod";
import { catalogues, furtherTesting, engine, classifications } from "../lib/greenlight-engine";
import { getRun, listProjects, createFromGithub, createFromZip, updateRun, compareProject, fixRuns, seedDemo } from "../lib/greenlight-store";
import { listReports, generateReport, mime, readObject } from "../lib/greenlight-reports";
import { startFix, approveFix, sandboxStatus } from "../lib/greenlight-fixes";
import { getSession } from "../lib/fix-events";
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
    githubEnabled: !!process.env.GITHUB_TOKEN, checks: "rules, no AI",
    // Demonstration deployments keep every link to the real repositories closed (GREENLIGHT_EXTERNAL_LINKS=1 opens them).
    externalLinks: process.env.GREENLIGHT_EXTERNAL_LINKS === "1", engineVersion: "Greenlight / CrossCheck standalone 1.0",
    fixingDisabledReason: !process.env.ANTHROPIC_API_KEY ? "Live fixing is not enabled on this deployment; the recorded session shows the same run end to end" : sandboxStatus().reason,
    // The written rules themselves (Greenlight's own words, not standards text), so a finding can show what fired.
    rules: Object.fromEntries(e.SIGNALS.map((s: any) => [s.id, { title: s.title, theme: s.theme || "governance", fix: s.fix || "" }])),
    ruleCount: e.SIGNALS.length,
    factCount: e.FACTS.length,
    itemCount: catalogues.reduce((n: number, c: any) => n + c.items.length, 0),
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
  const output = await generateReport(id, String(req.params.kind), format, typeof req.query.after === "string" ? req.query.after : "");
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
/**
 * Live event stream for the fix console (server-sent events). A viewer who
 * arrives late gets the whole history first, then live events. Once the run
 * has finished and the in-memory session is gone, the events persisted on the
 * fix row are sent instead, followed by `end`.
 */
router.get(`${prefix}/fixes/:id/events`, async (req, res) => {
  requireUser(req);
  const id = String(req.params.id);
  const [row] = await db.select().from(greenlightFixes).where(eq(greenlightFixes.id, id));
  if (!row) throw Object.assign(new Error("Fix run not found"), { status: 404 });
  await accessRun(req, row.runId);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const send = (event: string, data: unknown) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const session = getSession(id);
  if (!session || session.closed) {
    for (const e of ((row.result as any)?.events ?? session?.events ?? [])) send("fix", e);
    send("end", { id });
    res.end();
    return;
  }
  const unsubscribe = session.subscribe(e => {
    send("fix", e);
    if (e.type === "done" || (e.type === "stage" && e.stage === "failed")) { send("end", { id }); res.end(); }
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => { clearInterval(ping); unsubscribe(); });
});
/**
 * A finished fix run as a self-contained recording (events, changes, before/after
 * readiness) for publishing with the app as a rehearsed replay.
 */
router.get(`${prefix}/fixes/:id/recording`, async (req, res) => {
  requireUser(req);
  const id = String(req.params.id);
  const [row] = await db.select().from(greenlightFixes).where(eq(greenlightFixes.id, id));
  if (!row) throw Object.assign(new Error("Fix run not found"), { status: 404 });
  const before = await accessRun(req, row.runId);
  const result = row.result as any;
  const events = result.events ?? [];
  const after = result.verificationRunId ? await accessRun(req, String(result.verificationRunId)).catch(() => null) : null;
  const readiness = (r: any) => Object.fromEntries((r?.result?.standards ?? []).map((s: any) => [s.short, s.readiness]));
  const plan = events.find((e: any) => e.type === "plan");
  res.json({
    version: 1,
    recordedAt: row.createdAt ?? new Date().toISOString(),
    project: before.result?.projectName ?? before.result?.name ?? "",
    wave: result.wave,
    model: process.env.GREENLIGHT_FIX_MODEL || "claude-sonnet-4-6",
    durationMs: events.length ? events[events.length - 1].at : 0,
    packages: plan?.packages ?? [],
    events,
    changes: (result.changes ?? []).map((c: any) => ({ file: c.file, before: c.before, after: c.after })),
    outcome: { before: readiness(before), after: after ? readiness(after) : readiness(before), verdictBefore: before.result?.verdict ?? "", verdictAfter: after?.result?.verdict ?? before.result?.verdict ?? "" },
  });
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
