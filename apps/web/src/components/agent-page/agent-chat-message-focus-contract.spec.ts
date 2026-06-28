import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./agent-chat.tsx", import.meta.url)), "utf8");

test("supports host-driven message focus for InternShannon memory timeline links", () => {
  assert.match(source, /focusMessageId\?: string;/);
  assert.match(source, /focusMessageRequest\?: number;/);
  assert.match(source, /data-agent-message-id=\{msg\.id\}/);
  assert.match(source, /highlightedMessageId === msg\.id/);
  assert.match(source, /displayMessages\.findIndex\(\(message\) => message\.id === focusMessageId\)/);
  assert.match(source, /element\.dataset\.agentMessageId === focusMessageId/);
  assert.match(source, /scrollIntoView\(\{ block: "center", behavior: "smooth" \}\)/);
});
