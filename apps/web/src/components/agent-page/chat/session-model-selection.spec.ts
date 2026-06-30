import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPinnedSessionModelPatch,
  buildRoutedSessionModelPatch,
  resolveStatusBarModelValue,
  type StatusBarModelOption,
} from "./session-model-selection.ts";

const models: StatusBarModelOption[] = [
  { value: "openai/gpt-4o", modelId: "gpt-4o" },
  { value: "zhipu/glm-4.5", modelId: "glm-4.5" },
  { value: "minimax/MiniMax-M1", modelId: "MiniMax-M1" },
];

test("selects the routed default model when the session follows defaults", () => {
  assert.equal(
    resolveStatusBarModelValue({
      availableModels: models,
      sessionModel: "",
      followDefaultModel: true,
      routedModel: { providerName: "zhipu", modelId: "glm-4.5" },
    }),
    "zhipu/glm-4.5",
  );
});

test("selects the routed default model for an unpinned session with no model", () => {
  assert.equal(
    resolveStatusBarModelValue({
      availableModels: models,
      routedModel: { providerName: "minimax", modelId: "MiniMax-M1" },
    }),
    "minimax/MiniMax-M1",
  );
});

test("keeps an explicitly pinned full model", () => {
  assert.equal(
    resolveStatusBarModelValue({
      availableModels: models,
      sessionModel: "openai/gpt-4o",
      followDefaultModel: false,
      routedModel: { providerName: "zhipu", modelId: "glm-4.5" },
    }),
    "openai/gpt-4o",
  );
});

test("maps a unique bare model id to its provider-qualified value", () => {
  assert.equal(
    resolveStatusBarModelValue({
      availableModels: models,
      sessionModel: "glm-4.5",
      followDefaultModel: false,
      routedModel: { providerName: "openai", modelId: "gpt-4o" },
    }),
    "zhipu/glm-4.5",
  );
});

test("pins status bar model selections so new sends do not fall back to defaults", () => {
  assert.deepEqual(buildPinnedSessionModelPatch(" zhipu/glm-4.5 "), {
    model: "zhipu/glm-4.5",
    followDefaultModel: false,
  });
});

test("carries explicit follow-default state through send-time runtime configuration", () => {
  assert.deepEqual(buildRoutedSessionModelPatch("openai/gpt-4o", false), {
    model: "openai/gpt-4o",
    followDefaultModel: false,
  });
  assert.deepEqual(buildRoutedSessionModelPatch("zhipu/glm-4.5", true), {
    model: "zhipu/glm-4.5",
    followDefaultModel: true,
  });
  assert.deepEqual(buildRoutedSessionModelPatch("minimax/MiniMax-M1"), {
    model: "minimax/MiniMax-M1",
  });
});
