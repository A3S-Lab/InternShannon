import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProfileButtonLabel } from "./user-profile-trigger-state.ts";

test("uses a clear profile trigger label when a nickname is available", () => {
  assert.equal(resolveProfileButtonLabel("本地用户"), "打开个人资料：本地用户");
});

test("falls back to a generic profile trigger label without a nickname", () => {
  assert.equal(resolveProfileButtonLabel("  "), "打开个人资料");
  assert.equal(resolveProfileButtonLabel(null), "打开个人资料");
  assert.equal(resolveProfileButtonLabel(undefined), "打开个人资料");
});
