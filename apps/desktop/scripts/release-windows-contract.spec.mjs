import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const DESKTOP_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const REPO_ROOT = path.resolve(DESKTOP_DIR, "..", "..");
const read = (relativePath) =>
	fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
const canonicalSha256 = (relativePath) =>
	createHash("sha256")
		.update(read(relativePath).replace(/\r\n/g, "\n"))
		.digest("hex");

test("pins the Windows 0.2.3 offline NSIS release identity", () => {
	const base = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
	const windows = JSON.parse(
		read("apps/desktop/src-tauri/tauri.windows.conf.json"),
	);
	const profile = JSON.parse(read("packaging/rc/RELEASE-PROFILE.json"));
	const windowsProfile = profile.targets["windows-x64"];
	assert.equal(base.productName, "书小安");
	assert.equal(base.version, "0.2.3");
	assert.equal(base.identifier, "com.a3s.internshannon");
	assert.equal(base.app.windows[0].title, "书小安");
	assert.equal(windows.mainBinaryName, "书小安");
	assert.deepEqual(windows.bundle.windows.webviewInstallMode, {
		type: "offlineInstaller",
		silent: true,
	});
	assert.equal(windows.bundle.windows.nsis.installMode, "both");
	assert.deepEqual(windows.bundle.windows.nsis.languages, [
		"SimpChinese",
		"English",
	]);
	assert.equal(windows.bundle.windows.nsis.displayLanguageSelector, true);
	assert.equal(profile.id, "shuxiaoan-0.2.3-internal-rc");
	assert.equal(profile.scope, "windows-internal-candidate");
	assert.equal(profile.sourceTrack, "rc/0.2.3-kc3");
	assert.equal(profile.source.branch, "rc/0.2.3-kc3/source");
	assert.equal(profile.source.cleanTreeRequired, true);
	assert.equal(profile.source.identityRecordedByBuildManifest, true);
	assert.equal(profile.distribution.productName, base.productName);
	assert.equal(profile.distribution.version, base.version);
	assert.equal(profile.distribution.identifier, base.identifier);
	assert.equal(profile.distribution.signing, undefined);
	assert.equal(windowsProfile.signing.required, false);
	assert.equal(windowsProfile.signing.classification, "unsigned-internal");
	assert.equal(windowsProfile.executable, `${windows.mainBinaryName}.exe`);
	assert.equal(windowsProfile.installer, "nsis");
	assert.equal(windowsProfile.controlledA3sTarget, "win32-x64");
	assert.deepEqual(
		windowsProfile.webview2,
		windows.bundle.windows.webviewInstallMode,
	);
	assert.equal(
		windowsProfile.nsis.installMode,
		windows.bundle.windows.nsis.installMode,
	);
	assert.equal(windowsProfile.nsis.uacPolicy, "tauri-stock-highest-accepted");
	assert.equal(windowsProfile.nsis.currentUserAdminFreeGuaranteed, false);
	assert.deepEqual(
		windowsProfile.nsis.languages,
		windows.bundle.windows.nsis.languages,
	);
	assert.equal(
		windowsProfile.nsis.displayLanguageSelector,
		windows.bundle.windows.nsis.displayLanguageSelector,
	);
});

test("keeps the stable technical identity while disabling every updater surface", () => {
	const cargo = read("apps/desktop/src-tauri/Cargo.toml");
	const cargoLock = read("apps/desktop/src-tauri/Cargo.lock");
	const rust = read("apps/desktop/src-tauri/src/lib.rs");
	const tauri = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
	const profile = JSON.parse(read("packaging/rc/RELEASE-PROFILE.json"));
	const runtimeEnvironment = read("apps/web/src/lib/runtime-environment.ts");
	const desktop = read("apps/web/src/desktop/DesktopApp.tsx");
	const settings = read("apps/web/src/desktop/pages/settings/SettingsPage.tsx");
	assert.match(cargo, /name = "internShannon"/);
	assert.match(cargo, /version = "0\.2\.3"/);
	assert.doesNotMatch(cargo, /tauri-plugin-updater/);
	assert.doesNotMatch(cargoLock, /name = "tauri-plugin-updater"/);
	assert.doesNotMatch(
		rust,
		/tauri_plugin_updater|check_app_update|install_app_update/,
	);
	assert.equal(tauri.bundle.createUpdaterArtifacts, false);
	assert.deepEqual(tauri.plugins, {});
	assert.equal(profile.distribution.updater.enabled, false);
	assert.equal(profile.distribution.updater.createArtifacts, false);
	assert.doesNotMatch(desktop, /AppUpdateBootstrap/);
	assert.doesNotMatch(settings, /UpdateSection|id: "update"/);
	assert.match(runtimeEnvironment, /nativeUpdater:\s*false/);
	for (const relativePath of [
		"apps/web/src/desktop/lib/update-api.ts",
		"apps/web/src/desktop/components/app-update-bootstrap-state.ts",
		"apps/web/src/desktop/components/app-update-bootstrap-state.spec.ts",
		"apps/web/src/desktop/components/app-update-bootstrap.tsx",
		"apps/web/src/desktop/pages/settings/components/update-section.tsx",
	]) {
		assert.equal(fs.existsSync(path.join(REPO_ROOT, relativePath)), false);
	}
});

