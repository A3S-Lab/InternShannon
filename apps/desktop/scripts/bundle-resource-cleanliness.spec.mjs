import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupStagedResources } from "./build-standalone-tauri.mjs";
import { resetResourceDir, stageRuntime } from "./stage-node-runtime.mjs";
import {
	cleanSearchBrowserResource,
	stageSearchBrowserResource,
} from "./stage-search-browser-resource.mjs";

const QUIET_LOGGER = { log() {} };

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

function assertGitClean(repository, label) {
	assert.equal(
		git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]),
		"",
		`${label}: git status`,
	);
	assert.equal(
		git(repository, ["diff", "--exit-code"]),
		"",
		`${label}: git diff`,
	);
}

function fixture(t) {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-bundle-cleanliness."),
	);
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const repository = path.join(root, "repository");
	const runtimeDirectory = path.join(root, "runtime");
	const nodeDirectory = path.join(
		repository,
		"apps/desktop/src-tauri/resources/node",
	);
	const searchDirectory = path.join(
		repository,
		"apps/desktop/src-tauri/resources/search-browser",
	);
	const stagingRoot = path.join(repository, ".cache/resource-staging");
	fs.mkdirSync(nodeDirectory, { recursive: true });
	fs.mkdirSync(searchDirectory, { recursive: true });
	fs.mkdirSync(runtimeDirectory, { recursive: true });
	fs.writeFileSync(path.join(nodeDirectory, ".gitkeep"), "\n");
	fs.writeFileSync(path.join(searchDirectory, ".gitkeep"), "\n");
	fs.writeFileSync(path.join(runtimeDirectory, "node.exe"), "node fixture");
	fs.writeFileSync(
		path.join(repository, ".gitignore"),
		[
			".cache/",
			"apps/desktop/src-tauri/resources/node/*",
			"!apps/desktop/src-tauri/resources/node/.gitkeep",
			"apps/desktop/src-tauri/resources/search-browser/*",
			"!apps/desktop/src-tauri/resources/search-browser/.gitkeep",
			"",
		].join("\n"),
	);
	git(repository, ["init", "--quiet"]);
	git(repository, ["config", "user.name", "Phase 4 resource test"]);
	git(repository, ["config", "user.email", "phase4-resource@example.invalid"]);
	git(repository, ["add", ".gitignore", "apps/desktop/src-tauri/resources"]);
	git(repository, ["commit", "--quiet", "-m", "fixture"]);
	return {
		repository,
		runtimeDirectory,
		nodeDirectory,
		searchDirectory,
		stagingRoot,
		nodeSentinel: fs.readFileSync(path.join(nodeDirectory, ".gitkeep")),
		searchSentinel: fs.readFileSync(path.join(searchDirectory, ".gitkeep")),
	};
}

test("formal bundle resource staging and cleanup keep Git clean", async (t) => {
	const state = fixture(t);
	assertGitClean(state.repository, "initial");

	await stageRuntime(
		state.runtimeDirectory,
		{
			version: "v22.18.0",
			major: "22",
			platform: "win",
			arch: "x64",
			source: "https://nodejs.org/dist/v22.18.0/node-v22.18.0-win-x64.zip",
			archive: ".cache/node-runtime/node-v22.18.0-win-x64.zip",
			sha256: "a".repeat(64),
			downloaded: false,
		},
		{
			resourceDirectory: state.nodeDirectory,
			resourceStagingRoot: state.stagingRoot,
		},
	);
	await stageSearchBrowserResource({
		manifest: { snapshot: "unused", platforms: {} },
		platform: "win32",
		arch: "x64",
		resourceDirectory: state.searchDirectory,
		resourceCacheRoot: path.join(state.repository, ".cache/search-browser"),
		resourceStagingRoot: state.stagingRoot,
		logger: QUIET_LOGGER,
	});
	assertGitClean(state.repository, "after staging");

	await cleanSearchBrowserResource({
		resourceDirectory: state.searchDirectory,
		resourceStagingRoot: state.stagingRoot,
	});
	await resetResourceDir({
		resourceDirectory: state.nodeDirectory,
		resourceStagingRoot: state.stagingRoot,
	});
	assertGitClean(state.repository, "after cleanup");
	assert.deepEqual(
		fs.readFileSync(path.join(state.nodeDirectory, ".gitkeep")),
		state.nodeSentinel,
	);
	assert.deepEqual(
		fs.readFileSync(path.join(state.searchDirectory, ".gitkeep")),
		state.searchSentinel,
	);
});

test("the release wrapper attempts every enabled cleanup after a build failure", () => {
	const calls = [];
	const errors = [];
	const exitCode = cleanupStagedResources({
		exitCode: 7,
		shouldResetSourceSidecar: true,
		shouldResetSourceNodeRuntime: true,
		shouldResetSourceSearchBrowser: true,
		resetSidecar() {
			calls.push("sidecar");
			throw new Error("sidecar cleanup failed");
		},
		resetNode() {
			calls.push("node");
		},
		resetSearchBrowser() {
			calls.push("search-browser");
		},
		logError(message) {
			errors.push(message);
		},
	});
	assert.equal(exitCode, 7);
	assert.deepEqual(calls, ["sidecar", "node", "search-browser"]);
	assert.deepEqual(errors, ["build-standalone-tauri: sidecar cleanup failed"]);
});
