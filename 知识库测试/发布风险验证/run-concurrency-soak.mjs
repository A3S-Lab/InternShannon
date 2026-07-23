import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const entry = path.join(repoRoot, "apps/sidecar/dist/main.js");
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const port = Number(process.env.KB_SOAK_API_PORT || 29691);
const apiBase = `http://127.0.0.1:${port}/api/v1`;
const workerCount = Number(process.env.KB_SOAK_WORKERS || 8);
const durationMs = Number(process.env.KB_SOAK_DURATION_MS || 180_000);
const sourceBytes = Number(process.env.KB_SOAK_SOURCE_BYTES || 512 * 1024);
const p95LimitMs = Number(process.env.KB_SOAK_P95_LIMIT_MS || 5_000);
const rebuildEvery = Number(process.env.KB_SOAK_REBUILD_EVERY || 80);
const dataDir = mkdtempSync(path.join(os.tmpdir(), "internshannon-kb-soak-"));
const outputDir = path.join(scriptDir, "soak-runs", runId);
const reportPath = path.join(scriptDir, "latest-concurrency-soak-report.json");
const marker = `CONCURRENCY-SOAK-${runId}`;
let sidecar;

assert(existsSync(entry), `missing Sidecar build: ${entry}`);
assert(Number.isInteger(workerCount) && workerCount >= 8 && workerCount <= 32);
assert(durationMs >= 30_000);
assert(Number.isFinite(p95LimitMs) && p95LimitMs > 0);
assert(Number.isInteger(rebuildEvery) && rebuildEvery > 0);
mkdirSync(outputDir, { recursive: true });

const report = {
  runId,
  startedAt: new Date().toISOString(),
  status: "running",
  profile: {
    workerCount,
    durationMs,
    sourceBytes,
    p95LimitMs,
    rebuildEvery,
    extendedCommand: "KB_SOAK_DURATION_MS=14400000 KB_SOAK_WORKERS=16 node run-concurrency-soak.mjs",
  },
  isolation: { dataDir, userDataUntouched: true },
  checks: [],
  measurements: {},
};

