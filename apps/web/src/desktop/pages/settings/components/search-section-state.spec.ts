import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSearchBrowserStatusError,
  formatSearchSaveError,
  resolveSearchBrowserStatusFeedback,
  resolveSearchSaveButton,
  resolveSearchSaveFeedback,
} from "./search-section-state.ts";

test("describes search settings save progress and disables duplicate saves", () => {
  const feedback = resolveSearchSaveFeedback({ kind: "saving" });
  const button = resolveSearchSaveButton({ kind: "saving" });

  assert.equal(feedback?.title, "正在保存搜索配置");
  assert.equal(feedback?.role, "status");
  assert.equal(button.disabled, true);
  assert.equal(button.label, "保存中");
});

test("keeps search settings save success visible", () => {
  const feedback = resolveSearchSaveFeedback({ kind: "saved" });
  const button = resolveSearchSaveButton({ kind: "saved" });

  assert.equal(feedback?.tone, "success");
  assert.equal(feedback?.description, "新的搜索设置会用于后续 Agent 搜索和浏览任务。");
  assert.equal(button.disabled, false);
});

test("formats search settings save failures for inline recovery", () => {
  const feedback = resolveSearchSaveFeedback({
    kind: "error",
    message: "  Failed   to fetch\n/api/config  ",
  });

  assert.equal(feedback?.tone, "error");
  assert.equal(feedback?.role, "alert");
  assert.equal(feedback?.ariaLive, "assertive");
  assert.equal(feedback?.description, "Failed to fetch /api/config");
  assert.equal(formatSearchSaveError(null), "搜索配置保存失败，请确认本地后端已启动后重试。");

  const formatted = formatSearchSaveError("x".repeat(220));
  assert.equal(formatted.length, 160);
  assert.ok(formatted.endsWith("…"));
});

test("describes browser status checks while they are running", () => {
  const feedback = resolveSearchBrowserStatusFeedback({
    checking: true,
    status: null,
  });

  assert.equal(feedback.tone, "info");
  assert.equal(feedback.title, "正在检测浏览器");
  assert.equal(feedback.role, "status");
});

test("keeps browser status detection failures visible inline", () => {
  const feedback = resolveSearchBrowserStatusFeedback({
    checking: false,
    status: null,
    error: "  invoke failed\noutside tauri  ",
  });

  assert.equal(feedback.tone, "error");
  assert.equal(feedback.role, "alert");
  assert.equal(feedback.ariaLive, "assertive");
  assert.equal(feedback.description, "invoke failed outside tauri");
  assert.equal(formatSearchBrowserStatusError(null), "浏览器检测不可用，请确认当前运行在桌面客户端中。");

  const formatted = formatSearchBrowserStatusError("x".repeat(240));
  assert.equal(formatted.length, 180);
  assert.ok(formatted.endsWith("…"));
});

test("describes ready and unsupported browser states distinctly", () => {
  const ready = resolveSearchBrowserStatusFeedback({
    checking: false,
    status: {
      installed: true,
      supported: true,
      version: "Lightpanda 0.1.2",
    },
  });

  assert.equal(ready.tone, "success");
  assert.equal(ready.title, "浏览器可用");
  assert.equal(ready.description, "Lightpanda 0.1.2");

  const unsupported = resolveSearchBrowserStatusFeedback({
    checking: false,
    status: {
      installed: true,
      supported: false,
      message: "版本过低",
    },
  });

  assert.equal(unsupported.tone, "warning");
  assert.equal(unsupported.title, "浏览器版本不受支持");
  assert.equal(unsupported.description, "版本过低");
});

test("describes missing browser states without treating them as detection errors", () => {
  const feedback = resolveSearchBrowserStatusFeedback({
    checking: false,
    status: {
      installed: false,
      supported: false,
      message: "未找到 Chrome",
    },
  });

  assert.equal(feedback.tone, "warning");
  assert.equal(feedback.role, "status");
  assert.equal(feedback.title, "浏览器未就绪");
  assert.equal(feedback.description, "未找到 Chrome");
});

test("does not render idle search settings save feedback", () => {
  assert.equal(resolveSearchSaveFeedback({ kind: "idle" }), null);
  assert.deepEqual(resolveSearchSaveButton({ kind: "idle" }), {
    label: "保存搜索配置",
    ariaLabel: "保存搜索配置",
    disabled: false,
  });
});
