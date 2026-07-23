import assert from "node:assert/strict";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const runId = process.env.KB_SCENARIO_RUN_ID || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const apiPort = Number(process.env.KB_SCENARIO_API_PORT || 29683);
const webPort = Number(process.env.KB_SCENARIO_WEB_PORT || 5011);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const skipDialogue = process.env.KB_SCENARIO_SKIP_DIALOGUE === "1";
const configSource = process.env.KB_SCENARIO_CONFIG_DIR?.trim() || "";
const outputRoot = process.env.KB_SCENARIO_OUTPUT_ROOT?.trim() || "isolated-runs";
const outputDir = path.join(scriptDir, outputRoot, runId);
const latestReportPath = process.env.KB_SCENARIO_LATEST_REPORT?.trim() || path.join(scriptDir, "latest-isolated-report.json");
const sidecarEntry = path.join(repoRoot, "apps/sidecar/dist/main.js");
const rsbuildEntry = path.join(repoRoot, "apps/web/node_modules/.bin/rsbuild");
const scenarioRunner = path.join(scriptDir, "run-real-project-scenarios.mjs");
const allScenarioIds = ["renewal-operations", "literature-research", "release-incident", "internshannon-docs", "prompt-security", "compliance-lifecycle"];
const requestedScenarioId = process.env.KB_SCENARIO_ID?.trim() || "";
const requestedScenarioIds = process.env.KB_SCENARIO_IDS?.split(",").map((id) => id.trim()).filter(Boolean) || [];
const scenarioSelection = requestedScenarioIds.length > 0 ? requestedScenarioIds : requestedScenarioId ? [requestedScenarioId] : allScenarioIds;
const scenarios = allScenarioIds.filter((id) => scenarioSelection.includes(id));
const children = new Set();

assert(existsSync(sidecarEntry), `missing built sidecar: ${sidecarEntry}`);
assert(existsSync(rsbuildEntry), `missing rsbuild executable: ${rsbuildEntry}`);
assert(scenarios.length > 0, `unknown KB_SCENARIO_ID: ${requestedScenarioId}`);
assert.equal(scenarios.length, scenarioSelection.length, `unknown scenario selection: ${scenarioSelection.join(",")}`);
if (!skipDialogue) {
  assert(configSource, "KB_SCENARIO_CONFIG_DIR is required for real-model isolated runs");
  assert(existsSync(path.join(configSource, "app-config.json")), "model app-config.json is missing");
  assert(existsSync(path.join(configSource, "config.json")), "model config.json is missing");
}
mkdirSync(outputDir, { recursive: true });