try {
  sidecar = startSidecar();
  await waitForHealth();
  const asset = await getJson("/assets/me/knowledge");
  assert(asset?.id);
  report.assetId = asset.id;
  const before = processStats(sidecar.pid);

  const paths = await Promise.all(Array.from({ length: workerCount }, async (_, index) => {
    const name = `soak-${runId}-${index}.txt`;
    const repositoryPath = `raw/sources/${name}`;
    const row = `${marker}-${index} 并发摄取、搜索、取消和重建必须保持引用与任务状态一致。\n`;
    const text = row.repeat(Math.ceil(sourceBytes / Buffer.byteLength(row))).slice(0, sourceBytes);
    await postJson(`/assets/${asset.id}/wiki/sources`, {
      ingest: false,
      sources: [{ name, contentBase64: Buffer.from(text).toString("base64") }],
    });
    return repositoryPath;
  }));
  pass("8-way concurrent uploads completed", { count: paths.length });

  const jobs = await Promise.all(paths.map((sourcePath) => postJson(`/assets/${asset.id}/wiki/ingest-jobs`, { sourcePaths: [sourcePath] })));
  const observed = await waitForQueueShape(asset.id, jobs.map((job) => job.jobId));
  assert(observed.running.length >= 1 && observed.queued.length >= workerCount - 1, JSON.stringify(observed));
  pass("queue exposed one running job and multiple queued jobs", observed);

  const cancelIds = [observed.running[0], ...observed.queued.slice(0, 2)];
  await Promise.all(cancelIds.map((jobId) => postJson(`/assets/${asset.id}/wiki/ingest-jobs/${jobId}/cancel`, {})));
  const terminals = await Promise.all(jobs.map((job) => waitForJob(asset.id, job.jobId, 600_000)));
  assert(cancelIds.every((jobId) => terminals.find((job) => job.jobId === jobId)?.status === "cancelled"));
  assert(terminals.filter((job) => job.status === "succeeded").length >= workerCount - cancelIds.length);
  pass("running and queued cancellation remained consistent", {
    cancelled: terminals.filter((job) => job.status === "cancelled").length,
    succeeded: terminals.filter((job) => job.status === "succeeded").length,
  });

  const seedJob = await postJson(`/assets/${asset.id}/wiki/ingest-jobs`, { sourcePaths: paths });
  const seedTerminal = await waitForJob(asset.id, seedJob.jobId, 600_000);
  assert.equal(seedTerminal.status, "succeeded", JSON.stringify(seedTerminal));

  const latencies = [];
  let requests = 0;
  let attempts = 0;
  let errors = 0;
  const errorSamples = [];
  let rebuilds = 0;
  const workerRequestCounts = Array(workerCount).fill(0);
  let lastActivityAt = Date.now();
  let maxActivityGapMs = 0;
  const activityGapLimitMs = Number(process.env.KB_SOAK_ACTIVITY_GAP_LIMIT_MS || 120_000);
  const deadline = Date.now() + durationMs;
  const workers = Array.from({ length: workerCount }, (_, worker) => (async () => {
    while (Date.now() < deadline) {
      const requestWallTime = Date.now();
      maxActivityGapMs = Math.max(maxActivityGapMs, requestWallTime - lastActivityAt);
      lastActivityAt = requestWallTime;
      const startedAt = performance.now();
      const query = `${marker}-${worker % paths.length}`;
      let phase = "search";
      attempts += 1;
      try {
        const search = await getJson(`/assets/${asset.id}/wiki/search?q=${encodeURIComponent(query)}&limit=8`);
        assert(search.hits?.length > 0);
        assert(search.hits.every((hit) => Array.isArray(hit.citations) && hit.citations.length > 0));
        latencies.push(performance.now() - startedAt);
        requests += 1;
        workerRequestCounts[worker] += 1;
        if (worker === 0 && workerRequestCounts[worker] % rebuildEvery === 0) {
          phase = "rebuild";
          const rebuild = await postJson(`/assets/${asset.id}/wiki/ingest-jobs`, { sourcePaths: [paths[worker % paths.length]] });
          const terminal = await waitForJob(asset.id, rebuild.jobId, 600_000);
          assert.equal(terminal.status, "succeeded");
          rebuilds += 1;
        }
      } catch (error) {
        errors += 1;
        if (errorSamples.length < 20) {
          errorSamples.push({
            at: new Date().toISOString(),
            elapsedMs: Date.now() - (deadline - durationMs),
            worker,
            phase,
            query,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack?.split("\n").slice(0, 6).join("\n") : undefined,
          });
        }
      }
    }
  })());
  await Promise.all(workers);
  maxActivityGapMs = Math.max(maxActivityGapMs, Date.now() - lastActivityAt);
  const after = processStats(sidecar.pid);
  const latency = summarizeLatency(latencies);
  report.measurements = {
    attempts,
    requests,
    workerRequestCounts,
    errors,
    errorSamples,
    rebuilds,
    continuity: { maxActivityGapMs, activityGapLimitMs, sleepOrLongStallDetected: false },
    latency,
    process: {
      before,
      after,
      rssGrowthBytes: Math.max(0, after.rssBytes - before.rssBytes),
      fileDescriptorGrowth: Math.max(0, after.fileDescriptors - before.fileDescriptors),
    },
  };
  assert(maxActivityGapMs < activityGapLimitMs, `activity gap ${maxActivityGapMs}ms indicates sleep or a stalled event loop`);
  assert.equal(errors, 0, `${errors} concurrent request(s) failed: ${JSON.stringify(errorSamples)}`);
  assert(requests >= workerCount * 10, `insufficient soak requests: ${requests}`);
  const expectedRebuilds = Math.floor(workerRequestCounts[0] / rebuildEvery);
  assert.equal(rebuilds, expectedRebuilds, `expected ${expectedRebuilds} rebuilds, observed ${rebuilds}`);
  assert(rebuilds > 0, `no rebuild completed after ${workerRequestCounts[0]} worker-0 searches`);
  assert(latency.p95 < p95LimitMs, `p95 ${latency.p95} exceeds limit ${p95LimitMs}`);
  assert(report.measurements.process.rssGrowthBytes < 512 * 1024 * 1024);
  assert(report.measurements.process.fileDescriptorGrowth < 128);
  pass("concurrent search/rebuild soak stayed within latency and resource guards", report.measurements);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  process.exitCode = 1;
} finally {
  await stopSidecar();
  report.completedAt = new Date().toISOString();
  report.summary = { passed: report.checks.length, failed: report.status === "failed" ? 1 : 0 };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(path.join(outputDir, "report.json"), serialized, "utf8");
  writeFileSync(reportPath, serialized, "utf8");
  if (process.env.KB_SOAK_KEEP_DATA !== "1") rmSync(dataDir, { recursive: true, force: true });
  console.log(`[kb-concurrency-soak] ${report.status} requests=${report.measurements.requests ?? 0}`);
}

