import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSessionRelaunchError,
  resolveSessionRelaunchFeedback,
  shouldRelaunchSessionBeforeSend,
} from "./session-relaunch-state.ts";

test("formats session relaunch errors without losing backend details", () => {
  assert.equal(formatSessionRelaunchError(new Error("sidecar offline")), "sidecar offline");
  assert.equal(formatSessionRelaunchError(" relaunch denied "), "relaunch denied");
  assert.equal(formatSessionRelaunchError({ message: "session missing" }), "session missing");
  assert.equal(formatSessionRelaunchError({ reason: "unknown" }), "会话重启失败，请检查本地服务连接后重试。");
});

test("shows progress feedback while an exited session is relaunching", () => {
  assert.deepEqual(
    resolveSessionRelaunchFeedback({
      relaunching: true,
      relaunchError: "previous failure",
    }),
    {
      tone: "info",
      title: "正在重启会话",
      message: "正在重新连接本地 sidecar，并恢复这个会话。",
      role: "status",
      ariaLive: "polite",
    },
  );
});

test("shows relaunch failure feedback after the attempt settles", () => {
  assert.deepEqual(
    resolveSessionRelaunchFeedback({
      relaunching: false,
      relaunchError: " sidecar offline ",
    }),
    {
      tone: "error",
      title: "会话重启失败",
      message: "sidecar offline",
      role: "alert",
      ariaLive: "assertive",
    },
  );
  assert.equal(resolveSessionRelaunchFeedback({ relaunching: false, relaunchError: " " }), null);
  assert.equal(resolveSessionRelaunchFeedback({ relaunching: false }), null);
});

test("relaunches an exited session before sending a real user message", () => {
  assert.equal(shouldRelaunchSessionBeforeSend({ sessionState: "exited", hasUserMessage: true }), true);
  assert.equal(shouldRelaunchSessionBeforeSend({ sessionState: "exited", hasUserMessage: false }), false);
  assert.equal(shouldRelaunchSessionBeforeSend({ sessionState: "connected", hasUserMessage: true }), false);
  assert.equal(shouldRelaunchSessionBeforeSend({ sessionState: undefined, hasUserMessage: true }), false);
});
