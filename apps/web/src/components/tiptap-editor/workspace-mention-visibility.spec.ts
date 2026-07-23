import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterWorkspaceMentionNodes,
  isWorkspaceMentionVisibleName,
} from "./workspace-mention-visibility.ts";

test("hides application state and dotfiles from workspace mentions", () => {
  for (const name of [".memory", ".sessions", ".git", "traces", "subagent_tasks"]) {
    assert.equal(isWorkspaceMentionVisibleName(name), false, name);
  }
  assert.equal(isWorkspaceMentionVisibleName("docs"), true);
  assert.equal(isWorkspaceMentionVisibleName("README.md"), true);
});
test("filters internal nodes without mutating visible nodes", () => {
  const nodes = [{ name: "docs" }, { name: ".memory" }, { name: "traces" }, { name: "notes.md" }];
  assert.deepEqual(filterWorkspaceMentionNodes(nodes), [{ name: "docs" }, { name: "notes.md" }]);
});
