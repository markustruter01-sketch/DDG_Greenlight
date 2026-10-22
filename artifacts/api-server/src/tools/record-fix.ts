/**
 * Headless fix recorder. Assesses a folder with the deterministic engine,
 * runs the same Claude fix loop the API uses on an isolated copy, re-checks
 * the result with the same engine, and writes a FixRecording JSON that the
 * app replays as a rehearsed session.
 *
 *   node dist/record-fix.mjs --repo ../subject --project "God's Eye View" \
 *        --standards ed153,ism-e8 --wave 1 --out recording.json [--test] [--allow-all-dirs]
 *
 * Needs ANTHROPIC_API_KEY. Nothing here touches a database or the network
 * beyond the model API; the repository folder is copied, never edited.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { assessEvidence, engine } from "../lib/greenlight-engine";
import { openSession, type FixEvent, type FixRecording } from "../lib/fix-events";
import { BLOCKED, planPackage, readWorkspace, runFixAgent } from "../lib/fix-agent";

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(name);

/** Snapshot entries for a folder, the same way the engine's CLI does it. */
async function folderEntries(folder: string) {
  const entries: { path: string; size: number; read: () => Buffer }[] = [];
  const { readFileSync, statSync } = await import("node:fs");
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if ([".git", ".claude", "node_modules"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) entries.push({ path: path.relative(folder, p).replaceAll("\\", "/"), size: statSync(p).size, read: () => readFileSync(p) });
    }
  }
  await walk(folder);
  return entries;
}

async function assessFolder(folder: string, name: string, standards: string[]) {
  const e = await engine;
  const snapshot = e.buildSnapshot(await folderEntries(folder), { name });
  const evidence = e.gatherEvidence(snapshot);
  const result = await assessEvidence({ evidence, name }, { standards, facts: {}, levels: {}, maturity: 1 });
  return { evidence, result };
}

async function copyTree(repo: string, from: string, to: string, blocked: RegExp) {
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    if (e.isSymbolicLink()) continue;
    if (blocked.test(path.relative(repo, src).replaceAll("\\", "/"))) continue;
    const dst = path.join(to, e.name);
    if (e.isDirectory()) { await fs.mkdir(dst, { recursive: true }); await copyTree(repo, src, dst, blocked); }
    else await fs.copyFile(src, dst);
  }
}

function runTests(root: string): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    const p = spawn("npm", ["test", "--silent"], { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (b: Buffer) => { output = (output + b.toString()).slice(-6000); };
    p.stdout.on("data", keep); p.stderr.on("data", keep);
    const timer = setTimeout(() => { p.kill("SIGKILL"); resolve({ ok: false, output: output + "\n(timed out)" }); }, 300_000);
    p.on("close", code => { clearTimeout(timer); resolve({ ok: code === 0, output }); });
  });
}

