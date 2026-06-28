import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./floating-internShannon-assistant.tsx", import.meta.url)), "utf8");

function extractFunctionBody(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected to find ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Expected to find ${endMarker}`);
  return source.slice(start, end);
}

test("binds bubble drag events to the captured bubble element", () => {
  const startBubbleDragSource = extractFunctionBody("const startBubbleDrag =", "const handleBubbleClick =");

  assert.match(startBubbleDragSource, /if \(!canStartAssistantBubbleDrag\(event\)\) return;/);
  assert.doesNotMatch(startBubbleDragSource, /event\.button !== 0/);
  assert.match(startBubbleDragSource, /const dragTarget = event\.currentTarget;/);
  assert.match(startBubbleDragSource, /dragTarget\.setPointerCapture\(pointerId\);/);
  assert.match(startBubbleDragSource, /dragTarget\.addEventListener\("pointermove", handleMove\);/);
  assert.match(startBubbleDragSource, /dragTarget\.addEventListener\("pointerup", handleEnd/);
  assert.match(startBubbleDragSource, /dragTarget\.addEventListener\("pointercancel", handleEnd/);
  assert.match(startBubbleDragSource, /dragTarget\.addEventListener\("lostpointercapture", handleLostPointerCapture/);
});

test("prevents the bubble logo from starting native browser drag", () => {
  assert.match(source, /onDragStart=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(source, /draggable=\{false\}/);
});

test("keeps the floating assistant panel mounted while hidden", () => {
  assert.match(source, /createPortal\(/);
  assert.match(source, /visibility: panelVisible \? "visible" : "hidden"/);
  assert.match(source, /<FloatingAssistantPanelBody \/>/);
  assert.doesNotMatch(source, /if \(!panelVisible\)\s*\{\s*return/);
  assert.doesNotMatch(source, /panelAnimationPhase === "opening" \?/);
});

test("exposes resize handles for every floating assistant window edge and corner", () => {
  const expectedHandles = [
    "top",
    "right",
    "bottom",
    "left",
    "top-left",
    "top-right",
    "bottom-right",
    "bottom-left",
  ];

  for (const handle of expectedHandles) {
    assert.match(source, new RegExp(`handle: "${handle}"`));
  }

  assert.match(source, /type AssistantPanelResizeHandle =/);
  assert.match(source, /resizePanelRectFromHandle\(/);
  assert.match(source, /data-internshannon-resize-handle=\{resizeHandle\.handle\}/);
  assert.doesNotMatch(source, /startResize\(event, "width"\)/);
  assert.doesNotMatch(source, /startResize\(event, "corner"\)/);
});

test("keeps panel show-hide immediate while preserving drag and resize motion modes", () => {
  const openAssistantSource = extractFunctionBody("const openAssistant =", "const closeAssistant =");
  const closeAssistantSource = extractFunctionBody("const closeAssistant =", "useEffect(() => {");
  const startDragSource = extractFunctionBody("const startDrag =", "const startResize =");
  const startResizeSource = extractFunctionBody("const startResize =", "const handleToggleFullscreen =");

  assert.match(source, /type AssistantPanelAnimationPhase = "closed" \| "open"/);
  assert.match(source, /type AssistantPanelMotionMode = "idle" \| "dragging" \| "resizing"/);
  assert.match(source, /function resolvePanelMotionStyle\(/);
  assert.match(source, /transitionProperty: "none"/);
  assert.match(source, /transitionDuration: "0ms"/);
  assert.match(source, /data-internshannon-panel-motion=\{panelMotionMode\}/);
  assert.match(source, /resolveAssistantPanelTransform\(bubblePosition, rect, "expanded"\)/);
  assert.doesNotMatch(source, /transitionDelay/);
  assert.doesNotMatch(source, /resolvePanelContentMotionStyle/);
  assert.doesNotMatch(source, /"settling"/);
  assert.doesNotMatch(source, /"opening"/);
  assert.doesNotMatch(source, /"closing"/);

  assert.match(openAssistantSource, /updatePanelAnimationPhase\("open"\)/);
  assert.doesNotMatch(openAssistantSource, /requestAnimationFrame/);

  assert.match(closeAssistantSource, /updatePanelAnimationPhase\("closed"\)/);
  assert.doesNotMatch(closeAssistantSource, /setTimeout/);

  assert.match(startDragSource, /updatePanelMotionMode\("dragging"\)/);
  assert.match(startDragSource, /updatePanelMotionMode\("idle"\)/);
  assert.doesNotMatch(startDragSource, /passive: true/);

  assert.match(startResizeSource, /updatePanelMotionMode\("resizing"\)/);
  assert.match(startResizeSource, /updatePanelMotionMode\("idle"\)/);
  assert.doesNotMatch(startResizeSource, /passive: true/);
});

test("exposes the InternShannon memory timeline view and conversation focus bridge", () => {
  assert.match(source, /FloatingAssistantMemoryTimeline/);
  assert.match(source, /type FloatingAssistantView = "chat" \| "workspace" \| "memory"/);
  assert.match(source, /onMemoryOpen=\{\(\) => setActiveView\("memory"\)\}/);
  assert.match(source, /onOpenConversation=\{\(conversation\) => \{/);
  assert.match(source, /agentModel\.setCurrentSession\(conversation\.sessionId\)/);
  assert.match(source, /messageId: conversation\.messageId/);
  assert.match(source, /focusMessageId=\{messageFocus\.messageId\}/);
  assert.match(source, /focusMessageRequest=\{messageFocus\.request\}/);
});
