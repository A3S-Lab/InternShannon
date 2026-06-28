import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizePersistedSdkSessions,
  normalizePersistedSessionCreatedAt,
  normalizePersistedSessionNames,
} from "./agent-session-persistence.ts";

test("normalizes persisted ISO session timestamps", () => {
  assert.equal(normalizePersistedSessionCreatedAt("2026-06-04T12:34:58.590Z"), Date.parse("2026-06-04T12:34:58.590Z"));
});

test("normalizes numeric session timestamps", () => {
  assert.equal(normalizePersistedSessionCreatedAt(1780576498590), 1780576498590);
  assert.equal(normalizePersistedSessionCreatedAt(1780576498), 1780576498000);
  assert.equal(normalizePersistedSessionCreatedAt("1780576498590"), 1780576498590);
  assert.equal(normalizePersistedSessionCreatedAt("1780576498"), 1780576498000);
});

test("falls back for invalid persisted session timestamps", () => {
  assert.equal(normalizePersistedSessionCreatedAt("", 1234), 1234);
  assert.equal(normalizePersistedSessionCreatedAt("not a date", 1234), 1234);
  assert.equal(normalizePersistedSessionCreatedAt(null, 1234), 1234);
});

test("normalizes malformed persisted SDK sessions before Agent state boot", () => {
  const sessions = normalizePersistedSdkSessions(
    [
      {
        sessionId: 42,
        agentId: { id: "ignored" },
        state: "running",
        createdAt: "1780576498",
        cwd: { path: "/tmp/legacy" },
        model: 123,
        followDefaultModel: "yes",
        permissionMode: "",
        pid: "not-a-number",
        metadata: { restored: true },
      },
      {
        sessionId: "   ",
        createdAt: "2026-06-04T12:34:58.590Z",
        cwd: "/tmp/drop-empty-id",
      },
      {
        sessionId: "session-ok",
        state: "exited",
        createdAt: "2026-06-04T12:34:58.590Z",
        cwd: "/tmp/workspace",
        model: "openai/gpt-4.1",
        followDefaultModel: false,
        permissionMode: "acceptEdits",
        name: " Restored ",
      },
    ],
    {
      fallbackCreatedAt: 1111,
      exposeWorkspacePath: (path) => (path ? `safe:${path}` : ""),
    },
  );

  assert.deepEqual(sessions, [
    {
      sessionId: "42",
      agentId: null,
      state: "running",
      createdAt: 1780576498000,
      cwd: "",
      followDefaultModel: true,
      metadata: { restored: true },
    },
    {
      sessionId: "session-ok",
      agentId: null,
      state: "exited",
      createdAt: Date.parse("2026-06-04T12:34:58.590Z"),
      cwd: "safe:/tmp/workspace",
      model: "openai/gpt-4.1",
      followDefaultModel: false,
      permissionMode: "acceptEdits",
      name: "Restored",
    },
  ]);
});

test("normalizes malformed persisted session names before Agent UI render", () => {
  assert.deepEqual(
    normalizePersistedSessionNames({
      "session-1": "  Local name  ",
      "session-2": { label: "bad object" },
      "session-3": "",
      "session-4": 42,
      "   ": "empty id",
    }),
    {
      "session-1": "Local name",
      "session-4": "42",
    },
  );

  assert.deepEqual(normalizePersistedSessionNames(["not", "a", "map"]), {});
});
