import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  getLegacyDesktopDefaultWorkspaceRoot,
  resolveMigratedDesktopWorkspaceRoot,
} from "./workspace-root-migration.ts";

test("derives the legacy desktop default from the current desktop default", () => {
  assert.equal(
    getLegacyDesktopDefaultWorkspaceRoot("/Users/local/.internshannon/workspace"),
    "/Users/local/.a3s/workspace",
  );
  assert.equal(
    getLegacyDesktopDefaultWorkspaceRoot("C:\\Users\\local\\.internshannon\\workspace"),
    "C:/Users/local/.a3s/workspace",
  );
});

test("migrates only the exact legacy desktop default workspace root", () => {
  assert.equal(
    resolveMigratedDesktopWorkspaceRoot("/Users/local/.a3s/workspace", "/Users/local/.internshannon/workspace"),
    "/Users/local/.internshannon/workspace",
  );
  assert.equal(
    resolveMigratedDesktopWorkspaceRoot("/Users/local/.a3s/workspace/", "/Users/local/.internshannon/workspace"),
    "/Users/local/.internshannon/workspace",
  );
});

test("preserves custom workspace roots and non-desktop backend defaults", () => {
  assert.equal(
    resolveMigratedDesktopWorkspaceRoot("/Users/local/projects/workspace", "/Users/local/.internshannon/workspace"),
    "/Users/local/projects/workspace",
  );
  assert.equal(
    resolveMigratedDesktopWorkspaceRoot("/Users/local/.a3s/workspace", "/Users/local/.a3s/workspace"),
    "/Users/local/.a3s/workspace",
  );
  assert.equal(resolveMigratedDesktopWorkspaceRoot("", "/Users/local/.internshannon/workspace"), "");
});
