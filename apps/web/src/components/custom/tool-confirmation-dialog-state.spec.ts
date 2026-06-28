import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveToolConfirmationDialogFeedback } from "./tool-confirmation-dialog-state.ts";

test("shows progress feedback while a tool confirmation response is being sent", () => {
  assert.deepEqual(
    resolveToolConfirmationDialogFeedback({
      pending: true,
      deliveryError: "previous failure",
    }),
    {
      tone: "info",
      title: "正在发送确认",
      message: "正在把授权响应发送到本地运行时。",
      role: "status",
      ariaLive: "polite",
    },
  );
});

test("shows delivery failures inside the tool confirmation dialog", () => {
  assert.deepEqual(
    resolveToolConfirmationDialogFeedback({
      pending: false,
      deliveryError: " response socket disconnected ",
    }),
    {
      tone: "error",
      title: "授权响应未送达",
      message: "response socket disconnected",
      role: "alert",
      ariaLive: "assertive",
    },
  );
});

test("omits dialog feedback when there is no pending send or delivery error", () => {
  assert.equal(resolveToolConfirmationDialogFeedback({ pending: false, deliveryError: " " }), null);
  assert.equal(resolveToolConfirmationDialogFeedback({ pending: false }), null);
});
