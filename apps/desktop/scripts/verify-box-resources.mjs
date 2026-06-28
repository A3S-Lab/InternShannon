#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
	const args = {
		dir: "src-tauri/resources/box",
		json: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--dir") {
			args.dir = argv[i + 1];
			i += 1;
		} else if (token === "--json") {
			args.json = true;
		} else if (token === "--output") {
			args.output = argv[i + 1];
			i += 1;
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
			"Usage: node scripts/verify-box-resources.mjs [--dir <path>]",
			"       node scripts/verify-box-resources.mjs [--dir <path>] [--json] [--output <file>]",
			"",
			"Validates a internShannon bundled a3s-box resource directory or a parent directory",
			"that contains box/manifest.json.",
		].join("\n"),
	);
}

function exists(p) {
	return fs.existsSync(p);
}

function isFile(p) {
	try {
		return fs.statSync(p).isFile();
	} catch {
		return false;
	}
}

function findBoxDir(startDir) {
	const resolved = path.resolve(startDir);
	const directManifest = path.join(resolved, "manifest.json");
	if (isFile(directManifest)) {
		return resolved;
	}

	const queue = [resolved];
	while (queue.length > 0) {
		const current = queue.shift();
		const manifest = path.join(current, "box", "manifest.json");
		if (isFile(manifest)) {
			return path.join(current, "box");
		}

		let entries = [];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			if (entry.name.startsWith(".") || entry.name === "node_modules") {
				continue;
			}
			queue.push(path.join(current, entry.name));
		}
	}

	throw new Error(
		[
			`Could not find box/manifest.json under ${resolved}.`,
			"Build a fresh desktop bundle first with `pnpm tauri:build:validated`,",
			"or point `--dir` at an extracted bundle Resources directory that contains `box/manifest.json`.",
		].join(" "),
	);
}

function loadManifest(boxDir) {
	const manifestPath = path.join(boxDir, "manifest.json");
	if (!isFile(manifestPath)) {
		throw new Error(`Missing manifest: ${manifestPath}`);
	}
	const raw = fs.readFileSync(manifestPath, "utf8");
	return JSON.parse(raw);
}

function validateManifestShape(manifest) {
	const issues = [];
	if (!manifest.internshannon_version && !manifest.safeclaw_version) {
		issues.push("manifest.internshannon_version is missing");
	}
	if (!manifest.profile) {
		issues.push("manifest.profile is missing");
	}
	if (!manifest.host_os) {
		issues.push("manifest.host_os is missing");
	}
	if (!manifest.host_arch) {
		issues.push("manifest.host_arch is missing");
	}
	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		issues.push("manifest.files must be a non-empty array");
	}
	return issues;
}

function validateBoxDir(boxDir, manifest) {
	const issues = [];
	const expectedCoreFiles = ["a3s-box-shim", "a3s-box-guest-init"];

	for (const relativePath of manifest.files ?? []) {
		const absolutePath = path.join(boxDir, relativePath);
		if (!exists(absolutePath)) {
			issues.push(`missing manifest file: ${relativePath}`);
			continue;
		}
		if (isFile(absolutePath) && fs.statSync(absolutePath).size === 0) {
			issues.push(`empty manifest file: ${relativePath}`);
		}
	}

	for (const filename of expectedCoreFiles) {
		if (!(manifest.files ?? []).includes(filename)) {
			issues.push(`manifest is missing required file entry: ${filename}`);
		}
		if (!exists(path.join(boxDir, filename))) {
			issues.push(`missing required file on disk: ${filename}`);
		}
	}

	const runtimeLibs = (manifest.files ?? []).filter(
		(relativePath) =>
			relativePath.startsWith("lib/") &&
			(relativePath.endsWith(".dylib") || relativePath.endsWith(".so")),
	);

	if (
		manifest.profile === "release" &&
		["darwin", "linux"].includes(manifest.host_os)
	) {
		if (runtimeLibs.length === 0) {
			issues.push(
				"release manifest does not include any bundled runtime library (.dylib/.so)",
			);
		}
	}

	for (const relativePath of runtimeLibs) {
		const absolutePath = path.join(boxDir, relativePath);
		if (isFile(absolutePath) && fs.statSync(absolutePath).size === 0) {
			issues.push(`runtime library is empty: ${relativePath}`);
		}
	}

	if (manifest.host_os === "darwin") {
		const libDir = path.join(boxDir, "lib");
		const libkrunMajor = path.join(libDir, "libkrun.1.dylib");
		const libkrunfwMajor = path.join(libDir, "libkrunfw.5.dylib");
		const libkrunfwAlias = path.join(libDir, "libkrunfw.dylib");
		const versionedLibkrun = exists(libDir)
			? fs
					.readdirSync(libDir)
					.some((name) => /^libkrun\.\d+\.\d+\.\d+\.dylib$/.test(name))
			: false;
		if (isFile(libkrunMajor) && !versionedLibkrun) {
			issues.push(
				"missing macOS libkrun versioned alias: lib/libkrun.<version>.dylib",
			);
		}
		if (isFile(libkrunfwMajor) && !exists(libkrunfwAlias)) {
			issues.push("missing macOS libkrunfw alias: lib/libkrunfw.dylib");
		}
	}

	return {
		runtimeLibs,
		issues,
	};
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const boxDir = findBoxDir(args.dir);
	const manifest = loadManifest(boxDir);
	const shapeIssues = validateManifestShape(manifest);
	const { runtimeLibs, issues } = validateBoxDir(boxDir, manifest);
	const allIssues = [...shapeIssues, ...issues];
	const report = {
		boxDir,
		manifest,
		runtimeLibs,
		ok: allIssues.length === 0,
		issues: allIssues,
	};

	if (args.output) {
		fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
	}

	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
		if (!report.ok) {
			process.exitCode = 1;
		}
		return;
	}

	console.log(`Box resource directory: ${boxDir}`);
	const productVersion =
		manifest.internshannon_version ?? manifest.safeclaw_version;
	console.log(
		`Manifest: internShannon ${productVersion} ${manifest.host_os}/${manifest.host_arch} (${manifest.profile})`,
	);
	console.log(`Files declared: ${(manifest.files ?? []).length}`);
	console.log(`Runtime libs declared: ${runtimeLibs.length}`);

	if (allIssues.length > 0) {
		console.error("\nValidation failed:");
		for (const issue of allIssues) {
			console.error(`- ${issue}`);
		}
		process.exitCode = 1;
		return;
	}

	console.log("Box resource validation passed.");
}

try {
	main();
} catch (error) {
	console.error(
		`Box resource validation failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
}
