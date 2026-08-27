import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { stageResourceDirectory } from "./resource-directory.mjs";

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "resource-directory."));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const resourceDir = path.join(root, "resources", "node");
	const stagingRoot = path.join(root, "staging");
	fs.mkdirSync(resourceDir, { recursive: true });
	fs.writeFileSync(path.join(resourceDir, ".gitkeep"), "\n");
	fs.writeFileSync(path.join(resourceDir, "old-a.txt"), "old a");
	fs.writeFileSync(path.join(resourceDir, "old-b.txt"), "old b");
	return { resourceDir, stagingRoot };
}

function injectedRename({ failPublish, failRestore = false }) {
	const fileSystem = Object.create(fs);
	fileSystem.renameSync = (source, destination) => {
		const sourceIsStage = source.includes(".stage-");
		const sourceIsBackup = source.includes(".backup-");
		if (sourceIsStage && failPublish()) {
			throw new Error("injected publish failure");
		}
		if (
			sourceIsBackup &&
			failRestore &&
			path.basename(source) === "old-b.txt"
		) {
			throw new Error("injected rollback failure");
		}
		fs.renameSync(source, destination);
	};
	return fileSystem;
}

test("restores the prior payload when publishing the staged payload fails", async (t) => {
	const state = fixture(t);
	let failed = false;
	await assert.rejects(
		stageResourceDirectory({
			...state,
			populate(candidateDir) {
				fs.writeFileSync(path.join(candidateDir, "new.txt"), "new");
			},
			fileSystem: injectedRename({
				failPublish() {
					if (failed) return false;
					failed = true;
					return true;
				},
			}),
		}),
		/injected publish failure/,
	);
	assert.deepEqual(fs.readdirSync(state.resourceDir).sort(), [
		".gitkeep",
		"old-a.txt",
		"old-b.txt",
	]);
	assert.deepEqual(fs.readdirSync(state.stagingRoot), []);
});

test("preserves recovery directories when rollback is incomplete", async (t) => {
	const state = fixture(t);
	let failed = false;
	let caught;
	try {
		await stageResourceDirectory({
			...state,
			populate(candidateDir) {
				fs.writeFileSync(path.join(candidateDir, "new.txt"), "new");
			},
			fileSystem: injectedRename({
				failPublish() {
					if (failed) return false;
					failed = true;
					return true;
				},
				failRestore: true,
			}),
		});
	} catch (error) {
		caught = error;
	}
	assert.equal(caught instanceof AggregateError, true);
	assert.match(caught.message, /recovery directories were preserved/i);
	const recoveryDirectories = fs
		.readdirSync(state.stagingRoot)
		.map((entry) => path.join(state.stagingRoot, entry));
	assert.equal(recoveryDirectories.length, 2);
	assert.equal(
		recoveryDirectories.some((directory) =>
			fs.existsSync(path.join(directory, "old-b.txt")),
		),
		true,
	);
	assert.equal(
		recoveryDirectories.some((directory) =>
			fs.existsSync(path.join(directory, "new.txt")),
		),
		true,
	);
	assert.equal(
		fs.readFileSync(path.join(state.resourceDir, "old-a.txt"), "utf8"),
		"old a",
	);
	assert.equal(fs.existsSync(path.join(state.resourceDir, ".gitkeep")), true);
});

test("retains the primary staging failure when temporary cleanup also fails", async (t) => {
	const state = fixture(t);
	const fileSystem = Object.create(fs);
	fileSystem.rmSync = (target, options) => {
		if (target.includes(".stage-")) {
			throw new Error("injected cleanup failure");
		}
		fs.rmSync(target, options);
	};
	let caught;
	try {
		await stageResourceDirectory({
			...state,
			populate() {
				throw new Error("injected acquisition failure");
			},
			fileSystem,
		});
	} catch (error) {
		caught = error;
	}
	assert.equal(caught instanceof AggregateError, true);
	assert.match(caught.message, /staging failed and cleanup also failed/i);
	assert.deepEqual(
		caught.errors.map((error) => error.message),
		["injected acquisition failure", "injected cleanup failure"],
	);
	assert.equal(caught.cause?.message, "injected acquisition failure");
	assert.equal(fs.existsSync(path.join(state.resourceDir, ".gitkeep")), true);
});
