import {
	readdirSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin") {
	console.log("[fix-macos-bundle] skipped: not macOS");
	process.exit(0);
}

const appName = process.env.SAFECLAW_APP_NAME ?? "internShannon";
const executableName = process.env.SAFECLAW_EXECUTABLE_NAME ?? appName;
const appPath = path.resolve(
	process.cwd(),
	`src-tauri/target/release/bundle/macos/${appName}.app`,
);
const executablePath = path.join(appPath, "Contents/MacOS", executableName);
const updaterArchivePath = path.resolve(
	process.cwd(),
	`src-tauri/target/release/bundle/macos/${appName}.app.tar.gz`,
);
const updaterSignaturePath = `${updaterArchivePath}.sig`;
const updaterManifestPath = path.resolve(
	process.cwd(),
	"src-tauri/target/release/latest.json",
);
const bundledLibPath =
	"@executable_path/../Resources/box/lib/libkrun.1.17.0.dylib";
const boxResourcesPath = path.join(appPath, "Contents/Resources/box");

if (!existsSync(executablePath)) {
	console.error(`[fix-macos-bundle] executable not found: ${executablePath}`);
	process.exit(1);
}

function dylibLinks(binaryPath) {
	return execFileSync("otool", ["-L", binaryPath], {
		encoding: "utf8",
	});
}

function ensureExecutablePatched(binaryPath) {
	const currentLinks = dylibLinks(binaryPath);
	if (currentLinks.includes(bundledLibPath)) {
		return false;
	}
	// Find any libkrun reference and patch it to the bundled path
	// Handles both bare filenames (libkrun.1.dylib) and absolute paths (/opt/homebrew/...)
	const libkrunMatch = currentLinks.match(/libkrun\S+\.dylib/);
	if (!libkrunMatch) {
		throw new Error(
			`unexpected libkrun linkage in ${binaryPath}: expected either bare libkrun.1.dylib or ${bundledLibPath}`,
		);
	}

	execFileSync(
		"install_name_tool",
		["-change", libkrunMatch[0], bundledLibPath, binaryPath],
		{ stdio: "inherit" },
	);
	return true;
}

function patchDylibInstallNames(dylibPath) {
	// The dylib's internal install name uses @executable_path/box/lib/...
	// but should be @executable_path/../Resources/box/lib/...
	const result = execFileSync("otool", ["-D", dylibPath], {
		encoding: "utf8",
	});
	const output = typeof result === "object" ? result.stdout : result;
	if (!output) {
		console.warn(
			"[fix-macos-bundle] could not read install name for:",
			dylibPath,
		);
		return;
	}
	const lines = output.trim().split("\n");
	const currentInstallName = lines[1];
	if (!currentInstallName) {
		console.warn(
			"[fix-macos-bundle] could not parse install name for:",
			dylibPath,
			"output:",
			output,
		);
		return;
	}

	const correctPath =
		"@executable_path/../Resources/box/lib/" + path.basename(dylibPath);
	if (currentInstallName !== correctPath) {
		execFileSync("install_name_tool", ["-id", correctPath, dylibPath], {
			stdio: "inherit",
		});
		console.log(
			`[fix-macos-bundle] patched dylib install name: ${path.basename(dylibPath)}`,
		);
	}
}

function patchAllDylibsInBundle(appPath) {
	const libDir = path.join(appPath, "Contents/Resources/box/lib");
	if (!existsSync(libDir)) {
		console.warn("[fix-macos-bundle] lib dir not found:", libDir);
		return;
	}

	const dylibs = readdirSync(libDir).filter((f) => f.endsWith(".dylib"));
	for (const dylib of dylibs) {
		patchDylibInstallNames(path.join(libDir, dylib));
	}
}

function codesignApp(targetAppPath) {
	const nestedCodePaths = collectNestedCodePaths(boxResourcesPath);
	for (const nestedPath of nestedCodePaths) {
		execFileSync("codesign", ["--force", "--sign", "-", nestedPath], {
			stdio: "inherit",
		});
	}
	execFileSync("codesign", ["--force", "--sign", "-", executablePath], {
		stdio: "inherit",
	});
	execFileSync(
		"codesign",
		["--force", "--deep", "--sign", "-", targetAppPath],
		{
			stdio: "inherit",
		},
	);
	execFileSync(
		"codesign",
		["--verify", "--deep", "--strict", "--verbose=4", targetAppPath],
		{ stdio: "inherit" },
	);
	for (const nestedPath of nestedCodePaths) {
		execFileSync("codesign", ["--verify", "--verbose=4", nestedPath], {
			stdio: "inherit",
		});
	}
}

