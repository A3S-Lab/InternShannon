import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeBackendModelConfig } from "./settings-model-config-normalization.ts";

test("normalizes malformed backend model config without dropping valid providers", () => {
  const normalized = normalizeBackendModelConfig({
    providers: [
      null,
      {
        name: " openai ",
        apiKey: 42,
        baseUrl: " https://api.example.test ",
        models: [
          null,
          {
            id: " gpt-4.1 ",
            name: "",
            family: 123,
            apiKey: "[configured]",
            baseUrl: 7,
            attachment: "true",
            reasoning: "false",
            toolCall: "yes",
            temperature: "no",
            releaseDate: 20260401,
            modalities: { input: [" text ", 42, "image"], output: [" text "] },
            cost: { input: "1.25", output: 2, cacheRead: "0.1", cacheWrite: null },
            limit: { context: "128000", output: 4096 },
          },
          {
            id: " ",
            name: "drop empty id",
          },
        ],
      },
      {
        name: { text: "bad" },
        models: [{ id: "drop bad provider" }],
      },
      {
        name: "anthropic",
        models: { id: "not-array" },
      },
    ],
    defaultModel: "openai/gpt-4.1",
  });

  assert.equal(normalized.defaultProvider, "openai");
  assert.equal(normalized.defaultModel, "gpt-4.1");
  assert.deepEqual(normalized.providers, [
    {
      name: "openai",
      baseUrl: "https://api.example.test",
      models: [
        {
          id: "gpt-4.1",
          name: "gpt-4.1",
          apiKey: "[configured]",
          attachment: true,
          reasoning: false,
          toolCall: true,
          temperature: false,
          releaseDate: "20260401",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 1.25, output: 2, cacheRead: 0.1 },
          limit: { context: 128000, output: 4096 },
        },
      ],
    },
    {
      name: "anthropic",
      models: [],
    },
  ]);
});

test("keeps redacted backend API key sentinels so settings inputs show configured credentials", () => {
  const normalized = normalizeBackendModelConfig({
    providers: [
      {
        name: "openai",
        apiKey: "[configured]",
        models: [{ id: "gpt-4.1", apiKey: "[configured]" }],
      },
    ],
    defaultModel: "openai/gpt-4.1",
  });

  assert.equal(normalized.providers[0].apiKey, "[configured]");
  assert.equal(normalized.providers[0].models[0].apiKey, "[configured]");
});

test("falls back to the first valid provider and model when the default reference is unusable", () => {
  const normalized = normalizeBackendModelConfig({
    providers: [
      { name: "openai", models: [{ id: "gpt-4.1" }] },
      { name: "anthropic", models: [{ id: "claude-sonnet-4" }] },
    ],
    default_model: "missing/nope",
  });

  assert.equal(normalized.defaultProvider, "openai");
  assert.equal(normalized.defaultModel, "gpt-4.1");
});

test("keeps a bare default model only when it exists under a valid provider", () => {
  assert.deepEqual(
    normalizeBackendModelConfig({
      providers: [
        { name: "openai", models: [{ id: "gpt-4.1" }] },
        { name: "anthropic", models: [{ id: "claude-sonnet-4" }] },
      ],
      defaultModel: "claude-sonnet-4",
    }),
    {
      providers: [
        { name: "openai", models: [{ id: "gpt-4.1", name: "gpt-4.1" }] },
        { name: "anthropic", models: [{ id: "claude-sonnet-4", name: "claude-sonnet-4" }] },
      ],
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4",
    },
  );
});
