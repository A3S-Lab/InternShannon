#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveControlledA3sPackage } from "./controlled-a3s-package.mjs";
import { resolveDefaultDesktopResourcesDir } from "./desktop-bundle-paths.mjs";

export const EXPECTED_CODE_SDK_VERSION = "6.6.0";
export const EXPECTED_ACL_VERSION = "0.3.0";

const DEFAULT_RESOURCES_DIR = resolveDefaultDesktopResourcesDir();
const CODE_PACKAGE = "@a3s-lab/code";
const NATIVE_PACKAGE_PREFIX = "@a3s-lab/code-";
const SIDECAR_MANIFEST = "sidecar-resource-manifest.json";

function parseArgs(argv) {
	const args = {
		dir: DEFAULT_RESOURCES_DIR,
		json: false,
		requireControlled: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--dir") {
			args.dir = argv[index + 1];
			index += 1;
		} else if (token === "--json") {
			args.json = true;
		} else if (token === "--require-controlled") {
			args.requireControlled = true;
		} else if (token === "--help" || token === "-h") {
			args.help = true;
		} else {
			throw new Error(`Unknown argument: ${token}`);
		}
	}
	return args;
}

function printHelp() {
	console.log(
		[
			"Usage: node scripts/verify-sdk-runtime.mjs [--dir <path>] [--json] [--require-controlled]",
			"",
			`Asserts that a packaged app carries ${CODE_PACKAGE}@${EXPECTED_CODE_SDK_VERSION}`,
			`and that its native binding was compiled with a3s-acl@${EXPECTED_ACL_VERSION}.`,
			"--require-controlled also rejects a registry SDK and verifies the pinned local package identity.",
		].join("\n"),
	);
}

