import type { AgentProcessInfo } from "@/lib/types";

export interface AgentPageSessionResolution {
  activeSessionId: string | null;
  activeSession: Readonly<AgentProcessInfo> | null;
  isRestoringSessions: boolean;
  suggestedCurrentSessionId: string | null;
}

export type AgentPageBootstrapSurface = "loading" | "error" | "workspace";

export interface AgentPageBackgroundSyncNotice {
  title: string;
  description: string;
  actionLabel: string;
  ariaLive: "polite";
}

export function resolveAgentPageBootstrapSurface(input: {
  bootstrapReady: boolean;
  bootstrapError?: string | null;
  sessionCount: number;
}): AgentPageBootstrapSurface {
  if (!input.bootstrapReady) return "loading";
  if (input.bootstrapError && input.sessionCount === 0) return "error";
  return "workspace";
}

export function resolveAgentPageBackgroundSyncNotice(input: {
  bootstrapReady: boolean;
  bootstrapError?: string | null;
  sessionCount: number;
  refreshing: boolean;
}): AgentPageBackgroundSyncNotice | null {
  if (!input.bootstrapReady || !input.bootstrapError || input.sessionCount === 0) return null;

  if (input.refreshing) {
    return {
      title: "正在重新同步会话",
      description: "正在重新连接本地 sidecar，当前会话会保持可用。",
      actionLabel: "正在重试",
      ariaLive: "polite",
    };
  }

  return {
    title: "会话同步暂时失败",
    description: input.bootstrapError.trim() || "加载会话失败，请检查本地服务连接",
    actionLabel: "重试同步",
    ariaLive: "polite",
  };
}

function timestampMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value > 0 && value < 1e12 ? value * 1000 : value;
}

function chooseFallbackSession(sessions: readonly Readonly<AgentProcessInfo>[]): Readonly<AgentProcessInfo> | null {
  return (
    [...sessions].sort((a, b) => {
      const stateRank = Number(b.state !== "exited") - Number(a.state !== "exited");
      if (stateRank !== 0) return stateRank;
      const createdRank = timestampMs(b.createdAt) - timestampMs(a.createdAt);
      if (createdRank !== 0) return createdRank;
      return b.sessionId.localeCompare(a.sessionId);
    })[0] ?? null
  );
}

export function resolveAgentPageSession(input: {
  bootstrapReady: boolean;
  currentSessionId: string | null;
  sessions: readonly Readonly<AgentProcessInfo>[];
}): AgentPageSessionResolution {
  if (!input.bootstrapReady) {
    return {
      activeSessionId: null,
      activeSession: null,
      isRestoringSessions: true,
      suggestedCurrentSessionId: input.currentSessionId,
    };
  }

  const currentSession = input.currentSessionId
    ? (input.sessions.find((session) => session.sessionId === input.currentSessionId) ?? null)
    : null;
  const activeSession = currentSession ?? chooseFallbackSession(input.sessions);

  return {
    activeSessionId: activeSession?.sessionId ?? null,
    activeSession,
    isRestoringSessions: false,
    suggestedCurrentSessionId: activeSession?.sessionId ?? null,
  };
}
