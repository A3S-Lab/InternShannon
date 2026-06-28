import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampUploadPercent,
  createPendingFilesFromPastedImages,
  fileLabelFromPath,
  formatUploadBytes,
  formatUploadSizeText,
  getDroppedFiles,
  resolveUploadButtonTitle,
  sanitizeWorkspaceFileName,
} from "./agent-input-upload-state.ts";

test("sanitizes workspace upload filenames without changing safe names", () => {
  assert.equal(sanitizeWorkspaceFileName("report.md"), "report.md");
  assert.equal(sanitizeWorkspaceFileName("a/b<c>\u0001.txt"), "a-b-c-.txt");
  assert.match(sanitizeWorkspaceFileName(" .. "), /^upload-/);
});

test("extracts dropped files and skips directories", () => {
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  const result = getDroppedFiles({
    items: [
      { kind: "string" },
      { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => null },
      { kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }), getAsFile: () => file },
    ],
    files: [],
  });

  assert.deepEqual(result.files, [file]);
  assert.equal(result.skippedDirectories, 1);
});

test("falls back to DataTransfer files when item details are unavailable", () => {
  const file = new File(["hello"], "fallback.txt", { type: "text/plain" });

  assert.deepEqual(getDroppedFiles({ files: [file] }), {
    files: [file],
    skippedDirectories: 0,
  });
});

test("formats upload progress and labels", () => {
  assert.equal(clampUploadPercent(Number.NaN), 0);
  assert.equal(clampUploadPercent(-10), 0);
  assert.equal(clampUploadPercent(41.6), 42);
  assert.equal(clampUploadPercent(120), 100);
  assert.equal(formatUploadBytes(1024), "1.0 KB");
  assert.equal(formatUploadSizeText(512, 1024), "512 B / 1.0 KB");
  assert.equal(formatUploadSizeText(0, 0), "准备上传");
  assert.equal(fileLabelFromPath("sessions/demo/report.md", "fallback.md"), "report.md");
});

test("resolves upload button title by blocked state", () => {
  assert.equal(resolveUploadButtonTitle(null), "上传文件到工作区");
  assert.equal(resolveUploadButtonTitle("connecting"), "等待本地服务连接");
  assert.equal(resolveUploadButtonTitle("uploading"), "文件正在上传中");
  assert.equal(resolveUploadButtonTitle("disabled"), "上传不可用");
});

test("creates pending image files for pasted images", () => {
  const files = createPendingFilesFromPastedImages([{ mediaType: "image/png", data: "abc" }]);

  assert.equal(files.length, 1);
  assert.equal(files[0].name, "粘贴图片");
  assert.equal(files[0].mediaType, "image/png");
  assert.equal(files[0].data, "abc");
  assert.match(files[0].id, /^file-/);
});

test("normalizes pasted image files before InternShannon renders pending uploads", () => {
  const files = createPendingFilesFromPastedImages([
    { mediaType: " image/png ", data: " abc " },
    { mediaType: " ", data: "ignored" },
    { mediaType: "image/webp", data: "   " },
  ]);

  assert.equal(files.length, 1);
  assert.equal(files[0].name, "粘贴图片");
  assert.equal(files[0].mediaType, "image/png");
  assert.equal(files[0].data, "abc");
  assert.match(files[0].id, /^file-/);
});