function isFile(filePath) {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function packageRelativePath(packageName) {
	return path.join(...packageName.split("/"), "package.json");
}

function candidateNodeModulesDirs(resourcesDir) {
	const resolved = path.resolve(resourcesDir);
	return [
		path.join(resolved, "node_modules"),
		path.join(resolved, "sidecar", "node_modules"),
		path.basename(resolved) === "sidecar"
			? path.join(resolved, "node_modules")
			: null,
	].filter((value, index, values) => value && values.indexOf(value) === index);
}

function findPackage(nodeModulesDirs, packageName) {
	const relativePath = packageRelativePath(packageName);
	for (const nodeModulesDir of nodeModulesDirs) {
		const packageJsonPath = path.join(nodeModulesDir, relativePath);
		if (isFile(packageJsonPath)) {
			return {
				nodeModulesDir,
				packageDir: path.dirname(packageJsonPath),
				packageJsonPath,
				manifest: readJson(packageJsonPath),
			};
		}
	}
	return null;
}

function nativePackageNames(codeManifest) {
	return Object.keys(codeManifest.optionalDependencies ?? {}).filter((name) =>
		name.startsWith(NATIVE_PACKAGE_PREFIX),
	);
}

function findNativeBinding(nodeModulesDirs, codeManifest) {
	const candidates = [];
	for (const packageName of nativePackageNames(codeManifest)) {
		const found = findPackage(nodeModulesDirs, packageName);
		if (!found) continue;
		const binaryPath = path.join(found.packageDir, found.manifest.main ?? "");
		if (!isFile(binaryPath)) continue;
		candidates.push({ packageName, binaryPath, ...found });
	}
	return candidates;
}

function findControlledLocalA3s(resourcesDir) {
	const resolved = path.resolve(resourcesDir);
	for (const manifestPath of [
		path.join(resolved, SIDECAR_MANIFEST),
		path.join(resolved, "sidecar", SIDECAR_MANIFEST),
	]) {
		if (!isFile(manifestPath)) continue;
		const controlledLocalA3s = readJson(manifestPath).controlledLocalA3s;
		if (controlledLocalA3s && typeof controlledLocalA3s === "object") {
			return { manifestPath, ...controlledLocalA3s };
		}
	}
	return null;
}

function inspectControlledLocalBinding(
	codePackage,
	controlledLocalA3s,
	issues,
) {
	const localBuild = codePackage.manifest.a3sLocalBuild;
	if (!localBuild || typeof localBuild !== "object") {
		issues.push(
			"controlled local A3S package is missing a3sLocalBuild metadata",
		);
		return [];
	}

	const expectedValues = [
		["version", codePackage.manifest.version, controlledLocalA3s.version],
		[
			"source version",
			localBuild.sourceVersion,
			controlledLocalA3s.sourceVersion,
		],
		[
			"source revision",
			localBuild.sourceRevision,
			controlledLocalA3s.sourceRevision,
		],
		[
			"source dirty state",
			localBuild.sourceDirty,
			controlledLocalA3s.sourceDirty,
		],
		[
			"source tree SHA-256",
			localBuild.sourceTreeSha256,
			controlledLocalA3s.sourceTreeSha256,
		],
		[
			"native binary SHA-256 metadata",
			localBuild.binarySha256,
			controlledLocalA3s.binarySha256,
		],
		["platform", localBuild.platform, controlledLocalA3s.platform],
		["architecture", localBuild.arch, controlledLocalA3s.arch],
	];
	for (const [label, actual, expected] of expectedValues) {
		if (actual !== expected) {
			issues.push(
				`controlled local A3S ${label} mismatch: package=${actual} manifest=${expected}`,
			);
		}
	}
	if (localBuild.sourceDirty !== false) {
		issues.push("controlled local A3S source must be clean");
	}
	if (
		localBuild.platform !== process.platform ||
		localBuild.arch !== process.arch
	) {
		issues.push(
			`controlled local A3S native target ${localBuild.platform}-${localBuild.arch} does not match ${process.platform}-${process.arch}`,
		);
	}
	if (
		typeof controlledLocalA3s.sha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(controlledLocalA3s.sha256)
	) {
		issues.push(
			"controlled local A3S manifest is missing a valid package SHA-256",
		);
	}
	if (
		typeof localBuild.binary !== "string" ||
		path.basename(localBuild.binary) !== localBuild.binary
	) {
		issues.push("controlled local A3S binary name is invalid");
		return [];
	}

	const binaryPath = path.join(codePackage.packageDir, localBuild.binary);
	if (!isFile(binaryPath)) {
		issues.push(
			`missing controlled local A3S native binary ${localBuild.binary}`,
		);
		return [];
	}
	return [
		{
			packageName: `${CODE_PACKAGE} (embedded controlled binary)`,
			binaryPath,
			packageDir: codePackage.packageDir,
			packageJsonPath: codePackage.packageJsonPath,
			manifest: codePackage.manifest,
		},
	];
}

function binaryContains(binaryPath, marker) {
	return fs.readFileSync(binaryPath).includes(Buffer.from(marker));
}

function sha256File(filePath) {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function compareControlledPolicy(controlledLocalA3s, expected, issues) {
	if (!expected) return;
	for (const [label, actual, pinned] of [
		["version", controlledLocalA3s.version, expected.version],
		[
			"source version",
			controlledLocalA3s.sourceVersion,
			expected.sourceVersion,
		],
		["package SHA-256", controlledLocalA3s.sha256, expected.sha256],
		[
			"native binary SHA-256",
			controlledLocalA3s.binarySha256,
			expected.binarySha256,
		],
		[
			"source revision",
			controlledLocalA3s.sourceRevision,
			expected.sourceRevision,
		],
		[
			"source dirty state",
			controlledLocalA3s.sourceDirty,
			expected.sourceDirty,
		],
		[
			"source tree SHA-256",
			controlledLocalA3s.sourceTreeSha256,
			expected.sourceTreeSha256,
		],
		["platform", controlledLocalA3s.platform, expected.platform],
		["architecture", controlledLocalA3s.arch, expected.arch],
	]) {
		if (actual !== pinned) {
			issues.push(
				`controlled local A3S ${label} differs from policy: package=${actual} policy=${pinned}`,
			);
		}
	}
}

export function inspectBundledSdk(resourcesDir, options = {}) {
	const nodeModulesDirs = candidateNodeModulesDirs(resourcesDir);
	const codePackage = findPackage(nodeModulesDirs, CODE_PACKAGE);
	const controlledLocalA3s = findControlledLocalA3s(resourcesDir);
	const issues = [];
	if (options.requireControlled && !controlledLocalA3s) {
		issues.push(
			"packaged runtime is missing controlledLocalA3s metadata; refusing registry SDK fallback",
		);
	}
	if (controlledLocalA3s) {
		compareControlledPolicy(
			controlledLocalA3s,
			options.expectedControlled,
			issues,
		);
	}

	if (!codePackage) {
		return {
			resourcesDir: path.resolve(resourcesDir),
			expected: {
				codeSdk: EXPECTED_CODE_SDK_VERSION,
				acl: EXPECTED_ACL_VERSION,
			},
			issues: [`missing packaged ${CODE_PACKAGE}/package.json`],
			ok: false,
		};
	}

	if (
		!controlledLocalA3s &&
		codePackage.manifest.version !== EXPECTED_CODE_SDK_VERSION
	) {
		issues.push(
			`expected ${CODE_PACKAGE}@${EXPECTED_CODE_SDK_VERSION}, found ${codePackage.manifest.version ?? "unknown"}`,
		);
	}

	const bindings = controlledLocalA3s
		? inspectControlledLocalBinding(codePackage, controlledLocalA3s, issues)
		: findNativeBinding(nodeModulesDirs, codePackage.manifest);
	if (bindings.length === 0) {
		issues.push("missing packaged @a3s-lab/code native platform binding");
	}

	const aclMarkers = [
		`a3s-acl-${EXPECTED_ACL_VERSION}/src/lexer.rs`,
		`a3s-acl-${EXPECTED_ACL_VERSION}\\src\\lexer.rs`,
	];
	const bindingReports = bindings.map((binding) => {
		const expectedBindingVersion =
			controlledLocalA3s?.version ?? EXPECTED_CODE_SDK_VERSION;
		const versionMatches = binding.manifest.version === expectedBindingVersion;
		const aclMarker =
			aclMarkers.find((candidate) =>
				binaryContains(binding.binaryPath, candidate),
			) ?? null;
		const aclMatches = aclMarker !== null;
		const binarySha256 = sha256File(binding.binaryPath);
		if (!versionMatches) {
			issues.push(
				`expected ${binding.packageName}@${expectedBindingVersion}, found ${binding.manifest.version ?? "unknown"}`,
			);
		}
		if (!aclMatches) {
			issues.push(
				`${binding.packageName} native binary does not contain compiled dependency marker ${aclMarkers.join(" or ")}`,
			);
		}
		if (
			controlledLocalA3s &&
			binarySha256 !== controlledLocalA3s.binarySha256
		) {
			issues.push(
				`${binding.packageName} native binary SHA-256 mismatch: binary=${binarySha256} manifest=${controlledLocalA3s.binarySha256 ?? "missing"}`,
			);
		}
		return {
			packageName: binding.packageName,
			packageVersion: binding.manifest.version,
			packageJsonPath: binding.packageJsonPath,
			binaryPath: binding.binaryPath,
			aclMarker: aclMarker ?? aclMarkers[0],
			aclVersion: aclMatches ? EXPECTED_ACL_VERSION : null,
			binarySha256,
		};
	});

	return {
		resourcesDir: path.resolve(resourcesDir),
		expected: { codeSdk: EXPECTED_CODE_SDK_VERSION, acl: EXPECTED_ACL_VERSION },
		codePackage: {
			name: CODE_PACKAGE,
			version: codePackage.manifest.version,
			packageJsonPath: codePackage.packageJsonPath,
		},
		controlledLocalA3s,
		nativeBindings: bindingReports,
		issues,
		ok: issues.length === 0,
	};
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	let expectedControlled;
	if (args.requireControlled) {
		expectedControlled = resolveControlledA3sPackage();
	}
	const report = inspectBundledSdk(args.dir, {
		requireControlled: args.requireControlled,
		expectedControlled,
	});
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
	} else if (report.ok) {
		console.log(
			`Packaged SDK OK: ${CODE_PACKAGE}@${report.codePackage.version}`,
		);
		for (const binding of report.nativeBindings) {
			console.log(
				`Native binding OK: ${binding.packageName}@${binding.packageVersion}, compiled a3s-acl@${binding.aclVersion}`,
			);
			console.log(`Native binary: ${binding.binaryPath}`);
		}
	} else {
		console.error("Packaged SDK validation failed:");
		for (const issue of report.issues) {
			console.error(`- ${issue}`);
		}
	}

	if (!report.ok) process.exitCode = 1;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
