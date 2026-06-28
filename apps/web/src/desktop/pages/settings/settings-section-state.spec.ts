import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS_SECTION,
  getSettingsSectionFromSearch,
  isSettingsSectionId,
  resolveSettingsSection,
  resolveSettingsSectionPreference,
} from "./settings-section-state.ts";

test("accepts known settings section ids", () => {
  assert.equal(isSettingsSectionId("workspace"), true);
  assert.equal(isSettingsSectionId("ai"), true);
  assert.equal(isSettingsSectionId("mcp"), true);
});

test("rejects unknown settings section ids", () => {
  assert.equal(isSettingsSectionId("billing"), false);
  assert.equal(isSettingsSectionId(""), false);
  assert.equal(isSettingsSectionId(null), false);
});

test("falls back to workspace for invalid persisted values", () => {
  assert.equal(resolveSettingsSection("search"), "search");
  assert.equal(resolveSettingsSection("billing"), DEFAULT_SETTINGS_SECTION);
  assert.equal(resolveSettingsSection(undefined), DEFAULT_SETTINGS_SECTION);
});

test("parses valid section search params", () => {
  assert.equal(getSettingsSectionFromSearch("?section=workspace"), "workspace");
  assert.equal(getSettingsSectionFromSearch("?section=ai&source=skills"), "ai");
  assert.equal(getSettingsSectionFromSearch("?section=billing"), null);
  assert.equal(getSettingsSectionFromSearch("?source=skills"), null);
});

test("uses route section before persisted section", () => {
  assert.equal(
    resolveSettingsSectionPreference({
      routeSection: "workspace",
      storedSection: "ai",
    }),
    "workspace",
  );
  assert.equal(
    resolveSettingsSectionPreference({
      routeSection: null,
      storedSection: "ai",
    }),
    "ai",
  );
  assert.equal(
    resolveSettingsSectionPreference({
      routeSection: "billing",
      storedSection: "unknown",
    }),
    DEFAULT_SETTINGS_SECTION,
  );
});
