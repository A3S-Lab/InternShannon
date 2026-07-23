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
const port = Number(process.env.KB_SCALE_API_PORT || 29688);
const apiBase = `http://127.0.0.1:${port}/api/v1`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "internshannon-kb-scale-"));
const outputDir = path.join(scriptDir, "scale-runs", runId);
const latestPath = path.join(scriptDir, "latest-scale-performance-report.json");
const pageCount = Number(process.env.KB_SCALE_PAGE_COUNT || 1000);
const queryCount = Number(process.env.KB_SCALE_QUERY_COUNT || 200);
const reindexRounds = Number(process.env.KB_SCALE_REINDEX_ROUNDS || 3);
const sourceBytesTarget = Number(process.env.KB_SCALE_SOURCE_BYTES || 4 * 1024 * 1024);
const marker = `SCALE-LONG-${runId}`;
let sidecar;

assert(existsSync(entry), `missing built Sidecar: ${entry}`);
assert(Number.isInteger(pageCount) && pageCount >= 1 && pageCount <= 5000);
assert(Number.isInteger(queryCount) && queryCount >= 1);
assert(Number.isInteger(reindexRounds) && reindexRounds >= 1);
mkdirSync(outputDir, { recursive: true });

const report = {
  runId,
  startedAt: new Date().toISOString(),
  status: "running",
  profile: { pageCount, queryCount, reindexRounds, sourceBytesTarget },
  checks: [],
  measurements: {},
};

try {
  sidecar = startSidecar();
  await waitForHealth();
  const asset = await getJson("/assets/me/knowledge");
  assert(asset?.id);
  report.assetId = asset.id;
  const rssBefore = readRssBytes(sidecar.pid);

  const files = buildOkfFiles(pageCount);
  const importStart = performance.now();
  const imported = await postJson(`/assets/${asset.id}/wiki/okf/import`, { files, overwrite: true });
  const importMs = performance.now() - importStart;
  assert.equal(imported.imported, pageCount);
  report.measurements.okfImport = { documents: pageCount, ms: round(importMs), documentsPerSecond: round(pageCount / (importMs / 1000)) };
  pass("large OKF bundle imported", report.measurements.okfImport);

  const validation = await getJson(`/assets/${asset.id}/wiki/okf/validate`);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics?.slice(0, 5)));
  // A freshly provisioned personal knowledge base includes a reserved/default
  // page, so validation covers the imported bundle plus pre-existing pages.
  assert(validation.documentCount >= pageCount);
  pass("large OKF bundle validates", {
    importedDocumentCount: pageCount,
    totalDocumentCount: validation.documentCount,
    preExistingDocumentCount: validation.documentCount - pageCount,
    conceptCount: validation.conceptCount,
  });

  const sourceName = `scale-source-${runId}.txt`;
  const sourcePath = `raw/sources/${sourceName}`;
  const row = `${marker} 长稳测试要求每一轮索引都产生可定位引用，并且不得重复累加文档。\n`;
  const sourceText = row.repeat(Math.ceil(sourceBytesTarget / Buffer.byteLength(row))).slice(0, sourceBytesTarget);
  await postJson(`/assets/${asset.id}/wiki/sources`, {
    sources: [{ name: sourceName, contentBase64: Buffer.from(sourceText).toString("base64") }],
    ingest: false,
  });
  pass("large raw source uploaded", { bytes: Buffer.byteLength(sourceText), path: sourcePath });

  const reindexes = [];
  for (let roundIndex = 0; roundIndex < reindexRounds; roundIndex += 1) {
    const startedAt = performance.now();
    const job = await postJson(`/assets/${asset.id}/wiki/ingest-jobs`, { sourcePaths: [sourcePath] });
    const terminal = await waitForJob(asset.id, job.jobId, 360_000);
    const durationMs = performance.now() - startedAt;
    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal));
    reindexes.push({
      round: roundIndex + 1,
      ms: round(durationMs),
      sourceCount: terminal.result?.sourceCount,
      chunkCount: terminal.result?.chunkCount,
    });
  }
  assert(reindexes.every((item) => item.sourceCount === reindexes[0].sourceCount));
  assert(reindexes.every((item) => item.chunkCount === reindexes[0].chunkCount));
  report.measurements.reindex = reindexes;
  pass("repeated index rebuilds are stable", { rounds: reindexRounds, chunkCount: reindexes[0].chunkCount });

  const timings = [];
  let totalHits = 0;
  for (let index = 0; index < queryCount; index += 1) {
    const query = index % 4 === 0
      ? marker
      : `SCALE-PAGE-${String(index % pageCount).padStart(4, "0")}`;
    const startedAt = performance.now();
    const result = await getJson(`/assets/${asset.id}/wiki/search?q=${encodeURIComponent(query)}&limit=8`);
    timings.push(performance.now() - startedAt);
    assert(result.hits?.length > 0, `query returned no hits: ${query}`);
    assert(result.hits.every((hit) => Array.isArray(hit.citations) && hit.citations.length > 0));
    totalHits += result.hits.length;
  }
  const latency = summarizeLatency(timings);
  assert(latency.p95 < Number(process.env.KB_SCALE_P95_LIMIT_MS || 5000), `search p95 ${latency.p95}ms exceeds limit`);
  report.measurements.search = { ...latency, queries: queryCount, totalHits };
  pass("search soak completed without errors", report.measurements.search);

  const sources = await getJson(`/assets/${asset.id}/wiki/sources`);
  const sourceMatches = sources.filter((item) => item.path === sourcePath);
  assert.equal(sourceMatches.length, 1, `duplicate source entries after repeated reindex: ${sourceMatches.length}`);
  pass("repeated rebuild did not duplicate source metadata", { matchingEntries: sourceMatches.length });

  const rssAfter = readRssBytes(sidecar.pid);
  const rssGrowth = Math.max(0, rssAfter - rssBefore);
  const allowedGrowth = Math.max(256 * 1024 * 1024, rssBefore * 1.5);
  assert(rssGrowth <= allowedGrowth, `RSS growth ${rssGrowth} exceeds ${allowedGrowth}`);
  report.measurements.memory = { beforeBytes: rssBefore, afterBytes: rssAfter, growthBytes: rssGrowth, allowedGrowthBytes: round(allowedGrowth) };
  pass("Sidecar RSS growth stayed within the engineering guardrail", report.measurements.memory);
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
  writeFileSync(latestPath, serialized, "utf8");
  if (process.env.KB_SCALE_KEEP_DATA !== "1") rmSync(dataDir, { recursive: true, force: true });
  console.log(`[kb-scale] ${report.status} checks=${report.summary.passed} report=${latestPath}`);
}

