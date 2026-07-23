import assert from "node:assert/strict";
import test from "node:test";
import { assertBrowserChecksum, resolveBrowserManifestEntry, sha256 } from "./search-browser-resource-state.mjs";

test("selects a supported pinned browser platform", () => {
  const digest = sha256("browser");
  const entry = resolveBrowserManifestEntry(
    { snapshot: "nightly-test", platforms: { "darwin-arm64": { url: "https://example.test/browser", sha256: digest } } },
    "darwin",
    "arm64",
  );
  assert.deepEqual(entry, {
    key: "darwin-arm64",
    snapshot: "nightly-test",
    url: "https://example.test/browser",
    sha256: digest,
  });
  assert.equal(resolveBrowserManifestEntry({ platforms: {} }, "win32", "x64"), null);
});

test("rejects a downloaded browser whose bytes do not match the manifest", () => {
  const digest = sha256("browser");
  assert.equal(assertBrowserChecksum(Buffer.from("browser"), digest), digest);
  assert.throws(() => assertBrowserChecksum(Buffer.from("changed"), digest), /checksum mismatch/);
});
