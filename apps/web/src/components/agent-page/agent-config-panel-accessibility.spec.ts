import * as assert from "node:assert/strict";
import { test } from "node:test";
import { parameterHelpTriggerLabel } from "./agent-config-panel-accessibility.ts";

test("labels parameter help trigger buttons by the parameter title", () => {
  assert.equal(parameterHelpTriggerLabel("规划模式"), "查看规划模式说明");
  assert.equal(parameterHelpTriggerLabel("  温度  "), "查看温度说明");
});

test("falls back to a generic parameter help label", () => {
  assert.equal(parameterHelpTriggerLabel(""), "查看参数说明");
  assert.equal(parameterHelpTriggerLabel(null), "查看参数说明");
  assert.equal(parameterHelpTriggerLabel(undefined), "查看参数说明");
});
