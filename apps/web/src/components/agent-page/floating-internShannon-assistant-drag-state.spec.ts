import * as assert from "node:assert/strict";
import { test } from "node:test";
import { canStartAssistantBubbleDrag } from "./floating-internShannon-assistant-drag-state.ts";

test("starts bubble dragging for primary touch and pen pointers", () => {
  assert.equal(canStartAssistantBubbleDrag({ button: -1, pointerType: "touch", isPrimary: true }), true);
  assert.equal(canStartAssistantBubbleDrag({ button: 0, pointerType: "touch", isPrimary: true }), true);
  assert.equal(canStartAssistantBubbleDrag({ button: -1, pointerType: "pen", isPrimary: true }), true);
});

test("keeps mouse bubble dragging limited to the primary button", () => {
  assert.equal(canStartAssistantBubbleDrag({ button: 0, pointerType: "mouse", isPrimary: true }), true);
  assert.equal(canStartAssistantBubbleDrag({ button: 2, pointerType: "mouse", isPrimary: true }), false);
});

test("ignores secondary touch points when the browser exposes them", () => {
  assert.equal(canStartAssistantBubbleDrag({ button: 0, pointerType: "touch", isPrimary: false }), false);
});
