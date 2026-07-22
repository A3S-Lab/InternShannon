#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const rsbuildCommand = process.platform === "win32" ? "rsbuild.cmd" : "rsbuild";

fs.rmSync("dist/workspace", { recursive: true, force: true });

const result = spawnSync(rsbuildCommand, ["build", "--config", "rsbuild.desktop.config.ts"], {
  env: {
    ...process.env,
    PUBLIC_DESKTOP_ASSET_BASE_URL: "/workspace",
    // Production desktop assets must never contain the interaction-blocking
    // Agentation developer overlay, even if a developer shell exports the flag.
    PUBLIC_ENABLE_AGENTATION: "false",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(`desktop:build failed to execute ${rsbuildCommand}: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const budgetResult = spawnSync(process.execPath, ["scripts/check-desktop-bundle-size.mjs"], {
  env: process.env,
  stdio: "inherit",
});

if (budgetResult.error) {
  console.error(`desktop bundle budget failed to execute: ${budgetResult.error.message}`);
  process.exit(1);
}

process.exit(budgetResult.status ?? 1);
