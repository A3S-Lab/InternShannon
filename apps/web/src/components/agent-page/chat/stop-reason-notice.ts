export interface StopReasonNoticeContext {
  hasToolActivity?: boolean;
}

export function stopReasonNotice(stopReason?: string | null, context: StopReasonNoticeContext = {}): string | null {
  if (!stopReason || stopReason === "end_turn") return null;
  if (
    stopReason === "max_tokens" ||
    stopReason === "context_limit" ||
    stopReason === "max_tool_rounds" ||
    stopReason === "continuation_exhausted"
  ) {
    return `输出或任务被截断 (${stopReason})`;
  }
  if (stopReason === "sdk_stream_ended_without_stop_reason") {
    if (context.hasToolActivity === false) return null;
    return "运行提前结束，未收到明确完成信号";
  }
  if (stopReason === "event_stream_stalled") return "运行事件流超时停滞";
  if (stopReason === "tool_circuit_open") return "工具连续失败，本轮已中止";
  if (stopReason === "empty_response") return "模型未返回有效响应";
  if (stopReason === "user_cancelled") return "用户取消了本轮任务";
  return `本轮未正常结束 (${stopReason})`;
}
