import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveNativeRevealPath } from "./native-reveal-state.ts";

test("resolves reveal targets for files and directories", () => {
  assert.equal(resolveNativeRevealPath("/workspace/docs/readme.md", { isDirectory: false }), "/workspace/docs");
  assert.equal(resolveNativeRevealPath("/workspace/docs", { isDirectory: true }), "/workspace/docs");
  assert.equal(resolveNativeRevealPath("/file.txt", { isDirectory: false }), "/");
});

test("preserves Windows parent separators when resolving reveal targets", () => {
  assert.equal(resolveNativeRevealPath("C:\\Users\\me\\demo.png", { isDirectory: false }), "C:\\Users\\me");
  assert.equal(resolveNativeRevealPath("C:\\demo.png", { isDirectory: false }), "C:\\");
  assert.equal(resolveNativeRevealPath("C:\\Users\\me\\Pictures", { isDirectory: true }), "C:\\Users\\me\\Pictures");
});

test("falls back to workspace root when a file path has no parent segment", () => {
  assert.equal(resolveNativeRevealPath("readme.md", { isDirectory: false, rootPath: "/workspace" }), "/workspace");
  assert.equal(resolveNativeRevealPath("readme.md", { isDirectory: false }), "readme.md");
  assert.equal(resolveNativeRevealPath("  ", { rootPath: "/workspace" }), "");
});
