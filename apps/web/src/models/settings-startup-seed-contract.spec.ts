import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const settingsSource = readFileSync(
	fileURLToPath(new URL("./settings.model.ts", import.meta.url)),
	"utf8",
);
const dialogSource = readFileSync(
	fileURLToPath(
		new URL(
			"../desktop/layouts/chat/components/startup-config-dialog.tsx",
			import.meta.url,
		),
	),
	"utf8",
);
const aiSectionSource = readFileSync(
	fileURLToPath(
		new URL(
			"../desktop/pages/settings/components/ai-section.tsx",
			import.meta.url,
		),
	),
	"utf8",
);
const normalizationSource = readFileSync(
	fileURLToPath(
		new URL("./settings-model-config-normalization.ts", import.meta.url),
	),
	"utf8",
);

test("settings seed reports a failed config fetch instead of treating health as successful initialization", () => {
	assert.match(settingsSource, /const _seedPromise = new Promise<boolean>/);
	assert.match(settingsSource, /resolveSeedOnce\(loaded\)/);
	assert.match(
		settingsSource,
		/Failed to load settings from ConfigModule after retries/,
	);
	assert.doesNotMatch(
		settingsSource,
		/Failed to load settings from ConfigModule, using defaults/,
	);
});

test("settings seed retries in one lifecycle so waitForSeed is not resolved by an outer recursive finally", () => {
	const seedStart = settingsSource.indexOf("async function seedFromBackend");
	const syncStart = settingsSource.indexOf(
		"async function syncToBackend",
		seedStart,
	);
	const seedSource = settingsSource.slice(seedStart, syncStart);

	assert.match(seedSource, /while \(true\)/);
	assert.doesNotMatch(seedSource, /return seedFromBackend\(/);
	assert.match(seedSource, /finally \{\s*resolveSeedOnce\(loaded\);/s);
});

test("startup dialog only evaluates first-run requirements after backend settings really load", () => {
	assert.match(
		dialogSource,
		/const backendModelsLoaded = initialLoadSucceeded \|\| \(await ensureBackendModelsLoaded\(\)\)/,
	);
	assert.match(dialogSource, /if \(!backendModelsLoaded\) \{/);
	assert.match(dialogSource, /默认配置加载失败/);
	assert.match(dialogSource, /setSeeded\(true\)/);
});

test("AI settings autosave is enabled only after a successful backend seed", () => {
	assert.match(aiSectionSource, /waitForSeed\(\)\.then\(\(loaded\) =>/);
	assert.match(aiSectionSource, /if \(!cancelled && loaded\)/);
	assert.match(
		aiSectionSource,
		/if \(!cancelled && applied\)[\s\S]*seededRef\.current = true/,
	);
});

test("startup model normalization never writes a first-provider fallback into runtime state", () => {
	assert.doesNotMatch(normalizationSource, /fallbackProvider/);
	assert.doesNotMatch(normalizationSource, /defaultProvider:\s*providers\[0\]/);
	assert.doesNotMatch(normalizationSource, /defaultModel:\s*providers\[0\]/);
	assert.match(
		normalizationSource,
		/unresolved persisted value visible for diagnosis/,
	);
	assert.match(
		settingsSource,
		/serializeDefaultModelRef\(\s*state\.defaultProvider,\s*state\.defaultModel/s,
	);
});
