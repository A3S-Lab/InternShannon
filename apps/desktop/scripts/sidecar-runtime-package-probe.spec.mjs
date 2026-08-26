import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	probeRuntimePackages,
	workspaceRuntimeProbeSpecifiers,
} from "./sidecar-runtime-package-probe.mjs";

function writeFile(filePath, contents) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents);
}

function makePackageFixture({ complete }) {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-runtime-probe."),
	);
	const packageDir = path.join(root, "node_modules", "@a3s-lab", "ocr");
	writeFile(
		path.join(packageDir, "package.json"),
		`${JSON.stringify({
			name: "@a3s-lab/ocr",
			main: "./dist/index.js",
			exports: {
				".": "./dist/index.js",
				"./types": "./dist/types.js",
			},
		})}\n`,
	);
	writeFile(
		path.join(packageDir, "dist", "index.js"),
		'module.exports = require("./missing-runtime-file");\n',
	);
	writeFile(
		path.join(packageDir, "dist", "types.js"),
		'module.exports = { kind: "types" };\n',
	);
	if (complete) {
		writeFile(
			path.join(packageDir, "dist", "missing-runtime-file.js"),
			'module.exports = { kind: "ocr" };\n',
		);
	}
	const anchorPath = path.join(root, "main.js");
	writeFile(anchorPath, "module.exports = {};\n");
	return { root, anchorPath };
}

test("fails when an entrypoint resolves but a runtime dependency is missing", (t) => {
	const fixture = makePackageFixture({ complete: false });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

	const report = probeRuntimePackages({
		anchorPath: fixture.anchorPath,
		specifiers: ["@a3s-lab/ocr"],
	});

	assert.equal(report.ok, false);
	assert.equal(report.results[0].specifier, "@a3s-lab/ocr");
	assert.equal(report.results[0].loaded, false);
	assert.match(report.results[0].message, /missing-runtime-file/);
});

test("loads the actual entrypoint and exported subpath in a complete package", (t) => {
	const fixture = makePackageFixture({ complete: true });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

	const report = probeRuntimePackages({
		anchorPath: fixture.anchorPath,
		specifiers: ["@a3s-lab/ocr", "@a3s-lab/ocr/types"],
	});

	assert.equal(report.ok, true);
	assert.deepEqual(
		report.results.map((result) => result.loaded),
		[true, true],
	);
});

test("adds OCR exported entrypoints when compiled JS requires OCR", () => {
	assert.deepEqual(
		workspaceRuntimeProbeSpecifiers([
			"@nestjs/common",
			"@a3s-lab/agent-planning",
			"@a3s-lab/ocr",
		]),
		[
			"@a3s-lab/agent-planning",
			"@a3s-lab/ocr",
			"@a3s-lab/ocr/defaults",
			"@a3s-lab/ocr/types",
		],
	);
});
