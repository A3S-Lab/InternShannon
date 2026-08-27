#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_CONTROLLED_A3S_POLICY_PATH,
	resolveControlledA3sPackage,
} from "../../../apps/desktop/scripts/controlled-a3s-package.mjs";
import { inspectControlledA3sPackageDirectory } from "../../../apps/desktop/scripts/verify-controlled-a3s-matrix.mjs";
import {
	CONTROLLED_A3S_DEPENDENCY_ROOT,
	CONTROLLED_A3S_DEPENDENCY_SPECIFIER,
} from "./stage-controlled-a3s-dependency.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const LOCK_PATH = path.join(REPO_ROOT, "pnpm-lock.yaml");
const RC_INPUTS_PATH = path.join(
	REPO_ROOT,
	"packaging",
	"rc",
	"RC-INPUTS.json",
);
const WORKSPACES = ["apps/desktop", "apps/sidecar"];
const TARGETS = Object.freeze({
	"darwin-arm64": { platform: "darwin", arch: "arm64" },
	"win32-x64": { platform: "win32", arch: "x64" },
});

function sha256Bytes(value) {
	return createHash("sha256").update(value).digest("hex");
}

function sha256CanonicalTextFile(filePath) {
	return sha256Bytes(fs.readFileSync(filePath, "utf8").replace(/\r\n/gu, "\n"));
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function option(name, argv = process.argv) {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
}

export function validateControlledA3sDependencyAuthority({
	desktopManifest,
	sidecarManifest,
	lockContent,
}) {
	const issues = [];
	for (const [label, manifest] of [
		["apps/desktop/package.json", desktopManifest],
		["apps/sidecar/package.json", sidecarManifest],
	]) {
		if (
			manifest?.dependencies?.["@a3s-lab/code"] !==
			CONTROLLED_A3S_DEPENDENCY_SPECIFIER
		) {
			issues.push(`${label} must use ${CONTROLLED_A3S_DEPENDENCY_SPECIFIER}`);
		}
	}
	if (/vendor\/a3s\/(?:darwin-arm64|win32-x64)\//u.test(lockContent)) {
		issues.push("pnpm lock authority contains a platform-specific A3S locator");
	}
	const stableLocatorCount = (
		lockContent.match(/vendor\/a3s\/selected\/package/gu) ?? []
	).length;
	if (stableLocatorCount < 3) {
		issues.push(
			`pnpm lock authority is missing the stable A3S locator (found ${stableLocatorCount})`,
		);
	}
	return { ok: issues.length === 0, issues, stableLocatorCount };
}

function inspectInstalledPackage(packageDir, expected, label) {
	const report = inspectControlledA3sPackageDirectory(packageDir, expected);
	if (!report.ok) {
		throw new Error(`${label}: ${report.issues.join("; ")}`);
	}
	return {
		workspace: label,
		packagePath: path.relative(REPO_ROOT, packageDir).split(path.sep).join("/"),
		native: expected.binary,
		nativeSha256: report.binarySha256,
		foreignNativeCount: report.foreignNative.length,
		publicFiles: report.publicFiles,
	};
}

export function verifyControlledA3sInstall({
	target = `${process.platform}-${process.arch}`,
	policyPath = DEFAULT_CONTROLLED_A3S_POLICY_PATH,
	dependencyRoot = CONTROLLED_A3S_DEPENDENCY_ROOT,
	requireNativeLoad = false,
} = {}) {
	const identity = TARGETS[target];
	if (!identity) {
		throw new Error(`unsupported controlled A3S dependency target ${target}`);
	}
	const expected = resolveControlledA3sPackage({
		policyPath,
		packageOverride: "",
		platform: identity.platform,
		arch: identity.arch,
	});
	const desktopManifest = readJson(
		path.join(REPO_ROOT, "apps", "desktop", "package.json"),
	);
	const sidecarManifest = readJson(
		path.join(REPO_ROOT, "apps", "sidecar", "package.json"),
	);
	const lockContent = fs.readFileSync(LOCK_PATH, "utf8");
	const lockSha256 = sha256Bytes(lockContent.replace(/\r\n/gu, "\n"));
	const rcInputs = readJson(RC_INPUTS_PATH);
	if (rcInputs?.locks?.pnpm?.sha256 !== lockSha256) {
		throw new Error(
			`RC inputs pnpm lock SHA-256 mismatch: actual=${lockSha256} expected=${rcInputs?.locks?.pnpm?.sha256}`,
		);
	}
	const authority = validateControlledA3sDependencyAuthority({
		desktopManifest,
		sidecarManifest,
		lockContent,
	});
	if (!authority.ok) {
		throw new Error(authority.issues.join("; "));
	}

	const summary = readJson(path.join(dependencyRoot, "selection-summary.json"));
	for (const [label, actual, pinned] of [
		["target", summary.target, target],
		[
			"dependency specifier",
			summary.dependencySpecifier,
			CONTROLLED_A3S_DEPENDENCY_SPECIFIER,
		],
		["package SHA-256", summary.package?.sha256, expected.sha256],
		["native filename", summary.native?.filename, expected.binary],
		["native SHA-256", summary.native?.sha256, expected.binarySha256],
		["source revision", summary.source?.revision, expected.sourceRevision],
		[
			"source tree SHA-256",
			summary.source?.treeSha256,
			expected.sourceTreeSha256,
		],
	]) {
		if (actual !== pinned) {
			throw new Error(
				`selection summary ${label} mismatch: actual=${actual} expected=${pinned}`,
			);
		}
	}

	const selectedPackage = path.join(dependencyRoot, "package");
	const selected = inspectInstalledPackage(
		selectedPackage,
		expected,
		"selected",
	);
	const installed = WORKSPACES.map((workspace) => {
		const workspaceManifest = path.join(REPO_ROOT, workspace, "package.json");
		const requireFromWorkspace = createRequire(workspaceManifest);
		const manifestPath = requireFromWorkspace.resolve(
			"@a3s-lab/code/package.json",
		);
		const report = inspectInstalledPackage(
			path.dirname(manifestPath),
			expected,
			workspace,
		);
		if (requireNativeLoad) {
			requireFromWorkspace("@a3s-lab/code");
		}
		return {
			...report,
			nativeLoad: requireNativeLoad ? "pass" : "not-requested",
		};
	});

	return {
		ok: true,
		target,
		lockAuthority: {
			path: "pnpm-lock.yaml",
			sha256: lockSha256,
			normalization: "LF",
			stableLocatorCount: authority.stableLocatorCount,
		},
		dependencyAuthority: {
			rcInputs: {
				path: "packaging/rc/RC-INPUTS.json",
				sha256: sha256CanonicalTextFile(RC_INPUTS_PATH),
			},
			policy: {
				path: "apps/desktop/config/controlled-a3s-package.json",
				sha256: sha256CanonicalTextFile(policyPath),
			},
			stageScript: {
				path: "packaging/rc/scripts/stage-controlled-a3s-dependency.mjs",
				sha256: sha256CanonicalTextFile(
					path.join(SCRIPT_DIR, "stage-controlled-a3s-dependency.mjs"),
				),
			},
			verifyScript: {
				path: "packaging/rc/scripts/verify-controlled-a3s-install.mjs",
				sha256: sha256CanonicalTextFile(SCRIPT_PATH),
			},
		},
		package: {
			version: expected.version,
			sha256: expected.sha256,
		},
		native: {
			filename: expected.binary,
			sha256: expected.binarySha256,
			foreignNativeCount: 0,
		},
		publicFiles: selected.publicFiles,
		resolved: installed,
	};
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
				`controlled A3S install verification must run on its native host: requested=${target} host=${hostTarget}`,
			);
		}
		process.stdout.write(
			`${JSON.stringify(
				verifyControlledA3sInstall({
					target,
					requireNativeLoad: process.argv.includes("--require-native-load"),
				}),
				null,
				2,
			)}\n`,
		);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	}
}
