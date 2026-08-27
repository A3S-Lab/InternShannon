import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const INPUTS_PATH = path.join(REPO_ROOT, "packaging", "rc", "RC-INPUTS.json");

function sha256File(filePath) {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function option(name, argv = process.argv) {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
}

function requiredString(value, label) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`missing ${label}`);
	}
	return value.trim();
}

function githubEnvironment(environment) {
	if (environment.GH_TOKEN?.trim() || environment.GITHUB_TOKEN?.trim()) {
		return environment;
	}
	const credential = spawnSync("git", ["credential", "fill"], {
		input: "protocol=https\nhost=github.com\n\n",
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	if (credential.error || credential.status !== 0) {
		throw new Error(
			"GitHub authentication is unavailable for private RC assets",
		);
	}
	const fields = Object.fromEntries(
		String(credential.stdout)
			.trim()
			.split(/\r?\n/u)
			.map((line) => {
				const separator = line.indexOf("=");
				return separator < 0
					? [line, ""]
					: [line.slice(0, separator), line.slice(separator + 1)];
			}),
	);
	if (!fields.password) {
		throw new Error(
			"GitHub credential manager returned no private asset token",
		);
	}
	return { ...environment, GH_TOKEN: fields.password };
}

export function selectPrivateReleaseAsset({
	assets,
	assetName,
	expectedSha256,
	expectedBytes,
}) {
	const matches = assets.filter((asset) => asset?.name === assetName);
	if (matches.length !== 1) {
		throw new Error(
			`private RC release must contain exactly one ${assetName}; found ${matches.length}`,
		);
	}
	const asset = matches[0];
	if (!Number.isInteger(asset.id) || asset.id <= 0) {
		throw new Error(
			`private RC release asset ${assetName} has no stable asset id`,
		);
	}
	if (Number.isInteger(expectedBytes) && asset.size !== expectedBytes) {
		throw new Error(
			`private RC release asset size mismatch for ${assetName}: expected=${expectedBytes} actual=${asset.size}`,
		);
	}
	if (asset.digest && asset.digest !== `sha256:${expectedSha256}`) {
		throw new Error(
			`private RC release digest mismatch for ${assetName}: expected=sha256:${expectedSha256} actual=${asset.digest}`,
		);
	}
	return asset;
}

function downloadPrivateReleaseAsset({
	repository,
	releaseTag,
	assetName,
	expectedSha256,
	expectedBytes,
	destination,
	environment,
}) {
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
		throw new Error(`invalid private RC repository ${repository}`);
	}
	const ghEnvironment = githubEnvironment(environment);
	const release = spawnSync(
		"gh",
		["api", `repos/${repository}/releases/tags/${releaseTag}`],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: ghEnvironment,
			timeout: 60_000,
			maxBuffer: 8 * 1024 * 1024,
		},
	);
	if (release.error || release.status !== 0) {
		throw new Error(
			`could not inspect private RC release: ${release.error?.message ?? release.stderr ?? "unknown gh failure"}`,
		);
	}
	const releaseMetadata = JSON.parse(release.stdout);
	const asset = selectPrivateReleaseAsset({
		assets: releaseMetadata.assets ?? [],
		assetName,
		expectedSha256,
		expectedBytes,
	});
	const token =
		ghEnvironment.GH_TOKEN?.trim() || ghEnvironment.GITHUB_TOKEN?.trim();
	const curlConfig = [
		`url = "https://api.github.com/repos/${repository}/releases/assets/${asset.id}"`,
		'header = "Accept: application/octet-stream"',
		`header = "Authorization: Bearer ${token}"`,
		'header = "X-GitHub-Api-Version: 2022-11-28"',
		'header = "User-Agent: shuxiaoan-controlled-rc-restore"',
		"location",
		"fail",
		"silent",
		"show-error",
		"retry = 3",
		"retry-all-errors",
		"retry-delay = 2",
		"connect-timeout = 30",
		"max-time = 300",
		`output = "${destination.split(path.sep).join("/")}"`,
		"",
	].join("\n");
	const download = spawnSync("curl", ["--config", "-"], {
		input: curlConfig,
		encoding: "utf8",
		stdio: ["pipe", "ignore", "pipe"],
		timeout: 330_000,
	});
	if (download.error || download.status !== 0) {
		fs.rmSync(destination, { force: true });
		throw new Error(
			`could not download ${assetName} from private RC release: ${download.error?.message ?? download.stderr}`,
		);
	}
	const downloadedBytes = fs.statSync(destination).size;
	return {
		assetId: asset.id,
		bytes: downloadedBytes,
		remoteDigest: asset.digest ?? null,
	};
}

