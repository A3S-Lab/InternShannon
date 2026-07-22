import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const scenarioDir = path.join(repoRoot, "知识库测试", "三场景真实项目测试");
const runId = process.env.KB_EXTERNAL_RUN_ID || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const ocrPort = Number(process.env.KB_REAL_OCR_PORT || 39871);
const outputDir = path.join(scriptDir, "runs", runId);
const tempConfig = await mkdtemp(path.join(os.tmpdir(), "internshannon-external-config-"));
const children = new Set();

await mkdir(outputDir, { recursive: true });

try {
  await prepareConfig(process.env.KB_SCENARIO_CONFIG_DIR || path.join(os.homedir(), ".internshannon"), tempConfig);
  const ocr = start(process.execPath, [path.join(scriptDir, "tesseract-ocr-provider.mjs")], {
    KB_REAL_OCR_PORT: String(ocrPort),
  }, path.join(outputDir, "ocr-provider.log"));
  await waitForUrl(`http://127.0.0.1:${ocrPort}/health`, 20_000);

  const embeddingProbe = await probeEmbedding(tempConfig);
  assert.equal(embeddingProbe.status, 200);
  assert.equal(embeddingProbe.dimensions, 1536);
  await writeFile(path.join(outputDir, "embedding-probe.json"), `${JSON.stringify(embeddingProbe, null, 2)}\n`);

  const latestReport = path.join(scriptDir, "latest-real-provider-report.json");
  await run(process.execPath, [path.join(scenarioDir, "run-isolated-project-suite.mjs")], {
    KB_SCENARIO_CONFIG_DIR: tempConfig,
    KB_SCENARIO_OUTPUT_ROOT: path.relative(scenarioDir, path.join(outputDir, "scenario-runs")),
    KB_SCENARIO_LATEST_REPORT: latestReport,
    KB_SCENARIO_EXPECT_REAL_OCR: "1",
    KB_SCENARIO_EMBEDDING_PROVIDER: "boyue",
    KB_SCENARIO_EMBEDDING_MODEL: "text-embedding-3-small",
    KB_SCENARIO_EMBEDDING_DIMENSIONS: "1536",
    KB_SCENARIO_RUN_ID: runId,
  }, path.join(outputDir, "scenario-suite.log"));

  const scenarioReport = JSON.parse(await readFile(latestReport, "utf8"));
  assert.equal(scenarioReport.status, "passed");
  const summary = {
    runId,
    completedAt: new Date().toISOString(),
    status: "passed",
    providers: {
      ocr: { engine: "tesseract", transport: "custom-http", real: true },
      embedding: { provider: "boyue", model: "text-embedding-3-small", dimensions: 1536, real: true },
    },
    embeddingProbe,
    scenarios: scenarioReport,
  };
  await writeFile(path.join(scriptDir, "latest-real-provider-report.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[external-provider-suite] passed output=${outputDir}`);
  await stop(ocr);
} catch (error) {
  console.error("[external-provider-suite] failed", error);
  process.exitCode = 1;
} finally {
  await Promise.all(Array.from(children, stop));
  await rm(tempConfig, { recursive: true, force: true });
}

async function prepareConfig(source, target) {
  for (const name of ["app-config.json", "config.json"]) await cp(path.join(source, name), path.join(target, name));
  const appPath = path.join(target, "app-config.json");
  const app = JSON.parse(await readFile(appPath, "utf8"));
  const models = typeof app.models === "string" ? JSON.parse(app.models) : app.models;
  addEmbeddingModel(models);
  app.models = typeof app.models === "string" ? JSON.stringify(models) : models;
  await writeFile(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const configPath = path.join(target, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const llmWasString = typeof config["config/app/llm"] === "string";
  const llm = llmWasString ? JSON.parse(config["config/app/llm"]) : config["config/app/llm"];
  addEmbeddingModel(llm);
  config["config/app/llm"] = llmWasString ? JSON.stringify(llm) : llm;
  const ocrWasString = typeof config["config/app/ocr"] === "string";
  const ocr = {
    defaultBackend: "tesseract-http",
    backends: [{
      name: "tesseract-http",
      type: "custom",
      enabled: true,
      baseUrl: `http://127.0.0.1:${ocrPort}`,
      endpoint: "/ocr",
      timeoutMs: 120000,
      outputFormat: "json",
      requestFormat: "json-base64",
      headers: {},
      options: { bodyField: "file" },
    }],
  };
  config["config/app/ocr"] = ocrWasString ? JSON.stringify(ocr) : ocr;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function addEmbeddingModel(settings) {
  const provider = settings.providers.find((item) => item.name === "boyue");
  assert(provider?.apiKey && provider?.baseUrl, "boyue provider is not configured");
  if (!provider.models.some((item) => (item.id || item.name) === "text-embedding-3-small")) {
    provider.models.push({ id: "text-embedding-3-small", name: "text-embedding-3-small", attachment: false, reasoning: false, toolCall: false, temperature: false });
  }
}

async function probeEmbedding(configDir) {
  const app = JSON.parse(await readFile(path.join(configDir, "app-config.json"), "utf8"));
  const models = typeof app.models === "string" ? JSON.parse(app.models) : app.models;
  const provider = models.providers.find((item) => item.name === "boyue");
  const response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: ["external embedding validation marker"] }),
  });
  const body = await response.json().catch(() => ({}));
  return { provider: "boyue", model: "text-embedding-3-small", status: response.status, dimensions: body?.data?.[0]?.embedding?.length || 0 };
}

function start(command, args, extraEnv, logPath) {
  const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  child.once("exit", () => writeFile(logPath, Buffer.concat(chunks)).catch(() => undefined));
  children.add(child);
  return child;
}

async function run(command, args, extraEnv, logPath) {
  const child = start(command, args, extraEnv, logPath);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (value) => resolve(value)); });
  assert.equal(code, 0, `${path.basename(command)} exited with ${code}; see ${logPath}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}`);
}