function startSidecar() {
  const log = createWriteStream(path.join(outputDir, "sidecar.log"), { flags: "a" });
  const child = spawn(process.execPath, [entry], {
    cwd: repoRoot,
    env: { ...process.env, INTERNSHANNON_DATA_DIR: dataDir, APP_HOST: "127.0.0.1", APP_PORT: String(port), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once("exit", () => log.end());
  return child;
}

async function stopSidecar() {
  if (!sidecar || sidecar.exitCode !== null || sidecar.signalCode) return;
  sidecar.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => sidecar.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (sidecar.exitCode === null && !sidecar.signalCode) sidecar.kill("SIGKILL");
}

async function waitForHealth() {
  await waitUntil(async () => (await fetch(`${apiBase}/health`).catch(() => null))?.ok, 60_000, 100, "health");
}

async function waitForQueueShape(assetId, jobIds) {
  let shape = { running: [], queued: [] };
  await waitUntil(async () => {
    const jobs = await Promise.all(jobIds.map((jobId) => getJson(`/assets/${assetId}/wiki/ingest-jobs/${jobId}`)));
    shape = {
      running: jobs.filter((job) => job.status === "running").map((job) => job.jobId),
      queued: jobs.filter((job) => job.status === "queued").map((job) => job.jobId),
    };
    return shape.running.length >= 1 && shape.queued.length >= workerCount - 1;
  }, 60_000, 20, "running + queued shape");
  return shape;
}

async function waitForJob(assetId, jobId, timeoutMs) {
  let latest;
  await waitUntil(async () => {
    latest = await getJson(`/assets/${assetId}/wiki/ingest-jobs/${jobId}`);
    return ["succeeded", "failed", "cancelled"].includes(latest.status);
  }, timeoutMs, 150, `job ${jobId}`);
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

function processStats(pid) {
  const rssKb = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) || 0;
  let fileDescriptors = 0;
  try { fileDescriptors = execFileSync("lsof", ["-p", String(pid)], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length; } catch {}
  return { rssBytes: rssKb * 1024, fileDescriptors };
}

function summarizeLatency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  const round = (value) => Math.round(value * 100) / 100;
  return {
    min: round(sorted[0]),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    p99: round(percentile(0.99)),
    max: round(sorted.at(-1)),
  };
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
  if (!response.ok) throw new Error(`${options.method} ${pathname} -> ${response.status}: ${text.slice(0, 1000)}`);
  let payload = text ? JSON.parse(text) : null;
  if (payload && typeof payload === "object" && "data" in payload && "code" in payload) payload = payload.data;
  return payload;
}

function pass(name, details = {}) { report.checks.push({ name, status: "passed", ...details }); }
