import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const node22 = process.execPath;
const pnpm = process.env.KB_FOLLOWUP_PNPM || "pnpm";
const cargo = process.env.KB_FOLLOWUP_CARGO || "cargo";
const soakRunId = process.env.KB_FOLLOWUP_SOAK_RUN_ID || "";
const soakReport = soakRunId ? path.join(scriptDir, "soak-runs", soakRunId, "report.json") : "";
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const outputDir = path.join(scriptDir, "followup-runs", runId);
const reportPath = path.join(scriptDir, "latest-p0-p1-followup-report.json");
const checks = [];

assert(soakRunId, "KB_FOLLOWUP_SOAK_RUN_ID is required");
assert(existsSync(node22), `missing Node runtime: ${node22}`);
mkdirSync(outputDir, { recursive: true });

await waitForSoak();
const soak = JSON.parse(readFileSync(soakReport, "utf8"));
checks.push({ name: "4-hour 16-worker soak", status: soak.status, report: path.relative(repoRoot, soakReport) });

await runCheck("backup-restore-and-real-disk-pressure", node22, [path.join(scriptDir, "run-backup-restore-disk-pressure.mjs")]);
await runCheck(
  "longitudinal-compliance-real-project",
  node22,
  [path.join(repoRoot, "知识库测试/三场景真实项目测试/run-isolated-project-suite.mjs")],
  {
    KB_SCENARIO_CONFIG_DIR: path.join(process.env.HOME || homedir(), ".internshannon"),
    KB_SCENARIO_IDS: "compliance-lifecycle",
    KB_SCENARIO_API_PORT: "29695",
    KB_SCENARIO_WEB_PORT: "5013",
    KB_SCENARIO_OUTPUT_ROOT: "longitudinal-runs",
    KB_SCENARIO_LATEST_REPORT: path.join(repoRoot, "知识库测试/三场景真实项目测试/latest-longitudinal-report.json"),
  },
);
await runCheck("sidecar-unit-and-integration", pnpm, ["--filter", "@internshannon/sidecar", "test", "--runInBand"]);
await runCheck("web-state-and-contract", node22, [path.join(repoRoot, "apps/web/scripts/desktop-state-tests.mjs")]);
await runCheck("ooxml-unit-and-open-handles", pnpm, ["--filter", "@a3s-lab/ooxml", "test", "--runInBand", "--detectOpenHandles"]);
await runCheck("ocr-unit", pnpm, ["--filter", "@a3s-lab/ocr", "test", "--runInBand"]);
await runCheck("ddd-boundary", pnpm, ["--filter", "@internshannon/sidecar", "ddd:check"]);
await runCheck("sidecar-production-build", pnpm, ["--filter", "@internshannon/sidecar", "build"]);
await runCheck("web-production-build", pnpm, ["--filter", "@internshannon/web", "desktop:build"]);
await runCheck("rust-desktop-unit", cargo, ["test", "--manifest-path", path.join(repoRoot, "apps/desktop/src-tauri/Cargo.toml")]);
await runCheck("candidate-fingerprint", node22, [path.join(scriptDir, "write-candidate-fingerprint.mjs")]);
await runCheck("git-diff-check", process.env.KB_FOLLOWUP_GIT || "git", ["diff", "--check"]);

const failed = checks.filter((check) => check.status === "failed");
const summary = {
  runId,
  startedAfterSoakRun: soakRunId,
  completedAt: new Date().toISOString(),
  status: failed.length === 0 ? "passed" : "failed",
  checks,
  summary: { passed: checks.filter((check) => check.status === "passed").length, failed: failed.length },
};
const serialized = `${JSON.stringify(summary, null, 2)}\n`;
writeFileSync(path.join(outputDir, "report.json"), serialized);
writeFileSync(reportPath, serialized);
console.log(`[kb-p0-p1-followup] ${summary.status} passed=${summary.summary.passed} failed=${summary.summary.failed}`);
process.exitCode = failed.length === 0 ? 0 : 1;

async function waitForSoak() {
  const deadline = Date.now() + 6 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    if (existsSync(soakReport)) return;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  throw new Error(`timed out waiting for soak report: ${soakReport}`);
}

async function runCheck(name, command, args, extraEnv = {}) {
  const startedAt = new Date().toISOString();
  const logPath = path.join(outputDir, `${String(checks.length + 1).padStart(2, "0")}-${name}.log`);
  const log = createWriteStream(logPath, { flags: "a" });
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
  checks.push({
    name,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    startedAt,
    completedAt: new Date().toISOString(),
    log: path.relative(repoRoot, logPath),
  });
  writeFileSync(reportPath, `${JSON.stringify({ runId, status: "running", checks }, null, 2)}\n`);
}
