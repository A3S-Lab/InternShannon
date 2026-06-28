import type { AgentProfile } from "./agent-profile.types";
import { getSystemSessionDefaults } from "@/models/settings.model";

type AgentRuntimeDefaultsSource = Pick<AgentProfile, "defaultPermissionMode" | "sessionOptions"> | null | undefined;

export function getSessionRuntimeDefaults(agent?: AgentRuntimeDefaultsSource) {
  const defaults = {
    ...getSystemSessionDefaults(),
    ...(agent?.sessionOptions ?? {}),
  };
  if (agent?.defaultPermissionMode === "plan") {
    return {
      ...defaults,
      planningMode: "enabled" as const,
      goalTracking: true,
    };
  }
  return defaults;
}
