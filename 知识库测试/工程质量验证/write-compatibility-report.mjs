import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const visual = JSON.parse(readFileSync(path.join(scriptDir, "latest-visual-contract-report.json"), "utf8"));
const command = (program, args) => execFileSync(program, args, { encoding: "utf8" }).trim();
const commandSafe = (program, args) => {
  try {
    return command(program, args);
  } catch {
    return null;
  }
};
const powerPointPath = "/Applications/Microsoft PowerPoint.app";
const report = {
  generatedAt: new Date().toISOString(),
  status: visual.status === "passed" ? "passed_with_not_run_environments" : "failed",
  host: {
    os: os.type(),
    version: os.release(),
    build: process.platform === "darwin" ? commandSafe("sw_vers", ["-buildVersion"]) : null,
    arch: os.arch(),
  },
  matrix: [
    {
      target: `${process.platform} ${os.arch()} + current Node`,
      version: process.version,
      status: process.env.KB_COMPAT_CURRENT_NODE_STATUS || "not_run",
      evidence: ["Set KB_COMPAT_CURRENT_NODE_STATUS=passed only after executing the candidate regression on this runtime"],
    },
    {
      target: `${process.platform} ${os.arch()} + Node 22`,
      version: process.version.startsWith("v22.") ? process.version : null,
      status: process.env.KB_COMPAT_NODE22_STATUS || "not_run",
      evidence: ["Run Web desktop state/contract tests with Node 22 before marking passed"],
    },
    {
      target: "Codex in-app browser / local Web UI",
      status: visual.status,
      evidence: visual.checks.map((check) => check.name),
    },
    {
      target: "Microsoft PowerPoint for macOS",
      version: process.platform === "darwin" ? commandSafe("mdls", ["-name", "kMDItemVersion", "-raw", powerPointPath]) : null,
      status: process.env.KB_COMPAT_POWERPOINT_STATUS || "not_run",
      evidence: ["Set KB_COMPAT_POWERPOINT_STATUS after manual open/edit/save/reopen against the same candidate"],
    },
    {
      target: "LibreOffice",
      status: process.env.KB_COMPAT_LIBREOFFICE_STATUS || "not_run",
      evidence: ["External baseline is version-specific and is not inferred from installation state"],
    },
    { target: "Windows x64", status: "not_run", reason: "No Windows host or runner is available in this workspace" },
    { target: "Linux x64/arm64", status: "not_run", reason: "No Linux host or container runner is available in this workspace" },
  ],
  notes: [
    "Node 20.9 cannot directly execute Node native .ts tests; this is a runtime capability limitation, not a product failure.",
    "Unexecuted environments are not counted as passed.",
  ],
};

writeFileSync(path.join(scriptDir, "latest-compatibility-matrix.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`[kb-compatibility] ${report.status}`);
