import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveSelectionToolbarPosition } from "./selection-toolbar-state.ts";

const toolbarSize = { width: 40, height: 38 };
const viewportSize = { width: 800, height: 600 };
const agentChatSource = readFileSync(fileURLToPath(new URL("../agent-chat.tsx", import.meta.url)), "utf8");

test("places the selection toolbar above a selection when there is enough room", () => {
  assert.deepEqual(
    resolveSelectionToolbarPosition({
      selectionRect: { left: 300, top: 200, right: 400, bottom: 220, width: 100, height: 20 },
      toolbarSize,
      viewportSize,
    }),
    { left: 330, top: 154, placement: "above" },
  );
});

test("places the selection toolbar below a session title near the viewport top", () => {
  assert.deepEqual(
    resolveSelectionToolbarPosition({
      selectionRect: { left: 24, top: 6, right: 184, bottom: 26, width: 160, height: 20 },
      toolbarSize,
      viewportSize,
    }),
    { left: 84, top: 34, placement: "below" },
  );
});

test("keeps the toolbar inside the left and right viewport margins", () => {
  assert.equal(
    resolveSelectionToolbarPosition({
      selectionRect: { left: -10, top: 100, right: 10, bottom: 120, width: 20, height: 20 },
      toolbarSize,
      viewportSize,
    }).left,
    8,
  );
  assert.equal(
    resolveSelectionToolbarPosition({
      selectionRect: { left: 790, top: 100, right: 810, bottom: 120, width: 20, height: 20 },
      toolbarSize,
      viewportSize,
    }).left,
    752,
  );
});

test("clamps the toolbar vertically when neither side has enough room", () => {
  assert.deepEqual(
    resolveSelectionToolbarPosition({
      selectionRect: { left: 300, top: 12, right: 400, bottom: 590, width: 100, height: 578 },
      toolbarSize,
      viewportSize,
    }),
    { left: 330, top: 8, placement: "above" },
  );
});

test("keeps the toolbar mounted while its copy button receives the click", () => {
  assert.match(
    agentChatSource,
    /toolbarRef\.current\?\.contains\(event\.target\)\) return;/,
    "document mousedown must ignore events from inside the selection toolbar",
  );
  assert.match(
    agentChatSource,
    /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/,
    "the copy button must preserve the browser selection until click",
  );
  assert.match(
    agentChatSource,
    /const handleMouseUp = \(event: MouseEvent\) => \{\s*if \(event\.target instanceof Node && toolbarRef\.current\?\.contains\(event\.target\)\) return;/,
    "toolbar mouseup must not reopen the toolbar after copying",
  );
});

test("copies the captured selection instead of the entire message", () => {
  assert.match(agentChatSource, /await writeClipboardText\(state\.selectedText\);/);
  assert.match(agentChatSource, /aria-label="复制选中文本"/);
});
