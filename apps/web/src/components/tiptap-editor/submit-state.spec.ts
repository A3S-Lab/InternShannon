import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTiptapSubmitPromise,
  shouldClearAfterTiptapSubmitResult,
  shouldHandleTiptapSubmitKey,
  shouldSubmitTiptapContent,
} from "./submit-state.ts";

test("submits non-empty tiptap content by default", () => {
  assert.equal(shouldSubmitTiptapContent({ text: "hello" }), true);
  assert.equal(shouldSubmitTiptapContent({ text: "  hello  " }), true);
});

test("keeps empty tiptap content idle unless an external draft can be submitted", () => {
  assert.equal(shouldSubmitTiptapContent({ text: "" }), false);
  assert.equal(shouldSubmitTiptapContent({ text: "   " }), false);
  assert.equal(shouldSubmitTiptapContent({ text: "", allowEmptySubmit: true }), true);
  assert.equal(shouldSubmitTiptapContent({ text: "   ", allowEmptySubmit: true }), true);
});

test("leaves modified Enter shortcuts to the owning input shell", () => {
  assert.equal(shouldHandleTiptapSubmitKey({ key: "Enter" }), true);
  assert.equal(shouldHandleTiptapSubmitKey({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldHandleTiptapSubmitKey({ key: "Enter", ctrlKey: true }), false);
  assert.equal(shouldHandleTiptapSubmitKey({ key: "Enter", metaKey: true }), false);
});

test("keeps tiptap content when submit explicitly returns false", () => {
  assert.equal(shouldClearAfterTiptapSubmitResult(false), false);
});

test("clears tiptap content for accepted or legacy void submit results", () => {
  assert.equal(shouldClearAfterTiptapSubmitResult(true), true);
  assert.equal(shouldClearAfterTiptapSubmitResult(undefined), true);
});

test("detects async tiptap submit results", () => {
  assert.equal(isTiptapSubmitPromise(Promise.resolve(false)), true);
  assert.equal(isTiptapSubmitPromise(false), false);
  assert.equal(isTiptapSubmitPromise(undefined), false);
});
