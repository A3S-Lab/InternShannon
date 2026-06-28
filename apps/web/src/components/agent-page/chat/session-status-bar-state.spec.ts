import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSessionStatusBarActionError,
  resolveMainAgentStatusPresentation,
  resolveModelSwitcherFocusState,
  resolveSessionModelDisplayText,
  resolveSessionPermissionMode,
  resolveSessionStatusBarActionError,
} from "./session-status-bar-state.ts";

test("describes main agent connection states distinctly", () => {
  assert.deepEqual(
    resolveMainAgentStatusPresentation({
      connection: "connecting",
      status: null,
      activeToolCount: 0,
    }),
    {
      label: "连接中",
      tone: "connecting",
    },
  );
  assert.deepEqual(
    resolveMainAgentStatusPresentation({
      connection: "disconnected",
      status: "running",
      activeToolCount: 1,
    }),
    {
      label: "连接已断开",
      tone: "disconnected",
    },
  );
  assert.deepEqual(
    resolveMainAgentStatusPresentation({
      connection: undefined,
      status: null,
      activeToolCount: 0,
    }),
    {
      label: "等待连接",
      tone: "connecting",
    },
  );
});

test("describes main agent runtime states after the websocket is connected", () => {
  assert.deepEqual(
    resolveMainAgentStatusPresentation({
      connection: "connected",
      status: "compacting",
      activeToolCount: 0,
    }),
    {
      label: "压缩上下文",
      tone: "running",
    },
  );
  assert.deepEqual(
    resolveMainAgentStatusPresentation({
      connection: "connected",
      status: "running",
      activeToolCount: 2,
    }),
    {
      label: "2 个工具执行中",
      tone: "running",
    },
  );
  assert.deepEqual(
    resolveMainAgentStatusPresentation({
      connection: "connected",
      status: "idle",
      activeToolCount: 0,
    }),
    {
      label: "空闲",
      tone: "idle",
    },
  );
});

test("formats status bar action errors for visible recovery feedback", () => {
  assert.deepEqual(resolveSessionStatusBarActionError(null), null);
  assert.deepEqual(
    resolveSessionStatusBarActionError({
      kind: "model",
      message: "  provider offline  ",
    }),
    {
      title: "模型设置失败",
      message: "provider offline",
      dismissLabel: "关闭模型设置失败提示",
    },
  );
  assert.deepEqual(
    resolveSessionStatusBarActionError({
      kind: "execution-mode",
      message: "runtime disconnected",
    }),
    {
      title: "执行模式设置失败",
      message: "runtime disconnected",
      dismissLabel: "关闭执行模式设置失败提示",
    },
  );
});

test("focuses and highlights the model switcher only for a new visible request", () => {
  assert.deepEqual(
    resolveModelSwitcherFocusState({
      request: 2,
      previousRequest: 1,
      showModelSwitcher: true,
      hasFocusableModelSwitcher: true,
    }),
    {
      shouldFocus: true,
      shouldHighlight: true,
    },
  );
  assert.deepEqual(
    resolveModelSwitcherFocusState({
      request: 2,
      previousRequest: 1,
      showModelSwitcher: true,
      hasFocusableModelSwitcher: false,
    }),
    {
      shouldFocus: false,
      shouldHighlight: true,
    },
  );
  assert.deepEqual(
    resolveModelSwitcherFocusState({
      request: 2,
      previousRequest: 2,
      showModelSwitcher: true,
      hasFocusableModelSwitcher: true,
    }),
    {
      shouldFocus: false,
      shouldHighlight: false,
    },
  );
  assert.deepEqual(
    resolveModelSwitcherFocusState({
      request: 2,
      previousRequest: 1,
      showModelSwitcher: false,
      hasFocusableModelSwitcher: true,
    }),
    {
      shouldFocus: false,
      shouldHighlight: false,
    },
  );
});

test("normalizes unknown action errors with a fallback message", () => {
  assert.equal(formatSessionStatusBarActionError(new Error(" request failed "), "fallback"), "request failed");
  assert.equal(formatSessionStatusBarActionError(" websocket closed ", "fallback"), "websocket closed");
  assert.equal(formatSessionStatusBarActionError({ message: " api rejected " }, "fallback"), "api rejected");
  assert.equal(formatSessionStatusBarActionError({ message: "" }, "fallback"), "fallback");
  assert.equal(formatSessionStatusBarActionError(null, "fallback"), "fallback");
});

test("normalizes malformed status bar session controls before render", () => {
  assert.equal(resolveSessionPermissionMode("plan"), "plan");
  assert.equal(resolveSessionPermissionMode({ mode: "danger" }), "default");
  assert.equal(resolveSessionPermissionMode("legacy-invalid-mode"), "default");

  assert.equal(resolveSessionModelDisplayText(" openai/gpt-4.1 "), "openai/gpt-4.1");
  assert.equal(resolveSessionModelDisplayText({ id: "legacy-object-model" }), "默认模型");
  assert.equal(resolveSessionModelDisplayText("   "), "默认模型");
});
