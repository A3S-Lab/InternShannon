import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveResizableHandleLabel } from "./resizable-handle-state.ts";

test("uses the provided resizable handle label", () => {
  assert.equal(resolveResizableHandleLabel("调整会话列表宽度"), "调整会话列表宽度");
});

test("falls back to a generic resizable handle label", () => {
  assert.equal(resolveResizableHandleLabel("  "), "调整面板大小");
  assert.equal(resolveResizableHandleLabel(null), "调整面板大小");
  assert.equal(resolveResizableHandleLabel(undefined), "调整面板大小");
});
