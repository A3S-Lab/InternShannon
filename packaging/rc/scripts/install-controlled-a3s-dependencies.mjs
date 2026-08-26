#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePnpmInvocation } from "../../../apps/desktop/scripts/npm-process.mjs";
import { restoreControlledA3s } from "./restore-controlled-a3s.mjs";
import {
	CONTROLLED_A3S_DEPENDENCY_ROOT,
	stageControlledA3sDependency,
} from "./stage-controlled-a3s-dependency.mjs";
import { verifyControlledA3sInstall } from "./verify-controlled-a3s-install.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const REQUIRED_NODE_VERSION = "v22.18.0";

function option(name, argv = process.argv) {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
}

function sha256File(filePath) {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: REPO_ROOT,
		encoding: "utf8",
		stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
		env: { ...process.env, CI: process.env.CI ?? "true" },
	});
	if (result.error || result.status !== 0) {
		throw new Error(
			`${options.label ?? command} failed: ${result.error?.message ?? result.stderr ?? result.stdout ?? result.status}`,
		);
	}
	return options.capture ? String(result.stdout).trim() : "";
}

function gitStatus() {
	return run("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
		capture: true,
		label: "git status",
	});
}

function assertAbsent(targetPath, label) {
	if (fs.existsSync(targetPath)) {
		throw new Error(
			`fresh install requires ${label} to be absent: ${targetPath}`,
		);
	}
}

function validateRemoteProof({ proofPath, assetDir, target }) {
	const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
	const inputs = JSON.parse(
		fs.readFileSync(
			path.join(REPO_ROOT, "packaging", "rc", "RC-INPUTS.json"),
			"utf8",
		),
	);
	const expected = inputs?.controlledA3s?.targets?.[target];
	const downloadedAsset = path.join(assetDir, expected.asset);
	for (const [label, actual, pinned] of [
		["result", proof.result, "PASS"],
		["repository", proof.repository, inputs.repository],
		["release tag", proof.tag, inputs.releaseTag],
		["asset name", proof.assetName, expected.asset],
		["asset id", proof.assetId, expected.privateReleaseVerification?.assetId],
		["asset bytes", proof.downloadedBytes, expected.bytes],
		["asset SHA-256", proof.downloadedSha256, expected.sha256],
		["API digest", proof.apiDigest, `sha256:${expected.sha256}`],
		["native SHA-256", proof.native?.sha256, expected.nativeBinarySha256],
	]) {
		if (actual !== pinned) {
			throw new Error(
				`private release proof ${label} mismatch: actual=${actual} expected=${pinned}`,
			);
		}
	}
	if (path.resolve(proof.downloadedPath) !== path.resolve(downloadedAsset)) {
		throw new Error(
			"private release proof does not describe the selected asset directory",
		);
	}
	if (sha256File(downloadedAsset) !== expected.sha256) {
		throw new Error(
			"private release proof asset bytes no longer match RC inputs",
		);
	}
	return {
		status: "verified-private-release-redownload",
		proofSha256: sha256File(proofPath),
		assetId: proof.assetId,
	};
}