export function resolveRestoreAuthority({ status, localAssetDir, target }) {
	if (status === "verified") {
		return localAssetDir ? "local" : "private-release";
	}
	if (status === "verified-local-pending-private-asset") {
		if (!localAssetDir) {
			throw new Error(
				`controlled A3S target ${target} is verified locally but its private release asset is pending; pass --asset-dir explicitly`,
			);
		}
		return "local";
	}
	throw new Error(
		`controlled A3S target ${target} is not verified; refusing registry or cross-platform fallback`,
	);
}

export function restoreControlledA3s({
	argv = process.argv,
	environment = process.env,
	inputsPath = INPUTS_PATH,
} = {}) {
	const inputs = JSON.parse(fs.readFileSync(inputsPath, "utf8"));
	const target =
		option("--target", argv) ?? `${process.platform}-${process.arch}`;
	const targetInput = inputs?.controlledA3s?.targets?.[target];
	if (!targetInput) {
		throw new Error(
			`controlled A3S policy has no target ${target}; refusing registry or cross-platform fallback`,
		);
	}

	const localAssetDir =
		option("--asset-dir", argv) ?? environment.INTERNSHANNON_RC_ASSET_DIR;
	const authority = resolveRestoreAuthority({
		status: targetInput.status,
		localAssetDir,
		target,
	});
	const expectedSha256 = requiredString(targetInput.sha256, `${target}.sha256`);
	if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
		throw new Error(`invalid SHA-256 for ${target}`);
	}

	const assetName = requiredString(targetInput.asset, `${target}.asset`);
	if (assetName !== path.basename(assetName)) {
		throw new Error(`unsafe controlled A3S asset name for ${target}`);
	}
	const configuredDestination = path.resolve(
		REPO_ROOT,
		targetInput.destination,
	);
	if (!configuredDestination.startsWith(`${REPO_ROOT}${path.sep}`)) {
		throw new Error(
			`unsafe controlled A3S destination: ${targetInput.destination}`,
		);
	}
	const destination = path.resolve(
		option("--destination", argv) ?? configuredDestination,
	);
	const releaseRepository =
		environment.INTERNSHANNON_RC_REPOSITORY ?? inputs.repository;
	let privateReleaseAsset = null;

	const temporaryDirectory = fs.mkdtempSync(
		path.join(os.tmpdir(), "internshannon-rc-a3s-"),
	);
	const downloadedPath = path.join(temporaryDirectory, assetName);

	try {
		if (authority === "local") {
			fs.copyFileSync(path.resolve(localAssetDir, assetName), downloadedPath);
		} else {
			privateReleaseAsset = downloadPrivateReleaseAsset({
				repository: releaseRepository,
				releaseTag: inputs.releaseTag,
				assetName,
				expectedSha256,
				expectedBytes: targetInput.bytes,
				destination: downloadedPath,
				environment,
			});
		}

		const actualSha256 = sha256File(downloadedPath);
		if (actualSha256 !== expectedSha256) {
			throw new Error(
				`controlled A3S SHA-256 mismatch for ${target}: expected=${expectedSha256} actual=${actualSha256}`,
			);
		}

		fs.mkdirSync(path.dirname(destination), { recursive: true });
		fs.copyFileSync(downloadedPath, destination);
		fs.writeFileSync(
			`${destination}.sha256`,
			`${actualSha256}  ${path.basename(destination)}\n`,
		);
		return {
			ok: true,
			target,
			destination,
			sha256: actualSha256,
			authority,
			privateReleaseAsset,
		};
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
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
		process.stdout.write(`${JSON.stringify(restoreControlledA3s())}\n`);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	}
}
