#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBrowserChecksum, resolveBrowserManifestEntry } from "./search-browser-resource-state.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(desktopDir, "../sidecar/config/browser-binary.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entry = resolveBrowserManifestEntry(manifest);
const resourceDir = path.join(desktopDir, "src-tauri/resources/search-browser");
const allowDownload = process.argv.includes("--download");

fs.mkdirSync(resourceDir, { recursive: true });

if (!entry) {
  fs.writeFileSync(
    path.join(resourceDir, "UNSUPPORTED.txt"),
    `No bundled Lightpanda runtime is published for ${process.platform}-${process.arch}; install Chrome.\n`,
  );
  console.log(`search browser resource: Lightpanda unsupported on ${process.platform}-${process.arch}; Chrome fallback required`);
  process.exit(0);
}

const cacheDir = path.join(desktopDir, ".cache/search-browser", entry.snapshot, entry.key);
const cachePath = path.join(cacheDir, process.platform === "win32" ? "lightpanda.exe" : "lightpanda");
fs.mkdirSync(cacheDir, { recursive: true });

let bytes = fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : null;
if (bytes) {
  try {
    assertBrowserChecksum(bytes, entry.sha256);
  } catch {
    bytes = null;
  }
}

if (!bytes) {
  if (!allowDownload) {
    const unavailablePath = path.join(resourceDir, "UNAVAILABLE.txt");
    fs.rmSync(path.join(resourceDir, process.platform === "win32" ? "lightpanda.exe" : "lightpanda"), {
      force: true,
    });
    fs.rmSync(path.join(resourceDir, "manifest.json"), { force: true });
    fs.writeFileSync(
      unavailablePath,
      `No verified cached Lightpanda runtime for ${entry.snapshot} ${entry.key}. Run pnpm --filter @internshannon/desktop download:search-browser explicitly, or install Chrome.\n`,
    );
    console.log(
      `search browser resource: no verified cache for ${entry.snapshot} ${entry.key}; skipped network download during build`,
    );
    process.exit(0);
  }

  const response = await fetch(entry.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Lightpanda download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  assertBrowserChecksum(bytes, entry.sha256);
  fs.writeFileSync(cachePath, bytes, { mode: 0o755 });
}

const targetPath = path.join(resourceDir, path.basename(cachePath));
fs.rmSync(path.join(resourceDir, "UNAVAILABLE.txt"), { force: true });
fs.copyFileSync(cachePath, targetPath);
if (process.platform !== "win32") fs.chmodSync(targetPath, 0o755);
fs.writeFileSync(
  path.join(resourceDir, "manifest.json"),
  `${JSON.stringify({ snapshot: entry.snapshot, platform: entry.key, sha256: entry.sha256 }, null, 2)}\n`,
);
console.log(`search browser resource staged: ${entry.snapshot} ${entry.key} (${bytes.length} bytes, SHA-256 verified)`);
