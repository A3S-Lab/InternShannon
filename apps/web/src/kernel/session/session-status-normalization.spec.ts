import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSessionStatusPatch } from "./session-status-normalization.ts";

const resolveWorkspacePath = (storageWorkspace: string, currentCwd: string, statusWorkspace: string) =>
  `resolved:${storageWorkspace}|${currentCwd}|${statusWorkspace}`;

test("ignores malformed session_status data instead of throwing", () => {
  assert.deepEqual(
    normalizeSessionStatusPatch(null, {
      currentAgentId: "default",
      currentCwd: "/workspace",
      resolveWorkspacePath,
    }),
    {},
  );
});

test("normalizes sparse session_status payloads before applying runtime state", () => {
  assert.deepEqual(
    normalizeSessionStatusPatch(
      {
        agentId: 42,
        storageWorkspace: "/storage",
        workspace: "/runtime",
        toolNames: [" Bash ", "", null, "Read", "Bash"],
        commands: ["/clear", { command: " compact " }, { label: "/cost" }, {}, null],
        skills: [
          { name: " write-code ", description: "writes code", kind: "local" },
          "review-code",
          { name: "" },
          null,
        ],
        mcpStatus: [
          null,
          { name: "filesystem", connected: true },
          { name: "git", error: "not running" },
          { name: "browser" },
          { connected: true },
        ],
      },
      {
        currentAgentId: "default",
        currentCwd: "/current",
        resolveWorkspacePath,
      },
    ),
    {
      agentId: "default",
      cwd: "resolved:/storage|/current|/runtime",
      tools: ["Bash", "Read"],
      skills: ["review-code", "write-code"],
      skillDetails: [{ name: "review-code" }, { name: "write-code", description: "writes code", kind: "local" }],
      slashCommands: ["/clear", "compact", "/cost"],
      mcpServers: [
        { name: "filesystem", status: "connected" },
        { name: "git", status: "not running" },
        { name: "browser", status: "disconnected" },
      ],
    },
  );
});
