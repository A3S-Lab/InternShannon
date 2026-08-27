import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_CONTROLLED_A3S_POLICY_PATH = path.resolve(
	SCRIPT_DIR,
	"..",
	"config",
	"controlled-a3s-package.json",
);

export function controlledA3sTarget(
	platform = process.platform,
	arch = process.arch,
) {
	return `${platform}-${arch}`;
}

export function sha256File(filePath) {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function requiredString(value, label) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`controlled A3S policy is missing ${label}`);
	}
	return value.trim();
}

function requiredSha256(value, label) {
	const normalized = requiredString(value, label).toLowerCase();
	if (!/^[a-f0-9]{64}$/.test(normalized)) {
		throw new Error(`controlled A3S policy has invalid ${label}`);
	}
	return normalized;
}

function requiredGitRevision(value, label) {
	const normalized = requiredString(value, label).toLowerCase();
	if (!/^[a-f0-9]{40}$/.test(normalized)) {
		throw new Error(`controlled A3S policy has invalid ${label}`);
	}
	return normalized;
}

function requiredPublicFiles(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("controlled A3S policy is missing publicFiles");
	}
	const required = [
		"index.js",
		"index.d.ts",
		"generated.d.ts",
		"extra-types.d.ts",
		"event-protocol-v1.d.ts",
	];
	return Object.fromEntries(
		required.map((filename) => [
			filename,
			requiredSha256(value[filename], `publicFiles.${filename}`),
		]),
	);
}

export function resolveControlledA3sPackage({
	policyPath = DEFAULT_CONTROLLED_A3S_POLICY_PATH,
	packageOverride = process.env.INTERNSHANNON_LOCAL_A3S_PACKAGE,
	platform = process.platform,
	arch = process.arch,
} = {}) {
	const resolvedPolicyPath = path.resolve(policyPath);
	let policy;
	try {
		policy = JSON.parse(fs.readFileSync(resolvedPolicyPath, "utf8"));
	} catch (error) {
		throw new Error(
			`could not read controlled A3S policy ${resolvedPolicyPath}: ${error.message}`,
		);
	}
	if (policy?.schemaVersion !== 1 || policy?.requiredForStandalone !== true) {
		throw new Error(
			"controlled A3S policy must use schemaVersion=1 and requiredForStandalone=true",
		);
	}

	const target = controlledA3sTarget(platform, arch);
	const entry = policy?.packages?.[target];
	if (!entry || typeof entry !== "object") {
		throw new Error(
			`controlled A3S policy has no package for ${target}; refusing to fall back to the registry SDK`,
		);
	}

	const configuredPath = requiredString(
		entry.packagePath,
		`${target}.packagePath`,
	);
	const packagePath = packageOverride?.trim()
		? path.resolve(packageOverride.trim())
		: path.resolve(path.dirname(resolvedPolicyPath), configuredPath);
	if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isFile()) {
		throw new Error(
			`controlled A3S package is missing for ${target}: ${packagePath}`,
		);
	}

	const expectedSha256 = requiredSha256(entry.sha256, `${target}.sha256`);
	const actualSha256 = sha256File(packagePath);
	if (actualSha256 !== expectedSha256) {
		throw new Error(
			`controlled A3S package SHA-256 mismatch for ${target}: expected=${expectedSha256} actual=${actualSha256}`,
		);
	}
	if (entry.sourceDirty !== false) {
		throw new Error(
			`controlled A3S policy requires ${target}.sourceDirty=false`,
		);
	}

	return {
		policyPath: resolvedPolicyPath,
		target,
		packagePath,
		version: requiredString(entry.version, `${target}.version`),
		sourceVersion: requiredString(
			entry.sourceVersion,
			`${target}.sourceVersion`,
		),
		sourceRevision: requiredGitRevision(
			entry.sourceRevision,
			`${target}.sourceRevision`,
		),
		sourceDirty: false,
		sourceTreeSha256: requiredSha256(
			entry.sourceTreeSha256,
			`${target}.sourceTreeSha256`,
		),
		sha256: expectedSha256,
		binary: requiredString(entry.binary, `${target}.binary`),
		binarySha256: requiredSha256(entry.binarySha256, `${target}.binarySha256`),
		publicFiles: requiredPublicFiles(policy.publicFiles),
		platform,
		arch,
	};
}
