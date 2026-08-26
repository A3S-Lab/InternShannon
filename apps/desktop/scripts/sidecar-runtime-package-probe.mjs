import { spawnSync } from "node:child_process";
import path from "node:path";

export const WORKSPACE_RUNTIME_PACKAGES = Object.freeze([
	"@a3s-lab/agent-planning",
	"@a3s-lab/lark",
	"@a3s-lab/ocr",
	"@a3s-lab/ocr/defaults",
	"@a3s-lab/ocr/types",
]);

const PROBE_MARKER = "__INTERNSHANNON_RUNTIME_PACKAGE_PROBE__";

const PROBE_SOURCE = String.raw`
const { createRequire } = require("node:module");
const path = require("node:path");

const marker = process.argv[1];
const anchorPath = path.resolve(process.argv[2]);
const specifiers = JSON.parse(process.argv[3]);
const runtimeRequire = createRequire(anchorPath);
const results = [];

for (const specifier of specifiers) {
    try {
        const resolved = runtimeRequire.resolve(specifier, {
            paths: [path.dirname(anchorPath)],
        });
        runtimeRequire(specifier);
        results.push({ specifier, resolved, loaded: true });
    } catch (error) {
        results.push({
            specifier,
            loaded: false,
            code: typeof error?.code === "string" ? error.code : undefined,
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

const report = {
    anchorPath,
    ok: results.every((result) => result.loaded),
    results,
};
process.stdout.write(marker + JSON.stringify(report) + "\n");
if (!report.ok) process.exitCode = 1;
`;

function parseProbeReport(stdout) {
	const markerIndex = stdout.lastIndexOf(PROBE_MARKER);
	if (markerIndex < 0) {
		return undefined;
	}
	const payload = stdout
		.slice(markerIndex + PROBE_MARKER.length)
		.split(/\r?\n/, 1)[0];
	try {
		return JSON.parse(payload);
	} catch {
		return undefined;
	}
}

export function probeRuntimePackages({
	anchorPath,
	nodeExecutable = process.execPath,
	specifiers = WORKSPACE_RUNTIME_PACKAGES,
} = {}) {
	if (!anchorPath) {
		throw new Error("anchorPath is required for the runtime package probe");
	}
	const normalizedSpecifiers = [...new Set(specifiers.filter(Boolean))];
	if (normalizedSpecifiers.length === 0) {
		return {
			anchorPath: path.resolve(anchorPath),
			nodeExecutable,
			ok: true,
			results: [],
		};
	}

	const result = spawnSync(
		nodeExecutable,
		[
			"-e",
			PROBE_SOURCE,
			PROBE_MARKER,
			path.resolve(anchorPath),
			JSON.stringify(normalizedSpecifiers),
		],
		{
			encoding: "utf8",
			stdio: "pipe",
		},
	);
	const parsed = parseProbeReport(result.stdout ?? "");
	if (result.error) {
		return {
			anchorPath: path.resolve(anchorPath),
			nodeExecutable,
			ok: false,
			results: [],
			error: result.error.message,
			stderr: result.stderr?.trim() || undefined,
		};
	}
	if (!parsed) {
		return {
			anchorPath: path.resolve(anchorPath),
			nodeExecutable,
			ok: false,
			results: [],
			error: `runtime probe exited without a valid report (status=${result.status})`,
			stderr: result.stderr?.trim() || undefined,
		};
	}
	return {
		...parsed,
		nodeExecutable,
		stderr: result.stderr?.trim() || undefined,
		ok: parsed.ok && result.status === 0,
	};
}

export function formatRuntimePackageProbeFailures(report) {
	const failures = report.results
		.filter((result) => !result.loaded)
		.map((result) => {
			const code = result.code ? ` (${result.code})` : "";
			return `${result.specifier}${code}: ${result.message}`;
		});
	if (report.error) {
		failures.push(report.error);
	}
	if (report.stderr) {
		failures.push(`stderr: ${report.stderr}`);
	}
	return failures;
}

export function workspaceRuntimeProbeSpecifiers(externalSpecifiers) {
	const requested = new Set(externalSpecifiers);
	const result = [];
	for (const packageName of [
		"@a3s-lab/agent-planning",
		"@a3s-lab/lark",
		"@a3s-lab/ocr",
	]) {
		if (
			[...requested].some(
				(specifier) =>
					specifier === packageName || specifier.startsWith(`${packageName}/`),
			)
		) {
			result.push(packageName);
		}
	}
	if (result.includes("@a3s-lab/ocr")) {
		result.push("@a3s-lab/ocr/defaults", "@a3s-lab/ocr/types");
	}
	return result;
}