test("keeps the optional SSH CPU probe deterministic without Python", () => {
	const workspace = read("pnpm-workspace.yaml");
	assert.match(workspace, /^\s*cpu-features:\s*false\s*$/m);
});

test("keeps the existing 0.2.3 app version while pinning the release toolchain", () => {
	const workspacePackage = JSON.parse(read("package.json"));
	assert.equal(workspacePackage.version, "0.1.0");
	assert.equal(JSON.parse(read("apps/web/package.json")).version, "0.1.0");
	assert.equal(JSON.parse(read("apps/desktop/package.json")).version, "0.2.3");
	assert.equal(workspacePackage.engines.node, "22.18.0");
	assert.equal(workspacePackage.packageManager, "pnpm@11.19.0");
	assert.equal(read(".nvmrc").trim(), "22.18.0");
	assert.equal(process.versions.node, "22.18.0");
	const profile = JSON.parse(read("packaging/rc/RELEASE-PROFILE.json"));
	assert.equal(profile.toolchain.node, "22.18.0");
	assert.equal(profile.toolchain.packageManager, "pnpm@11.19.0");
	const nodeStaging = read("apps/desktop/scripts/stage-node-runtime.mjs");
	assert.match(nodeStaging, /readPinnedNodeVersion/);
	assert.doesNotMatch(nodeStaging, /resolveLatestVersion/);
	assert.doesNotMatch(
		read("apps/web/src/desktop/pages/settings/components/about-section.tsx"),
		/0\.1\.1/,
	);
	assert.match(read("apps/web/rsbuild.desktop.config.ts"), /appName.*书小安/);
});

test("publishes only verified controlled Windows A3S inputs", () => {
	const inputs = JSON.parse(read("packaging/rc/RC-INPUTS.json"));
	const profile = JSON.parse(read("packaging/rc/RELEASE-PROFILE.json"));
	const desktopPackage = JSON.parse(read("apps/desktop/package.json"));
	const sidecarPackage = JSON.parse(read("apps/sidecar/package.json"));
	const policy = JSON.parse(
		read("apps/desktop/config/controlled-a3s-package.json"),
	);
	const lock = read("pnpm-lock.yaml");
	const windowsA3s = inputs.controlledA3s.targets["win32-x64"];
	assert.equal(inputs.application.name, profile.distribution.productName);
	assert.equal(inputs.application.version, profile.distribution.version);
	assert.equal(windowsA3s.status, "verified");
	assert.equal(windowsA3s.privateReleaseVerification.status, "verified");
	assert.equal(
		windowsA3s.privateReleaseVerification.remoteRedownloadSha256,
		windowsA3s.sha256,
	);
	assert.equal(
		windowsA3s.sha256,
		"18ca8253e1711b2abc4d850250e2210a928916c18b9d73637554e0abe9e68187",
	);
	assert.equal(windowsA3s.nativeBinary, "index.win32-x64-msvc.node");
	assert.equal(
		windowsA3s.nativeBinarySha256,
		"d3f64db2c28a529b75a581ae9b2ebaabbc938b0e4e998071a87bcd004c852b77",
	);
	for (const lock of Object.values(inputs.locks)) {
		assert.equal(lock.sha256, canonicalSha256(lock.path), lock.path);
	}
	assert.equal(profile.inputs.rcInputs, "packaging/rc/RC-INPUTS.json");
	assert.equal(
		profile.inputs.controlledA3sPolicy,
		"apps/desktop/config/controlled-a3s-package.json",
	);
	assert.equal(
		inputs.controlledA3s.dependencySelection.mode,
		"deterministic-extracted-directory",
	);
	assert.equal(
		profile.platformDependencies.mode,
		"single-lock-deterministic-staging",
	);
	assert.equal(profile.platformDependencies.nativeHostRequired, true);
	assert.equal(
		profile.platformDependencies["windows-x64"],
		"PASS_FRESH_FROZEN_INSTALL_NATIVE_LOAD",
	);
	assert.equal(profile.platformDependencies.macosArm64, undefined);
	assert.equal(
		profile.platformDependencies["macos-arm64"],
		"PENDING_MAC_NATIVE_VALIDATION",
	);
	assert.equal(
		desktopPackage.dependencies["@a3s-lab/code"],
		"file:../../vendor/a3s/selected/package",
	);
	assert.equal(
		sidecarPackage.dependencies["@a3s-lab/code"],
		desktopPackage.dependencies["@a3s-lab/code"],
	);
	assert.doesNotMatch(lock, /vendor\/a3s\/(?:darwin-arm64|win32-x64)\//u);
	assert.match(
		lock,
		/resolution: \{directory: vendor\/a3s\/selected\/package, type: directory\}/u,
	);
	assert.equal(Object.keys(policy.publicFiles).length, 5);
});

test("retains the split CSP needed by the packaged WebView", () => {
	const tauri = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json"));
	assert.match(
		tauri.app.security.csp,
		/style-src 'self'; style-src-attr 'unsafe-inline'/,
	);
	assert.doesNotMatch(
		tauri.app.security.csp,
		/style-src 'self' 'unsafe-inline'/,
	);
});
