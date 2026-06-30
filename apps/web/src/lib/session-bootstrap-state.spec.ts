import * as assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentSessionCreateRequest, buildCreatedSessionInfo } from "./session-bootstrap-state.ts";

test("omits model snapshots when creating a session that follows the system default", () => {
  const request = buildAgentSessionCreateRequest({
    agent: {
      sessionOptions: { builtinSkills: true },
      defaultModel: "openai/bailian/deepseek-v4-pro",
      defaultSkills: [" capabilities ", "capabilities", "mermaid"],
    },
    normalizedAgentId: "default",
    title: "New chat",
    permissionMode: "default",
    cwd: "/workspace",
    options: {
      followDefaultModel: true,
      skills: [" vis-chart ", "vis-chart"],
    },
    runtimeOptions: {
      followDefaultModel: true,
      model: "openai/bailian/deepseek-v4-pro",
    },
  });

  assert.equal("model" in request, false);
  assert.equal(request.followDefaultModel, true);
  assert.deepEqual(request.skills, ["vis-chart"]);
});

test("keeps explicit model pins for sessions that do not follow the system default", () => {
  const request = buildAgentSessionCreateRequest({
    agent: {
      defaultModel: "anthropic/claude-opus-4-7",
    },
    normalizedAgentId: "custom",
    permissionMode: "default",
    options: {
      followDefaultModel: false,
      model: "openai/bailian/deepseek-v4-pro",
    },
    runtimeOptions: {
      followDefaultModel: false,
      model: "openai/bailian/deepseek-v4-pro",
    },
  });

  assert.equal(request.model, "openai/bailian/deepseek-v4-pro");
  assert.equal(request.followDefaultModel, false);
});

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
