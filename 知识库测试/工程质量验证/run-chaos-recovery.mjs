import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const sidecarEntry = path.join(repoRoot, "apps/sidecar/dist/main.js");
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const apiPort = Number(process.env.KB_CHAOS_API_PORT || 29687);
const apiBase = `http://127.0.0.1:${apiPort}/api/v1`;
const outputDir = path.join(scriptDir, "chaos-runs", runId);
const reportPath = path.join(scriptDir, "latest-chaos-recovery-report.json");
const dataDir = mkdtempSync(path.join(os.tmpdir(), "internshannon-kb-chaos-"));
const sourceName = `chaos-recovery-${runId}.txt`;
const sourcePath = `raw/sources/${sourceName}`;
const marker = `CHAOS-RECOVERY-${runId}`;
const sourceBytes = Buffer.from(createLargeSource(marker));
const expectedSha = sha256(sourceBytes);
let child;

assert(existsSync(sidecarEntry), `missing built Sidecar: ${sidecarEntry}`);
mkdirSync(outputDir, { recursive: true });

const report = {
  runId,
  startedAt: new Date().toISOString(),
  status: "running",
  isolation: { dataDir, userDataUntouched: true },
  fault: { signal: "SIGKILL", process: "Sidecar", point: "persisted running ingest job" },
  checks: [],
};

try {
  child = startSidecar("before-kill.log");
  await waitForHealth();
  pass("fresh isolated Sidecar started");

  const asset = await getJson("/assets/me/knowledge");
  assert(asset?.id, "personal knowledge asset missing");
  report.assetId = asset.id;

  await postJson(`/assets/${asset.id}/wiki/sources`, {
    sources: [{ name: sourceName, contentBase64: sourceBytes.toString("base64") }],
    ingest: false,
  });
  pass("large source uploaded without implicit ingest", { bytes: sourceBytes.length, sha256: expectedSha });

  const started = await postJson(`/assets/${asset.id}/wiki/ingest-jobs`, { sourcePaths: [sourcePath] });
  assert(started?.jobId, "ingest job id missing");
  report.interruptedJobId = started.jobId;

  const running = await waitForJobStatus(asset.id, started.jobId, ["running"], 60_000, 20);
  pass("job reached persisted running state", { progress: running.progress });

  const killedPid = child.pid;
  await stopSidecar("SIGKILL");
  pass("Sidecar forcibly terminated", { pid: killedPid, signal: "SIGKILL" });

  child = startSidecar("after-restart.log");
  await waitForHealth();
  pass("Sidecar restarted with the same data directory");

  const recoveredAsset = await getJson("/assets/me/knowledge");
  assert.equal(recoveredAsset.id, asset.id, "knowledge asset identity changed after restart");
  const recovered = await getJson(`/assets/${asset.id}/wiki/ingest-jobs/${started.jobId}`);
  assert.equal(recovered.status, "failed", JSON.stringify(recovered));
  assert.match(recovered.failedReason || "", /restarted before.*completed/i);
  pass("interrupted job recovered as retryable failure", {
    status: recovered.status,
    failedReason: recovered.failedReason,
  });

  const blobAfterRestart = await getJson(`/assets/${asset.id}/repository/blob?path=${encodeURIComponent(sourcePath)}`);
  assert.equal(blobSha(blobAfterRestart), expectedSha, "source bytes changed across process crash/restart");
  pass("source SHA-256 survived process crash", { sha256: expectedSha });

  const retry = await postJson(`/assets/${asset.id}/wiki/ingest-jobs/${started.jobId}/retry`, {});
  assert.equal(retry.retryOf, started.jobId);
  report.retryJobId = retry.jobId;
  const retried = await waitForJobStatus(asset.id, retry.jobId, ["succeeded", "failed", "cancelled"], 300_000, 200);
  assert.equal(retried.status, "succeeded", JSON.stringify(retried));
  pass("explicit retry completed successfully", {
    jobId: retry.jobId,
    sourceCount: retried.result?.sourceCount,
    chunkCount: retried.result?.chunkCount,
  });

  const blobAfterRetry = await getJson(`/assets/${asset.id}/repository/blob?path=${encodeURIComponent(sourcePath)}`);
  assert.equal(blobSha(blobAfterRetry), expectedSha, "source bytes changed after retry");
  pass("source SHA-256 survived successful retry", { sha256: expectedSha });

  const search = await getJson(`/assets/${asset.id}/wiki/search?q=${encodeURIComponent(marker)}&limit=8`);
  assert(search.hits?.some((hit) => hit.path === sourcePath), JSON.stringify(search));
  assert(search.hits.every((hit) => Array.isArray(hit.citations) && hit.citations.length > 0));
  pass("recovered index finds the source marker with citations", { hits: search.hits.length, sourcePath });

  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  process.exitCode = 1;
} finally {
  await stopSidecar("SIGTERM");
  report.completedAt = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter((check) => check.status === "passed").length,
    failed: report.status === "failed" ? 1 : 0,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(path.join(outputDir, "report.json"), serialized, "utf8");
  writeFileSync(reportPath, serialized, "utf8");
  if (process.env.KB_CHAOS_KEEP_DATA !== "1") rmSync(dataDir, { recursive: true, force: true });
  console.log(`[kb-chaos] ${report.status} checks=${report.summary.passed} report=${reportPath}`);
}

