import * as assert from "node:assert/strict";
import { test } from "node:test";
import { assertSkillStatus, joinWorkspacePath } from "./skill-loading-smoke.mjs";

test("validates the exact skill metadata returned by session_status", () => {
  assert.doesNotThrow(() =>
    assertSkillStatus(
      {
        type: "session_status",
        data: {
          skills: [
            {
              name: "review-fixture",
              description: "review websocket fixture",
              kind: "instruction",
            },
          ],
        },
      },
      {
        name: "review-fixture",
        description: "review websocket fixture",
        kind: "instruction",
      },
    ),
  );
});

test("rejects missing or partially parsed skill metadata", () => {
  assert.throws(
    () =>
      assertSkillStatus(
        { type: "session_status", data: { skills: [{ name: "review-fixture" }] } },
        { name: "review-fixture", description: "expected", kind: "instruction" },
      ),
    /unexpected skill description/,
  );
});

test("joins Unix and Windows workspace fixture paths", () => {
  assert.equal(joinWorkspacePath("/workspace", "users", "local", "skills"), "/workspace/users/local/skills");
  assert.equal(joinWorkspacePath("C:\\workspace", "users", "local", "skills"), "C:\\workspace\\users\\local\\skills");
});
