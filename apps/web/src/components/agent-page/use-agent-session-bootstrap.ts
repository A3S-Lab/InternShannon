import { useEventListener } from "ahooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectSession } from "@/hooks/use-agent-ws";
import { isDefaultAgentId } from "@/lib/builtins";
import { allowsLocalWorkspacePaths } from "@/lib/runtime-environment";
import { reloadSessions } from "@/lib/session-bootstrap";
import type { AgentProcessInfo } from "@/lib/types";
import { exposeWorkspacePath } from "@/lib/workspace-path";
import { getEffectiveWorkspaceRoot } from "@/lib/workspace-utils";
import agentModel from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";

type LoadAgentSessionsOptions = {
  apiUrl?: string;
  retries?: number;
  retryDelayMs?: number;
};

type UseAgentSessionBootstrapOptions = LoadAgentSessionsOptions & {
  reloadOnFocus?: boolean;
};

export interface LoadAgentSessionsResult {
  sessions: AgentProcessInfo[];
  error: string | null;
}

function formatSessionBootstrapError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "加载会话失败，请检查本地服务连接";
}

function latestActiveSession(sessions: readonly AgentProcessInfo[]): AgentProcessInfo | undefined {
  return sessions.filter((session) => session.state !== "exited").sort((a, b) => b.createdAt - a.createdAt)[0];
}

export async function loadAgentSessionsWithResult(
  options: LoadAgentSessionsOptions = {},
): Promise<LoadAgentSessionsResult> {
  const retries = options.retries ?? 0;
  const retryDelayMs = options.retryDelayMs ?? 0;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      void agentRegistryModel.loadServerAgents();
      const sessions = await reloadSessions(options.apiUrl);
      const visibleSessions = sessions.filter(
        (session) => session.metadata?.visibility !== "embedded" && !agentModel.isInternalSession(session.sessionId),
      );

      // 解析此次应聚焦的会话（沿用原 latestActiveSession 兜底）。
      const currentId = agentModel.state.currentSessionId;
      const currentStillExists = visibleSessions.some((session) => session.sessionId === currentId);
      const nextCurrentId =
        !currentId || !currentStillExists ? (latestActiveSession(visibleSessions)?.sessionId ?? null) : currentId;
      if (nextCurrentId !== currentId) {
        agentModel.setCurrentSession(nextCurrentId);
      }

      // 最佳实践：加载时只为「当前查看的会话」建立实时 WS。旧逻辑会给每个未退出会话各开一条
      // socket（用户攒到上百会话即上百连接 = 连接风暴）。其余会话在被选中时按需连接（侧栏/头部
      // 选择、聊天挂载、发送前都会调用 connectSession），且一旦连接便保持、侧栏状态持续实时刷新；
      // 从未打开过的会话展示会话列表(REST)的最后已知状态。后端 /ws/kernel 是一 socket 一 session
      // 架构（subscribe 新会话会断开旧房间），无法用单连接多路复用，故「按需单连」是与后端对齐的最优解。
      if (nextCurrentId) {
        const activeSession = visibleSessions.find((session) => session.sessionId === nextCurrentId);
        if (activeSession && activeSession.state !== "exited") {
          connectSession(nextCurrentId);
        }
      }

      return {
        sessions: visibleSessions,
        error: null,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  const currentId = agentModel.state.currentSessionId;
  if (currentId && !agentModel.state.sessions[currentId]) {
    agentModel.setCurrentSession(null);
  }

  console.warn("Failed to load sessions on startup", lastError);
  return {
    sessions: [],
    error: formatSessionBootstrapError(lastError),
  };
}

export async function loadAgentSessions(options: LoadAgentSessionsOptions = {}) {
  const result = await loadAgentSessionsWithResult(options);
  return result.sessions;
}

export function useAgentSessionBootstrap({
  apiUrl,
  retries = 8,
  retryDelayMs = 500,
  reloadOnFocus = true,
}: UseAgentSessionBootstrapOptions = {}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const completedInitialLoadRef = useRef(false);

  useEffect(() => {
    // retry() bumps reloadVersion so this effect re-runs without clearing a ready workspace.
    void reloadVersion;
    let cancelled = false;
    const completedInitialLoad = completedInitialLoadRef.current;
    if (completedInitialLoad) {
      setRefreshing(true);
    } else {
      setReady(false);
      setError(null);
    }
    void loadAgentSessionsWithResult({ apiUrl, retries, retryDelayMs }).then((result) => {
      if (cancelled) return;
      completedInitialLoadRef.current = true;
      setError(result.error);
      setReady(true);
      setRefreshing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, retries, retryDelayMs, reloadVersion]);

  useEventListener("focus", () => {
    if (reloadOnFocus) {
      void loadAgentSessionsWithResult({ apiUrl }).then((result) => {
        if (!result.error) setError(null);
      });
    }
  });
  const retry = useCallback(() => setReloadVersion((version) => version + 1), []);

  return {
    ready,
    error,
    refreshing,
    retry,
  };
}

export function useEffectiveAgentWorkspace(
  sessionId: string | null,
  sessions: readonly Readonly<AgentProcessInfo>[],
  options: { superAdminFallback?: boolean } = {},
) {
  const session = useMemo(() => sessions.find((item) => item.sessionId === sessionId), [sessionId, sessions]);
  const visibleSessionCwd = exposeWorkspacePath(session?.cwd, { allowLocal: allowsLocalWorkspacePaths() });
  const [effectiveCwd, setEffectiveCwd] = useState<string | undefined>(visibleSessionCwd || undefined);

  useEffect(() => {
    let cancelled = false;

    if (!sessionId || !session) {
      setEffectiveCwd(undefined);
      return;
    }

    const nextCwd = exposeWorkspacePath(session.cwd, { allowLocal: allowsLocalWorkspacePaths() });
    if (nextCwd) {
      setEffectiveCwd(nextCwd);
      return;
    }

    if (!options.superAdminFallback) {
      setEffectiveCwd(undefined);
      return;
    }

    const agentId = agentRegistryModel.getSessionAgent(sessionId).id;
    if (!isDefaultAgentId(agentId)) {
      setEffectiveCwd(undefined);
      return;
    }

    void getEffectiveWorkspaceRoot().then((root) => {
      if (!cancelled) {
        const visibleRoot = exposeWorkspacePath(root, { allowLocal: allowsLocalWorkspacePaths() });
        setEffectiveCwd(visibleRoot || undefined);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [options.superAdminFallback, session, sessionId]);

  return effectiveCwd;
}
