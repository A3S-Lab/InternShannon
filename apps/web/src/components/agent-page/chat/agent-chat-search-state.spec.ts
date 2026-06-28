import assert from "node:assert/strict";
import test from "node:test";
import {
  isChatSearchActive,
  resolveChatSearchInputKeyAction,
  resolveChatSearchNavigation,
  resolveChatSearchState,
  shouldOpenChatSearchFromShortcut,
} from "./agent-chat-search-state.ts";

test("treats blank search text as inactive", () => {
  assert.equal(isChatSearchActive("   "), false);
  assert.deepEqual(
    resolveChatSearchState({
      query: "   ",
      matchCount: 5,
      currentIndex: 3,
    }),
    {
      active: false,
      matchCount: undefined,
      currentIndex: 0,
      hasMatches: false,
    },
  );
});

test("describes active search with no matches", () => {
  assert.deepEqual(
    resolveChatSearchState({
      query: "missing",
      matchCount: 0,
      currentIndex: 4,
    }),
    {
      active: true,
      matchCount: 0,
      currentIndex: 0,
      hasMatches: false,
    },
  );
});

test("clamps the current match index when result count changes", () => {
  assert.deepEqual(
    resolveChatSearchState({
      query: "token",
      matchCount: 3,
      currentIndex: 8,
    }),
    {
      active: true,
      matchCount: 3,
      currentIndex: 2,
      hasMatches: true,
    },
  );

  assert.equal(
    resolveChatSearchState({
      query: "token",
      matchCount: 3.8,
      currentIndex: Number.NaN,
    }).currentIndex,
    0,
  );
});

test("wraps previous and next search navigation", () => {
  assert.equal(
    resolveChatSearchNavigation({
      direction: "previous",
      matchCount: 3,
      currentIndex: 0,
    }),
    2,
  );
  assert.equal(
    resolveChatSearchNavigation({
      direction: "next",
      matchCount: 3,
      currentIndex: 2,
    }),
    0,
  );
  assert.equal(
    resolveChatSearchNavigation({
      direction: "next",
      matchCount: 0,
      currentIndex: 2,
    }),
    0,
  );
});

test("opens chat search from the platform find shortcut", () => {
  assert.equal(shouldOpenChatSearchFromShortcut({ key: "f", metaKey: true }), true);
  assert.equal(shouldOpenChatSearchFromShortcut({ key: "F", ctrlKey: true }), true);
  assert.equal(shouldOpenChatSearchFromShortcut({ key: "f" }), false);
  assert.equal(shouldOpenChatSearchFromShortcut({ key: "f", ctrlKey: true, shiftKey: true }), false);
  assert.equal(shouldOpenChatSearchFromShortcut({ key: "f", metaKey: true, altKey: true }), false);
});

test("resolves focused search input keyboard actions", () => {
  assert.equal(resolveChatSearchInputKeyAction({ key: "Enter", hasMatches: true }), "next");
  assert.equal(resolveChatSearchInputKeyAction({ key: "Enter", shiftKey: true, hasMatches: true }), "previous");
  assert.equal(resolveChatSearchInputKeyAction({ key: "Escape", hasMatches: false }), "close");
});

test("ignores modified or composing search input shortcuts", () => {
  assert.equal(resolveChatSearchInputKeyAction({ key: "Enter", hasMatches: false }), null);
  assert.equal(resolveChatSearchInputKeyAction({ key: "Enter", metaKey: true, hasMatches: true }), null);
  assert.equal(resolveChatSearchInputKeyAction({ key: "Escape", shiftKey: true, hasMatches: true }), null);
  assert.equal(resolveChatSearchInputKeyAction({ key: "Enter", isComposing: true, hasMatches: true }), null);
});
