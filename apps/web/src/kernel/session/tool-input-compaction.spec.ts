import * as assert from "node:assert/strict";
import { test } from "node:test";
import { compactToolInputForUi } from "./tool-input-compaction.ts";

test("keeps small tool inputs unchanged", () => {
  const input = JSON.stringify({ path: "src/app.ts", content: "small" });
  assert.equal(compactToolInputForUi("write", input, { maxBytes: 200 }), input);
});

test("summarizes large write inputs without retaining the full content field", () => {
  const content = "x".repeat(700);
  const compacted = compactToolInputForUi("write", JSON.stringify({ path: "src/app.ts", content }), { maxBytes: 80 });
  const parsed = JSON.parse(compacted);

  assert.equal(parsed.path, "src/app.ts");
  assert.equal(parsed.__omitted, true);
  assert.match(parsed.__display, /src\/app\.ts/);
  assert.deepEqual(parsed.__omittedFields, ["content"]);
  assert.equal(compacted.includes(content), false);
});

test("summarizes large non-json tool inputs by byte size", () => {
  const compacted = compactToolInputForUi("bash", "x".repeat(100), { maxBytes: 20 });
  const parsed = JSON.parse(compacted);

  assert.equal(parsed.__omitted, true);
  assert.match(parsed.__display, /bash/);
  assert.equal(parsed.__rawBytes, 100);
});
