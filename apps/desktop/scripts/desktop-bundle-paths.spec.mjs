import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveDefaultDesktopResourcesDir } from "./desktop-bundle-paths.mjs";

function packagedResources(root, target, appName = "InternShannon.app") {
	const resources = path.join(
		root,
		"src-tauri",
		"target",
		...(target ? [target] : []),
		"release",
		"bundle",
		"macos",
		appName,
		"Contents",
		"Resources",
	);
	fs.mkdirSync(path.join(resources, "sidecar"), { recursive: true });
	fs.writeFileSync(
		path.join(resources, "sidecar", "main.js"),
		"// packaged sidecar\n",
	);
	return resources;
}

test("uses an explicit bundle resources override", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-bundle-paths."));
	try {
		assert.equal(
			resolveDefaultDesktopResourcesDir({
				desktopDir: root,
				env: { INTERNSHANNON_BUNDLE_RESOURCES_DIR: "custom/Resources" },
			}),
			path.join(root, "custom", "Resources"),
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("chooses the newest real target bundle instead of the obsolete fixed path", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-bundle-paths."));
	try {
		packagedResources(root, undefined, "internShannon.app");
		await new Promise((resolve) => setTimeout(resolve, 10));
		const arm64 = packagedResources(root, "aarch64-apple-darwin");
		assert.equal(
			resolveDefaultDesktopResourcesDir({ desktopDir: root, env: {} }),
			arm64,
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
