import * as assert from "node:assert/strict";
import { test } from "node:test";
import { shouldFocusAgentInputFromSlashShortcut } from "./agent-chat-input-focus-state.ts";

test("focuses the agent input from plain slash outside editable controls", () => {
  assert.equal(
    shouldFocusAgentInputFromSlashShortcut({
      key: "/",
      code: "Slash",
      hasInput: true,
    }),
    true,
  );

  assert.equal(
    shouldFocusAgentInputFromSlashShortcut({
      key: "Unidentified",
      code: "Slash",
      hasInput: true,
    }),
    true,
  );
});

test("does not steal slash from editable controls or dialogs", () => {
  assert.equal(
    shouldFocusAgentInputFromSlashShortcut({
      key: "/",
      targetTagName: "input",
      hasInput: true,
    }),
    false,
  );
  assert.equal(
    shouldFocusAgentInputFromSlashShortcut({
      key: "/",
      targetIsContentEditable: true,
      hasInput: true,
    }),
    false,
  );
  assert.equal(
    shouldFocusAgentInputFromSlashShortcut({
      key: "/",
      targetRole: "searchbox",
      hasInput: true,
    }),
    false,
  );
  assert.equal(
    shouldFocusAgentInputFromSlashShortcut({
      key: "/",
      targetInsideDialog: true,
      hasInput: true,
    }),
    false,
  );
});

test("ignores unavailable contexts and modified slash shortcuts", () => {
  assert.equal(
    shouldFocusAgentInputFromSlashShortcut({
      key: "/",
      disableSlash: true,
      hasInput: true,
    }),
    false,
  );
  assert.equal(
    shouldFocusAgentInputFromSlashShortcut({
      key: "/",
      readOnly: true,
      hasInput: true,
    }),
    false,
  );
  assert.equal(shouldFocusAgentInputFromSlashShortcut({ key: "/", hasInput: false }), false);
  assert.equal(shouldFocusAgentInputFromSlashShortcut({ key: "/", shiftKey: true, hasInput: true }), false);
  assert.equal(shouldFocusAgentInputFromSlashShortcut({ key: "/", isComposing: true, hasInput: true }), false);
});
