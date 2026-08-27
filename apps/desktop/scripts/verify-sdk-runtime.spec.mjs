import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	EXPECTED_ACL_VERSION,
	EXPECTED_CODE_SDK_VERSION,
	inspectBundledSdk,
} from "./verify-sdk-runtime.mjs";

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture({
	aclVersion = EXPECTED_ACL_VERSION,
	sdkVersion = EXPECTED_CODE_SDK_VERSION,
} = {}) {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-sdk-runtime."),
	);
	const nodeModules = path.join(root, "sidecar", "node_modules");
	const bindingName = "@a3s-lab/code-darwin-arm64";
	writeJson(path.join(nodeModules, "@a3s-lab", "code", "package.json"), {
		name: "@a3s-lab/code",
		version: sdkVersion,
		optionalDependencies: { [bindingName]: sdkVersion },
	});
	writeJson(
		path.join(nodeModules, "@a3s-lab", "code-darwin-arm64", "package.json"),
		{
			name: bindingName,
			version: sdkVersion,
			main: "index.darwin-arm64.node",
		},
	);
	fs.writeFileSync(
		path.join(
			nodeModules,
			"@a3s-lab",
			"code-darwin-arm64",
			"index.darwin-arm64.node",
		),
		Buffer.from(
			`native-bytes:/cargo/registry/a3s-acl-${aclVersion}/src/lexer.rs:end`,
		),
	);
	return root;
}

function makeControlledLocalFixture({
	manifestVersion = "6.6.1-local.1",
	packageVersion = manifestVersion,
	markerSeparator = "/",
} = {}) {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-local-sdk-runtime."),
	);
	const codeDir = path.join(root, "node_modules", "@a3s-lab", "code");
	const binary = `index.${process.platform}-${process.arch}.node`;
	const sourceRevision = "0123456789abcdef0123456789abcdef01234567";
	const sourceTreeSha256 = "c".repeat(64);
	const nativeBytes = Buffer.from(
		`native-bytes:/cargo/registry/a3s-acl-${EXPECTED_ACL_VERSION}${markerSeparator}src${markerSeparator}lexer.rs:end`,
	);
	const binarySha256 = createHash("sha256").update(nativeBytes).digest("hex");
	writeJson(path.join(root, "sidecar-resource-manifest.json"), {
		controlledLocalA3s: {
			filename: "a3s-lab-code-6.6.1-local.1.tgz",
			version: manifestVersion,
			sourceVersion: EXPECTED_CODE_SDK_VERSION,
			sha256: "a".repeat(64),
			binarySha256,
			sourceRevision,
			sourceDirty: false,
			sourceTreeSha256,
			platform: process.platform,
			arch: process.arch,
		},
	});
	writeJson(path.join(codeDir, "package.json"), {
		name: "@a3s-lab/code",
		version: packageVersion,
		a3sLocalBuild: {
			sourceVersion: EXPECTED_CODE_SDK_VERSION,
			sourceRevision,
			sourceDirty: false,
			sourceTreeSha256,
			binarySha256,
			platform: process.platform,
			arch: process.arch,
			binary,
		},
	});
	fs.writeFileSync(path.join(codeDir, binary), nativeBytes);
	return root;
}

test("accepts the expected SDK and ACL embedded in a packaged native binary", (t) => {
	const root = makeFixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	const report = inspectBundledSdk(root);

	assert.equal(report.ok, true);
	assert.equal(report.codePackage.version, EXPECTED_CODE_SDK_VERSION);
	assert.equal(report.nativeBindings[0].aclVersion, EXPECTED_ACL_VERSION);
});

test("rejects a stale packaged native SDK even if a newer workspace dependency exists", (t) => {
	const root = makeFixture({ aclVersion: "0.2.0", sdkVersion: "4.2.1" });
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	const report = inspectBundledSdk(root);

	assert.equal(report.ok, false);
	assert.match(
		report.issues.join("\n"),
		/expected @a3s-lab\/code@6\.6\.0, found 4\.2\.1/,
	);
	assert.match(report.issues.join("\n"), /a3s-acl-0\.3\.0/);
});

test("accepts a controlled local package only when its staged metadata and embedded binary agree", (t) => {
	const root = makeControlledLocalFixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	const report = inspectBundledSdk(root);

	assert.equal(report.ok, true);
	assert.equal(report.codePackage.version, "6.6.1-local.1");
	assert.equal(report.nativeBindings[0].aclVersion, EXPECTED_ACL_VERSION);
	assert.equal(report.controlledLocalA3s.sha256, "a".repeat(64));
});

test("accepts the exact ACL marker emitted with Windows path separators", (t) => {
	const root = makeControlledLocalFixture({ markerSeparator: "\\" });
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	const report = inspectBundledSdk(root);

	assert.equal(report.ok, true);
	assert.equal(
		report.nativeBindings[0].aclMarker,
		`a3s-acl-${EXPECTED_ACL_VERSION}\\src\\lexer.rs`,
	);
});

test("rejects a controlled local package when the package version disagrees with the resource manifest", (t) => {
	const root = makeControlledLocalFixture({
		packageVersion: "6.6.1-local.tampered",
	});
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	const report = inspectBundledSdk(root);

	assert.equal(report.ok, false);
	assert.match(report.issues.join("\n"), /version mismatch/);
});

test("rejects forged controlled binary metadata", (t) => {
	const root = makeControlledLocalFixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const packagePath = path.join(
		root,
		"node_modules",
		"@a3s-lab",
		"code",
		"package.json",
	);
	const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
	manifest.a3sLocalBuild.binarySha256 = "f".repeat(64);
	writeJson(packagePath, manifest);

	const report = inspectBundledSdk(root);

	assert.equal(report.ok, false);
	assert.match(report.issues.join("\n"), /binary SHA-256 metadata mismatch/);
});

test("rejects a registry SDK when a controlled package is required", (t) => {
	const root = makeFixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	const report = inspectBundledSdk(root, { requireControlled: true });

	assert.equal(report.ok, false);
	assert.match(report.issues.join("\n"), /refusing registry SDK fallback/);
});

test("rejects a controlled package whose identity differs from the pinned policy", (t) => {
	const root = makeControlledLocalFixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	const report = inspectBundledSdk(root, {
		requireControlled: true,
		expectedControlled: {
			version: "6.6.1-local.1",
			sourceVersion: EXPECTED_CODE_SDK_VERSION,
			sha256: "c".repeat(64),
			binarySha256: reportBinarySha(root),
			sourceRevision: "0123456789abcdef0123456789abcdef01234567",
			sourceDirty: false,
			sourceTreeSha256: "c".repeat(64),
			platform: process.platform,
			arch: process.arch,
		},
	});

	assert.equal(report.ok, false);
	assert.match(report.issues.join("\n"), /package SHA-256 differs from policy/);
});

function reportBinarySha(root) {
	const binary = `index.${process.platform}-${process.arch}.node`;
	return createHash("sha256")
		.update(
			fs.readFileSync(
				path.join(root, "node_modules", "@a3s-lab", "code", binary),
			),
		)
		.digest("hex");
}
