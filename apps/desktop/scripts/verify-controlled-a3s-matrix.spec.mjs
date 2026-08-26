import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectControlledA3sMatrixDirectories } from "./verify-controlled-a3s-matrix.mjs";

const sourceRevision = "07707ad74785f940e6579d692d7f142c13231040";
const sourceTreeSha256 =
	"3321cde6cd7d6b7c1439f09d22d7449b501dc8200fdbbbfe09a5334f5d83fc62";
const version = "6.6.1-knowledge-complete.3";
const publicFiles = [
	"index.js",
	"index.d.ts",
	"generated.d.ts",
	"extra-types.d.ts",
	"event-protocol-v1.d.ts",
];

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function controlledBinaryName(platform, arch) {
	return platform === "win32" && arch === "x64"
		? "index.win32-x64-msvc.node"
		: `index.${platform}-${arch}.node`;
}

function makePackage(
	t,
	{
		target,
		platform,
		arch,
		sourceRevisionOverride = sourceRevision,
		binaryBytes,
	},
) {
	const packageDir = fs.mkdtempSync(
		path.join(os.tmpdir(), `internshannon-a3s-${target}.`),
	);
	t.after(() => fs.rmSync(packageDir, { recursive: true, force: true }));
	for (const filename of publicFiles) {
		fs.writeFileSync(path.join(packageDir, filename), `shared:${filename}\n`);
	}
	const binary = controlledBinaryName(platform, arch);
	const bytes = Buffer.from(binaryBytes ?? `native:${target}`);
	const binarySha256 = sha256(bytes);
	fs.writeFileSync(path.join(packageDir, binary), bytes);
	fs.writeFileSync(
		path.join(packageDir, "package.json"),
		`${JSON.stringify(
			{
				name: "@a3s-lab/code",
				version,
				a3sLocalBuild: {
					sourceVersion: "6.6.0",
					sourceRevision: sourceRevisionOverride,
					sourceDirty: false,
					sourceTreeSha256,
					platform,
					arch,
					binary,
					binarySha256,
				},
			},
			null,
			2,
		)}\n`,
	);
	return {
		packageDir,
		expected: {
			target,
			packagePath: `${target}.tgz`,
			version,
			sourceVersion: "6.6.0",
			sourceRevision: sourceRevisionOverride,
			sourceDirty: false,
			sourceTreeSha256,
			platform,
			arch,
			sha256: sha256(`package:${target}`),
			binarySha256,
		},
	};
}

function makeMatrix(t, overrides = {}) {
	return [
		makePackage(t, {
			target: "darwin-arm64",
			platform: "darwin",
			arch: "arm64",
			...overrides.darwin,
		}),
		makePackage(t, {
			target: "win32-x64",
			platform: "win32",
			arch: "x64",
			...overrides.windows,
		}),
	];
}

test("accepts same-source packages with identical public SDK bytes and distinct native binaries", (t) => {
	const report = inspectControlledA3sMatrixDirectories(makeMatrix(t));
	assert.equal(report.ok, true);
	assert.deepEqual(report.issues, []);
});

test("rejects cross-platform source identity drift", (t) => {
	const report = inspectControlledA3sMatrixDirectories(
		makeMatrix(t, {
			windows: {
				sourceRevisionOverride: "0123456789abcdef0123456789abcdef01234567",
			},
		}),
	);
	assert.equal(report.ok, false);
	assert.match(
		report.issues.join("\n"),
		/cross-platform sourceRevision mismatch/,
	);
});

test("rejects public SDK drift between platform packages", (t) => {
	const entries = makeMatrix(t);
	fs.writeFileSync(
		path.join(entries[1].packageDir, "generated.d.ts"),
		"tampered\n",
	);
	const report = inspectControlledA3sMatrixDirectories(entries);
	assert.equal(report.ok, false);
	assert.match(
		report.issues.join("\n"),
		/public SDK bytes differ: generated\.d\.ts/,
	);
});

test("rejects public SDK bytes that do not match the pinned common identity", (t) => {
	const entries = makeMatrix(t);
	for (const entry of entries) {
		entry.expected.publicFiles = Object.fromEntries(
			publicFiles.map((filename) => [filename, sha256(`shared:${filename}\n`)]),
		);
	}
	entries[1].expected.publicFiles["generated.d.ts"] = "f".repeat(64);
	const report = inspectControlledA3sMatrixDirectories(entries);
	assert.equal(report.ok, false);
	assert.match(report.issues.join("\n"), /public SDK SHA-256 mismatch/u);
});

test("rejects different dependency surfaces behind one shared lock locator", (t) => {
	const entries = makeMatrix(t);
	const manifestPath = path.join(entries[1].packageDir, "package.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	manifest.dependencies = { unexpected: "1.0.0" };
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	const report = inspectControlledA3sMatrixDirectories(entries);
	assert.equal(report.ok, false);
	assert.match(report.issues.join("\n"), /dependency surfaces differ/u);
});

test("rejects reused or foreign native binaries", (t) => {
	const entries = makeMatrix(t, {
		darwin: { binaryBytes: "same-native" },
		windows: { binaryBytes: "same-native" },
	});
	fs.writeFileSync(
		path.join(entries[1].packageDir, "index.darwin-arm64.node"),
		"foreign",
	);
	const report = inspectControlledA3sMatrixDirectories(entries);
	assert.equal(report.ok, false);
	assert.match(report.issues.join("\n"), /foreign native binaries/);
	assert.match(report.issues.join("\n"), /binary SHA-256 values must differ/);
});

test("rejects a Windows binary without the loader's MSVC ABI suffix", (t) => {
	const entries = makeMatrix(t);
	const windows = entries[1];
	const manifestPath = path.join(windows.packageDir, "package.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const expectedBytes = fs.readFileSync(
		path.join(windows.packageDir, manifest.a3sLocalBuild.binary),
	);
	manifest.a3sLocalBuild.binary = "index.win32-x64.node";
	fs.writeFileSync(
		path.join(windows.packageDir, manifest.a3sLocalBuild.binary),
		expectedBytes,
	);
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

	const report = inspectControlledA3sMatrixDirectories(entries);
	assert.equal(report.ok, false);
	assert.match(
		report.issues.join("\n"),
		/expected=index\.win32-x64-msvc\.node/,
	);
});
