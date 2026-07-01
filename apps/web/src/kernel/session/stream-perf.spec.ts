import * as assert from "node:assert/strict";
import { test } from "node:test";
import { computeToolInputStreamMs, inferStreamSlowStage } from "./stream-perf.ts";

test("classifies long first model wait before a fast list tool as model latency", () => {
  assert.equal(
    inferStreamSlowStage({
      firstDeltaMs: 17_000,
      firstToolStartMs: 17_100,
      resultMs: 17_250,
    }),
    "model_first_token",
  );
});

test("classifies large tool argument streaming separately from execution", () => {
  const timing = {
    firstToolStartMs: 9_000,
    firstToolInputDeltaMs: 9_010,
    lastToolInputDeltaMs: 39_500,
    firstToolEndMs: 39_700,
    resultMs: 39_800,
  };

  assert.equal(computeToolInputStreamMs(timing), 30_500);
  assert.equal(inferStreamSlowStage(timing), "tool_input_streaming");
});

test("keeps genuinely slow post-input tools classified as tool execution", () => {
  assert.equal(
    inferStreamSlowStage({
      firstToolStartMs: 1_000,
      firstToolInputDeltaMs: 1_030,
      lastToolInputDeltaMs: 1_080,
      firstToolEndMs: 12_000,
      resultMs: 12_100,
    }),
    "tool_exec",
  );
});

test("prefers frontend send when no model or tool stage is slower", () => {
  assert.equal(
    inferStreamSlowStage({
      transportOverheadMs: 2_000,
      firstDeltaMs: 2_500,
      resultMs: 3_000,
    }),
    "frontend_send",
  );
});
