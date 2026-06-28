import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveClearSessionDeliveryState } from "./agent-clear-session-state.ts";

test("resets the local conversation only after clear delivery succeeds", () => {
  assert.deepEqual(resolveClearSessionDeliveryState({ sent: true }), {
    action: "reset-local",
    actionError: null,
    toastMessage: null,
  });
});

test("keeps the local conversation visible when clear delivery fails", () => {
  assert.deepEqual(resolveClearSessionDeliveryState({ sent: false }), {
    action: "keep-local",
    actionError: {
      message: "清空请求未送达，本地对话未清除。请恢复连接后重试。",
      dismissLabel: "关闭清空错误提示",
    },
    toastMessage: "清空失败，请检查本地服务连接",
  });
});
