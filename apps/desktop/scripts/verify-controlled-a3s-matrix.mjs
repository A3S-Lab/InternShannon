#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_CONTROLLED_A3S_POLICY_PATH,
	resolveControlledA3sPackage,
} from "./controlled-a3s-package.mjs";
import { resolveNpmInvocation } from "./npm-process.mjs";

export const CONTROLLED_A3S_PUBLIC_FILES = [
	"index.js",
	"index.d.ts",
	"generated.d.ts",
	"extra-types.d.ts",
	"event-protocol-v1.d.ts",
];
const TARGETS = [
	{ key: "darwin-arm64", platform: "darwin", arch: "arm64" },
	{ key: "win32-x64", platform: "win32", arch: "x64" },
];
const CONTROLLED_NATIVE_BINARIES = Object.freeze({
	"darwin-arm64": "index.darwin-arm64.node",
	"win32-x64": "index.win32-x64-msvc.node",
});

function sha256File(filePath) {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isFile(filePath) {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

export function inspectControlledA3sPackageDirectory(packageDir, expected) {
	const issues = [];
	const manifestPath = path.join(packageDir, "package.json");
	if (!isFile(manifestPath)) {
		return {
			target: expected.target,
			packageDir,
			issues: ["missing package.json"],
			ok: false,
		};
	}
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const localBuild = manifest.a3sLocalBuild;
	if (manifest.name !== "@a3s-lab/code") {
		issues.push(`unexpected package name ${manifest.name ?? "missing"}`);
	}
	if (!localBuild || typeof localBuild !== "object") {
		issues.push("missing a3sLocalBuild metadata");
	}
	for (const [label, actual, pinned] of [
		["version", manifest.version, expected.version],
		["source version", localBuild?.sourceVersion, expected.sourceVersion],
		["source revision", localBuild?.sourceRevision, expected.sourceRevision],
		["source dirty state", localBuild?.sourceDirty, false],
		[
			"source tree SHA-256",
			localBuild?.sourceTreeSha256,
			expected.sourceTreeSha256,
		],
		["platform", localBuild?.platform, expected.platform],
		["architecture", localBuild?.arch, expected.arch],
		[
			"binary SHA-256 metadata",
			localBuild?.binarySha256,
			expected.binarySha256,
		],
	]) {
		if (actual !== pinned) {
			issues.push(`${label} mismatch: package=${actual} policy=${pinned}`);
		}
	}
	if (
		typeof localBuild?.binary !== "string" ||
		path.basename(localBuild.binary) !== localBuild.binary
	) {
		issues.push("invalid native binary name");
	}
	const expectedBinary =
		expected.binary ?? CONTROLLED_NATIVE_BINARIES[expected.target];
	if (!expectedBinary) {
		issues.push(`unsupported controlled native target ${expected.target}`);
	}
	if (localBuild?.binary !== expectedBinary) {
		issues.push(
			`native binary name mismatch: package=${localBuild?.binary} expected=${expectedBinary}`,
		);
	}
	const binaryPath = localBuild?.binary
		? path.join(packageDir, localBuild.binary)
		: "";
	const binarySha256 = isFile(binaryPath) ? sha256File(binaryPath) : null;
	if (!binarySha256) {
		issues.push(`missing native binary ${localBuild?.binary ?? "unknown"}`);
	} else if (binarySha256 !== expected.binarySha256) {
		issues.push(
			`native binary SHA-256 mismatch: binary=${binarySha256} policy=${expected.binarySha256}`,
		);
	}
	const publicFiles = {};
	for (const filename of CONTROLLED_A3S_PUBLIC_FILES) {
		const filePath = path.join(packageDir, filename);
		if (!isFile(filePath)) {
			issues.push(`missing public SDK file ${filename}`);
			continue;
		}
		publicFiles[filename] = sha256File(filePath);
		if (
			expected.publicFiles?.[filename] &&
			publicFiles[filename] !== expected.publicFiles[filename]
		) {
			issues.push(
				`public SDK SHA-256 mismatch for ${filename}: package=${publicFiles[filename]} policy=${expected.publicFiles[filename]}`,
			);
		}
	}
	const unexpectedNative = fs
		.readdirSync(packageDir)
		.filter(
			(filename) =>
				/^index\..+\.node$/.test(filename) && filename !== expectedBinary,
		);
	if (unexpectedNative.length > 0) {
		issues.push(
			`package contains foreign native binaries: ${unexpectedNative.join(", ")}`,
		);
	}
	return {
		target: expected.target,
		packageDir,
		packagePath: expected.packagePath,
		packageSha256: expected.sha256,
		manifest,
		localBuild,
		binaryPath,
		binarySha256,
		publicFiles,
		dependencySurface: Object.fromEntries(
			[
				"dependencies",
				"optionalDependencies",
				"peerDependencies",
				"peerDependenciesMeta",
				"engines",
				"os",
				"cpu",
			].map((key) => [key, manifest[key] ?? null]),
		),
		foreignNative: unexpectedNative,
		issues,
		ok: issues.length === 0,
	};
}

export function compareControlledA3sMatrix(packageReports) {
	const issues = packageReports.flatMap((report) =>
		report.issues.map((issue) => `${report.target}: ${issue}`),
	);
	const byTarget = Object.fromEntries(
		packageReports.map((report) => [report.target, report]),
	);
	const darwin = byTarget["darwin-arm64"];
	const windows = byTarget["win32-x64"];
	if (!darwin || !windows) {
		issues.push("matrix requires darwin-arm64 and win32-x64 packages");
	} else {
		for (const [label, left, right] of [
			["version", darwin.manifest?.version, windows.manifest?.version],
			[
				"sourceVersion",
				darwin.localBuild?.sourceVersion,
				windows.localBuild?.sourceVersion,
			],
			[
				"sourceRevision",
				darwin.localBuild?.sourceRevision,
				windows.localBuild?.sourceRevision,
			],
			[
				"sourceDirty",
				darwin.localBuild?.sourceDirty,
				windows.localBuild?.sourceDirty,
			],
			[
				"sourceTreeSha256",
				darwin.localBuild?.sourceTreeSha256,
				windows.localBuild?.sourceTreeSha256,
			],
		]) {
			if (left !== right) {
				issues.push(
					`cross-platform ${label} mismatch: darwin=${left} win32=${right}`,
				);
			}
		}
		for (const filename of CONTROLLED_A3S_PUBLIC_FILES) {
			if (darwin.publicFiles[filename] !== windows.publicFiles[filename]) {
				issues.push(`cross-platform public SDK bytes differ: ${filename}`);
			}
		}
		if (
			JSON.stringify(darwin.dependencySurface) !==
			JSON.stringify(windows.dependencySurface)
		) {
			issues.push("cross-platform package dependency surfaces differ");
		}
		if (darwin.binarySha256 === windows.binarySha256) {
			issues.push("platform native binary SHA-256 values must differ");
		}
		if (darwin.packageSha256 === windows.packageSha256) {
			issues.push("platform package SHA-256 values must differ");
		}
	}
	return {
		ok: issues.length === 0,
		issues,
		packages: byTarget,
		publicFiles: CONTROLLED_A3S_PUBLIC_FILES,
	};
}

export function inspectControlledA3sMatrixDirectories(entries) {
	return compareControlledA3sMatrix(
		entries.map(({ packageDir, expected }) =>
			inspectControlledA3sPackageDirectory(packageDir, expected),
		),
	);
}

function installPackage(packagePath, installRoot) {
	const npmInvocation = resolveNpmInvocation();
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
		{
			encoding: "utf8",
		},
	);
	if (result.error || result.status !== 0) {
		throw new Error(
			`could not install controlled package ${packagePath}: ${result.error?.message ?? result.stderr ?? result.stdout}`,
		);
	}
	return path.join(installRoot, "node_modules", "@a3s-lab", "code");
}

export function inspectControlledA3sPolicyMatrix(
	policyPath = DEFAULT_CONTROLLED_A3S_POLICY_PATH,
) {
	const roots = [];
	try {
		const entries = TARGETS.map(({ key, platform, arch }) => {
			const expected = resolveControlledA3sPackage({
				policyPath,
				packageOverride: "",
				platform,
				arch,
			});
			const installRoot = fs.mkdtempSync(
				path.join(os.tmpdir(), `internshannon-a3s-matrix-${key}.`),
			);
			roots.push(installRoot);
			return {
				packageDir: installPackage(expected.packagePath, installRoot),
				expected,
			};
		});
		return inspectControlledA3sMatrixDirectories(entries);
	} finally {
		for (const root of roots) {
			fs.rmSync(root, { recursive: true, force: true });
		}
	}
}

function parseArgs(argv) {
	let policyPath = DEFAULT_CONTROLLED_A3S_POLICY_PATH;
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--policy") {
			policyPath = path.resolve(argv[++index] ?? "");
		} else if (argv[index] === "--json") {
			json = true;
		} else {
			throw new Error(`Unknown argument: ${argv[index]}`);
		}
	}
	return { policyPath, json };
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const report = inspectControlledA3sPolicyMatrix(args.policyPath);
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
	} else if (report.ok) {
		console.log(
			`Controlled A3S matrix OK: ${report.packages["darwin-arm64"].manifest.version} ${report.packages["darwin-arm64"].localBuild.sourceRevision}`,
		);
	} else {
		for (const issue of report.issues) console.error(`- ${issue}`);
	}
	if (!report.ok) process.exitCode = 1;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
