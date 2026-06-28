import * as assert from "node:assert/strict";
import { test } from "node:test";
import { sidebarSectionListClassName } from "./sidebar-layout-state.ts";

test("wraps section navigation on compact desktop widths", () => {
  const className = sidebarSectionListClassName();

  assert.match(className, /\bflex-wrap\b/);
  assert.match(className, /\boverflow-visible\b/);
  assert.doesNotMatch(className, /\boverflow-x-auto\b/);
});

test("keeps the desktop sidebar section navigation vertical", () => {
  const className = sidebarSectionListClassName();

  assert.match(className, /\bmd:flex-nowrap\b/);
  assert.match(className, /\bmd:flex-col\b/);
  assert.match(className, /\bmd:flex-1\b/);
});
