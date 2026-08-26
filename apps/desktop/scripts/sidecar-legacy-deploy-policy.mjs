import fs from "node:fs";
import path from "node:path";

export const LEGACY_DEPLOY_RUNTIME_PINS = Object.freeze([
	Object.freeze({
		manifest: "apps/sidecar/package.json",
		dependency: "axios",
		expected: "1.13.6",
	}),
	Object.freeze({
		manifest: "packages/lark/package.json",
		dependency: "@larksuiteoapi/node-sdk",
		expected: "1.64.0",
	}),
]);

export function legacyDeployRuntimePinFailures({ repoRoot, pins } = {}) {
	if (!repoRoot) {
		throw new Error("repoRoot is required");
	}
	const requestedPins = pins ?? LEGACY_DEPLOY_RUNTIME_PINS;
	const manifests = new Map();
	const failures = [];

	for (const pin of requestedPins) {
		let manifest = manifests.get(pin.manifest);
		if (!manifest) {
			const manifestPath = path.join(repoRoot, pin.manifest);
			try {
				manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
				manifests.set(pin.manifest, manifest);
			} catch (error) {
				failures.push(
					`${pin.manifest}: ${error instanceof Error ? error.message : String(error)}`,
				);
				continue;
			}
		}

		const actual = manifest.dependencies?.[pin.dependency];
		if (actual !== pin.expected) {
			failures.push(
				`${pin.manifest} must pin ${pin.dependency} to ${pin.expected}; found ${actual ?? "missing"}`,
			);
		}
	}

	return failures;
}

export function assertLegacyDeployRuntimePins(options) {
	const failures = legacyDeployRuntimePinFailures(options);
	if (failures.length > 0) {
		throw new Error(
			[
				"pnpm deploy --legacy does not consume the workspace lockfile; standalone runtime dependency pins are invalid:",
				...failures,
			].join(" "),
		);
	}
}
