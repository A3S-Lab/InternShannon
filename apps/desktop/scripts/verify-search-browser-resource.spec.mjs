import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RESOURCE_SENTINEL } from "./resource-directory.mjs";
import { resolveSystemChromiumFallback } from "./search-browser-resource-state.mjs";
import { inspectSearchBrowserResource } from "./verify-search-browser-resource.mjs";

function fixture(t, manifest = resolveSystemChromiumFallback("win32", "x64")) {
	const resourcesDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-search-browser."),
	);
	t.after(() => fs.rmSync(resourcesDir, { recursive: true, force: true }));
	const resourceDir = path.join(resourcesDir, "search-browser");
	fs.mkdirSync(resourceDir, { recursive: true });
	fs.writeFileSync(path.join(resourceDir, RESOURCE_SENTINEL), "\n");
	fs.writeFileSync(
		path.join(resourceDir, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return { resourcesDir, resourceDir };
}

function inspectWindows(resourcesDir) {
	return inspectSearchBrowserResource({
		resourcesDir,
		platform: "win32",
		arch: "x64",
		sourceManifest: { platforms: {} },
	});
}

test("accepts an exact win32-x64 system Chromium fallback", (t) => {
	const { resourcesDir } = fixture(t);
	const report = inspectWindows(resourcesDir);
	assert.equal(report.ok, true);
	assert.equal(report.mode, "system-chromium-fallback");
	assert.deepEqual(report.browserOrder, ["chrome", "edge"]);
});

test("rejects a system Chromium fallback without its manifest", (t) => {
	const { resourcesDir, resourceDir } = fixture(t);
	fs.rmSync(path.join(resourceDir, "manifest.json"));
	assert.throws(() => inspectWindows(resourcesDir), /missing manifest\.json/);
});

test("rejects a system Chromium fallback without its sentinel", (t) => {
	const { resourcesDir, resourceDir } = fixture(t);
	fs.rmSync(path.join(resourceDir, RESOURCE_SENTINEL));
	assert.throws(() => inspectWindows(resourcesDir), /missing \.gitkeep/);
});

test("rejects extra system Chromium fallback files and directories", async (t) => {
	for (const [name, createConflict] of [
		[
			"extra-file",
			(resourceDir) =>
				fs.writeFileSync(path.join(resourceDir, "extra.txt"), "conflict"),
		],
		[
			"extra-directory",
			(resourceDir) => fs.mkdirSync(path.join(resourceDir, "extra")),
		],
	]) {
		await t.test(name, (subtest) => {
			const { resourcesDir, resourceDir } = fixture(subtest);
			createConflict(resourceDir);
			assert.throws(
				() => inspectWindows(resourcesDir),
				/conflicting resources/,
			);
		});
	}
});

test("rejects a malformed system Chromium fallback manifest", (t) => {
	const { resourcesDir, resourceDir } = fixture(t);
	fs.writeFileSync(path.join(resourceDir, "manifest.json"), "{ malformed");
	assert.throws(() => inspectWindows(resourcesDir), SyntaxError);
});

test("rejects legacy markers and bundled Lightpanda conflicts", async (t) => {
	for (const conflict of [
		"UNAVAILABLE.txt",
		"UNSUPPORTED.txt",
		"lightpanda",
		"lightpanda.exe",
	]) {
		await t.test(conflict, (subtest) => {
			const { resourcesDir, resourceDir } = fixture(subtest);
			fs.writeFileSync(path.join(resourceDir, conflict), "conflict");
			assert.throws(
				() => inspectWindows(resourcesDir),
				/forbidden|conflicting resources/,
			);
		});
	}
});

test("rejects wrong fallback platform, mode, and extra fields", async (t) => {
	const expected = resolveSystemChromiumFallback("win32", "x64");
	for (const [name, manifest] of [
		["platform", { ...expected, platform: "linux-x64" }],
		["mode", { ...expected, mode: "bundled-lightpanda" }],
		["extra", { ...expected, executablePath: "C:/forged/chrome.exe" }],
	]) {
		await t.test(name, (subtest) => {
			const { resourcesDir } = fixture(subtest, manifest);
			assert.throws(
				() => inspectWindows(resourcesDir),
				/system Chromium fallback manifest/,
			);
		});
	}
});
