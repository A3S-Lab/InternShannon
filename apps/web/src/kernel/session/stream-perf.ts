import type { StreamSlowStage } from "../../models/agent.model";

export interface StreamPerfTimingInput {
  transportOverheadMs?: number | null;
  firstDeltaMs?: number | null;
  firstToolStartMs?: number | null;
  firstToolInputDeltaMs?: number | null;
  lastToolInputDeltaMs?: number | null;
  firstToolOutputMs?: number | null;
  firstToolEndMs?: number | null;
  resultMs?: number | null;
}

export function inferStreamSlowStage(input: StreamPerfTimingInput): StreamSlowStage {
  const transportOverheadMs = finite(input.transportOverheadMs);
  const firstDeltaMs = finite(input.firstDeltaMs);
  const firstToolStartMs = finite(input.firstToolStartMs);
  const firstToolInputDeltaMs = finite(input.firstToolInputDeltaMs);
  const lastToolInputDeltaMs = finite(input.lastToolInputDeltaMs);
  const firstToolEndMs = finite(input.firstToolEndMs);
  const resultMs = finite(input.resultMs);
  const firstModelEventMs = minFinite(firstDeltaMs, firstToolStartMs);
  const modelWaitMs = firstModelEventMs ?? firstDeltaMs;
  const inputStreamMs =
    firstToolInputDeltaMs !== undefined && lastToolInputDeltaMs !== undefined
      ? Math.max(0, lastToolInputDeltaMs - (firstToolStartMs ?? firstToolInputDeltaMs))
      : undefined;
  const toolEndOrResultMs = firstToolEndMs ?? resultMs;
  const postInputToolMs =
    lastToolInputDeltaMs !== undefined && toolEndOrResultMs !== undefined
      ? Math.max(0, toolEndOrResultMs - lastToolInputDeltaMs)
      : undefined;

  if (
    inputStreamMs !== undefined &&
    inputStreamMs > 4000 &&
    inputStreamMs >= (modelWaitMs ?? 0) &&
    inputStreamMs >= (postInputToolMs ?? 0)
  ) {
    return "tool_input_streaming";
  }

  if (modelWaitMs !== undefined && modelWaitMs > 8000) {
    return "model_first_token";
  }

  const toolExecWindowMs =
    firstToolStartMs !== undefined && resultMs !== undefined
      ? resultMs - (lastToolInputDeltaMs ?? firstToolStartMs)
      : undefined;
  if (toolExecWindowMs !== undefined && toolExecWindowMs > 4000) {
    return "tool_exec";
  }

  if (transportOverheadMs !== undefined && transportOverheadMs > 1500) {
    return "frontend_send";
  }

  return "unknown";
}

export function computeToolInputStreamMs(input: StreamPerfTimingInput): number | undefined {
  const firstToolStartMs = finite(input.firstToolStartMs);
  const firstToolInputDeltaMs = finite(input.firstToolInputDeltaMs);
  const lastToolInputDeltaMs = finite(input.lastToolInputDeltaMs);
  if (firstToolInputDeltaMs === undefined || lastToolInputDeltaMs === undefined) return undefined;
  return Math.max(0, lastToolInputDeltaMs - (firstToolStartMs ?? firstToolInputDeltaMs));
}

function finite(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function minFinite(...values: Array<number | undefined>): number | undefined {
  const finiteValues = values.filter((value): value is number => value !== undefined);
  return finiteValues.length > 0 ? Math.min(...finiteValues) : undefined;
}
