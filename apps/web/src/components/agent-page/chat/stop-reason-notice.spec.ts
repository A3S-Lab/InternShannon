import * as assert from "node:assert/strict";
import { test } from "node:test";
import { stopReasonNotice } from "./stop-reason-notice.ts";

test("hides normal end_turn stop reasons before InternShannon renders assistant messages", () => {
  assert.equal(stopReasonNotice(null), null);
  assert.equal(stopReasonNotice("end_turn"), null);
});

test("describes retryable truncation stop reasons for assistant messages", () => {
  assert.equal(stopReasonNotice("max_tokens"), "输出或任务被截断 (max_tokens)");
  assert.equal(stopReasonNotice("context_limit"), "输出或任务被截断 (context_limit)");
  assert.equal(stopReasonNotice("max_tool_rounds"), "输出或任务被截断 (max_tool_rounds)");
  assert.equal(stopReasonNotice("continuation_exhausted"), "输出或任务被截断 (continuation_exhausted)");
});

test("describes abnormal terminal stop reasons for assistant messages", () => {
  assert.equal(stopReasonNotice("sdk_stream_ended_without_stop_reason"), "运行提前结束，未收到明确完成信号");
  assert.equal(stopReasonNotice("event_stream_stalled"), "运行事件流超时停滞");
  assert.equal(stopReasonNotice("tool_circuit_open"), "工具连续失败，本轮已中止");
  assert.equal(stopReasonNotice("empty_response"), "模型未返回有效响应");
  assert.equal(stopReasonNotice("user_cancelled"), "用户取消了本轮任务");
  assert.equal(stopReasonNotice("unknown"), "本轮未正常结束 (unknown)");
});

test("hides missing SDK stop signal for text-only assistant messages", () => {
  assert.equal(stopReasonNotice("sdk_stream_ended_without_stop_reason", { hasToolActivity: false }), null);
  assert.equal(
    stopReasonNotice("sdk_stream_ended_without_stop_reason", { hasToolActivity: true }),
    "运行提前结束，未收到明确完成信号",
  );
});
