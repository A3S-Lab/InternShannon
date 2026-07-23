import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const entry = path.join(repoRoot, "apps/sidecar/dist/main.js");
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const port = Number(process.env.KB_MCP_FUZZ_API_PORT || 29689);
const apiBase = `http://127.0.0.1:${port}/api/v1`;
const caseCount = Number(process.env.KB_MCP_FUZZ_CASES || 500);
const dataDir = mkdtempSync(path.join(os.tmpdir(), "internshannon-kb-mcp-fuzz-"));
const outputDir = path.join(scriptDir, "mcp-fuzz-runs", runId);
const latestPath = path.join(scriptDir, "latest-mcp-fuzz-report.json");
let sidecar;

assert(existsSync(entry));
mkdirSync(outputDir, { recursive: true });
const report = { runId, startedAt: new Date().toISOString(), status: "running", caseCount, results: {}, checks: [] };

try {
  sidecar = startSidecar();
  await waitForHealth();
  const counters = { jsonRpcSuccess: 0, jsonRpcError: 0, toolError: 0, controlledHttp4xx: 0 };
  for (let index = 0; index < caseCount; index += 1) {
    const input = buildCase(index);
    const response = await fetch(`${apiBase}/kernel/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await response.text();
    assert(response.status < 500, `case ${index} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    if (response.status >= 400) {
      counters.controlledHttp4xx += 1;
    } else if (text) {
      const body = JSON.parse(text);
      if (body.error) counters.jsonRpcError += 1;
      else if (body.result?.isError) counters.toolError += 1;
      else counters.jsonRpcSuccess += 1;
      assert.equal(body.jsonrpc, "2.0");
    }
    if (index % 25 === 0) await assertHealth(`after case ${index}`);
  }

  const malformedBodies = ["{", "[1,", "not-json", '"unterminated'];
  for (const body of malformedBodies) {
    const response = await fetch(`${apiBase}/kernel/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert(response.status >= 400 && response.status < 500, `malformed JSON returned ${response.status}`);
    counters.controlledHttp4xx += 1;
  }
  await assertHealth("after malformed JSON cases");
  assert(counters.jsonRpcError > 0);
  assert(counters.toolError > 0);
  assert(counters.jsonRpcSuccess > 0);
  report.results = counters;
  report.checks.push({ name: "deterministic JSON-RPC mutations", status: "passed", cases: caseCount });
  report.checks.push({ name: "malformed JSON rejected without process failure", status: "passed", cases: malformedBodies.length });
  report.checks.push({ name: "Sidecar remained healthy throughout fuzz run", status: "passed" });
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
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`[kb-mcp-fuzz] ${report.status} cases=${caseCount + 4} report=${latestPath}`);
}

function buildCase(index) {
  const id = index % 7 === 0 ? null : index % 11 === 0 ? `id-${index}` : index;
  switch (index % 12) {
    case 0: return { jsonrpc: "2.0", id, method: "ping" };
    case 1: return { jsonrpc: "2.0", id, method: "tools/list", params: { cursor: index } };
    case 2: return { jsonrpc: "2.0", id, method: `unknown/${index}` };
    case 3: return { jsonrpc: "1.0", id, method: "ping" };
    case 4: return { jsonrpc: "2.0", id, method: "" };
    case 5: return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "missing", arguments: {} } };
    case 6: return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "knowledge_search", arguments: null } };
    case 7: return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "knowledge_search", arguments: { query: index } } };
    case 8: return { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: index % 2 ? "future" : null } };
    case 9: return { jsonrpc: "2.0", id, method: "notifications/initialized", params: { nested: { index } } };
    case 10: return index % 20 === 10 ? ["not", "an", "object"] : null;
    default: return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "knowledge_read", arguments: { path: `missing-${index}.md`, scope: "personal" } } };
  }
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await fetch(`${apiBase}/health`).catch(() => null))?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Sidecar health timeout");
}

async function assertHealth(label) {
  const response = await fetch(`${apiBase}/health`);
  assert(response.ok, `${label}: health HTTP ${response.status}`);
}