function collectNestedCodePaths(rootPath) {
	if (!existsSync(rootPath)) {
		return [];
	}

	const results = [];
	const stack = [rootPath];
	while (stack.length > 0) {
		const current = stack.pop();
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (!entry.isFile() || lstatSync(fullPath).isSymbolicLink()) {
				continue;
			}
			if (isMachO(fullPath)) {
				results.push(fullPath);
			}
		}
	}
	results.sort();
	return results;
}

function isMachO(filePath) {
	try {
		const output = execFileSync("file", ["-b", filePath], {
			encoding: "utf8",
		});
		return output.includes("Mach-O");
	} catch {
		return false;
	}
}

function recreateUpdaterArchive() {
	execFileSync(
		"tar",
		["-czf", updaterArchivePath, "-C", path.dirname(appPath), `${appName}.app`],
		{
			stdio: "inherit",
		},
	);
}

function signUpdaterArchive() {
	const hasSigningKey =
		Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY) ||
		Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH);
	if (!hasSigningKey) {
		rmSync(updaterSignaturePath, { force: true });
		console.warn(
			"[fix-macos-bundle] updater archive rebuilt but not re-signed because TAURI signing env vars are not set",
		);
		return null;
	}

	execFileSync("pnpm", ["tauri", "signer", "sign", updaterArchivePath], {
		stdio: "inherit",
	});

	return readFileSync(updaterSignaturePath, "utf8").trim();
}

function updateUpdaterManifest(signature) {
	if (!signature || !existsSync(updaterManifestPath)) {
		return false;
	}

	const manifest = JSON.parse(readFileSync(updaterManifestPath, "utf8"));
	let updated = false;
	for (const platform of Object.values(manifest.platforms ?? {})) {
		if (
			platform &&
			typeof platform === "object" &&
			typeof platform.url === "string" &&
			path.basename(platform.url) === path.basename(updaterArchivePath)
		) {
			platform.signature = signature;
			updated = true;
		}
	}

	if (updated) {
		writeFileSync(
			updaterManifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
	}
	return updated;
}

function verifyUpdaterArchive() {
	if (!existsSync(updaterArchivePath)) {
		return;
	}

	const tempDir = mkdtempSync(path.join(os.tmpdir(), "safeclaw-updater-"));
	try {
		execFileSync("tar", ["-xzf", updaterArchivePath, "-C", tempDir], {
			stdio: "inherit",
		});
		const archivedExecutablePath = path.join(
			tempDir,
			`${appName}.app/Contents/MacOS/${executableName}`,
		);
		const currentLinks = dylibLinks(archivedExecutablePath);
		if (!currentLinks.includes(bundledLibPath)) {
			throw new Error(
				`updater archive still has incorrect libkrun linkage: ${archivedExecutablePath}`,
			);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

const appPatched = ensureExecutablePatched(executablePath);
patchAllDylibsInBundle(appPath);
codesignApp(appPath);
if (appPatched) {
	console.log("[fix-macos-bundle] patched app bundle libkrun install_name");
} else {
	console.log(
		"[fix-macos-bundle] app bundle already patched; refreshed signatures",
	);
}

if (!dylibLinks(executablePath).includes(bundledLibPath)) {
	throw new Error(
		"[fix-macos-bundle] app bundle verification failed after patch",
	);
}

let updaterSignature = null;
if (existsSync(updaterArchivePath)) {
	recreateUpdaterArchive();
	updaterSignature = signUpdaterArchive();
	const manifestUpdated = updateUpdaterManifest(updaterSignature);
	verifyUpdaterArchive();
	console.log("[fix-macos-bundle] rebuilt updater archive from patched app");
	if (updaterSignature) {
		console.log("[fix-macos-bundle] refreshed updater archive signature");
	}
	if (manifestUpdated) {
		console.log("[fix-macos-bundle] updated latest.json signature");
	}
} else {
	console.log(
		"[fix-macos-bundle] updater archive not found; skipped archive refresh",
	);
}

console.log("[fix-macos-bundle] bundle verification passed");
