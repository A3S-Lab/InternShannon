import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatAiSettingsSyncError,
  resolveAiDefaultModelFeedback,
  resolveAiSettingsSyncFeedback,
} from "./ai-section-state.ts";

test("describes AI settings autosave progress", () => {
  const feedback = resolveAiSettingsSyncFeedback({ kind: "syncing" });

  assert.equal(feedback?.tone, "info");
  assert.equal(feedback?.role, "status");
  assert.equal(feedback?.title, "正在保存 AI 配置");
});

test("keeps AI settings autosave success visible", () => {
  const feedback = resolveAiSettingsSyncFeedback({ kind: "synced" });

  assert.equal(feedback?.tone, "success");
  assert.equal(feedback?.description, "新建 Agent 会话会使用最新的模型提供商和默认模型设置。");
});

test("formats AI settings autosave failures for inline recovery", () => {
  const feedback = resolveAiSettingsSyncFeedback({
    kind: "error",
    message: "  Failed   to fetch\n/api/config  ",
  });

  assert.equal(feedback?.tone, "error");
  assert.equal(feedback?.role, "alert");
  assert.equal(feedback?.ariaLive, "assertive");
  assert.equal(feedback?.description, "Failed to fetch /api/config");
  assert.equal(formatAiSettingsSyncError(null), "AI 配置保存失败，请确认本地后端已启动后重试。");

  const formatted = formatAiSettingsSyncError("x".repeat(220));
  assert.equal(formatted.length, 160);
  assert.ok(formatted.endsWith("…"));
});

test("does not render idle AI settings autosave feedback", () => {
  assert.equal(resolveAiSettingsSyncFeedback({ kind: "idle" }), null);
});

test("describes missing provider setup before new sessions can use a model", () => {
  const feedback = resolveAiDefaultModelFeedback({
    providers: [],
    defaultProvider: "",
    defaultModel: "",
  });

  assert.equal(feedback.tone, "warning");
  assert.equal(feedback.role, "status");
  assert.equal(feedback.title, "还没有可用的模型提供商");
});

test("surfaces stale default provider and model references", () => {
  const staleProvider = resolveAiDefaultModelFeedback({
    providers: [{ name: "openai", models: [{ id: "gpt-4o", name: "GPT-4o" }] }],
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4",
  });

  assert.equal(staleProvider.tone, "error");
  assert.equal(staleProvider.role, "alert");
  assert.equal(staleProvider.description, '当前默认 Provider "anthropic" 不在配置列表中，请重新选择。');

  const staleModel = resolveAiDefaultModelFeedback({
    providers: [{ name: "openai", models: [{ id: "gpt-4o", name: "GPT-4o" }] }],
    defaultProvider: "openai",
    defaultModel: "gpt-4.1",
  });

  assert.equal(staleModel.tone, "error");
  assert.equal(staleModel.title, "默认模型不在当前 Provider 中");
  assert.equal(staleModel.description, '当前默认模型 "gpt-4.1" 不属于 openai，请重新选择。');
});

test("describes incomplete default provider model setup", () => {
  const feedback = resolveAiDefaultModelFeedback({
    providers: [{ name: "openai", models: [] }],
    defaultProvider: "openai",
    defaultModel: "",
  });

  assert.equal(feedback.tone, "warning");
  assert.equal(feedback.title, "默认 Provider 还没有模型");
  assert.equal(feedback.description, "请先为 openai 添加至少一个模型。");
});

test("describes the ready default model for new sessions", () => {
  const feedback = resolveAiDefaultModelFeedback({
    providers: [{ name: "openai", models: [{ id: "gpt-4o", name: "GPT-4o" }] }],
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
  });

  assert.equal(feedback.tone, "success");
  assert.equal(feedback.role, "status");
  assert.equal(feedback.description, "新建 Agent 会话将使用 openai / GPT-4o。");
});
