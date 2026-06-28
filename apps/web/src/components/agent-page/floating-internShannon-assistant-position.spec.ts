import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  assistantBubbleCenter,
  constrainAssistantBubblePosition,
  createDefaultAssistantBubblePosition,
  resolveAssistantPanelCollapsedScale,
  resolveAssistantPanelTransform,
  resolveAssistantPanelTransformOrigin,
  resolveStoredAssistantBubblePosition,
} from "./floating-internShannon-assistant-position.ts";

test("keeps freely dragged bubble positions inside the viewport", () => {
  assert.deepEqual(constrainAssistantBubblePosition({ x: 120, y: 180 }, { width: 1024, height: 768 }), {
    x: 120,
    y: 180,
  });
});

test("clamps dragged bubble positions to visible desktop margins", () => {
  assert.deepEqual(constrainAssistantBubblePosition({ x: -20, y: 2000 }, { width: 1024, height: 768 }), {
    x: 24,
    y: 688,
  });
});

test("keeps the default bubble above mobile bottom controls on narrow viewports", () => {
  assert.deepEqual(createDefaultAssistantBubblePosition({ width: 390, height: 844 }), {
    x: 322,
    y: 692,
  });
});

test("restores stored bubble positions when valid and ignores malformed values", () => {
  assert.deepEqual(resolveStoredAssistantBubblePosition({ x: 180, y: 260 }, { width: 1024, height: 768 }), {
    x: 180,
    y: 260,
  });
  assert.equal(resolveStoredAssistantBubblePosition({ x: "180", y: 260 }, { width: 1024, height: 768 }), null);
  assert.equal(resolveStoredAssistantBubblePosition(null, { width: 1024, height: 768 }), null);
});

test("migrates legacy mobile bottom-right defaults while respecting versioned positions", () => {
  assert.equal(resolveStoredAssistantBubblePosition({ x: 322, y: 776 }, { width: 390, height: 844 }), null);
  assert.deepEqual(resolveStoredAssistantBubblePosition({ x: 322, y: 776, version: 2 }, { width: 390, height: 844 }), {
    x: 322,
    y: 776,
  });
});

test("uses the bubble center as the assistant panel animation origin", () => {
  assert.deepEqual(assistantBubbleCenter({ x: 900, y: 700 }), {
    x: 928,
    y: 728,
  });
  assert.deepEqual(
    resolveAssistantPanelTransformOrigin({ x: 900, y: 700 }, { x: 120, y: 80, width: 680, height: 560 }),
    {
      x: 808,
      y: 648,
    },
  );
});

test("collapses the panel toward bubble scale with sensible bounds", () => {
  assert.equal(resolveAssistantPanelCollapsedScale({ width: 680, height: 560 }), 56 / 680);
  assert.equal(resolveAssistantPanelCollapsedScale({ width: 5000, height: 3000 }), 0.045);
  assert.equal(resolveAssistantPanelCollapsedScale({ width: 120, height: 120 }), 0.16);
});

test("centers the collapsed assistant panel transform on the bubble center", () => {
  const bubble = { x: 900, y: 700 };
  const rect = { x: 208, y: 196, width: 680, height: 560 };
  const transform = resolveAssistantPanelTransform(bubble, rect, "collapsed");
  const center = assistantBubbleCenter(bubble);

  assert.equal(transform.scale, 56 / 680);
  assert.equal(transform.transformOrigin, "0 0");
  assert.equal(transform.x + (rect.width * transform.scale) / 2, center.x);
  assert.equal(transform.y + (rect.height * transform.scale) / 2, center.y);
});

test("keeps the expanded assistant panel transform at the stored panel rect", () => {
  const rect = { x: 208, y: 196, width: 680, height: 560 };
  const transform = resolveAssistantPanelTransform({ x: 900, y: 700 }, rect, "expanded");

  assert.deepEqual(transform, {
    x: 208,
    y: 196,
    scale: 1,
    transform: "translate3d(208px, 196px, 0) scale(1)",
    transformOrigin: "0 0",
  });
});
