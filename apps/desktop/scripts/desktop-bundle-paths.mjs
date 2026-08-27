import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DESKTOP_DIR = path.resolve(SCRIPT_DIR, "..");

function isPackagedResourcesDir(candidate) {
	return (
		fs.existsSync(path.join(candidate, "main.js")) ||
		fs.existsSync(path.join(candidate, "sidecar", "main.js"))
	);
}

function collectMacosResourcesDirs(targetDir) {
	const matches = [];
	const releaseDirs = [path.join(targetDir, "release")];
	try {
		for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name !== "release") {
				releaseDirs.push(path.join(targetDir, entry.name, "release"));
			}
		}
	} catch {}
	for (const releaseDir of releaseDirs) {
		const macosDir = path.join(releaseDir, "bundle", "macos");
		let apps = [];
		try {
			apps = fs.readdirSync(macosDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const app of apps) {
			if (!app.isDirectory() || !app.name.endsWith(".app")) continue;
			const resources = path.join(macosDir, app.name, "Contents", "Resources");
			if (isPackagedResourcesDir(resources)) matches.push(resources);
		}
	}
	return matches;
}

/**
 * Resolve the newest inspectable macOS bundle produced by this workspace.
 * Release checks may still pass --dir explicitly; this default only prevents
 * convenience scripts from silently targeting the obsolete lowercase,
 * non-target bundle path.
 */
export function resolveDefaultDesktopResourcesDir(options = {}) {
	const desktopDir = path.resolve(options.desktopDir ?? DEFAULT_DESKTOP_DIR);
	const configured =
		options.env?.INTERNSHANNON_BUNDLE_RESOURCES_DIR ??
		process.env.INTERNSHANNON_BUNDLE_RESOURCES_DIR;
	if (configured) return path.resolve(desktopDir, configured);

	const targetDir = path.join(desktopDir, "src-tauri", "target");
	const candidates = collectMacosResourcesDirs(targetDir).sort(
		(left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs,
	);
	if (candidates.length > 0) return candidates[0];

	const target =
		process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
	return path.join(
		targetDir,
		target,
		"release",
		"bundle",
		"macos",
		"InternShannon.app",
		"Contents",
		"Resources",
	);
}
