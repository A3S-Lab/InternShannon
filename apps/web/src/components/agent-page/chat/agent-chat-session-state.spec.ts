import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAgentChatSessionRuntimeState } from "./agent-chat-session-state.ts";

test("normalizes malformed chat session runtime state before AgentChat render", () => {
  assert.deepEqual(
    resolveAgentChatSessionRuntimeState({
      systemPrompt: { text: "legacy object prompt" },
    }),
    {
      systemPrompt: undefined,
    },
  );

  assert.deepEqual(
    resolveAgentChatSessionRuntimeState({
      system_prompt: "  keep the runtime prompt  ",
    }),
    {
      systemPrompt: "keep the runtime prompt",
    },
  );
});
