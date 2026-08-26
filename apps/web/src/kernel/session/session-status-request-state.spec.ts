import assert from "node:assert/strict";
import test from "node:test";
import { SessionStatusRequestRegistry } from "./session-status-request-state.ts";

test("settles only the matching request and session", async () => {
  const registry = new SessionStatusRequestRegistry();
  const pending = registry.wait("session-a", "request-a", 100);
  assert.equal(registry.settle("session-b", "request-a", true), false);
  assert.equal(registry.settle("session-a", undefined, true), false);
  assert.equal(registry.settle("session-a", "request-a", true), true);
  assert.equal(await pending, true);
});

test("a background status cannot complete an explicit request", async () => {
  const registry = new SessionStatusRequestRegistry();
  const pending = registry.wait("session-a", "request-a", 20);
  assert.equal(registry.settle("session-a", undefined, true), false);
  assert.equal(await pending, false);
});

test("disconnect cancels all pending requests for only that session", async () => {
  const registry = new SessionStatusRequestRegistry();
  const first = registry.wait("session-a", "request-a", 100);
  const second = registry.wait("session-b", "request-b", 100);
  registry.cancelSession("session-a");
  assert.equal(await first, false);
  assert.equal(registry.settle("session-b", "request-b", true), true);
  assert.equal(await second, true);
});
