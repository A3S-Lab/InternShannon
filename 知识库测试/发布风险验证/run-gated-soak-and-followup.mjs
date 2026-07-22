import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const outputDir = path.join(scriptDir, "gated-soak-runs", runId);
const latestSoakReport = path.join(scriptDir, "latest-concurrency-soak-report.json");
const latestReport = path.join(scriptDir, "latest-gated-soak-report.json");
const soakScript = path.join(scriptDir, "run-concurrency-soak.mjs");
const followupScript = path.join(scriptDir, "run-p0-p1-followup.mjs");
const report = { runId, startedAt: new Date().toISOString(), status: "running", stages: [] };

mkdirSync(outputDir, { recursive: true });
writeReport();

try {
  const diagnostic = await runSoak("diagnostic-30m", 30 * 60 * 1000);
  assert.equal(diagnostic.status, "passed", `diagnostic soak failed: ${JSON.stringify(diagnostic.error || diagnostic.measurements?.errorSamples)}`);

  const extended = await runSoak("extended-4h", 4 * 60 * 60 * 1000);
  assert.equal(extended.status, "passed", `extended soak failed: ${JSON.stringify(extended.error || extended.measurements?.errorSamples)}`);

  const followupExit = await runProcess(
    "final-p0-p1-followup",
    process.execPath,
    [followupScript],
    { KB_FOLLOWUP_SOAK_RUN_ID: extended.runId },
  );
  const followup = JSON.parse(readFileSync(path.join(scriptDir, "latest-p0-p1-followup-report.json"), "utf8"));
  report.stages.push({ name: "final-p0-p1-followup", status: followup.status, exitCode: followupExit, report: "latest-p0-p1-followup-report.json" });
  assert.equal(followupExit, 0, `final followup exited with ${followupExit}`);
  assert.equal(followup.status, "passed", `final followup status=${followup.status}`);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  writeReport();
  console.log(`[kb-gated-soak] ${report.status} stages=${report.stages.length}`);
}

async function runSoak(name, durationMs) {
  const exitCode = await runProcess(name, process.execPath, [soakScript], {
    KB_SOAK_DURATION_MS: String(durationMs),
    KB_SOAK_WORKERS: "16",
    KB_SOAK_API_PORT: "29691",
  });
  const result = JSON.parse(readFileSync(latestSoakReport, "utf8"));
  assert.equal(result.profile?.durationMs, durationMs, `${name} read a mismatched soak report`);
  const reportName = `${name}-report.json`;
  copyFileSync(latestSoakReport, path.join(outputDir, reportName));
  report.stages.push({
    name,
    status: result.status,
    exitCode,
    runId: result.runId,
    report: path.join("gated-soak-runs", runId, reportName),
    measurements: result.measurements,
    error: result.error,
  });
  writeReport();
  return result;
}

async function runProcess(name, command, args, extraEnv) {
  const log = createWriteStream(path.join(outputDir, `${name}.log`), { flags: "a" });
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const exitCode = await new Promise((resolve) => {
    child.once("error", () => resolve(127));
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
  log.end();
  return exitCode;
}

function writeReport() {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(path.join(outputDir, "report.json"), serialized);
  writeFileSync(latestReport, serialized);
}
