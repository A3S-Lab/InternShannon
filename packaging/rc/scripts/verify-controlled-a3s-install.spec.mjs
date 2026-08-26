import assert from "node:assert/strict";
import test from "node:test";
import { CONTROLLED_A3S_DEPENDENCY_SPECIFIER } from "./stage-controlled-a3s-dependency.mjs";
import { validateControlledA3sDependencyAuthority } from "./verify-controlled-a3s-install.mjs";

function manifest(specifier = CONTROLLED_A3S_DEPENDENCY_SPECIFIER) {
	return { dependencies: { "@a3s-lab/code": specifier } };
}

function stableLock() {
	return [
		"specifier: file:../../vendor/a3s/selected/package",
		"version: file:vendor/a3s/selected/package",
		"'@a3s-lab/code@file:vendor/a3s/selected/package': {}",
	].join("\n");
}

test("accepts one target-neutral dependency locator for both workspace importers", () => {
	const result = validateControlledA3sDependencyAuthority({
		desktopManifest: manifest(),
		sidecarManifest: manifest(),
		lockContent: stableLock(),
	});
	assert.equal(result.ok, true);
	assert.equal(result.stableLocatorCount, 3);
});

test("rejects a manifest that bypasses deterministic staging", () => {
	const result = validateControlledA3sDependencyAuthority({
		desktopManifest: manifest("file:../../vendor/a3s/darwin-arm64/a3s.tgz"),
		sidecarManifest: manifest(),
		lockContent: stableLock(),
	});
	assert.equal(result.ok, false);
	assert.match(
		result.issues.join("\n"),
		/apps\/desktop\/package\.json must use/u,
	);
});

test("rejects a platform-specific locator in the shared lock authority", () => {
	const result = validateControlledA3sDependencyAuthority({
		desktopManifest: manifest(),
		sidecarManifest: manifest(),
		lockContent: `${stableLock()}\nfile:vendor/a3s/win32-x64/a3s.tgz\n`,
	});
	assert.equal(result.ok, false);
	assert.match(result.issues.join("\n"), /platform-specific A3S locator/u);
});
