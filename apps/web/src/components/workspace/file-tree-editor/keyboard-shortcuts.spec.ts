import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasPrimaryShortcutModifier,
  isApplePlatformName,
  resolveFileTreeDocumentShortcut,
  resolveFileTreeScopedShortcut,
  shouldHandleFileTreeDeleteKey,
} from "./keyboard-shortcuts.ts";

test("detects Apple platforms for command-key shortcuts", () => {
  assert.equal(isApplePlatformName("MacIntel"), true);
  assert.equal(isApplePlatformName("iPad"), true);
  assert.equal(isApplePlatformName("Win32"), false);
});

test("uses meta as primary modifier on macOS and ctrl elsewhere", () => {
  assert.equal(hasPrimaryShortcutModifier({ key: "f", metaKey: true }, "MacIntel"), true);
  assert.equal(hasPrimaryShortcutModifier({ key: "f", ctrlKey: true }, "MacIntel"), false);
  assert.equal(hasPrimaryShortcutModifier({ key: "f", ctrlKey: true }, "Win32"), true);
  assert.equal(hasPrimaryShortcutModifier({ key: "f", metaKey: true }, "Win32"), false);
});

test("resolves file manager document-level shortcuts", () => {
  assert.equal(
    resolveFileTreeDocumentShortcut({ key: "E", ctrlKey: true, shiftKey: true }, { platform: "Win32" }),
    "focus-explorer",
  );
  assert.equal(
    resolveFileTreeDocumentShortcut({ key: "f", metaKey: true, shiftKey: true }, { platform: "MacIntel" }),
    "search",
  );
  assert.equal(
    resolveFileTreeDocumentShortcut({ key: "`", ctrlKey: true }, { platform: "MacIntel", supportsNativeShell: true }),
    "toggle-terminal",
  );
  assert.equal(
    resolveFileTreeDocumentShortcut({ key: "`", ctrlKey: true }, { platform: "MacIntel", supportsNativeShell: false }),
    null,
  );
  assert.equal(resolveFileTreeDocumentShortcut({ key: "n", altKey: true }), "new-file");
  assert.equal(resolveFileTreeDocumentShortcut({ key: "b", altKey: true }), "new-folder");
  assert.equal(
    resolveFileTreeDocumentShortcut({ key: "P", metaKey: true, shiftKey: true }, { platform: "MacIntel" }),
    "command-palette",
  );
  assert.equal(
    resolveFileTreeDocumentShortcut({ key: "p", ctrlKey: true, shiftKey: true }, { platform: "Win32" }),
    "command-palette",
  );
  assert.equal(resolveFileTreeDocumentShortcut({ key: "?", shiftKey: true }), "show-shortcuts");
  assert.equal(
    resolveFileTreeDocumentShortcut({ key: "p", metaKey: true }, { platform: "MacIntel" }),
    "quick-open",
  );
  assert.equal(resolveFileTreeDocumentShortcut({ key: "s", metaKey: true }, { platform: "MacIntel" }), "save-all");
  assert.equal(resolveFileTreeDocumentShortcut({ key: "b", ctrlKey: true }, { platform: "Win32" }), "toggle-sidebar");
  // 表驱动后仍精确:Cmd+S 不是 save-all 以外的任何项;无匹配返回 null。
  assert.equal(resolveFileTreeDocumentShortcut({ key: "q", metaKey: true }, { platform: "MacIntel" }), null);
});

test("resolves tree-scoped clipboard and history shortcuts", () => {
  assert.equal(resolveFileTreeScopedShortcut({ key: "c", ctrlKey: true }, { platform: "Win32" }), "copy");
  assert.equal(resolveFileTreeScopedShortcut({ key: "x", ctrlKey: true }, { platform: "Win32" }), "cut");
  assert.equal(resolveFileTreeScopedShortcut({ key: "v", metaKey: true }, { platform: "MacIntel" }), "paste");
  assert.equal(resolveFileTreeScopedShortcut({ key: "a", metaKey: true }, { platform: "MacIntel" }), "select-all");
  assert.equal(resolveFileTreeScopedShortcut({ key: "z", ctrlKey: true }, { platform: "Win32" }), "undo");
  assert.equal(
    resolveFileTreeScopedShortcut({ key: "z", ctrlKey: true, shiftKey: true }, { platform: "Win32" }),
    "redo",
  );
  assert.equal(
    resolveFileTreeScopedShortcut({ key: "h", metaKey: true, shiftKey: true }, { platform: "MacIntel" }),
    "collapse-all",
  );
  assert.equal(resolveFileTreeScopedShortcut({ key: "y", ctrlKey: true }, { platform: "Win32" }), "redo");
  assert.equal(resolveFileTreeScopedShortcut({ key: "c", ctrlKey: true, altKey: true }, { platform: "Win32" }), null);
  assert.equal(resolveFileTreeScopedShortcut({ key: "a", ctrlKey: true }, { platform: "MacIntel" }), null);
});

test("handles file tree delete shortcut only outside editable targets", () => {
  assert.equal(shouldHandleFileTreeDeleteKey({ key: "Delete" }), true);
  assert.equal(shouldHandleFileTreeDeleteKey({ key: "Backspace" }), true);
  assert.equal(shouldHandleFileTreeDeleteKey({ key: "Delete" }, { editableTarget: true }), false);
  assert.equal(shouldHandleFileTreeDeleteKey({ key: "Backspace" }, { editableTarget: true }), false);
  assert.equal(shouldHandleFileTreeDeleteKey({ key: "Delete" }, { readOnly: true }), false);
  assert.equal(shouldHandleFileTreeDeleteKey({ key: "Delete", ctrlKey: true }), false);
});
