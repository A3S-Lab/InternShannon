import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRuntimeModelConfigSnapshot,
  resolveRuntimeApiKey,
  resolveRuntimeBaseUrl,
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

  assert.equal(resolveRuntimeApiKey(oldSnapshot, "openai", "gpt-4.1"), "old-key");
  assert.equal(resolveRuntimeBaseUrl(oldSnapshot, "openai", "gpt-4.1"), "https://old.example/v1");
  assert.equal(resolveRuntimeApiKey(newSnapshot, "openai", "gpt-4.1"), "new-key");
  assert.equal(resolveRuntimeBaseUrl(newSnapshot, "openai", "gpt-4.1"), "https://new.example/v1");
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

  assert.equal(resolveRuntimeApiKey(snapshot, "openai", "gpt-4.1"), "model-key");
  assert.equal(resolveRuntimeBaseUrl(snapshot, "openai", "gpt-4.1"), "https://model.example/v1");
});
