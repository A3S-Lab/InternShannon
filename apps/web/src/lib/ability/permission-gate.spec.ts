import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePermissionGate } from "./permission-gate.ts";

test("grants and shows children when the permission is present (default modifiers)", () => {
  assert.deepEqual(evaluatePermissionGate(true), { allowed: true, showChildren: true });
});

test("denies and hides children when the permission is absent", () => {
  assert.deepEqual(evaluatePermissionGate(false), { allowed: false, showChildren: false });
});

test("`not` inverts the grant — absent permission becomes allowed, present becomes denied", () => {
  assert.deepEqual(evaluatePermissionGate(false, { not: true }), { allowed: true, showChildren: true });
  assert.deepEqual(evaluatePermissionGate(true, { not: true }), { allowed: false, showChildren: false });
});

test("`passThrough` still shows children when denied (disable, not hide)", () => {
  assert.deepEqual(evaluatePermissionGate(false, { passThrough: true }), { allowed: false, showChildren: true });
});

test("`passThrough` keeps allowed children rendering", () => {
  assert.deepEqual(evaluatePermissionGate(true, { passThrough: true }), { allowed: true, showChildren: true });
});

test("`not` + `passThrough` compose — denied-by-inversion still shows children", () => {
  assert.deepEqual(evaluatePermissionGate(true, { not: true, passThrough: true }), {
    allowed: false,
    showChildren: true,
  });
});
