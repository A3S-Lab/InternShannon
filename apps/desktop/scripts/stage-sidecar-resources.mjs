#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(DESKTOP_DIR, "..", "..");
const API_DIST_DIR = path.join(REPO_ROOT, "apps", "sidecar", "dist");
const SIDECAR_DIR = path.join(
	DESKTOP_DIR,
	"src-tauri",
	"resources",
	"sidecar",
);
const SIDECAR_DEPLOY_CACHE_DIR = path.join(
	DESKTOP_DIR,
	".cache",
	"sidecar-deploy",
);
const MANIFEST_NAME = "sidecar-resource-manifest.json";

function parseArgs(argv) {
	const args = {
		standalone:
			process.env.INTERNSHANNON_SIDECAR_STAGE_MODE === "standalone",
	};

	for (const token of argv) {
		if (token === "--standalone") {
			args.standalone = true;
		} else if (token === "--dist-only") {
			args.standalone = false;
		} else if (token === "--help" || token === "-h") {
			args.help = true;
		} else {
			fail(`Unknown argument: ${token}`);
		}
	}

	return args;
}

function printHelp() {
	console.log(
		[
			"Usage: node scripts/stage-sidecar-resources.mjs [--dist-only|--standalone]",
			"",
			"Stages the built API sidecar into src-tauri/resources/sidecar.",
			"--dist-only copies apps/sidecar/dist only and keeps local builds network-free.",
			"--standalone uses pnpm deploy --prod --legacy with a hoisted node_modules layout.",
		].join("\n"),
	);
}

function fail(message) {
	console.error(`stage-sidecar-resources: ${message}`);
	process.exit(1);
}

function isFile(filePath) {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function walkStats(dir) {
	let files = 0;
	let bytes = 0;
	const queue = [dir];

	while (queue.length > 0) {
		const current = queue.shift();
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const absolutePath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				queue.push(absolutePath);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			files += 1;
			bytes += fs.statSync(absolutePath).size;
		}
	}

	return { files, bytes };
}