function createLargeSource(uniqueMarker) {
  const row = `${uniqueMarker} 故障恢复项目要求 Sidecar 被强制终止后保留源文件，中断任务必须显式失败并可重试，重建后的检索结果必须带引用。\n`;
  const targetBytes = Number(process.env.KB_CHAOS_SOURCE_BYTES || 4 * 1024 * 1024);
  return row.repeat(Math.ceil(targetBytes / Buffer.byteLength(row))).slice(0, targetBytes);
}

function startSidecar(logName) {
  const logPath = path.join(outputDir, logName);
  const log = createWriteStream(logPath, { flags: "a" });
  const processChild = spawn(process.execPath, [sidecarEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      INTERNSHANNON_DATA_DIR: dataDir,
      APP_HOST: "127.0.0.1",
      APP_PORT: String(apiPort),
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processChild.stdout.pipe(log);
  processChild.stderr.pipe(log);
  processChild.once("exit", () => log.end());
  return processChild;
}

async function stopSidecar(signal) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const current = child;
  current.kill(signal);
  await Promise.race([
    new Promise((resolve) => current.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (current.exitCode === null && !current.signalCode) current.kill("SIGKILL");
}

async function waitForHealth() {
  await waitUntil(async () => {
    const response = await fetch(`${apiBase}/health`).catch(() => null);
    return response?.ok;
  }, 60_000, 100, "Sidecar health");
}

async function waitForJobStatus(assetId, jobId, statuses, timeoutMs, intervalMs) {
  let latest;
  await waitUntil(async () => {
    latest = await getJson(`/assets/${assetId}/wiki/ingest-jobs/${jobId}`);
    return statuses.includes(latest.status);
  }, timeoutMs, intervalMs, `job ${jobId} status ${statuses.join("/")}`);
  return latest;
}

async function waitUntil(predicate, timeoutMs, intervalMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function getJson(pathname) {
  return requestJson(pathname, { method: "GET" });
}

async function postJson(pathname, body) {
  return requestJson(pathname, { method: "POST", body });
}

async function requestJson(pathname, options) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: options.method,
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method} ${pathname} returned HTTP ${response.status}: ${text.slice(0, 1200)}`);
  let payload = text ? JSON.parse(text) : null;
  if (payload && typeof payload === "object" && "data" in payload && "code" in payload) payload = payload.data;
  return payload;
}

function blobSha(blob) {
  const bytes = blob.encoding === "base64" ? Buffer.from(blob.content, "base64") : Buffer.from(blob.content, "utf8");
  return sha256(bytes);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pass(name, evidence = {}) {
  report.checks.push({ name, status: "passed", ...evidence });
}
