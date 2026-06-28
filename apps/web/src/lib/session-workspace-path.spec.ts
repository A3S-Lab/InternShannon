import * as assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessionWorkspacePath } from "./session-workspace-path.ts";

test("creates a per-session workspace for the default assistant instead of the user root", () => {
  const root = "/Users/local/.internshannon/workspace/users/local";
  const workspace = buildSessionWorkspacePath(root, "default", new Date(2026, 5, 11, 7, 8, 9, 12));

  assert.equal(workspace, `${root}/sessions/default-20260611-070809012`);
  assert.notEqual(workspace, root);
});

test("sanitizes agent ids before using them as session workspace folders", () => {
  const root = "s3://workspace/users/local";
  const workspace = buildSessionWorkspacePath(root, "custom:agent\\demo", new Date(2026, 5, 11, 7, 8, 9, 12));

  assert.equal(workspace, `${root}/sessions/custom-agent-demo-20260611-070809012`);
});
