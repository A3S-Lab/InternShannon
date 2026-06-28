import * as assert from "node:assert/strict";
import { test } from "node:test";
import { buildInternShannonAssistantUrl } from "./floating-internShannon-assistant-state.ts";

test("builds a InternShannon assistant URL without duplicating stale query params", () => {
  assert.equal(buildInternShannonAssistantUrl("/admin?tab=kernel#memory"), "/admin?tab=kernel&internShannon=open#memory");
  assert.equal(buildInternShannonAssistantUrl("/admin?internShannon=closed&tab=kernel"), "/admin?tab=kernel&internShannon=open");
});