async function main() {
  const web = startProcess(
    rsbuildEntry,
    ["dev", "--config", path.join(repoRoot, "apps/web/rsbuild.desktop.config.ts")],
    {
      cwd: path.join(repoRoot, "apps/web"),
      env: {
        ...process.env,
        PUBLIC_DESKTOP_GATEWAY_URL: apiOrigin,
        PUBLIC_DESKTOP_DEV_PORT: String(webPort),
        PUBLIC_DESKTOP_URL: webOrigin,
        PUBLIC_DESKTOP_STORAGE_PREFIX: `kb-isolated-${runId}`,
      },
      logPath: path.join(outputDir, "web.log"),
    },
  );
  await waitForUrl(webOrigin, 120_000, "isolated web");

  const reports = [];
  try {
    for (const [index, scenarioId] of scenarios.entries()) {
      const dataDir = mkdtempSync(path.join(os.tmpdir(), `internshannon-kb-${scenarioId}-`));
      const syntheticAclPath = configSource || !skipDialogue ? "" : createNonDialogueModelConfig(dataDir);
      if (configSource) copyRuntimeConfig(configSource, dataDir);
      const sidecar = startProcess(
        process.execPath,
        [sidecarEntry],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            INTERNSHANNON_DATA_DIR: dataDir,
            APP_HOST: "127.0.0.1",
            APP_PORT: String(apiPort),
            NODE_ENV: "test",
            ...(syntheticAclPath ? { A3S_CONFIG_ACL: syntheticAclPath } : {}),
          },
          logPath: path.join(outputDir, `${scenarioId}-sidecar.log`),
        },
      );
      try {
        await waitForUrl(`${apiOrigin}/api/v1/health`, 60_000, `${scenarioId} sidecar`);
        const reportPath = path.join(outputDir, `${scenarioId}.json`);
        await runProcess(
          process.execPath,
          [scenarioRunner],
          {
            cwd: repoRoot,
            env: {
              ...process.env,
              KB_SCENARIO_API_URL: apiOrigin,
              KB_SCENARIO_WEB_URL: webOrigin,
              KB_SCENARIO_REPORT: reportPath,
              KB_SCENARIO_RUN_ID: `${runId}-${scenarioId}`,
              KB_SCENARIO_ID: scenarioId,
              KB_SCENARIO_EXTENDED_PROBES: index === 0 ? "1" : "0",
              KB_SCENARIO_SKIP_DIALOGUE: skipDialogue ? "1" : "0",
            },
            logPath: path.join(outputDir, `${scenarioId}-runner.log`),
          },
        );
        const report = JSON.parse(readFileSync(reportPath, "utf8"));
        assert(["passed", "passed_with_skips"].includes(report.status), `${scenarioId} report status=${report.status}`);
        const evidence = report.scenarios?.[0] || {};
        reports.push({
          scenarioId,
          status: report.status,
          summary: report.summary,
          report: path.basename(reportPath),
          evidence: {
            checks: evidence.checks || [],
            queue: evidence.queue,
            dialogue: evidence.dialogue,
            lifecycle: evidence.lifecycle,
            embedding: evidence.embedding,
            ocr: evidence.ocr,
            libreOffice: evidence.libreOffice,
            search: evidence.search,
            browserPassed: report.checks?.some((check) => check.name === "browser multi-project search and Office reopen" && check.status === "passed") || false,
            extendedProbeCount: report.checks?.filter((check) => check.name.startsWith("OKF ") || check.name === "MCP JSON-RPC protocol probes").length || 0,
          },
        });
      } finally {
        await stopProcess(sidecar);
        if (process.env.KB_SCENARIO_KEEP_DATA !== "1") rmSync(dataDir, { recursive: true, force: true });
      }
    }
  } finally {
    await stopProcess(web);
  }

  const summary = {
    runId,
    completedAt: new Date().toISOString(),
    status: reports.some((report) => report.status === "passed_with_skips") ? "passed_with_skips" : "passed",
    isolatedDataDirectories: true,
    realDialogueRequested: !skipDialogue,
    syntheticNonDialogueModelConfig: skipDialogue && !configSource,
    scenarios: reports,
  };
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  writeFileSync(path.join(outputDir, "summary.json"), serialized, "utf8");
  writeFileSync(latestReportPath, serialized, "utf8");
  console.log(`[kb-isolated-suite] ${summary.status} output=${outputDir}`);
}

function createNonDialogueModelConfig(dataDir) {
  const configPath = path.join(dataDir, "config.acl");
  writeFileSync(
    configPath,
    `default_model = "test/non-network"\n\nproviders "test" {\n  apiKey = "not-used"\n  baseUrl = "http://127.0.0.1:9/v1"\n\n  models "non-network" {\n    name = "Non-network test model"\n  }\n}\n`,
    "utf8",
  );
  return configPath;
}

function copyRuntimeConfig(source, target) {
  for (const name of ["app-config.json", "config.json"]) {
    cpSync(path.join(source, name), path.join(target, name));
  }
}

function startProcess(command, args, options) {
  const log = createWriteStream(options.logPath, { flags: "a" });
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once("exit", () => {
    children.delete(child);
    log.end();
  });
  children.add(child);
  return child;
}

async function runProcess(command, args, options) {
  const child = startProcess(command, args, options);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
  assert.equal(exitCode, 0, `${path.basename(command)} exited with ${exitCode}; see ${options.logPath}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitForUrl(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for ${label}: ${url}`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await Promise.all(Array.from(children, stopProcess));
    process.exit(130);
  });
}

main().catch(async (error) => {
  await Promise.all(Array.from(children, stopProcess));
  console.error("[kb-isolated-suite] failed", error);
  process.exitCode = 1;
});