async function main() {
  const repo = path.resolve(arg("--repo"));
  const project = arg("--project", path.basename(repo));
  const standards = arg("--standards", "ed153,ism-e8").split(",").map(s => s.trim()).filter(Boolean);
  const waveNumber = Number(arg("--wave", "1"));
  const out = path.resolve(arg("--out", "recording.json"));
  // For a demo subject that keeps its own code under engine/ or vendor/, let Claude in; the API keeps the strict list.
  const blocked = flag("--allow-all-dirs") ? /(^|\/)(\.git|\.claude|\.env(?:\..*)?|node_modules)(\/|$)|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/ : BLOCKED;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!repo || !(await fs.stat(repo).catch(() => null))?.isDirectory()) throw new Error("--repo must be a folder");

  console.log(`Assessing ${project} against ${standards.join(", ")}`);
  const before = await assessFolder(repo, project, standards);
  for (const s of before.result.standards) console.log(`  ${s.short.padEnd(14)} ${String(s.readiness).padStart(3)}%  ${s.verdict}`);
  const wave = before.result.waves.find((w: any) => w.number === waveNumber);
  const packages = (wave?.fixes || []).filter((f: any) => f.kind === "code");
  if (!packages.length) throw new Error(`Wave ${waveNumber} has no code work packages`);
  console.log(`Wave ${waveNumber}: ${packages.length} code packages`);

  const events: FixEvent[] = [];
  const session = openSession("recording", e => { events.push(e); console.log(`[${String(Math.round(e.at / 1000)).padStart(4)}s] ${e.type}${"path" in e && e.path ? " " + e.path : ""}${e.type === "note" ? " " + e.text.slice(0, 100) : e.type === "package" ? ` ${e.status} ${e.index + 1}: ${e.title}` : ""}`); });
  session.emit({ type: "stage", stage: "preparing", label: "Preparing isolated working copy" });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "greenlight-record-"));
  await copyTree(repo, repo, root, blocked);
  const original = await readWorkspace(root, blocked);
  const snapshots = new Map(original);
  session.emit({ type: "note", text: `${original.size} source files in the working copy` });
  session.emit({ type: "stage", stage: "fixing", label: `Fixing wave ${waveNumber}: ${packages.length} work package${packages.length === 1 ? "" : "s"}` });
  session.emit({ type: "plan", packages: packages.map(planPackage) });
  await runFixAgent({ root, wave: waveNumber, packages, session, snapshots, blocked });

  const after = await readWorkspace(root, blocked);
  const names = new Set([...original.keys(), ...after.keys()]);
  const changes = [...names].filter(f => original.get(f) !== after.get(f)).map(f => ({ file: f, before: original.get(f) || "", after: after.get(f) || "" }));

  // Verify: the project's own tests (optional), then the same deterministic engine again.
  session.emit({ type: "stage", stage: "verifying", label: flag("--test") ? "Running the project's tests, then re-checking with the same rules" : "Re-checking with the same rules" });
  if (flag("--test")) {
    session.emit({ type: "test", command: "npm test", status: "start" });
    const t = await runTests(root);
    session.emit({ type: "test", command: "npm test", status: t.ok ? "pass" : "fail", output: t.output.split("\n").slice(-12).join("\n") });
  } else session.emit({ type: "test", command: "npm test", status: "skipped", output: "Tests not run in this recording" });
  const afterRun = await assessFolder(root, project, standards);
  const readiness = (r: any) => Object.fromEntries(r.standards.map((s: any) => [s.short, s.readiness]));
  const b = readiness(before.result), a = readiness(afterRun.result);
  for (const k of Object.keys(a)) session.emit({ type: "note", text: `${k}: ${b[k]}% → ${a[k]}% by the same rules` });
  session.emit({ type: "stage", stage: "review", label: `${changes.length} file${changes.length === 1 ? "" : "s"} changed, awaiting your approval` });
  session.emit({ type: "done", summary: `Wave ${waveNumber} proposed`, filesChanged: changes.length, durationMs: Date.now() - session.startedAt });

  const recording: FixRecording = {
    version: 1, recordedAt: new Date().toISOString(), project, wave: waveNumber,
    model: process.env.GREENLIGHT_FIX_MODEL || "claude-sonnet-4-6",
    durationMs: events[events.length - 1].at, packages: packages.map(planPackage), events, changes,
    outcome: { before: b, after: a, verdictBefore: before.result.verdict, verdictAfter: afterRun.result.verdict },
  };
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(recording));
  await fs.writeFile(out.replace(/\.json$/, ".assessment-before.json"), JSON.stringify(before.result));
  await fs.writeFile(out.replace(/\.json$/, ".assessment-after.json"), JSON.stringify(afterRun.result));
  console.log(`Wrote ${out}: ${events.length} events, ${changes.length} files changed, ${Math.round(recording.durationMs / 1000)}s`);
  console.log(`Verdict ${recording.outcome.verdictBefore} → ${recording.outcome.verdictAfter}`);
}

main().catch(err => { console.error(err); process.exit(1); });
