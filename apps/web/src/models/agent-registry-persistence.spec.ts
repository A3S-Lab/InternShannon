import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizePersistedAgentOverrides,
  normalizePersistedAgentWorkspaces,
  normalizePersistedCustomAgents,
  normalizePersistedSessionAgents,
} from "./agent-registry-persistence.ts";

test("normalizes malformed persisted session agent mappings before Agent registry boot", () => {
  assert.deepEqual(
    normalizePersistedSessionAgents({
      " session-1 ": "super-admin",
      "session-2": " custom-agent ",
      "session-3": { id: "bad-object" },
      "session-4": "",
      "   ": "default",
    }),
    {
      "session-1": "default",
      "session-2": "custom-agent",
    },
  );

  assert.deepEqual(normalizePersistedSessionAgents(["not", "a", "map"]), {});
});

test("normalizes malformed persisted custom agents before Agent picker render", () => {
  const agents = normalizePersistedCustomAgents([
    null,
    {
      id: " custom-1 ",
      name: { text: "bad object" },
      description: 42,
      avatar: ["bad"],
      systemPrompt: 123,
      tags: [" 工程 ", 42, "", "工程"],
      defaultSkills: [" skill-a ", { name: "bad" }, "skill-a"],
      defaultKnowledgeBases: [" kb-1 ", null],
      scheduledTasks: [{ id: "bad" }],
      sessionOptions: {
        builtinSkills: "yes",
        planningMode: "invalid",
        goalTracking: "false",
        maxToolRounds: "25",
        continuationEnabled: "true",
        maxContinuationTurns: "3",
        autoCompact: "no",
        autoCompactThreshold: "0.65",
        temperature: "0.2",
        thinkingBudget: "128",
        searchConfig: { enabled: true },
      },
      hidden: "true",
      undeletable: "false",
      defaultWorkspace: " /tmp/agent ",
      defaultModel: " model-a ",
      defaultPermissionMode: " plan ",
    },
    {
      id: " ",
      name: "drop empty id",
      description: "drop",
      avatar: {},
      systemPrompt: "",
    },
  ]);

  assert.equal(agents.length, 1);
  assert.equal(agents[0]?.id, "custom-1");
  assert.equal(agents[0]?.name, "custom-1");
  assert.equal(agents[0]?.description, "42");
  assert.deepEqual(agents[0]?.avatar, {});
  assert.equal(agents[0]?.systemPrompt, "");
  assert.equal(agents[0]?.builtin, false);
  assert.equal(agents[0]?.hidden, true);
  assert.equal(agents[0]?.undeletable, false);
  assert.deepEqual(agents[0]?.tags, ["工程"]);
  assert.deepEqual(agents[0]?.defaultSkills, ["skill-a"]);
  assert.deepEqual(agents[0]?.defaultKnowledgeBases, ["kb-1"]);
  assert.deepEqual(agents[0]?.scheduledTasks, []);
  assert.deepEqual(agents[0]?.sessionOptions, {
    builtinSkills: true,
    planningMode: "auto",
    goalTracking: false,
    maxToolRounds: 25,
    continuationEnabled: true,
    maxContinuationTurns: 3,
    autoCompact: false,
    autoCompactThreshold: 0.65,
    temperature: 0.2,
    thinkingBudget: 128,
    searchConfig: { enabled: true },
  });
  assert.equal(agents[0]?.defaultWorkspace, "/tmp/agent");
  assert.equal(agents[0]?.defaultModel, "model-a");
  assert.equal(agents[0]?.defaultPermissionMode, "plan");

  assert.deepEqual(normalizePersistedCustomAgents({ not: "an array" }), []);
});

test("normalizes malformed persisted agent overrides and workspaces", () => {
  assert.deepEqual(
    normalizePersistedAgentOverrides({
      " default ": {
        defaultModel: 42,
        defaultPermissionMode: " auto ",
        systemPrompt: { text: "bad" },
        defaultSkills: [" skill-a ", "", "skill-a"],
        defaultKnowledgeBases: ["kb-a", 7],
        scheduledTasks: [{ id: "bad" }],
        sessionOptions: {
          planningMode: "enabled",
          maxToolRounds: "12",
          mcpServers: [
            { name: "server" },
            {
              name: " stdio-server ",
              transport: { type: "stdio", command: " node ", args: [" server.js ", ""] },
              enabled: "true",
              env: { A: " 1 ", EMPTY: "" },
            },
            {
              name: "http-server",
              transport: {
                type: "http",
                url: " https://example.test/mcp ",
                headers: { Authorization: " Bearer token ", Empty: "" },
              },
              toolTimeoutSecs: "30",
            },
          ],
        },
      },
      "custom-1": "bad override",
      " ": { defaultModel: "drop" },
    }),
    {
      default: {
        defaultModel: "42",
        defaultPermissionMode: "auto",
        defaultSkills: ["skill-a"],
        defaultKnowledgeBases: ["kb-a"],
        scheduledTasks: [],
        sessionOptions: {
          planningMode: "enabled",
          maxToolRounds: 12,
          mcpServers: [
            {
              name: "stdio-server",
              transport: { type: "stdio", command: "node", args: ["server.js"] },
              enabled: true,
              env: { A: "1" },
            },
            {
              name: "http-server",
              transport: {
                type: "http",
                url: "https://example.test/mcp",
                headers: { Authorization: "Bearer token" },
              },
              tool_timeout_secs: 30,
            },
          ],
        },
      },
    },
  );

  assert.deepEqual(
    normalizePersistedAgentWorkspaces({
      " default ": " /tmp/default ",
      "custom-1": 123,
      "custom-2": "",
      " ": "/tmp/drop",
    }),
    {
      default: "/tmp/default",
      "custom-1": "123",
    },
  );
});
