import * as assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
	resolveNpmInvocation,
	resolvePnpmInvocation,
} from "./npm-process.mjs";

test("runs npm through the current Node executable on Windows", () => {
	const execPath = "C:\\node-v22.18.0-win-x64\\node.exe";
	const invocation = resolveNpmInvocation({ platform: "win32", execPath, isFile: () => true });
	assert.equal(invocation.command, execPath);
	assert.deepEqual(invocation.prefixArgs, [
		path.win32.join("C:\\node-v22.18.0-win-x64", "node_modules", "npm", "bin", "npm-cli.js"),
	]);
});

test("fails closed when the Windows Node distribution has no npm CLI", () => {
	assert.throws(
		() => resolveNpmInvocation({ platform: "win32", execPath: "C:\\node\\node.exe", isFile: () => false }),
		/Bundled npm CLI was not found beside Node\.js/,
	);
});

test("uses PATH npm on non-Windows hosts", () => {
	assert.deepEqual(resolveNpmInvocation({ platform: "linux" }), { command: "npm", prefixArgs: [] });
});

test("runs the active pnpm JavaScript entry point through Node on Windows", () => {
	const execPath = "C:\\node-v22.18.0-win-x64\\node.exe";
	const pnpmCli = "C:\\tools\\node_modules\\pnpm\\bin\\pnpm.cjs";
	assert.deepEqual(
		resolvePnpmInvocation({ platform: "win32", execPath, npmExecPath: pnpmCli, pathValue: "", isFile: () => true }),
		{ command: execPath, prefixArgs: [pnpmCli] },
	);
});

test("rejects a missing or foreign Windows npm_execpath for pnpm", () => {
	for (const npmExecPath of [null, "C:\\tools\\npm-cli.js"]) {
		assert.throws(
			() => resolvePnpmInvocation({ platform: "win32", npmExecPath, pathValue: "", isFile: () => true }),
			/pnpm JavaScript entry point is unavailable/,
		);
	}
});

test("finds an installed pnpm JavaScript entry point without npm_execpath", () => {
	const root = "C:\\pinned-pnpm";
	const expected = path.win32.join(root, "node_modules", "pnpm", "bin", "pnpm.cjs");
	assert.deepEqual(
		resolvePnpmInvocation({
			platform: "win32",
			execPath: "C:\\node\\node.exe",
			npmExecPath: null,
			pathValue: `C:\\unrelated;${root}`,
			isFile: (candidate) => candidate === expected,
		}),
		{ command: "C:\\node\\node.exe", prefixArgs: [expected] },
	);
});

test("uses PATH pnpm on non-Windows hosts", () => {
	assert.deepEqual(resolvePnpmInvocation({ platform: "linux" }), { command: "pnpm", prefixArgs: [] });
});
