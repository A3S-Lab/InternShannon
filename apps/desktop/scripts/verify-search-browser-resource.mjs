#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDefaultDesktopResourcesDir } from "./desktop-bundle-paths.mjs";
import { RESOURCE_SENTINEL } from "./resource-directory.mjs";
import {
	assertBrowserChecksum,
	assertBrowserVersionOutput,
	resolveBrowserManifestEntry,
	resolveSystemChromiumFallback,
	validateBrowserReleasePin,
	validateSystemChromiumFallbackManifest,
} from "./search-browser-resource-state.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const sourceManifestPath = path.resolve(
	desktopDir,
	"../sidecar/config/browser-binary.json",
);
const forbiddenMarkers = ["UNAVAILABLE.txt", "UNSUPPORTED.txt"];

function parseArgs(argv) {
	const args = {
		resourcesDir: resolveDefaultDesktopResourcesDir(),
		platform: process.platform,
		arch: process.arch,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--dir") {
			args.resourcesDir = argv[++index];
		} else if (token === "--platform") {
			args.platform = argv[++index];
		} else if (token === "--arch") {
			args.arch = argv[++index];
		} else {
			throw new Error(`Unknown argument: ${token}`);
		}
	}
	for (const key of ["resourcesDir", "platform", "arch"]) {
		if (!args[key]) throw new Error(`Missing value for ${key}`);
	}
	args.resourcesDir = path.resolve(args.resourcesDir);
	return args;
}

function isFile(filePath) {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function assertNoForbiddenMarkers(resourceDir) {
	for (const marker of forbiddenMarkers) {
		if (fs.existsSync(path.join(resourceDir, marker))) {
			throw new Error(`search browser resource contains forbidden ${marker}`);
		}
	}
}

function inspectSystemChromiumFallback(resourceDir, platform, arch) {
	const manifestPath = path.join(resourceDir, "manifest.json");
	const sentinelPath = path.join(resourceDir, RESOURCE_SENTINEL);
	if (!isFile(manifestPath)) {
		throw new Error("system Chromium fallback is missing manifest.json");
	}
	if (!isFile(sentinelPath)) {
		throw new Error(`system Chromium fallback is missing ${RESOURCE_SENTINEL}`);
	}
	const entries = fs.readdirSync(resourceDir).sort();
	const expectedEntries = [RESOURCE_SENTINEL, "manifest.json"].sort();
	if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
		throw new Error(
			`system Chromium fallback contains conflicting resources: ${entries.join(", ")}`,
		);
	}
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	validateSystemChromiumFallbackManifest(manifest, platform, arch);
	return {
		ok: true,
		mode: manifest.mode,
		platform: manifest.platform,
		manifestPath,
		browserOrder: manifest.browserOrder,
	};
}

function inspectBundledLightpanda(resourceDir, platform, arch, sourceManifest) {
	if (platform !== process.platform || arch !== process.arch) {
		throw new Error(
			`cannot execute a ${platform}-${arch} Lightpanda verifier on ${process.platform}-${process.arch}`,
		);
	}
	const entry = validateBrowserReleasePin(
		resolveBrowserManifestEntry(sourceManifest, platform, arch),
	);
	if (!entry) {
		throw new Error(
			`Lightpanda is unsupported and no system fallback is approved for ${platform}-${arch}`,
		);
	}
	const binaryName = platform === "win32" ? "lightpanda.exe" : "lightpanda";
	const binaryPath = path.join(resourceDir, binaryName);
	const bundledManifestPath = path.join(resourceDir, "manifest.json");
	if (!isFile(binaryPath)) {
		throw new Error(`missing bundled Lightpanda binary: ${binaryPath}`);
	}
	if (!isFile(bundledManifestPath)) {
		throw new Error(
			`missing bundled Lightpanda manifest: ${bundledManifestPath}`,
		);
	}
	const bundledManifest = JSON.parse(
		fs.readFileSync(bundledManifestPath, "utf8"),
	);
	if (
		bundledManifest.snapshot !== entry.snapshot ||
		bundledManifest.platform !== entry.key ||
		bundledManifest.sha256 !== entry.sha256
	) {
		throw new Error(
			"bundled Lightpanda manifest does not match the pinned policy",
		);
	}
	assertBrowserChecksum(fs.readFileSync(binaryPath), entry.sha256);

	const versionProbe = spawnSync(binaryPath, ["version"], {
		encoding: "utf8",
		timeout: 10_000,
	});
	if (versionProbe.error) {
		throw new Error(
			`Lightpanda version probe failed: ${versionProbe.error.message}`,
		);
	}
	if (versionProbe.status !== 0) {
		throw new Error(
			`Lightpanda version probe exited with ${versionProbe.status}: ${versionProbe.stderr || versionProbe.stdout}`,
		);
	}
	const version = assertBrowserVersionOutput(
		versionProbe.stdout,
		entry.snapshot,
	);
	return {
		ok: true,
		mode: "bundled-lightpanda",
		platform: entry.key,
		version,
		sha256: entry.sha256,
		binaryPath,
		manifestPath: bundledManifestPath,
	};
}

export function inspectSearchBrowserResource({
	resourcesDir,
	platform = process.platform,
	arch = process.arch,
	sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8")),
}) {
	const resourceDir = path.join(path.resolve(resourcesDir), "search-browser");
	if (!fs.existsSync(resourceDir) || !fs.statSync(resourceDir).isDirectory()) {
		throw new Error(
			`missing search browser resource directory: ${resourceDir}`,
		);
	}
	assertNoForbiddenMarkers(resourceDir);
	const fallback = resolveSystemChromiumFallback(platform, arch);
	if (fallback) {
		return inspectSystemChromiumFallback(resourceDir, platform, arch);
	}
	return inspectBundledLightpanda(resourceDir, platform, arch, sourceManifest);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const report = inspectSearchBrowserResource(args);
	if (report.mode === "system-chromium-fallback") {
		console.log(
			`Search browser resource OK: ${report.mode} ${report.platform} (${report.browserOrder.join(" -> ")})`,
		);
		return;
	}
	console.log(
		`Bundled Lightpanda OK: ${report.version} ${report.platform} (${report.sha256})`,
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
