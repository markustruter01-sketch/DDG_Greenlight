import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { db, greenlightFixes, greenlightRuns, eq } from "@workspace/db";
import { getRun, saveAssessment } from "./greenlight-store";
import { engine, engineRoot } from "./greenlight-engine";
import { readObject, saveObject, generateReport } from "./greenlight-reports";
import { logger } from "./logger";
import { pathToFileURL } from "node:url";
import { openSession, dropSession, type FixEvent } from "./fix-events";
import { BLOCKED as blocked, planPackage, readWorkspace, runFixAgent } from "./fix-agent";

let sandboxMemo: { available: boolean; reason: string } | undefined;
export function sandboxStatus() {
  if (sandboxMemo) return sandboxMemo;
  const check = spawnSync("bwrap", ["--unshare-all", "--ro-bind", "/nix/store", "/nix/store", "--proc", "/proc", "--dev", "/dev", "--", process.execPath, "-e", "process.exit(0)"],
    { timeout: 4000, encoding: "utf8", env: { PATH: process.env.PATH } });
  sandboxMemo = { available: check.status === 0, reason: check.status === 0 ? "" :
    "Secure execution sandbox is unavailable in this environment. Fixing is disabled; download the fix prompt to run in your own isolated environment." };
  return sandboxMemo;
}
const workspaces = new Map<string, { root: string; original: Map<string, string>; entries: any[] }>();
const inFlight = new Set<string>();
async function persist(result: any) {
  await db.update(greenlightFixes).set({ result }).where(eq(greenlightFixes.id, result.id));
}
async function propose(id: string, run: any, held: any) {
  const result: any = { id, runId: run.id, wave: held.wave, status: "preparing", timeline: [], changes: [] };
  // Every step is published on a session so the live console (and a recording) can follow.
  const recordPath = process.env.GREENLIGHT_RECORD_DIR ? path.join(process.env.GREENLIGHT_RECORD_DIR, `${id}.events.jsonl`) : "";
  const recorder = recordPath ? (e: FixEvent) => { void fs.appendFile(recordPath, JSON.stringify(e) + "\n"); } : undefined;
  const session = openSession(id, recorder);
  const wave = run.waves.find((w: any) => w.number === held.wave);
  const packages = (wave?.fixes || []).filter((f: any) => f.kind === "code");
  session.emit({ type: "stage", stage: "preparing", label: "Preparing isolated working copy" });
  const snapshots = new Map<string, string>(); // last content seen per file, for edit hunks
  try {
    const e = await engine;
    const bytes = held.archivePath ? await readObject(held.archivePath) : await e.fetchGithubArchive(e.parseGithubUrl(run.source), { token: process.env.GITHUB_TOKEN });
    const { readZip } = await import(pathToFileURL(path.join(engineRoot, "server/zip.js")).href);
    const entries: any[] = readZip(bytes);
    const prefix = e.stripCommonRoot(entries.map((entry: any) => entry.path));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "greenlight-fix-"));
    for (const entry of entries) {
      const relative = e.cleanPath(prefix ? entry.path.slice(prefix.length) : entry.path);
      if (!relative || blocked.test(relative)) continue;
      const target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.read());
    }
    const original = await readWorkspace(root);
    for (const [f, c] of original) snapshots.set(f, c);
    workspaces.set(id, { root, original, entries: entries.map(entry => ({ path: prefix ? entry.path.slice(prefix.length) : entry.path, data: entry.read() })) });
    result.timeline.push("Sandbox ready");
    result.status = "applying";
    await persist(result);
    session.emit({ type: "note", text: `${original.size} source files in the working copy` });
    session.emit({ type: "stage", stage: "fixing", label: `Fixing wave ${held.wave}: ${packages.length} work package${packages.length === 1 ? "" : "s"}` });
    session.emit({ type: "plan", packages: packages.map(planPackage) });
    await runFixAgent({ root, wave: held.wave, packages, session, snapshots });
    // TODO: run lib/fix-recheck.ts recheckAndRetarget here as the recorder does: re-assess the working
    // copy (buildSnapshot over `entries` with the approved edits, the run's standards/levels/facts/
    // classification/maturity) and hand Claude the clauses still open, before the review step.
    const after = await readWorkspace(root);
    const names = new Set([...original.keys(), ...after.keys()]);
    result.changes = [...names].filter(file => original.get(file) !== after.get(file)).map(file => ({ file, before: original.get(file) || "", after: after.get(file) || "", approved: false }));
    result.timeline.push(`Wave ${held.wave} proposed [AI] — awaiting approval of every changed file`);
    result.status = "awaiting_approval";
    session.emit({ type: "stage", stage: "review", label: `${result.changes.length} file${result.changes.length === 1 ? "" : "s"} changed, awaiting your approval` });
    session.emit({ type: "done", summary: `Wave ${held.wave} proposed`, filesChanged: result.changes.length, durationMs: Date.now() - session.startedAt });
    result.events = session.events;
    await persist(result);
  } catch (error: any) {
    logger.error({ err: error, fixId: id }, "Claude remediation failed");
    result.status = "failed"; result.error = "Fixing failed safely. No source changes were exported or applied to your repository.";
    result.timeline.push("Stopped — no approved output");
    session.emit({ type: "stage", stage: "failed", label: "Stopped; no changes applied" });
    result.events = session.events;
    await persist(result);
  } finally { inFlight.delete(run.id); setTimeout(() => dropSession(id), 10 * 60_000); }
}
export async function startFix(runId: string, wave: number) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("Add an Anthropic API key to enable fixing"), { status: 503 });
  if (!sandboxStatus().available) throw Object.assign(new Error(sandboxStatus().reason), { status: 503 });
  if (inFlight.has(runId)) throw Object.assign(new Error("A wave is already running for this assessment"), { status: 409 });
  const { result: run, evidence } = await getRun(runId);
  if (!run.waves.find((w: any) => w.number === wave)?.fixes.some((f: any) => f.kind === "code"))
    throw Object.assign(new Error("This wave requires human answers or review, not code changes"), { status: 400 });
  const id = randomUUID();
  const result = { id, runId, wave, status: "preparing", timeline: ["Preparing isolated working copy"], changes: [] };
  await db.insert(greenlightFixes).values({ id, runId, result });
  inFlight.add(runId);
  void propose(id, run, { ...evidence, wave });
  return result;
}
async function testInSandbox(root: string) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  if (!pkg.scripts?.test) throw new Error("No project test script found. Verification cannot claim passing tests.");
  const npmPath = spawnSync("which", ["npm"], { encoding: "utf8" }).stdout.trim();
  const npmReal = await fs.realpath(npmPath);
  const shellPath = await fs.realpath("/bin/sh");
  return new Promise<string>((resolve, reject) => {
    const p = spawn("bwrap", ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv",
      "--ro-bind", "/nix/store", "/nix/store", "--bind", root, "/work", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--symlink", shellPath, "/bin/sh", "--chdir", "/work", "--setenv", "HOME", "/tmp", "--setenv", "PATH", path.dirname(process.execPath) + ":" + path.dirname(npmReal),
      "--", process.execPath, npmReal, "test"], { env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("Project tests exceeded 120 seconds")); }, 120_000);
    const append = (s: Buffer) => { output = (output + s.toString()).slice(-16000); };
    p.stdout.on("data", append); p.stderr.on("data", append);
    p.on("error", err => { clearTimeout(timer); reject(err); });
    p.on("close", code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error("Project tests did not pass in isolation. No verified output was exported.")); });
  });
}
export async function approveFix(id: string, approval: any) {
  const [row] = await db.select().from(greenlightFixes).where(eq(greenlightFixes.id, id));
  if (!row) throw Object.assign(new Error("Fix not found"), { status: 404 });
  const result = row.result as any;
  const work = workspaces.get(id);
  if (!work || result.status !== "awaiting_approval") throw Object.assign(new Error("Working copy expired or not awaiting approval. Start a new wave."), { status: 409 });
  const allowed = new Set(result.changes.map((c: any) => c.file));
  if (!approval.approvedFiles.length || approval.approvedFiles.some((f: string) => !allowed.has(f))) throw Object.assign(new Error("Select valid changed files to approve"), { status: 400 });
  if (approval.output === "pr" && !process.env.GITHUB_TOKEN) throw Object.assign(new Error("Add a GitHub token to open a pull request, or choose ZIP"), { status: 503 });
  const { result: baseline, evidence: held } = await getRun(result.runId);
  result.status = "verifying"; await persist(result);
  try {
    for (const c of result.changes) {
      c.approved = approval.approvedFiles.includes(c.file);
      if (!c.approved) {
        if (work.original.has(c.file)) await fs.writeFile(path.join(work.root, c.file), c.before);
        else await fs.rm(path.join(work.root, c.file), { force: true });
      }
    }
    await testInSandbox(work.root);
    result.timeline.push(`Wave ${result.wave} applied [AI] — approved files only`, "Project tests passed in isolated sandbox");
    const e = await engine;
    const approved = result.changes.filter((c: any) => c.approved);
    const data = new Map<string, Buffer>(work.entries.map(entry => [entry.path, entry.data]));
    for (const c of approved) data.set(c.file, Buffer.from(c.after));
    const snapshot = e.buildSnapshot([...data].map(([file, bytes]) => ({ path: file, size: bytes.length, read: () => bytes })), { name: baseline.projectName, source: baseline.source });
    const fresh: any = await saveAssessment({ ...held, evidence: e.gatherEvidence(snapshot), classification: baseline.classification }, {
      standards: baseline.standards.map((s: any) => s.id), levels: baseline.levels, facts: baseline.facts,
      classification: baseline.classification.current, maturity: baseline.maturity,
    }, baseline.projectId);
    fresh.verificationOf = baseline.id; fresh.testResult = "Project tests passed in isolated sandbox";
    await db.update(greenlightRuns).set({ result: fresh }).where(eq(greenlightRuns.id, fresh.id));
    result.verificationRunId = fresh.id; result.timeline.push("Assessed again [No AI]");
    // Use ExcelJS's existing maintained ZIP dependency rather than shelling out.
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const [file, bytes] of data) if (e.cleanPath(file)) zip.file(file, bytes);
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    result.archivePath = await saveObject(`${id}/approved.zip`, bytes, "application/zip");
    // Further waves start from this approved archive, not the original source.
    await db.update(greenlightRuns).set({ evidence: { ...held, archivePath: result.archivePath, evidence: e.gatherEvidence(snapshot) } }).where(eq(greenlightRuns.id, fresh.id));
    result.downloadUrl = `/api/greenlight/fixes/${id}/download`;
    if (approval.output === "pr") {
      const target = e.parseGithubUrl(baseline.source);
      const api = async (url: string, method = "GET", body?: any) => {
        const r = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}${url}`, { method, headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json",
        }, ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!r.ok) throw new Error("GitHub rejected the pull request operation. Verified ZIP remains available.");
        return r.json() as Promise<any>;
      };
      const repo = await api(""); const base = target.ref || repo.default_branch;
      const baseRef = await api(`/git/ref/heads/${encodeURIComponent(base)}`);
      const tree = await api("/git/trees", "POST", { base_tree: (await api(`/git/commits/${baseRef.object.sha}`)).tree.sha,
        tree: approved.map((c: any) => ({ path: c.file, mode: "100644", type: "blob", content: c.after })) });
      const commit = await api("/git/commits", "POST", { message: `Greenlight: approved remediation wave ${result.wave}`, tree: tree.sha, parents: [baseRef.object.sha] });
      const branch = `greenlight/wave-${result.wave}-${id.slice(0, 8)}`;
      await api("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha: commit.sha });
      const pr = await api("/pulls", "POST", { title: `Greenlight: wave ${result.wave} remediation`, head: branch, base,
        body: `Human-approved Claude changes followed by deterministic Greenlight assessment.\nBaseline ${baseline.readiness}%, actual ${fresh.readiness}%.\nIndependent testing still required. Never auto-merge.` });
      result.pullRequestUrl = pr.html_url; result.timeline.push("Pull request opened — never auto-merged");
    } else result.timeline.push("Verified ZIP ready");
    await generateReport(fresh.id, "verification", "pdf");
    result.status = "complete"; await persist(result);
    await fs.rm(work.root, { recursive: true, force: true }); workspaces.delete(id);
    return result;
  } catch (error: any) {
    logger.error({ error, fixId: id }, "Verification failed");
    result.status = "failed"; result.error = error.message; result.timeline.push("Stopped — verification not completed");
    await persist(result); return result;
  }
}
