import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatWorkspaceSaveErrorMessage,
  resolveWorkspaceRootValidationFeedback,
  resolveWorkspaceSaveButton,
  resolveWorkspaceSaveFeedback,
} from "./workspace-section-state.ts";

test("describes workspace save progress and disables duplicate saves", () => {
  const feedback = resolveWorkspaceSaveFeedback({ kind: "saving" });
  const button = resolveWorkspaceSaveButton({ kind: "saving" });

  assert.equal(feedback?.title, "正在保存工作区配置");
  assert.equal(feedback?.role, "status");
  assert.equal(button.disabled, true);
  assert.equal(button.label, "保存中");
});

test("keeps workspace save success visible on the page", () => {
  const feedback = resolveWorkspaceSaveFeedback({ kind: "saved" });
  const button = resolveWorkspaceSaveButton({ kind: "saved" });

  assert.equal(feedback?.tone, "success");
  assert.equal(feedback?.description, "新的工作区根目录会用于后续新建会话和技能目录。");
  assert.equal(button.disabled, false);
});

test("formats workspace save failures for inline recovery", () => {
  const feedback = resolveWorkspaceSaveFeedback({
    kind: "error",
    message: "  Failed   to fetch\n/api/config  ",
  });

  assert.equal(feedback?.tone, "error");
  assert.equal(feedback?.role, "alert");
  assert.equal(feedback?.ariaLive, "assertive");
  assert.equal(feedback?.description, "Failed to fetch /api/config");
  assert.equal(formatWorkspaceSaveErrorMessage(null), "保存失败，请确认本地后端已启动后重试。");

  const formatted = formatWorkspaceSaveErrorMessage("x".repeat(220));
  assert.equal(formatted.length, 160);
  assert.ok(formatted.endsWith("…"));
});

test("does not render idle workspace save feedback", () => {
  assert.equal(resolveWorkspaceSaveFeedback({ kind: "idle" }), null);
  assert.deepEqual(resolveWorkspaceSaveButton({ kind: "idle" }), {
    label: "保存",
    ariaLabel: "保存工作区配置",
    disabled: false,
  });
});

test("requires a workspace root before saving", () => {
  const feedback = resolveWorkspaceRootValidationFeedback("  ");
  const button = resolveWorkspaceSaveButton({ kind: "idle" }, { workspaceRoot: "  " });

  assert.equal(feedback?.tone, "warning");
  assert.equal(feedback?.role, "status");
  assert.equal(feedback?.description, "请输入或选择一个工作区目录后再保存。");
  assert.deepEqual(button, {
    label: "保存",
    ariaLabel: "请输入工作区根目录后保存",
    disabled: true,
  });
  assert.equal(resolveWorkspaceRootValidationFeedback("/tmp/shuan-os"), null);
  assert.equal(resolveWorkspaceSaveButton({ kind: "idle" }, { workspaceRoot: "/tmp/shuan-os" }).disabled, false);
});

test("keeps saving state authoritative while workspace validation is empty", () => {
  assert.deepEqual(resolveWorkspaceSaveButton({ kind: "saving" }, { workspaceRoot: "" }), {
    label: "保存中",
    ariaLabel: "正在保存工作区配置",
    disabled: true,
  });
});
