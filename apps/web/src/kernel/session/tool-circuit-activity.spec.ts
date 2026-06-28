import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeToolCircuitActivity } from "./tool-circuit-activity.ts";

test("normalizes legacy tool_circuit_open aliases before InternShannon renders circuit breakers", () => {
  assert.deepEqual(
    normalizeToolCircuitActivity(
      {
        type: "tool_circuit_open",
        tool_name: "web_search",
        consecutive_failures: "3",
      },
      { timestamp: 5_000 },
    ),
    {
      id: "tool_circuit_open:web_search:5000",
      kind: "tool",
      status: "failed",
      phase: "circuit_open",
      label: "工具熔断：web_search",
      detail: "web_search 连续失败 3 次，运行时已熔断本轮以避免空转",
      source: "工具运行器",
      toolName: "web_search",
      timestamp: 5_000,
    },
  );
});

test("falls back to tool ids before InternShannon renders circuit breakers", () => {
  assert.deepEqual(
    normalizeToolCircuitActivity(
      {
        type: "tool_circuit_open",
        tool_id: "tool-legacy-1",
        consecutive_failures: "3",
      },
      { timestamp: 5_100 },
    ),
    {
      id: "tool_circuit_open:tool-legacy-1:5100",
      kind: "tool",
      status: "failed",
      phase: "circuit_open",
      label: "工具熔断：tool-legacy-1",
      detail: "tool-legacy-1 连续失败 3 次，运行时已熔断本轮以避免空转",
      source: "工具运行器",
      toolName: "tool-legacy-1",
      timestamp: 5_100,
    },
  );
});

test("trims legacy tool_circuit_open fields before InternShannon groups circuit breaker activity", () => {
  assert.deepEqual(
    normalizeToolCircuitActivity(
      {
        type: "tool_circuit_open",
        tool_name: " Read ",
        consecutive_failures: "3",
      },
      { timestamp: 5_200 },
    ),
    {
      id: "tool_circuit_open:Read:5200",
      kind: "tool",
      status: "failed",
      phase: "circuit_open",
      label: "工具熔断：Read",
      detail: "Read 连续失败 3 次，运行时已熔断本轮以避免空转",
      source: "工具运行器",
      toolName: "Read",
      timestamp: 5_200,
    },
  );
});

test("ignores blank tool_circuit_open aliases before InternShannon groups circuit breaker activity", () => {
  assert.deepEqual(
    normalizeToolCircuitActivity(
      {
        type: "tool_circuit_open",
        toolName: "   ",
        tool_name: " Read ",
        consecutiveFailures: "   ",
        consecutive_failures: "4",
      },
      { timestamp: 5_300 },
    ),
    {
      id: "tool_circuit_open:Read:5300",
      kind: "tool",
      status: "failed",
      phase: "circuit_open",
      label: "工具熔断：Read",
      detail: "Read 连续失败 4 次，运行时已熔断本轮以避免空转",
      source: "工具运行器",
      toolName: "Read",
      timestamp: 5_300,
    },
  );
});
