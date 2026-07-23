import crypto from "node:crypto";

const PLATFORM_KEYS = Object.freeze({
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "linux-arm64": "linux-arm64",
  "linux-x64": "linux-x64",
});

export function resolveBrowserManifestEntry(manifest, platform = process.platform, arch = process.arch) {
  const key = PLATFORM_KEYS[`${platform}-${arch}`];
  if (!key) return null;
  const entry = manifest?.platforms?.[key];
  if (!entry?.url || !/^[a-f0-9]{64}$/i.test(entry.sha256 || "")) {
    throw new Error(`browser manifest entry ${key} is missing a valid URL or SHA-256`);
  }
  return { key, snapshot: manifest.snapshot, ...entry };
}

export function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function assertBrowserChecksum(bytes, expected) {
  const actual = sha256(bytes);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`Lightpanda checksum mismatch: expected ${expected}, got ${actual}`);
  }
  return actual;
}
