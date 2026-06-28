import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  SETTINGS_CONTENT_MAX_WIDTH_CLASS,
  SETTINGS_LEGACY_NARROW_CONTENT_MAX_WIDTH_CLASS,
} from "./settings-layout-state.ts";

test("uses a wide content container for dense settings panels", () => {
  assert.equal(SETTINGS_CONTENT_MAX_WIDTH_CLASS, "max-w-7xl");
  assert.notEqual(SETTINGS_CONTENT_MAX_WIDTH_CLASS, SETTINGS_LEGACY_NARROW_CONTENT_MAX_WIDTH_CLASS);
});
