import * as assert from "node:assert/strict";
import { test } from "node:test";
import { captureKeyCombo, normalizeKeyCombo } from "./key-combo.ts";

test("captures unshifted character shortcuts", () => {
  assert.equal(captureKeyCombo({ key: "b", code: "KeyB", ctrlKey: true }), "ctrl+b");
  assert.equal(captureKeyCombo({ key: "ArrowUp", code: "ArrowUp", altKey: true }), "alt+up");
});

test("uses physical key code for shifted digit shortcuts", () => {
  assert.equal(captureKeyCombo({ key: "*", code: "Digit8", ctrlKey: true, shiftKey: true }), "ctrl+shift+8");
  assert.equal(captureKeyCombo({ key: "(", code: "Digit9", metaKey: true, shiftKey: true }), "ctrl+shift+9");
});

test("uses physical key code for shifted punctuation shortcuts", () => {
  assert.equal(captureKeyCombo({ key: "~", code: "Backquote", ctrlKey: true, shiftKey: true }), "ctrl+shift+`");
  assert.equal(captureKeyCombo({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true }), "ctrl+shift+/");
});

test("falls back to shifted key values when code is unavailable", () => {
  assert.equal(captureKeyCombo({ key: "*", ctrlKey: true, shiftKey: true }), "ctrl+shift+8");
  assert.equal(captureKeyCombo({ key: "?", metaKey: true, shiftKey: true }), "ctrl+shift+/");
});

test("captures numpad shortcuts from physical key code", () => {
  assert.equal(captureKeyCombo({ key: "+", code: "NumpadAdd", ctrlKey: true }), "ctrl+numpadadd");
  assert.equal(captureKeyCombo({ key: "1", code: "Numpad1", ctrlKey: true }), "ctrl+numpad1");
});

test("ignores modifier-only key presses", () => {
  assert.equal(captureKeyCombo({ key: "Shift", code: "ShiftLeft", shiftKey: true }), null);
});

test("normalizes modifier aliases and order", () => {
  assert.equal(normalizeKeyCombo("Shift + Ctrl + B"), "ctrl+shift+b");
  assert.equal(normalizeKeyCombo("Command+Option+ArrowUp"), "ctrl+alt+up");
  assert.equal(normalizeKeyCombo("mod + shift + esc"), "ctrl+shift+escape");
});

test("normalizes shifted printable symbols to physical keys", () => {
  assert.equal(normalizeKeyCombo("cmd+?"), "ctrl+shift+/");
  assert.equal(normalizeKeyCombo("ctrl+*"), "ctrl+shift+8");
  assert.equal(normalizeKeyCombo("ctrl+shift+~"), "ctrl+shift+`");
});

test("rejects modifier-only combos", () => {
  assert.equal(normalizeKeyCombo("ctrl+shift"), "");
});
