import fs from "node:fs";
import path from "node:path";

export function resolveNpmInvocation({
	platform = process.platform,
	execPath = process.execPath,
	isFile = (candidate) => {
		try {
			return fs.statSync(candidate).isFile();
		} catch {
			return false;
		}
	},
} = {}) {
	if (platform !== "win32") {
		return { command: "npm", prefixArgs: [] };
	}

	const npmCli = path.win32.join(
		path.win32.dirname(execPath),
		"node_modules",
		"npm",
		"bin",
		"npm-cli.js",
	);
	if (!isFile(npmCli)) {
		throw new Error(`Bundled npm CLI was not found beside Node.js: ${npmCli}`);
	}
	return { command: execPath, prefixArgs: [npmCli] };
}

export function resolvePnpmInvocation({
	platform = process.platform,
	execPath = process.execPath,
	npmExecPath = process.env.npm_execpath,
	pathValue = process.env.PATH,
	isFile = (candidate) => {
		try {
			return fs.statSync(candidate).isFile();
		} catch {
			return false;
		}
	},
} = {}) {
	if (platform !== "win32") {
		return { command: "pnpm", prefixArgs: [] };
	}

	const candidates = [];
	if (npmExecPath?.trim()) candidates.push(npmExecPath.trim());
	for (const rawDirectory of pathValue?.split(";") ?? []) {
		const directory = rawDirectory.trim().replace(/^"|"$/gu, "");
		if (!directory) continue;
		for (const filename of ["pnpm.cjs", "pnpm.mjs"]) {
			candidates.push(
				path.win32.join(directory, "node_modules", "pnpm", "bin", filename),
			);
		}
	}
	const pnpmCli = candidates.find((candidate) => {
		const basename = path.win32.basename(candidate).toLowerCase();
		return /^pnpm\.(?:cjs|mjs|js)$/u.test(basename) && isFile(candidate);
	});
	if (!pnpmCli) {
		throw new Error(
			"The Windows pnpm JavaScript entry point is unavailable on PATH; run this script through the pinned pnpm command",
		);
	}
	return { command: execPath, prefixArgs: [pnpmCli] };
}
