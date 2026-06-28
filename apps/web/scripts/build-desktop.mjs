#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const rsbuildCommand = process.platform === "win32" ? "rsbuild.cmd" : "rsbuild";

fs.rmSync("dist/workspace", { recursive: true, force: true });

const result = spawnSync(rsbuildCommand, ["build", "--config", "rsbuild.desktop.config.ts"], {
  env: {
    ...process.env,
    PUBLIC_DESKTOP_ASSET_BASE_URL: "/workspace",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(`desktop:build failed to execute ${rsbuildCommand}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
