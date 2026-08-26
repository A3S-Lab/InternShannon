import assert from "node:assert/strict";
import test from "node:test";
import {
	assertBrowserChecksum,
	assertBrowserVersionOutput,
	resolveBrowserManifestEntry,
	resolveSystemChromiumFallback,
	sha256,
	validateBrowserReleasePin,
	validateSystemChromiumFallbackManifest,
} from "./search-browser-resource-state.mjs";

test("selects a supported pinned browser platform", () => {
	const digest = sha256("browser");
	const entry = resolveBrowserManifestEntry(
		{
			snapshot: "nightly-test",
			platforms: {
				"darwin-arm64": { url: "https://example.test/browser", sha256: digest },
			},
		},
		"darwin",
		"arm64",
	);
	assert.deepEqual(entry, {
		key: "darwin-arm64",
		snapshot: "nightly-test",
		url: "https://example.test/browser",
		sha256: digest,
	});
	assert.equal(
		resolveBrowserManifestEntry({ platforms: {} }, "win32", "x64"),
		null,
	);
});

test("rejects a downloaded browser whose bytes do not match the manifest", () => {
	const digest = sha256("browser");
	assert.equal(assertBrowserChecksum(Buffer.from("browser"), digest), digest);
	assert.throws(
		() => assertBrowserChecksum(Buffer.from("changed"), digest),
		/checksum mismatch/,
	);
});

test("requires an official versioned Lightpanda release bound to a commit", () => {
	const entry = {
		snapshot: "0.3.1@85d84c296ed592a0a924c8dee3426dbf7881b560",
		url: "https://github.com/lightpanda-io/browser/releases/download/0.3.1/lightpanda-aarch64-macos",
	};
	assert.equal(validateBrowserReleasePin(entry), entry);
	assert.throws(
		() =>
			validateBrowserReleasePin({
				...entry,
				snapshot: "nightly-2026-05-19",
				url: "https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos",
			}),
		/semantic version/,
	);
	assert.throws(
		() =>
			validateBrowserReleasePin({
				...entry,
				url: "https://example.test/lightpanda",
			}),
		/official versioned release/,
	);
});

test("requires the staged Lightpanda runtime to report the pinned release version", () => {
	const snapshot = "0.3.1@85d84c296ed592a0a924c8dee3426dbf7881b560";
	assert.equal(assertBrowserVersionOutput("0.3.1\n", snapshot), "0.3.1");
	assert.throws(
		() => assertBrowserVersionOutput("0.3.2", snapshot),
		/version mismatch/,
	);
});

test("uses a strict system Chromium fallback only for win32-x64", () => {
	const fallback = resolveSystemChromiumFallback("win32", "x64");
	assert.deepEqual(fallback, {
		schemaVersion: 1,
		mode: "system-chromium-fallback",
		platform: "win32-x64",
		bundledBinary: false,
		browserOrder: ["chrome", "edge"],
		executableNames: ["chrome.exe", "msedge.exe"],
	});
	assert.equal(resolveSystemChromiumFallback("darwin", "arm64"), null);
	assert.equal(resolveSystemChromiumFallback("win32", "arm64"), null);
	assert.equal(
		validateSystemChromiumFallbackManifest(fallback, "win32", "x64"),
		fallback,
	);
});

test("rejects forged or ambiguous system Chromium fallback manifests", () => {
	const fallback = resolveSystemChromiumFallback("win32", "x64");
	for (const forged of [
		{ ...fallback, platform: "darwin-arm64" },
		{ ...fallback, mode: "bundled-lightpanda" },
		{ ...fallback, bundledBinary: true },
		{ ...fallback, browserOrder: ["edge", "chrome"] },
		{ ...fallback, executableNames: ["browser.exe"] },
		{ ...fallback, executablePath: "C:/forged/chrome.exe" },
	]) {
		assert.throws(
			() => validateSystemChromiumFallbackManifest(forged, "win32", "x64"),
			/system Chromium fallback manifest/,
		);
	}
	assert.throws(
		() => validateSystemChromiumFallbackManifest(fallback, "linux", "x64"),
		/not approved/,
	);
});