function formatBytes(value) {
	const units = ["B", "KB", "MB", "GB"];
	let amount = value;
	let unitIndex = 0;
	while (amount >= 1024 && unitIndex < units.length - 1) {
		amount /= 1024;
		unitIndex += 1;
	}
	return `${amount.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function copyIfExists(source, destination) {
	if (!fs.existsSync(source)) {
		return false;
	}
	fs.cpSync(source, destination, { recursive: true });
	return true;
}

function isSubpath(candidatePath, parentPath) {
	const relativePath = path.relative(parentPath, candidatePath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
	);
}

function toRelativeSymlinkTarget(linkPath, targetPath) {
	const relativePath = path.relative(path.dirname(linkPath), targetPath);
	return relativePath === "" ? "." : relativePath;
}

function rewritePortableNodeModuleSymlinks(nodeModulesDir, deployNodeModules) {
	const deployNodeModulesPaths = [
		path.resolve(deployNodeModules),
		fs.realpathSync(deployNodeModules),
	].filter((value, index, values) => values.indexOf(value) === index);
	const stats = {
		rewritten: 0,
		removed: 0,
		unresolved: [],
	};
	const queue = [nodeModulesDir];

	while (queue.length > 0) {
		const current = queue.shift();
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const absolutePath = path.join(current, entry.name);
			if (entry.isSymbolicLink()) {
				const target = fs.readlinkSync(absolutePath);
				if (!path.isAbsolute(target)) {
					continue;
				}

				let rewritten = false;
				for (const deployPath of deployNodeModulesPaths) {
					if (!isSubpath(target, deployPath)) {
						continue;
					}
					const relativeFromDeploy = path.relative(deployPath, target);
					const stagedTarget = path.join(nodeModulesDir, relativeFromDeploy);
					const linkType = fs.statSync(target).isDirectory() ? "dir" : "file";
					fs.unlinkSync(absolutePath);
					fs.symlinkSync(
						toRelativeSymlinkTarget(absolutePath, stagedTarget),
						absolutePath,
						linkType,
					);
					stats.rewritten += 1;
					rewritten = true;
					break;
				}
				if (rewritten) {
					continue;
				}

				const relativeLinkPath = path
					.relative(nodeModulesDir, absolutePath)
					.split(path.sep)
					.join("/");
				if (
					relativeLinkPath === ".pnpm/node_modules/@shuxiaoan/sidecar" ||
					target.endsWith("/apps/sidecar")
				) {
					fs.unlinkSync(absolutePath);
					stats.removed += 1;
					continue;
				}
				stats.unresolved.push(`${relativeLinkPath} -> ${target}`);
				continue;
			}
			if (entry.isDirectory()) {
				queue.push(absolutePath);
			}
		}
	}

	if (stats.unresolved.length > 0) {
		fail(
			[
				"Could not make deployed node_modules portable; unresolved absolute symlinks:",
				stats.unresolved.slice(0, 12).join(", "),
				stats.unresolved.length > 12 ? ", ..." : "",
			].join(" "),
		);
	}

	return stats;
}

function removePnpmRuntimeMetadata(nodeModulesDir) {
	const removed = [];
	for (const metadataName of [".modules.yaml", ".pnpm-state.json"]) {
		const metadataPath = path.join(nodeModulesDir, metadataName);
		if (!fs.existsSync(metadataPath)) {
			continue;
		}
		fs.rmSync(metadataPath, { recursive: true, force: true });
		removed.push(metadataName);
	}
	return removed;
}

function isRuntimePrunable(relativePath) {
	const normalized = relativePath.split(path.sep).join("/");
	const basename = path.basename(normalized);
	return (
		normalized.includes("/__tests__/") ||
		normalized.startsWith("__tests__/") ||
		normalized.includes("/test/") ||
		normalized.startsWith("test/") ||
		normalized === "shared/infrastructure/testing" ||
		normalized.startsWith("shared/infrastructure/testing/") ||
		basename.includes(".spec.") ||
		basename.includes(".test.")
	);
}

function pruneRuntimeArtifacts(rootDir) {
	const queue = [rootDir];
	const pruned = [];
	while (queue.length > 0) {
		const current = queue.shift();
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const absolutePath = path.join(current, entry.name);
			const relativePath = path.relative(rootDir, absolutePath);
			if (isRuntimePrunable(relativePath)) {
				fs.rmSync(absolutePath, { recursive: true, force: true });
				pruned.push(relativePath);
				continue;
			}
			if (entry.isDirectory()) {
				queue.push(absolutePath);
			}
		}
	}
	return pruned;
}

function writeManifest(metadata) {
	const stats = walkStats(SIDECAR_DIR);
	const manifest = {
		generatedAt: new Date().toISOString(),
		destination: path.relative(DESKTOP_DIR, SIDECAR_DIR),
		entrypoint: "main.js",
		files: stats.files,
		bytes: stats.bytes,
		...metadata,
	};
	fs.writeFileSync(
		path.join(SIDECAR_DIR, MANIFEST_NAME),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

	console.log(
		`Staged sidecar resources (${manifest.mode}): ${manifest.files} files, ${formatBytes(manifest.bytes)} -> ${manifest.destination}`,
	);
}

function stageDistOnly() {
	const entrypoint = path.join(API_DIST_DIR, "main.js");
	if (!isFile(entrypoint)) {
		fail(
			[
				`Missing API build output: ${entrypoint}`,
				"Run `pnpm --filter @shuxiaoan/sidecar build` before staging sidecar resources.",
			].join(" "),
		);
	}

	fs.rmSync(SIDECAR_DIR, { recursive: true, force: true });
	fs.mkdirSync(SIDECAR_DIR, { recursive: true });
	fs.cpSync(API_DIST_DIR, SIDECAR_DIR, { recursive: true });
	const prunedArtifacts = pruneRuntimeArtifacts(SIDECAR_DIR);

	writeManifest({
		mode: "dist-only",
		source: path.relative(DESKTOP_DIR, API_DIST_DIR),
		standalone: false,
		prunedArtifacts: prunedArtifacts.length,
	});
}

function runPnpmDeploy(deployDir) {
	const deployTarget = path.relative(REPO_ROOT, deployDir) || ".";
	const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const result = spawnSync(
		pnpmCommand,
		[
			"--config.verify-deps-before-run=false",
			"--filter",
			"@shuxiaoan/sidecar",
			"deploy",
			"--prod",
			"--legacy",
			"--config.node-linker=hoisted",
			deployTarget,
		],
		{
			cwd: REPO_ROOT,
			env: { ...process.env, CI: process.env.CI ?? "true" },
			shell: process.platform === "win32",
			stdio: "inherit",
		},
	);

	if (result.error) {
		fail(`Failed to execute pnpm deploy: ${result.error.message}`);
	}
	if (result.status !== 0) {
		fail(`pnpm deploy failed with exit code ${result.status}`);
	}
}

function stageStandalone() {
	fs.rmSync(SIDECAR_DEPLOY_CACHE_DIR, { recursive: true, force: true });
	fs.mkdirSync(SIDECAR_DEPLOY_CACHE_DIR, { recursive: true });
	const deployDir = fs.mkdtempSync(
		path.join(SIDECAR_DEPLOY_CACHE_DIR, "internshannon-api-deploy."),
	);
	runPnpmDeploy(deployDir);

	const deployDistDir = path.join(deployDir, "dist");
	const deployEntrypoint = path.join(deployDistDir, "main.js");
	const deployNodeModules = path.join(deployDir, "node_modules");
	if (!isFile(deployEntrypoint)) {
		fail(`Missing deployed API entrypoint: ${deployEntrypoint}`);
	}
	if (!fs.existsSync(deployNodeModules)) {
		fail(`Missing deployed API node_modules: ${deployNodeModules}`);
	}

	fs.rmSync(SIDECAR_DIR, { recursive: true, force: true });
	fs.mkdirSync(SIDECAR_DIR, { recursive: true });
	fs.cpSync(deployDistDir, SIDECAR_DIR, { recursive: true });
	const stagedNodeModules = path.join(SIDECAR_DIR, "node_modules");
	fs.cpSync(deployNodeModules, stagedNodeModules, { recursive: true });
	const symlinkStats = rewritePortableNodeModuleSymlinks(
		stagedNodeModules,
		deployNodeModules,
	);
	const removedPnpmMetadata = removePnpmRuntimeMetadata(stagedNodeModules);
	const prunedArtifacts = pruneRuntimeArtifacts(SIDECAR_DIR);

	const copiedRoots = [];
	for (const rootName of ["config", "env"]) {
		if (copyIfExists(path.join(deployDir, rootName), path.join(SIDECAR_DIR, rootName))) {
			copiedRoots.push(rootName);
		}
	}
	fs.rmSync(SIDECAR_DEPLOY_CACHE_DIR, { recursive: true, force: true });

	writeManifest({
		mode: "standalone",
		source: "pnpm deploy --prod --legacy --config.node-linker=hoisted",
		standalone: true,
		copiedRoots,
		prunedArtifacts: prunedArtifacts.length,
		portableSymlinks: symlinkStats,
		removedPnpmMetadata,
	});
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	if (args.standalone) {
		stageStandalone();
		return;
	}
	stageDistOnly();
}

main();
