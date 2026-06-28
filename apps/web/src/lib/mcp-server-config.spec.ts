import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMcpServerConfigs } from "./mcp-server-config.ts";

test("normalizes valid MCP server configs and drops malformed entries", () => {
  assert.deepEqual(
    normalizeMcpServerConfigs([
      null,
      { name: "missing transport" },
      { name: "missing command", transport: { type: "stdio" } },
      { name: "missing url", transport: { type: "http" } },
      {
        name: " local-files ",
        transport: {
          type: "stdio",
          command: " npx ",
          args: [" -y ", "", 7, "@modelcontextprotocol/server-filesystem"],
        },
        enabled: true,
        env: { ROOT: " /tmp ", EMPTY: "" },
        toolTimeoutSecs: 45,
      },
      {
        name: "remote-browser",
        transport: {
          type: "streamable-http",
          url: " https://mcp.example.test ",
          headers: { Authorization: " Bearer token ", Empty: "" },
        },
        enabled: "yes",
        tool_timeout_secs: -1,
      },
      {
        name: 101,
        transport: {
          type: "http",
          url: " https://legacy.example.test/mcp ",
          headers: { "X-Retry": 3 },
        },
        enabled: "false",
        toolTimeoutSecs: "30",
      },
    ]),
    [
      {
        name: "local-files",
        transport: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
        },
        enabled: true,
        env: { ROOT: "/tmp" },
        tool_timeout_secs: 45,
      },
      {
        name: "remote-browser",
        transport: {
          type: "streamable-http",
          url: "https://mcp.example.test",
          headers: { Authorization: "Bearer token" },
        },
        enabled: true,
      },
      {
        name: "101",
        transport: {
          type: "http",
          url: "https://legacy.example.test/mcp",
          headers: { "X-Retry": "3" },
        },
        enabled: false,
        tool_timeout_secs: 30,
      },
    ],
  );
});

test("returns an empty list for non-array MCP config values", () => {
  assert.deepEqual(normalizeMcpServerConfigs({ name: "filesystem" }), []);
  assert.deepEqual(normalizeMcpServerConfigs(undefined), []);
});
