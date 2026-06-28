import * as assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentMessageRetryMessage, resolveAgentMessageRetryState } from "./agent-message-retry-state.ts";

function message(input: Partial<AgentMessageRetryMessage> & Pick<AgentMessageRetryMessage, "id" | "role">) {
  return input;
}

test("targets the latest assistant response paired with the previous main user turn", () => {
  const state = resolveAgentMessageRetryState({
    readOnly: false,
    isRunning: false,
    messages: [
      message({ id: "u1", role: "user", content: "first" }),
      message({ id: "a1", role: "assistant" }),
      message({ id: "u2", role: "user", content: "latest" }),
      message({ id: "a2", role: "assistant" }),
    ],
  });

  assert.deepEqual(state, {
    assistantMessageId: "a2",
    userMessageId: "u2",
  });
});

test("does not offer retry while the latest main user turn is unanswered", () => {
  const state = resolveAgentMessageRetryState({
    readOnly: false,
    isRunning: false,
    messages: [
      message({ id: "u1", role: "user", content: "first" }),
      message({ id: "a1", role: "assistant" }),
      message({ id: "u2", role: "user", content: "latest" }),
    ],
  });

  assert.deepEqual(state, {
    assistantMessageId: null,
    userMessageId: null,
  });
});

test("hides retry for read-only and running sessions", () => {
  const messages = [message({ id: "u1", role: "user", content: "first" }), message({ id: "a1", role: "assistant" })];

  assert.deepEqual(resolveAgentMessageRetryState({ messages, readOnly: true, isRunning: false }), {
    assistantMessageId: null,
    userMessageId: null,
  });
  assert.deepEqual(resolveAgentMessageRetryState({ messages, readOnly: false, isRunning: true }), {
    assistantMessageId: null,
    userMessageId: null,
  });
});

test("ignores bypass assistant messages when choosing the retry target", () => {
  const state = resolveAgentMessageRetryState({
    readOnly: false,
    isRunning: false,
    messages: [
      message({ id: "u1", role: "user", content: "main" }),
      message({ id: "a1", role: "assistant" }),
      message({ id: "btw-user", role: "user", content: "/btw side note" }),
      message({ id: "btw-assistant", role: "assistant", source: "command:/btw" }),
    ],
  });

  assert.deepEqual(state, {
    assistantMessageId: "a1",
    userMessageId: "u1",
  });
});

test("does not pair a latest main assistant with an earlier user when a later main user has no answer", () => {
  const state = resolveAgentMessageRetryState({
    readOnly: false,
    isRunning: false,
    messages: [
      message({ id: "u1", role: "user", content: "first" }),
      message({ id: "a1", role: "assistant" }),
      message({ id: "u2", role: "user", content: "pending" }),
    ],
  });

  assert.deepEqual(state, {
    assistantMessageId: null,
    userMessageId: null,
  });
});
