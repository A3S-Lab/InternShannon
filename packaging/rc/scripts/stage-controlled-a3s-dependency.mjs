#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_CONTROLLED_A3S_POLICY_PATH,
	resolveControlledA3sPackage,
} from "../../../apps/desktop/scripts/controlled-a3s-package.mjs";
import { resolveNpmInvocation } from "../../../apps/desktop/scripts/npm-process.mjs";
import { inspectControlledA3sPackageDirectory } from "../../../apps/desktop/scripts/verify-controlled-a3s-matrix.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const RC_INPUTS_PATH = path.join(
	REPO_ROOT,
	"packaging",
	"rc",
	"RC-INPUTS.json",
);
export const CONTROLLED_A3S_DEPENDENCY_ROOT = path.join(
	REPO_ROOT,
	"vendor",
	"a3s",
	"selected",
);
export const CONTROLLED_A3S_DEPENDENCY_SPECIFIER =
	"file:../../vendor/a3s/selected/package";

const TARGETS = Object.freeze({
	"darwin-arm64": { platform: "darwin", arch: "arm64" },
	"win32-x64": { platform: "win32", arch: "x64" },
});

function option(name, argv = process.argv) {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
}

function targetIdentity(target) {
	const identity = TARGETS[target];
	if (!identity) {
		throw new Error(
			`unsupported controlled A3S dependency target ${target}; expected ${Object.keys(TARGETS).join(" or ")}`,
		);
	}
	return identity;
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
			"--package-lock=false",
			"--prefix",
			installRoot,
			packagePath,
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	if (result.error || result.status !== 0) {
		throw new Error(
			`could not unpack controlled A3S package: ${result.error?.message ?? result.stderr ?? result.stdout}`,
		);
	}
	return path.join(installRoot, "node_modules", "@a3s-lab", "code");
}

function writeJson(filePath, value) {
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assertRcInputsMatch(target, expected, inputsPath = RC_INPUTS_PATH) {
	const inputs = JSON.parse(fs.readFileSync(inputsPath, "utf8"));
	const common = inputs?.controlledA3s;
	const targetInput = common?.targets?.[target];
	if (!targetInput) {
		throw new Error(`RC inputs are missing controlled A3S target ${target}`);
	}
	for (const [label, actual, pinned] of [
		["status", targetInput.status, "verified"],
		["package", common.package, "@a3s-lab/code"],
		["version", common.version, expected.version],
		["source revision", common.sourceRevision, expected.sourceRevision],
		["source tree SHA-256", common.sourceTreeSha256, expected.sourceTreeSha256],
		["source dirty state", common.sourceDirty, false],
		["asset SHA-256", targetInput.sha256, expected.sha256],
		["native filename", targetInput.nativeBinary, expected.binary],
		["native SHA-256", targetInput.nativeBinarySha256, expected.binarySha256],
	]) {
		if (actual !== pinned) {
			throw new Error(
				`RC inputs ${target} ${label} mismatch: actual=${actual} expected=${pinned}`,
			);
		}
	}
	const destination = path.resolve(REPO_ROOT, targetInput.destination);
	if (destination !== path.resolve(expected.packagePath)) {
		throw new Error(
			`RC inputs ${target} destination does not match controlled policy`,
		);
	}
}

export function stageControlledA3sDependency({
	target = `${process.platform}-${process.arch}`,
	policyPath = DEFAULT_CONTROLLED_A3S_POLICY_PATH,
	outputRoot = CONTROLLED_A3S_DEPENDENCY_ROOT,
} = {}) {
	const { platform, arch } = targetIdentity(target);
	const expected = resolveControlledA3sPackage({
		policyPath,
		packageOverride: "",
		platform,
		arch,
	});
	assertRcInputsMatch(target, expected);
	const installRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), `shuxiaoan-a3s-dependency-${target}.`),
	);
	try {
		const installedPackage = installPackage(expected.packagePath, installRoot);
		const report = inspectControlledA3sPackageDirectory(
			installedPackage,
			expected,
		);
		if (!report.ok) {
			throw new Error(
				`controlled A3S dependency validation failed: ${report.issues.join("; ")}`,
			);
		}

		const resolvedOutputRoot = path.resolve(outputRoot);
		const packageOutput = path.join(resolvedOutputRoot, "package");
		fs.rmSync(resolvedOutputRoot, { recursive: true, force: true });
		fs.mkdirSync(resolvedOutputRoot, { recursive: true });
		fs.cpSync(installedPackage, packageOutput, { recursive: true });

		const copiedReport = inspectControlledA3sPackageDirectory(
			packageOutput,
			expected,
		);
		if (!copiedReport.ok) {
			throw new Error(
				`staged controlled A3S dependency validation failed: ${copiedReport.issues.join("; ")}`,
			);
		}

		const summary = {
			schemaVersion: 1,
			target,
			dependencySpecifier: CONTROLLED_A3S_DEPENDENCY_SPECIFIER,
			lockAuthority: "pnpm-lock.yaml",
			package: {
				name: copiedReport.manifest.name,
				version: copiedReport.manifest.version,
				asset: path
					.relative(REPO_ROOT, expected.packagePath)
					.split(path.sep)
					.join("/"),
				sha256: expected.sha256,
			},
			source: {
				version: expected.sourceVersion,
				revision: expected.sourceRevision,
				dirty: expected.sourceDirty,
				treeSha256: expected.sourceTreeSha256,
			},
			native: {
				filename: expected.binary,
				sha256: expected.binarySha256,
				foreignNativeCount: copiedReport.foreignNative.length,
			},
			publicFiles: copiedReport.publicFiles,
		};
		writeJson(path.join(resolvedOutputRoot, "selection-summary.json"), summary);
		return summary;
	} finally {
		fs.rmSync(installRoot, { recursive: true, force: true });
	}
}

function isMainModule() {
	if (!process.argv[1]) return false;
	return (
		path.resolve(process.argv[1]).toLowerCase() === SCRIPT_PATH.toLowerCase()
	);
}

if (isMainModule()) {
	try {
		const target = option("--target") ?? `${process.platform}-${process.arch}`;
		const hostTarget = `${process.platform}-${process.arch}`;
		if (target !== hostTarget) {
			throw new Error(
				`controlled A3S dependency staging must run on its native host: requested=${target} host=${hostTarget}`,
			);
		}
		process.stdout.write(
			`${JSON.stringify(stageControlledA3sDependency({ target }))}\n`,
		);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	}
}
