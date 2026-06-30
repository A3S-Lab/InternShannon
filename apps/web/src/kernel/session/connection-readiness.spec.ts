import * as assert from "node:assert/strict";
import { test } from "node:test";
import { canSendSessionSocketMessage, subscribedPayloadMatchesSession } from "./connection-readiness.ts";

test("treats subscribed acknowledgements as belonging to the active session only", () => {
  assert.equal(subscribedPayloadMatchesSession({ sessionId: "session-a" }, "session-a"), true);
  assert.equal(subscribedPayloadMatchesSession({ sessionId: "session-b" }, "session-a"), false);
});

test("keeps legacy subscribed acknowledgements usable when the payload omits sessionId", () => {
  assert.equal(subscribedPayloadMatchesSession({}, "session-a"), true);
  assert.equal(subscribedPayloadMatchesSession(null, "session-a"), true);
});

test("blocks sends after socket connect until the session room subscription is acknowledged", () => {
  assert.equal(canSendSessionSocketMessage({ socketConnected: true, connectionStatus: "connecting" }), false);
  assert.equal(canSendSessionSocketMessage({ socketConnected: true, connectionStatus: "disconnected" }), false);
  assert.equal(canSendSessionSocketMessage({ socketConnected: false, connectionStatus: "connected" }), false);
  assert.equal(canSendSessionSocketMessage({ socketConnected: true, connectionStatus: "connected" }), true);
});