function buildOkfFiles(count) {
  return Array.from({ length: count }, (_, index) => {
    const id = String(index).padStart(4, "0");
    const previous = String((index + count - 1) % count).padStart(4, "0");
    return {
      path: `scale/page-${id}.md`,
      content: [
        "---",
        "type: Concept",
        `title: Scale Page ${id}`,
        `description: Deterministic scale fixture SCALE-PAGE-${id}`,
        "tags: [scale, soak]",
        "---",
        "",
        `# SCALE-PAGE-${id}`,
        "",
        `SCALE-PAGE-${id} 是规模测试概念，它引用[page-${previous}](page-${previous}.md)。`,
        "",
      ].join("\n"),
    };
  });
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
  const child = sidecar;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}

async function waitForHealth() {
  await waitUntil(async () => (await fetch(`${apiBase}/health`).catch(() => null))?.ok, 60_000, 100, "health");
}

async function waitForJob(assetId, jobId, timeoutMs) {
  let latest;
  await waitUntil(async () => {
    latest = await getJson(`/assets/${assetId}/wiki/ingest-jobs/${jobId}`);
    return ["succeeded", "failed", "cancelled"].includes(latest.status);
  }, timeoutMs, 200, `job ${jobId}`);
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

async function getJson(pathname) { return requestJson(pathname, { method: "GET" }); }
async function postJson(pathname, body) { return requestJson(pathname, { method: "POST", body }); }
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

function readRssBytes(pid) {
  try { return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) * 1024; }
  catch { return 0; }
}

function summarizeLatency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return {
    min: round(sorted[0]),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    p99: round(percentile(0.99)),
    max: round(sorted.at(-1)),
  };
}

function round(value) { return Math.round(value * 100) / 100; }
function pass(name, evidence = {}) { report.checks.push({ name, status: "passed", ...evidence }); }
