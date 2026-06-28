import * as assert from "node:assert/strict";
import { test } from "node:test";
import { shouldApplyMessageHistoryReplay } from "./message-history-replay.ts";

test("keeps local chat history when a reconnect replays an empty message_history", () => {
  assert.equal(
    shouldApplyMessageHistoryReplay({
      existingMessages: [
        {
          id: "user-1",
          role: "user",
          content: "hello before switching tabs",
          timestamp: 1,
        },
      ],
      replayMessages: [],
    }),
    false,
  );
});

test("allows empty message_history for an already-empty session", () => {
  assert.equal(
    shouldApplyMessageHistoryReplay({
      existingMessages: [],
      replayMessages: [],
    }),
    true,
  );
});

test("applies non-empty message_history as the server replay source of truth", () => {
  assert.equal(
    shouldApplyMessageHistoryReplay({
      existingMessages: [
        {
          id: "local-user",
          role: "user",
          content: "stale local text",
          timestamp: 1,
        },
      ],
      replayMessages: [
        {
          id: "server-user",
          role: "user",
          content: "server replay text",
          timestamp: 2,
        },
      ],
    }),
    true,
  );
});
