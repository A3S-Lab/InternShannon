import crypto from "node:crypto";

const PLATFORM_KEYS = Object.freeze({
	"darwin-arm64": "darwin-arm64",
	"darwin-x64": "darwin-x64",
	"linux-arm64": "linux-arm64",
	"linux-x64": "linux-x64",
});

const SYSTEM_CHROMIUM_FALLBACKS = Object.freeze({
	"win32-x64": Object.freeze({
		schemaVersion: 1,
		mode: "system-chromium-fallback",
		platform: "win32-x64",
		bundledBinary: false,
		browserOrder: Object.freeze(["chrome", "edge"]),
		executableNames: Object.freeze(["chrome.exe", "msedge.exe"]),
	}),
});

function targetKey(platform, arch) {
	return `${platform}-${arch}`;
}

export function resolveBrowserManifestEntry(
	manifest,
	platform = process.platform,
	arch = process.arch,
) {
	const key = PLATFORM_KEYS[`${platform}-${arch}`];
	if (!key) return null;
	const entry = manifest?.platforms?.[key];
	if (!entry?.url || !/^[a-f0-9]{64}$/i.test(entry.sha256 || "")) {
		throw new Error(
			`browser manifest entry ${key} is missing a valid URL or SHA-256`,
		);
	}
	return { key, snapshot: manifest.snapshot, ...entry };
}

export function resolveSystemChromiumFallback(
	platform = process.platform,
	arch = process.arch,
) {
	const entry = SYSTEM_CHROMIUM_FALLBACKS[targetKey(platform, arch)];
	if (!entry) return null;
	return {
		...entry,
		browserOrder: [...entry.browserOrder],
		executableNames: [...entry.executableNames],
	};
}

export function validateSystemChromiumFallbackManifest(
	manifest,
	platform = process.platform,
	arch = process.arch,
) {
	const expected = resolveSystemChromiumFallback(platform, arch);
	if (!expected) {
		throw new Error(
			`system Chromium fallback is not approved for ${targetKey(platform, arch)}`,
		);
	}
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw new Error("system Chromium fallback manifest must be an object");
	}
	const expectedKeys = Object.keys(expected).sort();
	const actualKeys = Object.keys(manifest).sort();
	if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
		throw new Error("system Chromium fallback manifest has unexpected fields");
	}
	for (const key of ["schemaVersion", "mode", "platform", "bundledBinary"]) {
		if (manifest[key] !== expected[key]) {
			throw new Error(`system Chromium fallback manifest has invalid ${key}`);
		}
	}
	for (const key of ["browserOrder", "executableNames"]) {
		if (JSON.stringify(manifest[key]) !== JSON.stringify(expected[key])) {
			throw new Error(`system Chromium fallback manifest has invalid ${key}`);
		}
	}
	return manifest;
}

export function sha256(bytes) {
	return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function assertBrowserChecksum(bytes, expected) {
	const actual = sha256(bytes);
	if (actual !== expected.toLowerCase()) {
		throw new Error(
			`Lightpanda checksum mismatch: expected ${expected}, got ${actual}`,
		);
	}
	return actual;
}

export function validateBrowserReleasePin(entry) {
	if (!entry) throw new Error("browser release pin is missing");
	if (!/^\d+\.\d+\.\d+@[a-f0-9]{40}$/i.test(entry.snapshot || "")) {
		throw new Error(
			"browser snapshot must bind a semantic version to a 40-character commit",
		);
	}
	const releaseVersion = entry.snapshot.split("@", 1)[0];
	const parsedUrl = new URL(entry.url);
	if (
		parsedUrl.protocol !== "https:" ||
		parsedUrl.hostname !== "github.com" ||
		!parsedUrl.pathname.startsWith(
			`/lightpanda-io/browser/releases/download/${releaseVersion}/`,
		)
	) {
		throw new Error(
			"browser URL must use the pinned official versioned release",
		);
	}
	return entry;
}

export function assertBrowserVersionOutput(output, snapshot) {
	const expectedVersion = snapshot?.split("@", 1)[0];
	if (!/^\d+\.\d+\.\d+$/.test(expectedVersion || "")) {
		throw new Error("browser snapshot is missing a semantic version");
	}
	const actualVersion = String(output || "").trim();
	if (actualVersion !== expectedVersion) {
		throw new Error(
			`Lightpanda version mismatch: expected ${expectedVersion}, got ${actualVersion || "empty output"}`,
		);
	}
	return actualVersion;
}
