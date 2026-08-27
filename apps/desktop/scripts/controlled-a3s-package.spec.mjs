import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	controlledA3sTarget,
	resolveControlledA3sPackage,
	sha256File,
} from "./controlled-a3s-package.mjs";

function fixture(t, { target = controlledA3sTarget(), sha256 } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "controlled-a3s-policy."));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const packagePath = path.join(root, "a3s.tgz");
	fs.writeFileSync(packagePath, "controlled-a3s");
	const policyPath = path.join(root, "policy.json");
	fs.writeFileSync(
		policyPath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				requiredForStandalone: true,
				publicFiles: {
					"index.js": "1".repeat(64),
					"index.d.ts": "2".repeat(64),
					"generated.d.ts": "3".repeat(64),
					"extra-types.d.ts": "4".repeat(64),
					"event-protocol-v1.d.ts": "5".repeat(64),
				},
				packages: {
					[target]: {
						packagePath: "a3s.tgz",
						version: "6.6.1-local.1",
						sourceVersion: "6.6.0",
						sourceRevision: "0123456789abcdef0123456789abcdef01234567",
						sourceDirty: false,
						sourceTreeSha256: "c".repeat(64),
						sha256: sha256 ?? sha256File(packagePath),
						binary: "index.test.node",
						binarySha256: "b".repeat(64),
					},
				},
			},
			null,
			2,
		)}\n`,
	);
	return { packagePath, policyPath };
}

test("resolves the pinned controlled package for the host target", (t) => {
	const { packagePath, policyPath } = fixture(t);

	const resolved = resolveControlledA3sPackage({ policyPath });

	assert.equal(resolved.packagePath, packagePath);
	assert.equal(resolved.version, "6.6.1-local.1");
	assert.equal(resolved.sha256, sha256File(packagePath));
	assert.equal(resolved.sourceTreeSha256, "c".repeat(64));
});

test("rejects a missing host target instead of falling back to the registry", (t) => {
	const { policyPath } = fixture(t, { target: "linux-x64" });

	assert.throws(
		() => resolveControlledA3sPackage({ policyPath }),
		/no package for .*refusing to fall back/,
	);
});

test("rejects a controlled package whose bytes do not match the policy", (t) => {
	const { policyPath } = fixture(t, { sha256: "a".repeat(64) });

	assert.throws(
		() => resolveControlledA3sPackage({ policyPath }),
		/SHA-256 mismatch/,
	);
});

test("rejects a malformed controlled source tree fingerprint", (t) => {
	const { policyPath } = fixture(t);
	const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
	policy.packages[controlledA3sTarget()].sourceTreeSha256 = "not-a-sha";
	fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

	assert.throws(
		() => resolveControlledA3sPackage({ policyPath }),
		/invalid .*sourceTreeSha256/,
	);
});

test("rejects dirty or malformed source identities", (t) => {
	const { policyPath } = fixture(t);
	const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
	policy.packages[controlledA3sTarget()].sourceDirty = true;
	fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
	assert.throws(
		() => resolveControlledA3sPackage({ policyPath }),
		/sourceDirty=false/,
	);

	policy.packages[controlledA3sTarget()].sourceDirty = false;
	policy.packages[controlledA3sTarget()].sourceRevision = "not-a-revision";
	fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
	assert.throws(
		() => resolveControlledA3sPackage({ policyPath }),
		/invalid .*sourceRevision/,
	);
});
