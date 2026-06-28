import * as assert from "node:assert/strict";
import { test } from "node:test";
import { formatExternalSkillImportError, resolveExternalSkillImportFeedback } from "./external-skill-import-state.ts";

test("formats external skill import errors into compact descriptions", () => {
  assert.equal(formatExternalSkillImportError(new Error("Archive entry is invalid")), "Archive entry is invalid");
  assert.equal(
    formatExternalSkillImportError({ message: "  Failed   to unpack\nskill.zip  " }),
    "Failed to unpack skill.zip",
  );
  assert.equal(formatExternalSkillImportError(null), "导入失败，请检查文件格式或稍后重试。");

  const formatted = formatExternalSkillImportError("x".repeat(220));
  assert.equal(formatted.length, 160);
  assert.ok(formatted.endsWith("…"));
});

test("describes external skill import progress and success", () => {
  assert.deepEqual(
    resolveExternalSkillImportFeedback({
      kind: "importing",
      targetLabel: "我的技能",
      pendingFileCount: 2,
    }),
    {
      tone: "info",
      role: "status",
      ariaLive: "polite",
      title: "正在导入技能",
      description: "正在处理 2 个文件，导入完成后会自动刷新我的技能。",
    },
  );

  assert.deepEqual(
    resolveExternalSkillImportFeedback({
      kind: "success",
      targetLabel: "共享技能",
      itemCount: 3,
      fileCount: 12,
    }),
    {
      tone: "success",
      role: "status",
      ariaLive: "polite",
      title: "导入完成",
      description: "已导入 3 个技能，包含 12 个文件。",
    },
  );
});

test("surfaces rejected and failed external skill imports as actionable alerts", () => {
  assert.deepEqual(
    resolveExternalSkillImportFeedback({
      kind: "rejected",
      targetLabel: "共享技能",
      message: "共享技能目录需要管理权限",
    }),
    {
      tone: "error",
      role: "alert",
      ariaLive: "assertive",
      title: "无法导入",
      description: "共享技能目录需要管理权限",
    },
  );

  assert.deepEqual(
    resolveExternalSkillImportFeedback({
      kind: "error",
      message: "Unsupported file type",
    }),
    {
      tone: "error",
      role: "alert",
      ariaLive: "assertive",
      title: "导入失败",
      description: "Unsupported file type",
    },
  );

  assert.equal(resolveExternalSkillImportFeedback({ kind: "idle" }), null);
});
