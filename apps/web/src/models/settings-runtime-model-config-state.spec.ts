import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	createRuntimeModelConfigSnapshot,
	formatResolvedRuntimeModel,
	resolveExactRuntimeModel,
	resolvePinnedRuntimeModel,
	resolveRuntimeApiKey,
	resolveRuntimeBaseUrl,
	resolveSessionRuntimeModel,
} from "./settings-runtime-model-config-state.ts";

test("runtime model config snapshots are isolated from later provider edits", () => {
	const providers = [
		{
			name: "openai",
			apiKey: "old-key",
			baseUrl: "https://old.example/v1",
			models: [{ id: "gpt-4.1", name: "GPT-4.1" }],
		},
	];
	const oldSnapshot = createRuntimeModelConfigSnapshot({
		providers,
		defaultProvider: "openai",
		defaultModel: "gpt-4.1",
	});

	providers[0].apiKey = "new-key";
	providers[0].baseUrl = "https://new.example/v1";
	const newSnapshot = createRuntimeModelConfigSnapshot({
		providers,
		defaultProvider: "openai",
		defaultModel: "gpt-4.1",
	});

	assert.equal(
		resolveRuntimeApiKey(oldSnapshot, "openai", "gpt-4.1"),
		"old-key",
	);
	assert.equal(
		resolveRuntimeBaseUrl(oldSnapshot, "openai", "gpt-4.1"),
		"https://old.example/v1",
	);
	assert.equal(
		resolveRuntimeApiKey(newSnapshot, "openai", "gpt-4.1"),
		"new-key",
	);
	assert.equal(
		resolveRuntimeBaseUrl(newSnapshot, "openai", "gpt-4.1"),
		"https://new.example/v1",
	);
});

test("runtime default resolution fails closed instead of choosing another credentialed provider", () => {
	const snapshot = createRuntimeModelConfigSnapshot({
		providers: [
			{ name: "boyue", apiKey: "", models: [{ id: "gpt-5", name: "GPT-5" }] },
			{
				name: "zhipu",
				apiKey: "zhipu-key",
				models: [{ id: "glm-5.2", name: "GLM-5.2" }],
			},
		],
		defaultProvider: "boyue",
		defaultModel: "gpt-5",
	});

	assert.equal(
		resolveExactRuntimeModel(
			snapshot,
			snapshot.defaultProvider,
			snapshot.defaultModel,
		),
		null,
	);
	assert.equal(resolvePinnedRuntimeModel(snapshot, "boyue/gpt-5"), null);
	assert.deepEqual(resolvePinnedRuntimeModel(snapshot, "zhipu/glm-5.2"), {
		providerName: "zhipu",
		modelId: "glm-5.2",
	});
});

test("runtime model resolution rejects missing, empty, and ambiguous models", () => {
	const snapshot = createRuntimeModelConfigSnapshot({
		providers: [
			{
				name: "one",
				apiKey: "key-one",
				models: [{ id: "shared", name: "Shared One" }],
			},
			{
				name: "two",
				apiKey: "key-two",
				models: [{ id: "shared", name: "Shared Two" }],
			},
		],
		defaultProvider: "missing",
		defaultModel: "nope",
	});

	assert.equal(resolveExactRuntimeModel(snapshot, "missing", "nope"), null);
	assert.equal(resolvePinnedRuntimeModel(snapshot, ""), null);
	assert.equal(resolvePinnedRuntimeModel(snapshot, "shared"), null);
});

test("formats only fully resolved runtime models", () => {
	assert.equal(
		formatResolvedRuntimeModel({ providerName: "zhipu", modelId: "glm-5.2" }),
		"zhipu/glm-5.2",
	);
	assert.equal(formatResolvedRuntimeModel(null), null);
	assert.equal(
		formatResolvedRuntimeModel({ providerName: "", modelId: "glm-5.2" }),
		null,
	);
});

test("runtime model config resolution prefers model overrides", () => {
	const snapshot = createRuntimeModelConfigSnapshot({
		providers: [
			{
				name: "openai",
				apiKey: "provider-key",
				baseUrl: "https://provider.example/v1",
				models: [
					{
						id: "gpt-4.1",
						name: "GPT-4.1",
						apiKey: "model-key",
						baseUrl: "https://model.example/v1",
					},
				],
			},
		],
		defaultProvider: "openai",
		defaultModel: "gpt-4.1",
	});

	assert.equal(
		resolveRuntimeApiKey(snapshot, "openai", "gpt-4.1"),
		"model-key",
	);
	assert.equal(
		resolveRuntimeBaseUrl(snapshot, "openai", "gpt-4.1"),
		"https://model.example/v1",
	);
});

test("session routing resolves only exact defaults and exact pinned models", () => {
	const snapshot = createRuntimeModelConfigSnapshot({
		providers: [
			{ name: "boyue", apiKey: "", models: [{ id: "gpt-5", name: "GPT-5" }] },
			{
				name: "zhipu",
				apiKey: "zhipu-key",
				models: [{ id: "glm-5.2", name: "GLM-5.2" }],
			},
		],
		defaultProvider: "boyue",
		defaultModel: "gpt-5",
	});

	assert.equal(resolveSessionRuntimeModel(snapshot, undefined, true), null);
	assert.equal(resolveSessionRuntimeModel(snapshot), null);
	assert.equal(
		resolveSessionRuntimeModel(snapshot, "boyue/gpt-5", false),
		null,
	);
	assert.deepEqual(
		resolveSessionRuntimeModel(snapshot, "zhipu/glm-5.2", false),
		{
			providerName: "zhipu",
			modelId: "glm-5.2",
		},
	);
	assert.equal(
		resolveSessionRuntimeModel(snapshot, "missing/nope", false),
		null,
	);
});
