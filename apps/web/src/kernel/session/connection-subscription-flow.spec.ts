import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSendSessionSocketMessage,
  subscribedPayloadMatchesSession,
  type SessionSocketConnectionStatus,
} from "./connection-readiness.ts";

test("keeps the first user message queued until the socket has joined the session room", () => {
  const sessionId = "session-a";
  const state: { socketConnected: boolean; connectionStatus: SessionSocketConnectionStatus } = {
    socketConnected: false,
    connectionStatus: "connecting",
  };
  const canSend = () =>
    canSendSessionSocketMessage({
      socketConnected: state.socketConnected,
      connectionStatus: state.connectionStatus,
    });

  state.socketConnected = true;
  assert.equal(canSend(), false);

  if (subscribedPayloadMatchesSession({ sessionId: "session-b" }, sessionId)) {
    state.connectionStatus = "connected";
  }
  assert.equal(canSend(), false);

  if (subscribedPayloadMatchesSession({ sessionId }, sessionId)) {
    state.connectionStatus = "connected";
  }
  assert.equal(canSend(), true);
});
