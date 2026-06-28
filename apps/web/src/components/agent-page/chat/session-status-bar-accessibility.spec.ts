import * as assert from "node:assert/strict";
import { test } from "node:test";
import { EXECUTION_MODE_SELECT_LABEL, SESSION_MODEL_SELECT_LABEL } from "./session-status-bar-accessibility.ts";

test("names compact status-bar select controls by their action", () => {
  assert.equal(EXECUTION_MODE_SELECT_LABEL, "选择对话执行模式");
  assert.equal(SESSION_MODEL_SELECT_LABEL, "选择会话模型");
});
