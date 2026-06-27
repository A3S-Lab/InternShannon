import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const EMBEDDED_DIR = path.join(
	ROOT,
	"crates",
	"safeclaw",
	"src",
	"embedded_skills",
);
const DISTRIBUTION_DIR = path.join(ROOT, "src-tauri", "resources", "skills");
const CORE_SKILLS = ["a3s-flow.md", "mermaid.md", "vis-chart.md"];

async function readUtf8(filePath) {
	return readFile(filePath, "utf8");
}

async function ensureKnownFiles(dirPath) {
	const entries = await readdir(dirPath, { withFileTypes: true });
	const unexpected = entries
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.filter((name) => CORE_SKILLS.includes(name) === false);
	return unexpected;
}

async function checkMode() {
	let driftFound = false;
	for (const filename of CORE_SKILLS) {
		const embeddedPath = path.join(EMBEDDED_DIR, filename);
		const distributionPath = path.join(DISTRIBUTION_DIR, filename);
		const [embedded, distribution] = await Promise.all([
			readUtf8(embeddedPath),
			readUtf8(distributionPath),
		]);
		if (embedded !== distribution) {
			driftFound = true;
			console.error(`Skill drift detected: ${filename}`);
		}
	}
	if (driftFound) {
		console.error(
			"Run `pnpm sync:core-skills` to copy backend-owned embedded skills into src-tauri/resources/skills.",
		);
		process.exit(1);
	}
	console.log("Core skill files are in sync.");
}

async function syncMode() {
	await mkdir(DISTRIBUTION_DIR, { recursive: true });
	for (const filename of CORE_SKILLS) {
		await copyFile(
			path.join(EMBEDDED_DIR, filename),
			path.join(DISTRIBUTION_DIR, filename),
		);
		console.log(`Synced ${filename}`);
	}
}

async function main() {
	const mode = process.argv[2] ?? "check";
	const unexpectedEmbedded = await ensureKnownFiles(EMBEDDED_DIR);
	if (unexpectedEmbedded.length > 0) {
		console.warn(
			`Embedded skill directory contains unmanaged files: ${unexpectedEmbedded.join(", ")}`,
		);
	}
	if (mode === "sync") {
		await syncMode();
		return;
	}
	if (mode === "check") {
		await checkMode();
		return;
	}
	console.error(`Unknown mode: ${mode}`);
	console.error("Usage: node scripts/sync-core-skills.mjs [check|sync]");
	process.exit(1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
