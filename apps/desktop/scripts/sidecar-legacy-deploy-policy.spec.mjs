import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	assertLegacyDeployRuntimePins,
	legacyDeployRuntimePinFailures,
} from "./sidecar-legacy-deploy-policy.mjs";

function withFixture(manifests, callback) {
	const repoRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-deploy-policy."),
	);
	try {
		for (const [relativePath, manifest] of Object.entries(manifests)) {
			const manifestPath = path.join(repoRoot, relativePath);
			fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
			fs.writeFileSync(manifestPath, JSON.stringify(manifest));
		}
		callback(repoRoot);
	} finally {
		fs.rmSync(repoRoot, { recursive: true, force: true });
	}
}

const exactManifests = {
	"apps/sidecar/package.json": {
		dependencies: { axios: "1.13.6" },
	},
	"packages/lark/package.json": {
		dependencies: { "@larksuiteoapi/node-sdk": "1.64.0" },
	},
};

test("accepts the tested standalone dependency versions", () => {
	withFixture(exactManifests, (repoRoot) => {
		assert.deepEqual(legacyDeployRuntimePinFailures({ repoRoot }), []);
		assert.doesNotThrow(() => assertLegacyDeployRuntimePins({ repoRoot }));
	});
});

test("rejects semver ranges that can drift when legacy deploy ignores the lockfile", () => {
	withFixture(
		{
			...exactManifests,
			"apps/sidecar/package.json": {
				dependencies: { axios: "^1.7.0" },
			},
			"packages/lark/package.json": {
				dependencies: { "@larksuiteoapi/node-sdk": "^1.64.0" },
			},
		},
		(repoRoot) => {
			assert.throws(
				() => assertLegacyDeployRuntimePins({ repoRoot }),
				(error) => {
					assert.match(
						error.message,
						/does not consume the workspace lockfile/,
					);
					assert.match(error.message, /axios to 1\.13\.6; found \^1\.7\.0/);
					assert.match(error.message, /node-sdk to 1\.64\.0; found \^1\.64\.0/);
					return true;
				},
			);
		},
	);
});

test("reports missing manifests without masking the policy failure", () => {
	withFixture({}, (repoRoot) => {
		const failures = legacyDeployRuntimePinFailures({ repoRoot });
		assert.equal(failures.length, 2);
		assert.match(failures[0], /apps\/sidecar\/package\.json/);
		assert.match(failures[1], /packages\/lark\/package\.json/);
	});
});
