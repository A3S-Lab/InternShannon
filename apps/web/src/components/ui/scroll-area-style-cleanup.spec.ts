import * as assert from "node:assert/strict";
import { test } from "node:test";
import { containsRadixScrollAreaViewportCss, RADIX_SCROLL_AREA_VIEWPORT_CSS } from "./scroll-area-style-cleanup.ts";

test("recognizes Radix scroll-area viewport style text", () => {
  assert.equal(containsRadixScrollAreaViewportCss(RADIX_SCROLL_AREA_VIEWPORT_CSS), true);
});

test("ignores unrelated style text", () => {
  assert.equal(containsRadixScrollAreaViewportCss(".foo{display:none}"), false);
  assert.equal(containsRadixScrollAreaViewportCss(""), false);
  assert.equal(containsRadixScrollAreaViewportCss(null), false);
});
