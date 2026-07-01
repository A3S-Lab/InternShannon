import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveModelLimit, resolveModelLimitPreset } from "./llm-model-limits.ts";

test("resolves bounded modern model limit presets by model id", () => {
  assert.deepEqual(resolveModelLimitPreset("gpt-5.5-codex"), { context: 258000, output: 128000 });
  assert.deepEqual(resolveModelLimitPreset("gpt-5.4-mini"), { context: 258000, output: 128000 });
  assert.deepEqual(resolveModelLimitPreset("claude-opus-4-7"), { context: 258000, output: 128000 });
  assert.deepEqual(resolveModelLimitPreset("claude-sonnet-5"), { context: 258000, output: 128000 });
  assert.deepEqual(resolveModelLimitPreset("claude-sonnet-4.6"), { context: 258000, output: 128000 });
  assert.deepEqual(resolveModelLimitPreset("claude-haiku-4.5"), { context: 200000, output: 65536 });
  assert.deepEqual(resolveModelLimitPreset("gemini-2.5-pro"), { context: 258000, output: 65536 });
  assert.deepEqual(resolveModelLimitPreset("custom-frontier"), { context: 128000, output: 65536 });
  assert.deepEqual(resolveModelLimitPreset("openai/gpt-5.5-codex"), { context: 258000, output: 128000 });
  assert.deepEqual(resolveModelLimitPreset("anthropic/claude-sonnet-5"), { context: 258000, output: 128000 });
});

test("upgrades generated output and context defaults while preserving explicit overrides", () => {
  assert.deepEqual(resolveModelLimit("gpt-5.5", { context: 128000, output: 4096 }), {
    context: 258000,
    output: 128000,
  });
  assert.deepEqual(resolveModelLimit("claude-sonnet-5", { context: 200000, output: 8192 }), {
    context: 258000,
    output: 128000,
  });
  assert.deepEqual(resolveModelLimit("claude-opus-4-7", { context: 200000, output: 65536 }), {
    context: 258000,
    output: 128000,
  });
  assert.deepEqual(resolveModelLimit("gpt-5.5", { context: 1000000, output: 128000 }), {
    context: 258000,
    output: 128000,
  });
  assert.deepEqual(resolveModelLimit("gpt-5.4-mini", { context: 400000, output: 128000 }), {
    context: 258000,
    output: 128000,
  });
  assert.deepEqual(resolveModelLimit("gemini-2.5-pro", { context: 1000000, output: 16384 }), {
    context: 258000,
    output: 65536,
  });
  assert.deepEqual(resolveModelLimit("custom-frontier", { context: 128000, output: 4096 }), {
    context: 128000,
    output: 65536,
  });
  assert.deepEqual(resolveModelLimit("gpt-5.5", { context: 250000, output: 32000 }), {
    context: 250000,
    output: 32000,
  });
  assert.deepEqual(resolveModelLimit("custom-frontier", { context: "200000", output: "4096" }), {
    context: 200000,
    output: 65536,
  });
});
