import * as assert from "node:assert/strict";
import { test } from "node:test";
import { buildCreatedSessionInfo } from "./session-bootstrap-state.ts";

test("preserves created session model before the status bar resolves defaults", () => {
  const session = buildCreatedSessionInfo({
    session: {
      sessionId: "session-custom-model",
      title: "Custom model chat",
      cwd: "/workspace",
      model: "zhipu/glm-4.5",
      followDefaultModel: false,
    },
    normalizedAgentId: "default",
    permissionMode: "auto",
    cwd: "/workspace",
    createdAt: 1_780_000_000_000,
    name: "Custom model chat",
  });

  assert.equal(session.model, "zhipu/glm-4.5");
  assert.equal(session.followDefaultModel, false);
});
