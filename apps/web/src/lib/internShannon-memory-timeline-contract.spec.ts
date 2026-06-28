import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./internShannon-memory-timeline.ts", import.meta.url)), "utf8");
const recordSource = readFileSync(
  fileURLToPath(new URL("./internShannon-memory-timeline-record.ts", import.meta.url)),
  "utf8",
);
const itemSource = readFileSync(
  fileURLToPath(new URL("./internShannon-memory-timeline-item.ts", import.meta.url)),
  "utf8",
);

test("defines a user-scoped InternShannon three-layer memory timeline", () => {
  assert.match(source, /INTERNSHANNON_MEMORY_TIMELINE_STORAGE_KEY = "internShannon-memory-timeline-v1"/);
  assert.match(recordSource, /export type InternShannonMemoryLayer = "resource" \| "artifact" \| "insight"/);
  assert.match(source, /INTERNSHANNON_MEMORY_LAYER_DEFINITIONS/);
  assert.match(itemSource, /resource: \{/);
  assert.match(itemSource, /artifact: \{/);
  assert.match(itemSource, /insight: \{/);
  assert.match(source, /readUserJsonStorage/);
  assert.match(source, /writeUserJsonStorage/);
});

test("exposes record, edit and delete operations for memory timeline items", () => {
  assert.match(source, /export function recordInternShannonMemoryEvent/);
  assert.match(source, /export function updateInternShannonMemoryTimelineItem/);
  assert.match(source, /export function deleteInternShannonMemoryTimelineItem/);
  assert.match(source, /deletedAt: Date\.now\(\)/);
});
