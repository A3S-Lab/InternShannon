import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AgentInputDraftStorage,
  clearAgentInputDraft,
  createAgentInputDraftStorageKey,
  createAgentInputPendingFilesFromPrefillImages,
  MAX_AGENT_INPUT_DRAFT_LENGTH,
  persistAgentInputDraft,
  readAgentInputDraft,
} from "./agent-input-draft-state.ts";

function createMemoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const writes: Array<{ key: string; value: string }> = [];
  const removals: string[] = [];
  const storage: AgentInputDraftStorage = {
    read: (key) => data.get(key),
    write: (key, value) => {
      writes.push({ key, value });
      data.set(key, value);
    },
    remove: (key) => {
      removals.push(key);
      data.delete(key);
    },
  };
  return { data, removals, storage, writes };
}

test("builds a stable per-session draft storage key", () => {
  assert.equal(createAgentInputDraftStorageKey(" session/with spaces "), "agent-input-draft:session%2Fwith%20spaces");
  assert.equal(createAgentInputDraftStorageKey("   "), null);
});

test("persists non-empty draft text and returns the stored value", () => {
  const { data, storage, writes } = createMemoryStorage();
  const key = createAgentInputDraftStorageKey("session-1");

  const stored = persistAgentInputDraft(storage, "session-1", "  keep my draft  ");

  assert.equal(stored, "  keep my draft  ");
  assert.deepEqual(writes, [{ key, value: "  keep my draft  " }]);
  assert.equal(data.get(key ?? ""), "  keep my draft  ");
});

test("removes empty draft text instead of storing it", () => {
  const key = createAgentInputDraftStorageKey("session-1") ?? "";
  const { data, removals, storage } = createMemoryStorage({ [key]: "old draft" });

  const stored = persistAgentInputDraft(storage, "session-1", "   ");

  assert.equal(stored, null);
  assert.deepEqual(removals, [key]);
  assert.equal(data.has(key), false);
});

test("reads stored draft text and cleans stale blank values", () => {
  const draftKey = createAgentInputDraftStorageKey("session-1") ?? "";
  const blankKey = createAgentInputDraftStorageKey("session-2") ?? "";
  const draft = createMemoryStorage({ [draftKey]: "resume me", [blankKey]: "\n\t" });

  assert.equal(readAgentInputDraft(draft.storage, "session-1"), "resume me");
  assert.equal(readAgentInputDraft(draft.storage, "session-2"), "");
  assert.deepEqual(draft.removals, [blankKey]);
});

test("limits draft size before writing to storage", () => {
  const { storage, writes } = createMemoryStorage();
  const longDraft = "x".repeat(MAX_AGENT_INPUT_DRAFT_LENGTH + 10);

  const stored = persistAgentInputDraft(storage, "session-1", longDraft);

  assert.equal(stored?.length, MAX_AGENT_INPUT_DRAFT_LENGTH);
  assert.equal(writes[0]?.value.length, MAX_AGENT_INPUT_DRAFT_LENGTH);
});

test("clears the current session draft", () => {
  const key = createAgentInputDraftStorageKey("session-1") ?? "";
  const { data, removals, storage } = createMemoryStorage({ [key]: "draft" });

  clearAgentInputDraft(storage, "session-1");

  assert.equal(data.has(key), false);
  assert.deepEqual(removals, [key]);
});

test("rebuilds ready pending files from normalized prefilled images", () => {
  let id = 0;
  const files = createAgentInputPendingFilesFromPrefillImages(
    [
      { mediaType: " image/png ", data: " base64-image ", name: " screenshot.png " },
      { mediaType: "image/jpeg", data: "base64-photo" },
      { mediaType: " ", data: "ignored" },
      { mediaType: "image/webp", data: "   " },
    ],
    () => `restored-${++id}`,
  );

  assert.deepEqual(files, [
    {
      id: "restored-1",
      name: "screenshot.png",
      mediaType: "image/png",
      data: "base64-image",
    },
    {
      id: "restored-2",
      name: "粘贴图片",
      mediaType: "image/jpeg",
      data: "base64-photo",
    },
  ]);
});
