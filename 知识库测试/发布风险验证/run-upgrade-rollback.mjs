import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const candidateEntry = path.join(repoRoot, "apps/sidecar/dist/main.js");
const baselineEntry = process.env.KB_BASELINE_SIDECAR_ENTRY?.trim();
const baselineRoot = process.env.KB_BASELINE_REPO_ROOT?.trim() || (baselineEntry ? path.resolve(path.dirname(baselineEntry), "../../..") : "");
const baselineCommit = process.env.KB_BASELINE_COMMIT?.trim() || "unspecified";
const port = Number(process.env.KB_UPGRADE_API_PORT || 29690);
const apiBase = `http://127.0.0.1:${port}/api/v1`;
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const outputDir = path.join(scriptDir, "upgrade-runs", runId);
const reportPath = path.join(scriptDir, "latest-upgrade-rollback-report.json");
const dataDir = mkdtempSync(path.join(os.tmpdir(), "internshannon-kb-upgrade-"));
const marker = `UPGRADE-ROLLBACK-${runId}`;
const sourceName = `upgrade-${runId}.txt`;
const sourcePath = `raw/sources/${sourceName}`;
const sourceBytes = Buffer.from(`${marker} 旧版知识库升级以后必须保留来源、引用和回退可读性。\n`.repeat(256));
const sourceSha = sha256(sourceBytes);
let sidecar;

assert(baselineEntry && existsSync(baselineEntry), "KB_BASELINE_SIDECAR_ENTRY must point to a built baseline Sidecar");
assert(existsSync(candidateEntry), `missing candidate Sidecar: ${candidateEntry}`);
mkdirSync(outputDir, { recursive: true });

const report = {
  runId,
  startedAt: new Date().toISOString(),
  status: "running",
  baseline: { commit: baselineCommit, entry: baselineEntry },
  candidate: { entry: candidateEntry },
  isolation: { dataDir, userDataUntouched: true },
  checks: [],
};

try {
  sidecar = startSidecar("baseline", baselineEntry, baselineRoot, "01-baseline.log");
  await waitForHealth();
  const asset = await getJson("/assets/me/knowledge");
  assert(asset?.id);
  report.assetId = asset.id;
  pass("baseline Sidecar created the personal knowledge base", { assetId: asset.id, commit: baselineCommit });

  await postJson(`/assets/${asset.id}/wiki/okf/import`, {
    overwrite: true,
    files: [{
      path: `upgrade/${runId}.md`,
      content: `---\ntype: Concept\ntitle: Upgrade ${runId}\ndescription: ${marker}\n---\n\n# ${marker}\n\n升级回退验证页面。\n`,
    }],
  });
  await postJson(`/assets/${asset.id}/wiki/sources`, {
    ingest: false,
    sources: [{ name: sourceName, contentBase64: sourceBytes.toString("base64") }],
  });
  const baselineJob = await postJson(`/assets/${asset.id}/wiki/ingest-jobs`, { sourcePaths: [sourcePath] });
  const baselineTerminal = await waitForJob(asset.id, baselineJob.jobId, 180_000);
  assert.equal(baselineTerminal.status, "succeeded", JSON.stringify(baselineTerminal));
  const oldManifest = await readRepositoryJson(asset.id, ".internshannon/knowledge/index/manifest.json");
  assert(oldManifest.vectorIndexPath);
  pass("baseline persisted OKF, source and legacy index", { vectorIndexPath: oldManifest.vectorIndexPath, sha256: sourceSha });

  const largeName = `upgrade-interrupted-${runId}.txt`;
  const largePath = `raw/sources/${largeName}`;
  const largeBytes = Buffer.from(`${marker} interrupted baseline job\n`.repeat(180_000));
  await postJson(`/assets/${asset.id}/wiki/sources`, {
    ingest: false,
    sources: [{ name: largeName, contentBase64: largeBytes.toString("base64") }],
  });
  const interrupted = await postJson(`/assets/${asset.id}/wiki/ingest-jobs`, { sourcePaths: [largePath] });
  await waitForJobStatus(asset.id, interrupted.jobId, ["running"], 60_000);
  await stopSidecar("SIGKILL");
  pass("baseline was terminated with a persisted running job", { jobId: interrupted.jobId });

  sidecar = startSidecar("candidate", candidateEntry, repoRoot, "02-candidate-upgrade.log");
  await waitForHealth();
  const upgradedAsset = await getJson("/assets/me/knowledge");
  assert.equal(upgradedAsset.id, asset.id);
  const recoveredJob = await getJson(`/assets/${asset.id}/wiki/ingest-jobs/${interrupted.jobId}`);
  assert.equal(recoveredJob.status, "failed", JSON.stringify(recoveredJob));
  assert.match(recoveredJob.failedReason || "", /restarted before.*completed/i);
  pass("candidate recovered the interrupted legacy job as retryable failure");

  await assertSourceSha(asset.id, sourcePath, sourceSha);
  await assertSearch(asset.id, marker, sourcePath);
  pass("candidate preserved legacy raw bytes, OKF search and citations");

  const upgradedJob = await postJson(`/assets/${asset.id}/wiki/ingest-jobs`, { sourcePaths: [sourcePath] });
  const upgradedTerminal = await waitForJob(asset.id, upgradedJob.jobId, 180_000);
  assert.equal(upgradedTerminal.status, "succeeded", JSON.stringify(upgradedTerminal));
  const newManifest = await readRepositoryJson(asset.id, ".internshannon/knowledge/index/manifest.json");
  assert.match(newManifest.vectorIndexPath, /-[a-f0-9]{16}\.json$/);
  assert.notEqual(newManifest.vectorIndexPath, oldManifest.vectorIndexPath);
  pass("candidate upgraded the vector index to an immutable revision", { vectorIndexPath: newManifest.vectorIndexPath });

  await stopSidecar("SIGTERM");
  sidecar = startSidecar("baseline-rollback", baselineEntry, baselineRoot, "03-baseline-rollback.log");
  await waitForHealth();
  const rolledBackAsset = await getJson("/assets/me/knowledge");
  assert.equal(rolledBackAsset.id, asset.id);
  await assertSourceSha(asset.id, sourcePath, sourceSha);
  await assertSearch(asset.id, marker, sourcePath);
  const rollbackManifest = await readRepositoryJson(asset.id, ".internshannon/knowledge/index/manifest.json");
  assert.equal(rollbackManifest.vectorIndexPath, newManifest.vectorIndexPath);
  pass("baseline rollback opened the candidate manifest without raw-source loss", { vectorIndexPath: rollbackManifest.vectorIndexPath });

  await stopSidecar("SIGTERM");
  sidecar = startSidecar("candidate-final", candidateEntry, repoRoot, "04-candidate-final.log");
  await waitForHealth();
  await assertSourceSha(asset.id, sourcePath, sourceSha);
  await assertSearch(asset.id, marker, sourcePath);
  pass("candidate reopened the twice-transitioned profile successfully");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  process.exitCode = 1;
} finally {
  await stopSidecar("SIGTERM");
  report.completedAt = new Date().toISOString();
  report.summary = { passed: report.checks.filter((check) => check.status === "passed").length, failed: report.status === "failed" ? 1 : 0 };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(path.join(outputDir, "report.json"), serialized, "utf8");
  writeFileSync(reportPath, serialized, "utf8");
  if (process.env.KB_UPGRADE_KEEP_DATA !== "1") rmSync(dataDir, { recursive: true, force: true });
  console.log(`[kb-upgrade-rollback] ${report.status} checks=${report.summary.passed}`);
}

