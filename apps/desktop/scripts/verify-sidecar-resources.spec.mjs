import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"verify-sidecar-resources.mjs",
);

function writeFile(filePath, contents) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents);
}

function makeStandaloneFixture() {
	const resourcesDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-sidecar-verifier."),
	);
	const sidecarDir = path.join(resourcesDir, "sidecar");
	writeFile(path.join(sidecarDir, "main.js"), 'require("@a3s-lab/ocr");\n');
	for (const required of [
		"intern-shannon-sidecar.module.js",
		"shared/infrastructure/config/load-env.js",
	]) {
		writeFile(path.join(sidecarDir, required), "module.exports = {};\n");
	}
	const packageDir = path.join(sidecarDir, "node_modules", "@a3s-lab", "ocr");
	writeFile(
		path.join(packageDir, "package.json"),
		`${JSON.stringify({
			name: "@a3s-lab/ocr",
			main: "./dist/index.js",
			exports: {
				".": "./dist/index.js",
				"./defaults": "./dist/defaults.js",
				"./types": "./dist/types.js",
			},
		})}\n`,
	);
	writeFile(
		path.join(packageDir, "dist", "index.js"),
		'module.exports = require("./missing-after-interruption");\n',
	);
	writeFile(
		path.join(packageDir, "dist", "defaults.js"),
		"module.exports = {};\n",
	);
	writeFile(
		path.join(packageDir, "dist", "types.js"),
		"module.exports = {};\n",
	);
	const bundledNode = path.join(resourcesDir, "node", "bin", "node");
	fs.mkdirSync(path.dirname(bundledNode), { recursive: true });
	fs.symlinkSync(process.execPath, bundledNode);
	return resourcesDir;
}

test("rejects a standalone workspace package whose entrypoint only resolves", (t) => {
	const resourcesDir = makeStandaloneFixture();
	t.after(() => fs.rmSync(resourcesDir, { recursive: true, force: true }));

	const result = spawnSync(
		process.execPath,
		[SCRIPT_PATH, "--dir", resourcesDir, "--require-standalone", "--json"],
		{ encoding: "utf8" },
	);

	assert.equal(result.status, 1);
	const report = JSON.parse(result.stdout);
	assert.equal(report.ok, false);
	assert.match(
		report.issues.join("\n"),
		/resolve but cannot be loaded at runtime/,
	);
	assert.match(report.issues.join("\n"), /missing-after-interruption/);
});
