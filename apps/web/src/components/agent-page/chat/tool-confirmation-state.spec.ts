import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatToolConfirmationDeliveryError,
  resolveToolConfirmationDeliveryAction,
  resolveToolConfirmationDialogDeliveryError,
} from "./tool-confirmation-state.ts";

test("clears the pending tool confirmation after successful delivery", () => {
  assert.equal(resolveToolConfirmationDeliveryAction({ sent: true }), "clear");
});

test("keeps the pending tool confirmation when delivery fails", () => {
  assert.equal(resolveToolConfirmationDeliveryAction({ sent: false }), "keep");
});

test("formats tool confirmation delivery errors without losing transport details", () => {
  assert.equal(formatToolConfirmationDeliveryError(new Error("socket closed"), "fallback"), "socket closed");
  assert.equal(formatToolConfirmationDeliveryError(" sidecar offline ", "fallback"), "sidecar offline");
  assert.equal(formatToolConfirmationDeliveryError({ message: "runtime busy" }, "fallback"), "runtime busy");
  assert.equal(formatToolConfirmationDeliveryError({ reason: "unknown" }, "授权响应发送失败"), "授权响应发送失败");
});

test("resolves dialog delivery errors only when a request and matching error both exist", () => {
  assert.equal(
    resolveToolConfirmationDialogDeliveryError({
      requestId: undefined,
      deliveryError: null,
    }),
    null,
  );
  assert.equal(
    resolveToolConfirmationDialogDeliveryError({
      requestId: "tool-1",
      deliveryError: { requestId: "tool-2", message: "send failed" },
    }),
    null,
  );
  assert.equal(
    resolveToolConfirmationDialogDeliveryError({
      requestId: "tool-1",
      deliveryError: { requestId: "tool-1", message: "send failed" },
    }),
    "send failed",
  );
});
