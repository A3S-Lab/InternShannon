import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatAgentMessageExecuteError,
  formatAgentMessageSourceLabel,
  normalizeAgentInboxMessages,
  resolveAgentMessageExecuteAction,
  resolveAgentMessageExecuteFeedback,
} from "./agent-message-inbox-state.ts";

test("removes agent inbox messages after a successful execute", () => {
  assert.equal(resolveAgentMessageExecuteAction({ sent: true, autoExecute: false }), "remove");
  assert.equal(resolveAgentMessageExecuteAction({ sent: true, autoExecute: true }), "remove");
});

test("keeps manual agent inbox messages visible when execute fails", () => {
  assert.equal(resolveAgentMessageExecuteAction({ sent: false, autoExecute: false }), "keep");
});

test("surfaces failed auto-execute messages as manual inbox items", () => {
  assert.equal(resolveAgentMessageExecuteAction({ sent: false, autoExecute: true }), "show_manual");
});

test("formats agent message execute errors without losing backend details", () => {
  assert.equal(formatAgentMessageExecuteError(new Error("sidecar offline"), "fallback"), "sidecar offline");
  assert.equal(formatAgentMessageExecuteError(" permission denied ", "fallback"), "permission denied");
  assert.equal(formatAgentMessageExecuteError({ message: "workspace missing" }, "fallback"), "workspace missing");
  assert.equal(formatAgentMessageExecuteError({ reason: "unknown" }, "执行失败"), "执行失败");
});

test("shows stable inline feedback while an agent inbox message is executing", () => {
  assert.deepEqual(
    resolveAgentMessageExecuteFeedback({
      executing: true,
      executionError: "previous failure",
    }),
    {
      tone: "info",
      title: "正在发送",
      message: "正在把这条 Agent 消息发送到当前会话。",
      role: "status",
      ariaLive: "polite",
    },
  );
});

test("shows row-scoped execute failures after the attempt settles", () => {
  assert.deepEqual(
    resolveAgentMessageExecuteFeedback({
      executing: false,
      executionError: " sidecar offline ",
    }),
    {
      tone: "error",
      title: "执行失败",
      message: "sidecar offline",
      role: "alert",
      ariaLive: "assertive",
    },
  );
  assert.equal(resolveAgentMessageExecuteFeedback({ executing: false, executionError: " " }), null);
  assert.equal(resolveAgentMessageExecuteFeedback({ executing: false }), null);
});

test("normalizes legacy agent inbox messages before rendering rows", () => {
  assert.deepEqual(
    normalizeAgentInboxMessages([
      {
        message_id: "agent-message-1",
        content: "please continue the task",
        topic: 42,
        auto_execute: true,
      },
    ]),
    [
      {
        messageId: "agent-message-1",
        fromSessionId: "unknown",
        topic: "Agent 消息",
        content: "please continue the task",
        autoExecute: true,
      },
    ],
  );
});

test("formats missing agent inbox source ids without throwing", () => {
  assert.equal(formatAgentMessageSourceLabel("unknown"), "未知会话");
  assert.equal(formatAgentMessageSourceLabel("session-abcdef"), "session-…");
});
