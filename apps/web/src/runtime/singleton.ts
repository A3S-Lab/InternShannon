import type { AgentRuntime } from "./context";

let currentRuntime: AgentRuntime | null = null;

export function setAgentRuntime(runtime: AgentRuntime): void {
  currentRuntime = runtime;
}

export function getAgentRuntime(): AgentRuntime {
  if (!currentRuntime) {
    throw new Error(
      "Agent runtime not initialized. Call setAgentRuntime() during app bootstrap."
    );
  }
  return currentRuntime;
}

export function getAgentRuntimeOptional(): AgentRuntime | null {
  return currentRuntime;
}
