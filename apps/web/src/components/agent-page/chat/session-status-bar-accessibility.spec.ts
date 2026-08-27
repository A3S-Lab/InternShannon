import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EXECUTION_MODE_SELECT_LABEL, SESSION_MODEL_SELECT_LABEL } from "./session-status-bar-accessibility.ts";

const statusBarSource = readFileSync(fileURLToPath(new URL("./session-status-bar.tsx", import.meta.url)), "utf8");

test("names compact status-bar select controls by their action", () => {
  assert.equal(EXECUTION_MODE_SELECT_LABEL, "选择对话执行模式");
  assert.equal(SESSION_MODEL_SELECT_LABEL, "选择会话模型");
});

test("isolates compact status-bar selectors from Radix collection update loops", () => {
  assert.doesNotMatch(statusBarSource, /from "@\/components\/ui\/select"/);
  assert.match(statusBarSource, /<select\s+aria-label=\{EXECUTION_MODE_SELECT_LABEL\}/);
  assert.match(statusBarSource, /<select\s+ref=\{modelSwitcherTriggerRef\}/);
  assert.match(statusBarSource, /aria-label=\{SESSION_MODEL_SELECT_LABEL\}/);
});