function startSidecar(label, entry, cwd, logName) {
  const log = createWriteStream(path.join(outputDir, logName), { flags: "a" });
  const child = spawn(process.execPath, [entry], {
    cwd,
    env: { ...process.env, INTERNSHANNON_DATA_DIR: dataDir, APP_HOST: "127.0.0.1", APP_PORT: String(port), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once("exit", () => log.end());
  report.transitions ??= [];
  report.transitions.push({ label, entry, startedAt: new Date().toISOString() });
  return child;
}

async function stopSidecar(signal) {
  if (!sidecar || sidecar.exitCode !== null || sidecar.signalCode) return;
  const child = sidecar;
  child.kill(signal);
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}

async function waitForHealth() {
  await waitUntil(async () => (await fetch(`${apiBase}/health`).catch(() => null))?.ok, 60_000, 100, "Sidecar health");
}

async function waitForJob(assetId, jobId, timeoutMs) {
  let latest;
  await waitUntil(async () => {
    latest = await getJson(`/assets/${assetId}/wiki/ingest-jobs/${jobId}`);
    return ["succeeded", "failed", "cancelled"].includes(latest.status);
  }, timeoutMs, 150, `job ${jobId} terminal`);
  return latest;
}

async function waitForJobStatus(assetId, jobId, statuses, timeoutMs) {
  let latest;
  await waitUntil(async () => {
    latest = await getJson(`/assets/${assetId}/wiki/ingest-jobs/${jobId}`);
    return statuses.includes(latest.status);
  }, timeoutMs, 50, `job ${jobId} ${statuses.join("/")}`);
  return latest;
}

async function waitUntil(predicate, timeoutMs, intervalMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function assertSourceSha(assetId, repositoryPath, expected) {
  const blob = await getJson(`/assets/${assetId}/repository/blob?path=${encodeURIComponent(repositoryPath)}`);
  const bytes = blob.encoding === "base64" ? Buffer.from(blob.content, "base64") : Buffer.from(blob.content, "utf8");
  assert.equal(sha256(bytes), expected);
}

async function assertSearch(assetId, query, expectedPath) {
  const search = await getJson(`/assets/${assetId}/wiki/search?q=${encodeURIComponent(query)}&limit=8`);
  assert(search.hits?.some((hit) => hit.path === expectedPath || hit.path.includes("upgrade/")), JSON.stringify(search));
  assert(search.hits.every((hit) => Array.isArray(hit.citations) && hit.citations.length > 0));
}

async function readRepositoryJson(assetId, repositoryPath) {
  const blob = await getJson(`/assets/${assetId}/repository/blob?path=${encodeURIComponent(repositoryPath)}`);
  const text = blob.encoding === "base64" ? Buffer.from(blob.content, "base64").toString("utf8") : blob.content;
  return JSON.parse(text);
}

async function getJson(pathname) { return requestJson(pathname, { method: "GET" }); }
async function postJson(pathname, body) { return requestJson(pathname, { method: "POST", body }); }
async function requestJson(pathname, options) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: options.method,
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method} ${pathname} -> HTTP ${response.status}: ${text.slice(0, 1200)}`);
  let payload = text ? JSON.parse(text) : null;
  if (payload && typeof payload === "object" && "data" in payload && "code" in payload) payload = payload.data;
  return payload;
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function pass(name, details = {}) { report.checks.push({ name, status: "passed", ...details }); }
