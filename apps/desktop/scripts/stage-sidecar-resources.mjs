#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	resolveControlledA3sPackage,
	sha256File,
} from "./controlled-a3s-package.mjs";
import { assertLegacyDeployRuntimePins } from "./sidecar-legacy-deploy-policy.mjs";
import {
	formatRuntimePackageProbeFailures,
	probeRuntimePackages,
	WORKSPACE_RUNTIME_PACKAGES,
} from "./sidecar-runtime-package-probe.mjs";
import {
	resolveNpmInvocation,
	resolvePnpmInvocation,
} from "./npm-process.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(DESKTOP_DIR, "..", "..");
const API_DIST_DIR = path.join(REPO_ROOT, "apps", "sidecar", "dist");
const SIDECAR_DIR = path.join(DESKTOP_DIR, "src-tauri", "resources", "sidecar");
const SIDECAR_DEPLOY_CACHE_DIR = path.join(
	DESKTOP_DIR,
	".cache",
	"sidecar-deploy",
);
const MANIFEST_NAME = "sidecar-resource-manifest.json";
const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org/";

function parseArgs(argv) {
	const args = {
		standalone: process.env.INTERNSHANNON_SIDECAR_STAGE_MODE === "standalone",
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
			"Standalone staging requires the package pinned by config/controlled-a3s-package.json.",
			"INTERNSHANNON_LOCAL_A3S_PACKAGE may override its location, but never its pinned identity.",
			"INTERNSHANNON_VALIDATED_SIDECAR_DIR may reuse a previously verified standalone runtime when the build host is offline.",
		].join("\n"),
	);
}

function fail(message) {
	throw new Error(`stage-sidecar-resources: ${message}`);
}

function prepareWorkspaceRuntimePackages() {
	const pnpmInvocation = resolvePnpmInvocation();
	const result = spawnSync(
		pnpmInvocation.command,
		[
			...pnpmInvocation.prefixArgs,
			"--config.verify-deps-before-run=false",
			"--filter",
			"@internshannon/sidecar",
			"run",
			"prepare:workspace",
		],
		{
			cwd: REPO_ROOT,
			env: { ...process.env, CI: process.env.CI ?? "true" },
			stdio: "inherit",
		},
	);
	if (result.error) {
		fail(
			`Could not prepare workspace runtime packages: ${result.error.message}`,
		);
	}
	if (result.status !== 0) {
		fail(
			`Workspace runtime package preparation failed with exit code ${result.status}`,
		);
	}

	assertRuntimePackagesLoad(
		path.join(REPO_ROOT, "apps", "sidecar", "package.json"),
		"prepared workspace",
	);
}

function assertRuntimePackagesLoad(anchorPath, label) {
	const report = probeRuntimePackages({
		anchorPath,
		specifiers: WORKSPACE_RUNTIME_PACKAGES,
	});
	if (!report.ok) {
		fail(
			[
				`${label} runtime package load probe failed:`,
				...formatRuntimePackageProbeFailures(report),
			].join(" "),
		);
	}
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
					relativeLinkPath === ".pnpm/node_modules/@internshannon/sidecar" ||
					/[\\/]apps[\\/]sidecar$/u.test(target)
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
				"Run `pnpm --filter @internshannon/sidecar build` before staging sidecar resources.",
			].join(" "),
		);
	}

	fs.rmSync(SIDECAR_DIR, { recursive: true, force: true });
	fs.mkdirSync(SIDECAR_DIR, { recursive: true });
	fs.cpSync(API_DIST_DIR, SIDECAR_DIR, { recursive: true });
	const prunedArtifacts = pruneRuntimeArtifacts(SIDECAR_DIR);
	assertRuntimePackagesLoad(
		path.join(SIDECAR_DIR, "main.js"),
		"staged dist-only sidecar",
	);

	writeManifest({
		mode: "dist-only",
		source: path.relative(DESKTOP_DIR, API_DIST_DIR),
		standalone: false,
		prunedArtifacts: prunedArtifacts.length,
	});
}

