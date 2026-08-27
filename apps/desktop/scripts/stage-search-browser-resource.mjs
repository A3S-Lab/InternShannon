#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	cleanResourceDirectory,
	ensureResourceSentinel,
	stageResourceDirectory,
} from "./resource-directory.mjs";
import {
	assertBrowserChecksum,
	assertBrowserVersionOutput,
	resolveBrowserManifestEntry,
	resolveSystemChromiumFallback,
	validateBrowserReleasePin,
} from "./search-browser-resource-state.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const desktopDir = path.resolve(path.dirname(SCRIPT_PATH), "..");
const manifestPath = path.resolve(
	desktopDir,
	"../sidecar/config/browser-binary.json",
);
const resourceDir = path.join(desktopDir, "src-tauri/resources/search-browser");
const cacheRoot = path.join(desktopDir, ".cache/search-browser");
const stagingRoot = path.join(desktopDir, ".cache/resource-staging");
export const DOWNLOAD_TIMEOUT_MS = 300_000;

function sourceManifest() {
	return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function browserFilename(platform) {
	return platform === "win32" ? "lightpanda.exe" : "lightpanda";
}

function persistVerifiedCache(cachePath, bytes) {
	fs.mkdirSync(path.dirname(cachePath), { recursive: true });
	const temporaryDir = fs.mkdtempSync(
		path.join(path.dirname(cachePath), ".verified-download-"),
	);
	const temporaryPath = path.join(temporaryDir, path.basename(cachePath));
	try {
		fs.writeFileSync(temporaryPath, bytes, { mode: 0o755 });
		fs.rmSync(cachePath, { force: true });
		fs.renameSync(temporaryPath, cachePath);
	} finally {
		fs.rmSync(temporaryDir, { recursive: true, force: true });
	}
}

export async function cleanSearchBrowserResource({
	resourceDirectory = resourceDir,
	resourceStagingRoot = stagingRoot,
} = {}) {
	return cleanResourceDirectory({
		resourceDir: resourceDirectory,
		stagingRoot: resourceStagingRoot,
	});
}

export async function stageSearchBrowserResource({
	manifest = sourceManifest(),
	platform = process.platform,
	arch = process.arch,
	resourceDirectory = resourceDir,
	resourceCacheRoot = cacheRoot,
	resourceStagingRoot = stagingRoot,
	allowDownload = false,
	fetchImpl = globalThis.fetch,
	timeoutSignal = () => AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	spawnImpl = spawnSync,
	logger = console,
} = {}) {
	ensureResourceSentinel(resourceDirectory);
	const entry = resolveBrowserManifestEntry(manifest, platform, arch);
	const systemChromiumFallback = entry
		? null
		: resolveSystemChromiumFallback(platform, arch);
	if (!entry && !systemChromiumFallback) {
		throw new Error(
			`No approved search browser resource policy for ${platform}-${arch}`,
		);
	}

	if (!entry) {
		const staged = await stageResourceDirectory({
			resourceDir: resourceDirectory,
			stagingRoot: resourceStagingRoot,
			populate(candidateDir) {
				fs.writeFileSync(
					path.join(candidateDir, "manifest.json"),
					`${JSON.stringify(systemChromiumFallback, null, 2)}\n`,
				);
				return systemChromiumFallback;
			},
		});
		logger.log(
			`search browser resource staged: ${systemChromiumFallback.mode} ${systemChromiumFallback.platform}`,
		);
		return staged;
	}

	validateBrowserReleasePin(entry);
	const selectedCacheDir = path.join(
		resourceCacheRoot,
		entry.snapshot,
		entry.key,
	);
	const filename = browserFilename(platform);
	const cachePath = path.join(selectedCacheDir, filename);
	let bytes = fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : null;
	if (bytes) {
		try {
			assertBrowserChecksum(bytes, entry.sha256);
		} catch {
			bytes = null;
		}
	}

	if (!bytes && !allowDownload) {
		const staged = await stageResourceDirectory({
			resourceDir: resourceDirectory,
			stagingRoot: resourceStagingRoot,
			populate(candidateDir) {
				fs.writeFileSync(
					path.join(candidateDir, "UNAVAILABLE.txt"),
					`No verified cached Lightpanda runtime for ${entry.snapshot} ${entry.key}. Run pnpm --filter @internshannon/desktop download:search-browser explicitly, or install Chrome.\n`,
				);
				return {
					mode: "unavailable",
					snapshot: entry.snapshot,
					platform: entry.key,
				};
			},
		});
		logger.log(
			`search browser resource: no verified cache for ${entry.snapshot} ${entry.key}; skipped network download during build`,
		);
		return staged;
	}

	let downloaded = false;
	if (!bytes) {
		const response = await fetchImpl(entry.url, {
			redirect: "follow",
			signal: timeoutSignal(),
		});
		if (!response.ok) {
			throw new Error(`Lightpanda download failed: HTTP ${response.status}`);
		}
		bytes = Buffer.from(await response.arrayBuffer());
		assertBrowserChecksum(bytes, entry.sha256);
		downloaded = true;
	}

	const staged = await stageResourceDirectory({
		resourceDir: resourceDirectory,
		stagingRoot: resourceStagingRoot,
		populate(candidateDir) {
			const targetPath = path.join(candidateDir, filename);
			fs.writeFileSync(targetPath, bytes, { mode: 0o755 });
			if (platform !== "win32") fs.chmodSync(targetPath, 0o755);
			const versionProbe = spawnImpl(targetPath, ["version"], {
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
			assertBrowserVersionOutput(versionProbe.stdout, entry.snapshot);
			if (downloaded) persistVerifiedCache(cachePath, bytes);
			fs.writeFileSync(
				path.join(candidateDir, "manifest.json"),
				`${JSON.stringify(
					{
						snapshot: entry.snapshot,
						platform: entry.key,
						sha256: entry.sha256,
					},
					null,
					2,
				)}\n`,
			);
			return {
				snapshot: entry.snapshot,
				platform: entry.key,
				sha256: entry.sha256,
				bytes: bytes.length,
				downloaded,
			};
		},
	});

	logger.log(
		`search browser resource staged: ${entry.snapshot} ${entry.key} (${bytes.length} bytes, SHA-256 verified)`,
	);
	return staged;
}

async function main() {
	if (process.argv.includes("--clean")) {
		await cleanSearchBrowserResource();
		console.log(
			`Reset search browser resources: ${path.relative(desktopDir, resourceDir)}`,
		);
		return;
	}
	await stageSearchBrowserResource({
		allowDownload: process.argv.includes("--download"),
	});
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
	main().catch((error) => {
		console.error(`stage-search-browser-resource: ${error.message}`);
		process.exitCode = 1;
	});
}