export function installControlledA3sDependencies({
	target = `${process.platform}-${process.arch}`,
	assetDir,
	remoteProofPath,
	storeDir,
	requireClean = false,
	requireFresh = false,
} = {}) {
	const hostTarget = `${process.platform}-${process.arch}`;
	if (target !== hostTarget) {
		throw new Error(
			`controlled dependency install must run on its native host: requested=${target} host=${hostTarget}`,
		);
	}
	if (process.version !== REQUIRED_NODE_VERSION) {
		throw new Error(
			`controlled dependency install requires Node ${REQUIRED_NODE_VERSION}: actual=${process.version}`,
		);
	}
	if (requireFresh) {
		for (const relative of [
			"node_modules",
			"apps/desktop/node_modules",
			"apps/sidecar/node_modules",
		]) {
			assertAbsent(path.join(REPO_ROOT, relative), relative);
		}
		assertAbsent(CONTROLLED_A3S_DEPENDENCY_ROOT, "vendor/a3s/selected");
		const rcInputs = JSON.parse(
			fs.readFileSync(
				path.join(REPO_ROOT, "packaging", "rc", "RC-INPUTS.json"),
				"utf8",
			),
		);
		const targetDestination =
			rcInputs?.controlledA3s?.targets?.[target]?.destination;
		if (!targetDestination) {
			throw new Error(`RC inputs are missing destination for ${target}`);
		}
		assertAbsent(
			path.resolve(REPO_ROOT, targetDestination),
			`${target} restored TGZ`,
		);
		if (!storeDir) {
			throw new Error("fresh install requires an explicit new --store-dir");
		}
		assertAbsent(path.resolve(REPO_ROOT, storeDir), "pnpm store");
		if (assetDir && !remoteProofPath) {
			throw new Error(
				"fresh install with --asset-dir requires --remote-proof for private release provenance",
			);
		}
	}
	if (remoteProofPath && !assetDir) {
		throw new Error("--remote-proof requires --asset-dir");
	}
	const remoteProof = remoteProofPath
		? validateRemoteProof({
				proofPath: path.resolve(remoteProofPath),
				assetDir: path.resolve(assetDir),
				target,
			})
		: null;
	const statusBefore = gitStatus();
	if (requireClean && statusBefore) {
		throw new Error(
			`controlled dependency install requires a clean worktree:\n${statusBefore}`,
		);
	}
	const lockPath = path.join(REPO_ROOT, "pnpm-lock.yaml");
	const lockSha256Before = sha256File(lockPath);

	const restoreArgv = ["node", SCRIPT_PATH, "--target", target];
	if (assetDir) restoreArgv.push("--asset-dir", assetDir);
	const restore = restoreControlledA3s({ argv: restoreArgv });
	const selection = stageControlledA3sDependency({ target });

	const pnpmInvocation = resolvePnpmInvocation();
	const pnpmVersion = run(
		pnpmInvocation.command,
		[...pnpmInvocation.prefixArgs, "--version"],
		{ capture: true, label: "pnpm version" },
	);
	if (pnpmVersion !== "11.19.0") {
		throw new Error(
			`controlled dependency install requires pnpm 11.19.0: actual=${pnpmVersion}`,
		);
	}
	const installArgs = [
		...pnpmInvocation.prefixArgs,
		"install",
		"--frozen-lockfile",
		"--config.verify-deps-before-run=false",
	];
	if (storeDir)
		installArgs.push("--store-dir", path.resolve(REPO_ROOT, storeDir));
	run(pnpmInvocation.command, installArgs, { label: "pnpm frozen install" });

	const verification = verifyControlledA3sInstall({
		target,
		requireNativeLoad: true,
	});
	const lockSha256After = sha256File(lockPath);
	if (lockSha256After !== lockSha256Before) {
		throw new Error(
			`pnpm frozen install changed lock authority: before=${lockSha256Before} after=${lockSha256After}`,
		);
	}
	const statusAfter = gitStatus();
	if (statusAfter !== statusBefore) {
		throw new Error(
			`controlled dependency install changed tracked worktree state:\nbefore=${statusBefore || "clean"}\nafter=${statusAfter || "clean"}`,
		);
	}
	if (requireClean && statusAfter) {
		throw new Error(
			`controlled dependency install left a dirty worktree:\n${statusAfter}`,
		);
	}

	return {
		ok: true,
		target,
		nodeVersion: process.version,
		pnpmVersion,
		restore: {
			authority: restore.authority,
			sha256: restore.sha256,
			remoteProof,
		},
		selection,
		lock: {
			path: "pnpm-lock.yaml",
			sha256Before: lockSha256Before,
			sha256After: lockSha256After,
			unchanged: true,
		},
		git: {
			before: statusBefore || "clean",
			after: statusAfter || "clean",
			unchanged: true,
		},
		verification,
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
		const result = installControlledA3sDependencies({
			target: option("--target") ?? `${process.platform}-${process.arch}`,
			assetDir: option("--asset-dir"),
			remoteProofPath: option("--remote-proof"),
			storeDir: option("--store-dir"),
			requireClean: process.argv.includes("--require-clean"),
			requireFresh: process.argv.includes("--require-fresh"),
		});
		const reportPath = option("--report");
		if (reportPath) {
			const resolvedReportPath = path.resolve(reportPath);
			fs.mkdirSync(path.dirname(resolvedReportPath), { recursive: true });
			fs.writeFileSync(
				resolvedReportPath,
				`${JSON.stringify(result, null, 2)}\n`,
				"utf8",
			);
		}
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	}
}