function runPnpmDeploy(deployDir) {
	const deployTarget = path.relative(REPO_ROOT, deployDir) || ".";
	const pnpmInvocation = resolvePnpmInvocation();
	const registry =
		process.env.INTERNSHANNON_NPM_REGISTRY?.trim() || DEFAULT_NPM_REGISTRY;
	const result = spawnSync(
		pnpmInvocation.command,
		[
			...pnpmInvocation.prefixArgs,
			"--config.verify-deps-before-run=false",
			`--config.registry=${registry}`,
			"--filter",
			"@internshannon/sidecar",
			"deploy",
			"--prod",
			"--legacy",
			"--config.node-linker=hoisted",
			deployTarget,
		],
		{
			cwd: REPO_ROOT,
			env: { ...process.env, CI: process.env.CI ?? "true" },
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

function controlledPackageMetadata(controlledPackage) {
	return {
		filename: path.basename(controlledPackage.packagePath),
		version: controlledPackage.version,
		sourceVersion: controlledPackage.sourceVersion,
		sha256: controlledPackage.sha256,
		binarySha256: controlledPackage.binarySha256,
		sourceRevision: controlledPackage.sourceRevision,
		sourceDirty: controlledPackage.sourceDirty,
		sourceTreeSha256: controlledPackage.sourceTreeSha256,
		platform: controlledPackage.platform,
		arch: controlledPackage.arch,
		policyTarget: controlledPackage.target,
		policyFile: path.relative(REPO_ROOT, controlledPackage.policyPath),
	};
}

function assertValidatedStandaloneCache(cacheDir, controlledPackage) {
	if (!fs.existsSync(cacheDir) || !fs.statSync(cacheDir).isDirectory()) {
		fail(`Validated standalone cache is missing: ${cacheDir}`);
	}
	if (isSubpath(cacheDir, SIDECAR_DIR) || isSubpath(SIDECAR_DIR, cacheDir)) {
		fail("Validated standalone cache must be outside src-tauri/resources/sidecar");
	}

	const entrypoint = path.join(cacheDir, "main.js");
	const nodeModules = path.join(cacheDir, "node_modules");
	const manifestPath = path.join(cacheDir, MANIFEST_NAME);
	if (!isFile(entrypoint) || !fs.existsSync(nodeModules) || !isFile(manifestPath)) {
		fail("Validated standalone cache is missing main.js, node_modules, or its resource manifest");
	}

	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (error) {
		fail(`Could not read validated standalone cache manifest: ${error.message}`);
	}
	if (manifest.mode !== "standalone" || manifest.standalone !== true) {
		fail("Validated standalone cache manifest is not a standalone runtime");
	}

	const expected = controlledPackageMetadata(controlledPackage);
	for (const [key, value] of Object.entries(expected)) {
		if (manifest.controlledLocalA3s?.[key] !== value) {
			fail(`Validated standalone cache controlled A3S mismatch for ${key}`);
		}
	}

	const installedPackage = path.join(nodeModules, "@a3s-lab", "code");
	const packageManifestPath = path.join(installedPackage, "package.json");
	if (!isFile(packageManifestPath)) {
		fail("Validated standalone cache is missing @a3s-lab/code");
	}
	const packageManifest = JSON.parse(fs.readFileSync(packageManifestPath, "utf8"));
	const localBuild = packageManifest.a3sLocalBuild;
	const nativeBinary = localBuild?.binary
		? path.join(installedPackage, localBuild.binary)
		: "";
	if (
		packageManifest.name !== "@a3s-lab/code" ||
		packageManifest.version !== expected.version ||
		!localBuild ||
		localBuild.sourceVersion !== expected.sourceVersion ||
		localBuild.sourceRevision !== expected.sourceRevision ||
		localBuild.sourceDirty !== expected.sourceDirty ||
		localBuild.sourceTreeSha256 !== expected.sourceTreeSha256 ||
		localBuild.binarySha256 !== expected.binarySha256 ||
		localBuild.platform !== expected.platform ||
		localBuild.arch !== expected.arch ||
		!isFile(nativeBinary) ||
		sha256File(nativeBinary) !== expected.binarySha256
	) {
		fail("Validated standalone cache controlled A3S package does not match the pinned policy");
	}

	assertRuntimePackagesLoad(entrypoint, "validated standalone cache");
	return {
		controlledLocalA3s: expected,
		manifestSha256: sha256File(manifestPath),
	};
}

function stageValidatedStandaloneCache(cacheDir, controlledPackage) {
	const validation = assertValidatedStandaloneCache(cacheDir, controlledPackage);
	fs.rmSync(SIDECAR_DIR, { recursive: true, force: true });
	fs.mkdirSync(SIDECAR_DIR, { recursive: true });
	fs.cpSync(cacheDir, SIDECAR_DIR, { recursive: true });
	fs.rmSync(path.join(SIDECAR_DIR, MANIFEST_NAME), { force: true });

	const stagedNodeModules = path.join(SIDECAR_DIR, "node_modules");
	const symlinkStats = rewritePortableNodeModuleSymlinks(
		stagedNodeModules,
		path.join(cacheDir, "node_modules"),
	);
	const removedPnpmMetadata = removePnpmRuntimeMetadata(stagedNodeModules);
	const prunedArtifacts = pruneRuntimeArtifacts(SIDECAR_DIR);
	assertRuntimePackagesLoad(
		path.join(SIDECAR_DIR, "main.js"),
		"reused standalone sidecar",
	);

	writeManifest({
		mode: "standalone",
		source: "validated standalone cache",
		standalone: true,
		copiedRoots: ["config", "env"].filter((name) =>
			fs.existsSync(path.join(SIDECAR_DIR, name)),
		),
		prunedArtifacts: prunedArtifacts.length,
		portableSymlinks: symlinkStats,
		removedPnpmMetadata,
		controlledLocalA3s: validation.controlledLocalA3s,
		reusedManifestSha256: validation.manifestSha256,
	});
}

function stageControlledLocalA3sPackage(stagedNodeModules, controlledPackage) {
	const { packagePath } = controlledPackage;

	const installRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-local-a3s."),
	);
	try {
		let npmInvocation;
		try {
			npmInvocation = resolveNpmInvocation();
		} catch (error) {
			fail(error instanceof Error ? error.message : String(error));
		}
		const result = spawnSync(
			npmInvocation.command,
			[
				...npmInvocation.prefixArgs,
				"install",
				"--ignore-scripts",
				"--omit=optional",
				"--no-audit",
				"--no-fund",
				"--no-save",
				"--prefix",
				installRoot,
				packagePath,
			],
			{ encoding: "utf8", stdio: "pipe" },
		);
		if (result.error) {
			fail(
				`Could not install controlled local A3S package: ${result.error.message}`,
			);
		}
		if (result.status !== 0) {
			fail(
				`Could not install controlled local A3S package: ${result.stderr || result.stdout}`,
			);
		}

		const installedPackage = path.join(
			installRoot,
			"node_modules",
			"@a3s-lab",
			"code",
		);
		const manifestPath = path.join(installedPackage, "package.json");
		if (!isFile(manifestPath)) {
			fail("Controlled local A3S package did not install @a3s-lab/code");
		}
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		const localBuild = manifest.a3sLocalBuild;
		const nativeBinary = localBuild?.binary
			? path.join(installedPackage, localBuild.binary)
			: "";
		if (
			manifest.name !== "@a3s-lab/code" ||
			!localBuild ||
			manifest.version !== controlledPackage.version ||
			localBuild.sourceVersion !== controlledPackage.sourceVersion ||
			localBuild.sourceRevision !== controlledPackage.sourceRevision ||
			localBuild.sourceDirty !== controlledPackage.sourceDirty ||
			localBuild.sourceTreeSha256 !== controlledPackage.sourceTreeSha256 ||
			localBuild.binarySha256 !== controlledPackage.binarySha256 ||
			localBuild.platform !== controlledPackage.platform ||
			localBuild.arch !== controlledPackage.arch ||
			!isFile(nativeBinary)
		) {
			fail(
				"Controlled local A3S package metadata does not match the pinned package policy",
			);
		}
		const binarySha256 = sha256File(nativeBinary);
		if (binarySha256 !== controlledPackage.binarySha256) {
			fail(
				`Controlled local A3S native binary SHA-256 mismatch: expected=${controlledPackage.binarySha256} actual=${binarySha256}`,
			);
		}

		const destination = path.join(stagedNodeModules, "@a3s-lab", "code");
		fs.rmSync(destination, { recursive: true, force: true });
		fs.mkdirSync(path.dirname(destination), { recursive: true });
		fs.cpSync(installedPackage, destination, { recursive: true });
		return {
			filename: path.basename(packagePath),
			version: manifest.version,
			sourceVersion: localBuild.sourceVersion,
			sha256: controlledPackage.sha256,
			binarySha256,
			sourceRevision: localBuild.sourceRevision,
			sourceDirty: localBuild.sourceDirty,
			sourceTreeSha256: localBuild.sourceTreeSha256,
			platform: localBuild.platform,
			arch: localBuild.arch,
			policyTarget: controlledPackage.target,
			policyFile: path.relative(REPO_ROOT, controlledPackage.policyPath),
		};
	} finally {
		fs.rmSync(installRoot, { recursive: true, force: true });
	}
}

function stageStandalone() {
	try {
		assertLegacyDeployRuntimePins({ repoRoot: REPO_ROOT });
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}
	let controlledPackage;
	try {
		controlledPackage = resolveControlledA3sPackage();
	} catch (error) {
		fail(error.message);
	}
	const validatedCacheValue =
		process.env.INTERNSHANNON_VALIDATED_SIDECAR_DIR?.trim();
	if (validatedCacheValue) {
		const validatedCacheDir = path.isAbsolute(validatedCacheValue)
			? path.resolve(validatedCacheValue)
			: path.resolve(REPO_ROOT, validatedCacheValue);
		stageValidatedStandaloneCache(validatedCacheDir, controlledPackage);
		return;
	}
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
	const controlledLocalA3s = stageControlledLocalA3sPackage(
		stagedNodeModules,
		controlledPackage,
	);
	const symlinkStats = rewritePortableNodeModuleSymlinks(
		stagedNodeModules,
		deployNodeModules,
	);
	const removedPnpmMetadata = removePnpmRuntimeMetadata(stagedNodeModules);
	const prunedArtifacts = pruneRuntimeArtifacts(SIDECAR_DIR);
	assertRuntimePackagesLoad(
		path.join(SIDECAR_DIR, "main.js"),
		"staged standalone sidecar",
	);

	const copiedRoots = [];
	for (const rootName of ["config", "env"]) {
		if (
			copyIfExists(
				path.join(deployDir, rootName),
				path.join(SIDECAR_DIR, rootName),
			)
		) {
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
		controlledLocalA3s,
	});
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	if (args.standalone) {
		if (!process.env.INTERNSHANNON_VALIDATED_SIDECAR_DIR?.trim()) {
			prepareWorkspaceRuntimePackages();
		}
		stageStandalone();
		return;
	}
	if (process.env.INTERNSHANNON_LOCAL_A3S_PACKAGE?.trim()) {
		fail(
			"INTERNSHANNON_LOCAL_A3S_PACKAGE requires --standalone (or INTERNSHANNON_SIDECAR_STAGE_MODE=standalone)",
		);
	}
	prepareWorkspaceRuntimePackages();
	stageDistOnly();
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
