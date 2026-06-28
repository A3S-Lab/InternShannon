import * as assert from "node:assert/strict";
import { test } from "node:test";
import { hasOnlyOneValueForKey } from "./chart.ts";

test("detects whether a key appears on at most one chart row", () => {
  assert.equal(hasOnlyOneValueForKey([{ value: 1 }, { other: 2 }], "value"), true);
  assert.equal(hasOnlyOneValueForKey([{ value: 1 }, { value: 2 }], "value"), false);
});

test("ignores malformed chart rows when checking sparse key usage", () => {
  assert.equal(hasOnlyOneValueForKey([null, "bad", { value: 1 }, ["skip"]], "value"), true);
});
