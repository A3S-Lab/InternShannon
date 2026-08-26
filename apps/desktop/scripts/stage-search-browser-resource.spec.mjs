import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256 } from "./search-browser-resource-state.mjs";
import {
	cleanSearchBrowserResource,
	stageSearchBrowserResource,
} from "./stage-search-browser-resource.mjs";

const SNAPSHOT = "0.3.1@85d84c296ed592a0a924c8dee3426dbf7881b560";
const BROWSER_BYTES = Buffer.from("verified Lightpanda fixture");
const QUIET_LOGGER = { log() {} };

function digest(bytes) {
	return crypto.createHash("sha256").update(bytes).digest("hex");
}

function git(repository, args) {
	const result = spawnSync("git", args, {
		cwd: repository,
		encoding: "utf8",
	});
	if (result.error || result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}`,
		);
	}
	return result.stdout.trim();
}

function assertGitClean(repository) {
	assert.equal(
		git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]),
		"",
	);
	assert.equal(git(repository, ["diff", "--exit-code"]), "");
}

function manifest(bytes = BROWSER_BYTES) {
	return {
		snapshot: SNAPSHOT,
		platforms: {
			"darwin-arm64": {
				url: "https://github.com/lightpanda-io/browser/releases/download/0.3.1/lightpanda-aarch64-macos",
				sha256: sha256(bytes),
			},
		},
	};
}

function directorySnapshot(directory) {
	const result = {};
	function visit(current, prefix = "") {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const relative = path.posix.join(prefix, entry.name);
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) {
				result[relative] = "directory";
				visit(absolute, relative);
			} else {
				result[relative] = digest(fs.readFileSync(absolute));
			}
		}
	}
	visit(directory);
	return result;
}

function fixture(t) {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-search-stage."),
	);
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const resourceDirectory = path.join(root, "resources", "search-browser");
	const resourceCacheRoot = path.join(root, "cache");
	const resourceStagingRoot = path.join(root, "staging");
	fs.mkdirSync(resourceDirectory, { recursive: true });
	fs.writeFileSync(
		path.join(root, ".gitignore"),
		[
			"cache/",
			"staging/",
			"resources/search-browser/*",
			"!resources/search-browser/.gitkeep",
			"",
		].join("\n"),
	);
	fs.writeFileSync(path.join(resourceDirectory, ".gitkeep"), "\n");
	fs.writeFileSync(
		path.join(resourceDirectory, "previous-resource.txt"),
		"stable",
	);
	const sentinelPath = path.join(resourceDirectory, ".gitkeep");
	const sentinel = {
		sha256: digest(fs.readFileSync(sentinelPath)),
		mtimeMs: fs.statSync(sentinelPath).mtimeMs,
	};
	git(root, ["init", "--quiet"]);
	git(root, ["config", "user.name", "Search resource test"]);
	git(root, ["config", "user.email", "search-resource@example.invalid"]);
	git(root, ["add", ".gitignore", "resources/search-browser/.gitkeep"]);
	git(root, ["commit", "--quiet", "-m", "fixture"]);
	assertGitClean(root);
	return {
		root,
		resourceDirectory,
		resourceCacheRoot,
		resourceStagingRoot,
		sentinelPath,
		sentinel,
	};
}

function options(state, overrides = {}) {
	return {
		manifest: manifest(),
		platform: "darwin",
		arch: "arm64",
		resourceDirectory: state.resourceDirectory,
		resourceCacheRoot: state.resourceCacheRoot,
		resourceStagingRoot: state.resourceStagingRoot,
		allowDownload: true,
		logger: QUIET_LOGGER,
		...overrides,
	};
}

function assertSentinelUnchanged(state) {
	assert.equal(
		digest(fs.readFileSync(state.sentinelPath)),
		state.sentinel.sha256,
	);
	assert.equal(fs.statSync(state.sentinelPath).mtimeMs, state.sentinel.mtimeMs);
	if (fs.existsSync(state.resourceStagingRoot)) {
		assert.deepEqual(fs.readdirSync(state.resourceStagingRoot), []);
	}
	assertGitClean(state.root);
}

function successfulFetch(bytes = BROWSER_BYTES) {
	return async () => ({
		ok: true,
		status: 200,
		arrayBuffer: async () => bytes,
	});
}

const correctVersionProbe = () => ({
	error: undefined,
	status: 0,
	stdout: "0.3.1\n",
	stderr: "",
});

test("stages the Windows fallback without changing the tracked sentinel", async (t) => {
	const state = fixture(t);
	await stageSearchBrowserResource(
		options(state, {
			manifest: { snapshot: SNAPSHOT, platforms: {} },
			platform: "win32",
			arch: "x64",
			allowDownload: false,
		}),
	);
	assertSentinelUnchanged(state);
	assert.equal(
		JSON.parse(
			fs.readFileSync(
				path.join(state.resourceDirectory, "manifest.json"),
				"utf8",
			),
		).mode,
		"system-chromium-fallback",
	);
	assert.equal(
		fs.existsSync(path.join(state.resourceDirectory, "previous-resource.txt")),
		false,
	);
});

test("publishes a verified Darwin resource only after checksum and version pass", async (t) => {
	const state = fixture(t);
	await stageSearchBrowserResource(
		options(state, {
			fetchImpl: successfulFetch(),
			spawnImpl: correctVersionProbe,
			timeoutSignal: () => new AbortController().signal,
		}),
	);
	assertSentinelUnchanged(state);
	assert.deepEqual(
		fs.readFileSync(path.join(state.resourceDirectory, "lightpanda")),
		BROWSER_BYTES,
	);
	assert.equal(
		JSON.parse(
			fs.readFileSync(
				path.join(state.resourceDirectory, "manifest.json"),
				"utf8",
			),
		).snapshot,
		SNAPSHOT,
	);
	const cachedBinary = path.join(
		state.resourceCacheRoot,
		SNAPSHOT,
		"darwin-arm64",
		"lightpanda",
	);
	assert.deepEqual(fs.readFileSync(cachedBinary), BROWSER_BYTES);
	await stageSearchBrowserResource(
		options(state, {
			allowDownload: false,
			fetchImpl: async () => {
				throw new Error("cache hit must not fetch");
			},
			spawnImpl: correctVersionProbe,
		}),
	);
	assert.deepEqual(
		fs.readFileSync(path.join(state.resourceDirectory, "lightpanda")),
		BROWSER_BYTES,
	);
	assertSentinelUnchanged(state);
});

test("stages an explicit unavailable state without network access or Git drift", async (t) => {
	const state = fixture(t);
	await stageSearchBrowserResource(
		options(state, {
			allowDownload: false,
			fetchImpl: async () => {
				throw new Error("non-download staging must not fetch");
			},
		}),
	);
	assert.equal(
		fs.existsSync(path.join(state.resourceDirectory, "UNAVAILABLE.txt")),
		true,
	);
	assert.equal(
		fs.existsSync(path.join(state.resourceDirectory, "previous-resource.txt")),
		false,
	);
	assertSentinelUnchanged(state);
});

test("keeps the live resource snapshot on network failure", async (t) => {
	const state = fixture(t);
	const before = directorySnapshot(state.resourceDirectory);
	await assert.rejects(
		stageSearchBrowserResource(
			options(state, {
				fetchImpl: async () => {
					throw new Error("ECONNRESET");
				},
				timeoutSignal: () => new AbortController().signal,
			}),
		),
		/ECONNRESET/,
	);
	assert.deepEqual(directorySnapshot(state.resourceDirectory), before);
	assertSentinelUnchanged(state);
});

test("keeps the live resource snapshot when acquisition times out", async (t) => {
	const state = fixture(t);
	const before = directorySnapshot(state.resourceDirectory);
	await assert.rejects(
		stageSearchBrowserResource(
			options(state, {
				timeoutSignal: () => {
					const controller = new AbortController();
					setTimeout(() => {
						const error = new Error("timed out after injected 5ms");
						error.name = "TimeoutError";
						controller.abort(error);
					}, 5);
					return controller.signal;
				},
				fetchImpl: async (_url, { signal }) =>
					new Promise((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
					}),
			}),
		),
		(error) => error?.name === "TimeoutError",
	);
	assert.deepEqual(directorySnapshot(state.resourceDirectory), before);
	assertSentinelUnchanged(state);
});

test("rejects bad downloaded bytes before probing or publishing", async (t) => {
	const state = fixture(t);
	const before = directorySnapshot(state.resourceDirectory);
	let probed = false;
	await assert.rejects(
		stageSearchBrowserResource(
			options(state, {
				fetchImpl: successfulFetch(Buffer.from("tampered")),
				spawnImpl: () => {
					probed = true;
					return correctVersionProbe();
				},
				timeoutSignal: () => new AbortController().signal,
			}),
		),
		/checksum mismatch/,
	);
	assert.equal(probed, false);
	assert.deepEqual(directorySnapshot(state.resourceDirectory), before);
	assertSentinelUnchanged(state);
});

test("rejects a wrong runtime version before publishing or caching", async (t) => {
	const state = fixture(t);
	const before = directorySnapshot(state.resourceDirectory);
	await assert.rejects(
		stageSearchBrowserResource(
			options(state, {
				fetchImpl: successfulFetch(),
				spawnImpl: () => ({
					error: undefined,
					status: 0,
					stdout: "0.3.2\n",
					stderr: "",
				}),
				timeoutSignal: () => new AbortController().signal,
			}),
		),
		/version mismatch/,
	);
	assert.deepEqual(directorySnapshot(state.resourceDirectory), before);
	assert.equal(fs.existsSync(state.resourceCacheRoot), false);
	assertSentinelUnchanged(state);
});

test("clean removes generated payload and preserves the tracked sentinel", async (t) => {
	const state = fixture(t);
	await cleanSearchBrowserResource({
		resourceDirectory: state.resourceDirectory,
		resourceStagingRoot: state.resourceStagingRoot,
	});
	assert.deepEqual(fs.readdirSync(state.resourceDirectory), [".gitkeep"]);
	assertSentinelUnchanged(state);
	await cleanSearchBrowserResource({
		resourceDirectory: state.resourceDirectory,
		resourceStagingRoot: state.resourceStagingRoot,
	});
	assertSentinelUnchanged(state);
});

test("clean deterministically restores a missing search resource sentinel", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "search-resource-clean."));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const resourceDirectory = path.join(root, "resources", "search-browser");
	const resourceStagingRoot = path.join(root, "staging");
	await cleanSearchBrowserResource({
		resourceDirectory,
		resourceStagingRoot,
	});
	assert.deepEqual(fs.readdirSync(resourceDirectory), [".gitkeep"]);
	assert.equal(
		fs.readFileSync(path.join(resourceDirectory, ".gitkeep"), "utf8"),
		"\n",
	);
});
