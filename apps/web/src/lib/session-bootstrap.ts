import { connectSession, disconnectSession } from "@/hooks/use-agent-ws";
import agentModel from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";
import { agentApi, type CreateSessionRequest } from "./agent-api";
import type { AgentProfile } from "./agent-profile.types";
import { DEFAULT_AGENT_ID, getAgentById, normalizeAgentId } from "./builtins";
import { allowsLocalWorkspacePaths } from "./runtime-environment";
import { buildCreatedSessionInfo } from "./session-bootstrap-state";
import { defaultSessionTitle } from "./session-title";
import type { AgentProcessInfo, AgentSessionState } from "./types";
import { exposeWorkspacePath as exposeRuntimeWorkspacePath } from "./workspace-path";
import { resolveAgentWorkingDirectory } from "./workspace-utils";
import type { PromptSlotConfig } from "./agent-runtime-config";

const pendingSessionCreations = new Map<
  string,
  Promise<{ sessionId: string; session: AgentProcessInfo; created: true }>
>();
const RECENT_LOCAL_SESSION_GRACE_MS = 2 * 60 * 1000;

const SESSION_RUNTIME_OPTION_KEYS = [
  "model",
  "systemPrompt",
  "mcpServers",
  "builtinSkills",
  "planningMode",
  "goalTracking",
  "maxToolRounds",
  "continuationEnabled",
  "maxContinuationTurns",
  "autoCompact",
  "autoCompactThreshold",
  "temperature",
  "thinkingBudget",
  "searchConfig",
  "workerAgents",
  "inlineSkills",
  "autoDelegation",
  "autoParallel",
  "maxParallelTasks",
  "artifactStoreLimits",
  "toolTimeoutMs",
  "queueTimeoutMs",
  "maxExecutionTimeMs",
  "streamStallWarningMs",
  "streamStallHardMs",
  "streamStallActiveToolHardMs",
  "maxConsecutiveToolErrors",
  "maxStreamRetries",
] as const satisfies readonly (keyof CreateSessionRequest)[];

type SessionRuntimeOptionKey = (typeof SESSION_RUNTIME_OPTION_KEYS)[number];

type CreateAgentSessionRuntimeOptions = Pick<CreateSessionRequest, SessionRuntimeOptionKey | "skills" | "skillDirs">;

export interface CreateAgentSessionOptions extends Partial<CreateAgentSessionRuntimeOptions> {
  agentId: string;
  cwd?: string | null;
  name?: string;
  permissionMode?: string;
  apiUrl?: string;
  optimisticPlaceholder?: boolean;
  hideFromMainList?: boolean;
}

function exposeWorkspacePath(path: string | null | undefined): string {
  return exposeRuntimeWorkspacePath(path, { allowLocal: allowsLocalWorkspacePaths() });
}

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringList(values?: string[] | null): string[] | undefined {
  const normalized = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function copyDefinedRuntimeOptions(
  target: CreateSessionRequest,
  source: Partial<CreateSessionRequest> | undefined,
): void {
  if (!source) return;
  for (const key of SESSION_RUNTIME_OPTION_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

function runtimeOptionsFingerprint(options: Partial<CreateSessionRequest>): string {
  const runtimeOptions: Record<string, unknown> = {};
  for (const key of SESSION_RUNTIME_OPTION_KEYS) {
    const value = options[key];
    if (value !== undefined) {
      runtimeOptions[key] = value;
    }
  }
  runtimeOptions.skills = normalizeStringList(options.skills) ?? [];
  runtimeOptions.skillDirs = normalizeStringList(options.skillDirs) ?? [];
  return JSON.stringify(runtimeOptions);
}

function ensureSessionCache(sessionId: string) {
  if (!agentModel.state.messages[sessionId]) {
    agentModel.setMessages(sessionId, []);
  }
}

function toSessionState(session: AgentProcessInfo): AgentSessionState {
  const assetId = session.assetId ?? stringFromRecord(session.metadata, "assetId");
  const agentPhase = session.agentPhase ?? stringFromRecord(session.metadata, "agentPhase");
  return {
    sessionId: session.sessionId,
    agentId: session.agentId ?? null,
    model: session.model || "",
    followDefaultModel: session.followDefaultModel ?? !session.model,
    cwd: session.cwd || "",
    tools: [],
    permissionMode: session.permissionMode || "default",
    mcpServers: [],
    agents: [],
    slashCommands: [],
    skills: [],
    totalCostUsd: 0,
    numTurns: 0,
    contextUsedPercent: 0,
    isCompacting: false,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    assetId,
    agentPhase,
  };
}

function isReusableSession(session: AgentProcessInfo): boolean {
  return session.state !== "exited";
}

function isEmbeddedSession(session: AgentProcessInfo): boolean {
  return session.metadata?.visibility === "embedded";
}

function visibleKernelSessions(sessions: AgentProcessInfo[]): AgentProcessInfo[] {
  return sessions.filter((session) => !isEmbeddedSession(session) && !agentModel.isInternalSession(session.sessionId));
}

function timestampMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value > 0 && value < 1e12 ? value * 1000 : value;
}

function isRecentLocalSession(session: AgentProcessInfo, now = Date.now()): boolean {
  const createdAt = timestampMs(session.createdAt);
  return createdAt > 0 && now - createdAt >= 0 && now - createdAt <= RECENT_LOCAL_SESSION_GRACE_MS;
}

function mergeWithRecentLocalSessions(visibleSessions: AgentProcessInfo[]): AgentProcessInfo[] {
  const byId = new Map(visibleSessions.map((session) => [session.sessionId, session]));
  for (const localSession of agentModel.state.sdkSessions) {
    if (byId.has(localSession.sessionId)) continue;
    if (!isReusableSession(localSession)) continue;
    if (isEmbeddedSession(localSession)) continue;
    if (agentModel.isInternalSession(localSession.sessionId)) continue;
    if (!isRecentLocalSession(localSession)) continue;
    byId.set(localSession.sessionId, localSession);
  }
  return [...byId.values()];
}

function applySessionListToStore(
  sessions: AgentProcessInfo[],
  options: { preserveExistingOnEmpty?: boolean } = {},
): AgentProcessInfo[] {
  for (const session of sessions) {
    agentModel.addSession(toSessionState(session));
    ensureSessionCache(session.sessionId);
    agentRegistryModel.ensureSessionAgent(session.sessionId, session.agentId ?? null);
    if (session.name) {
      agentModel.setSessionName(session.sessionId, session.name);
    }
  }

  const visibleSessions = mergeWithRecentLocalSessions(visibleKernelSessions(sessions));
  if (options.preserveExistingOnEmpty && visibleSessions.length === 0 && agentModel.state.sdkSessions.length > 0) {
    console.warn("[session-bootstrap] ignored empty session refresh while local sessions remain");
    return [...agentModel.state.sdkSessions];
  }

  agentModel.setSdkSessions(visibleSessions);
  return visibleSessions;
}

function buildCreationKey(
  options: {
    agentId: string;
    cwd?: string | null;
    hideFromMainList?: boolean;
    skills?: string[];
    skillDirs?: string[];
    apiUrl?: string;
  } & Partial<CreateSessionRequest>,
): string {
  return [
    normalizeAgentId(options.agentId) ?? options.agentId,
    options.cwd?.trim() || "",
    options.hideFromMainList ? "hidden" : "visible",
    runtimeOptionsFingerprint(options),
    options.apiUrl?.trim() || "",
  ].join("::");
}

export async function resolveSessionAgent(agentId: string): Promise<AgentProfile> {
  const normalizedAgentId = normalizeAgentId(agentId) ?? agentId;
  await agentRegistryModel.loadServerAgents();
  const agent =
    agentRegistryModel.getAllAgents().find((item) => item.id === normalizedAgentId) ?? getAgentById(normalizedAgentId);
  if (!agent) {
    throw new Error("智能体不存在");
  }
  return agent;
}

export function registerHydratedSession(
  session: AgentProcessInfo,
  options?: {
    agentId?: string;
    name?: string;
    hideFromMainList?: boolean;
  },
) {
  const { agentId, name, hideFromMainList } = options || {};

  agentModel.addSession(toSessionState(session));
  agentRegistryModel.ensureSessionAgent(session.sessionId, agentId ?? session.agentId ?? null);
  ensureSessionCache(session.sessionId);
  if (name) {
    agentModel.setSessionName(session.sessionId, name);
  }
  if (hideFromMainList) {
    agentModel.markInternalSession(session.sessionId);
  } else {
    agentModel.upsertSdkSession(session);
  }
  connectSession(session.sessionId);
}

export function registerCreatedSession(
  session: AgentProcessInfo,
  options?: {
    agentId?: string;
    name?: string;
    hideFromMainList?: boolean;
  },
) {
  registerHydratedSession(session, options);
  ensureSessionCache(session.sessionId);
}

export async function fetchSessionById(
  sessionId: string,
  options?: {
    agentId?: string;
    name?: string;
    hideFromMainList?: boolean;
    match?: (session: AgentProcessInfo) => boolean;
  },
  apiUrl?: string,
): Promise<AgentProcessInfo | null> {
  try {
    const session = await agentApi.getSession(sessionId, apiUrl);
    if (!session || !isReusableSession(session)) return null;
    if (options?.match && !options.match(session)) return null;
    registerHydratedSession(session, options);
    return session;
  } catch {
    return null;
  }
}

export function findReusableSession(options: {
  agentId: string;
  cwd?: string | null;
  match?: (session: AgentProcessInfo) => boolean;
}): AgentProcessInfo | null {
  const agentId = normalizeAgentId(options.agentId) ?? options.agentId;
  return (
    [...agentModel.state.sdkSessions]
      .filter(
        (session) =>
          isReusableSession(session) &&
          agentRegistryModel.resolveSessionAgentId(session.sessionId, session.agentId ?? null) === agentId &&
          (!options.cwd || session.cwd === options.cwd) &&
          (!options.match || options.match(session)),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}

export async function createAgentSession(
  options: CreateAgentSessionOptions,
): Promise<{ sessionId: string; session: AgentProcessInfo; created: true }> {
  const creationKey = buildCreationKey(options);
  const existingPending = pendingSessionCreations.get(creationKey);
  if (existingPending) {
    return await existingPending;
  }

  const creationPromise = (async () => {
    const agent = await resolveSessionAgent(options.agentId);
    const normalizedAgentId = normalizeAgentId(options.agentId) ?? options.agentId;
    const permissionMode =
      options.permissionMode ??
      agent.defaultPermissionMode ??
      (normalizedAgentId === DEFAULT_AGENT_ID ? "auto" : "default");
    const explicitName = options.name?.trim();
    const resolvedCwd = options.cwd?.trim() || (await resolveAgentWorkingDirectory(agent)) || "";

    let tempSessionId: string | null = null;
    if (options.optimisticPlaceholder) {
      tempSessionId = `pending-${
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      }`;
      const placeholderName = explicitName || defaultSessionTitle(tempSessionId);
      const placeholderSession: AgentProcessInfo = {
        sessionId: tempSessionId,
        agentId: normalizedAgentId,
        state: "creating",
        followDefaultModel: true,
        permissionMode,
        cwd: exposeWorkspacePath(resolvedCwd),
        createdAt: Date.now(),
        name: placeholderName,
      };
      agentModel.addSession(toSessionState(placeholderSession));
      agentModel.upsertSdkSession(placeholderSession);
      agentRegistryModel.ensureSessionAgent(tempSessionId, normalizedAgentId);
    }

    const createRequest: CreateSessionRequest = {
      ...(agent.sessionOptions ?? {}),
      agentId: normalizedAgentId,
      title: explicitName || undefined,
      permissionMode,
      cwd: resolvedCwd || undefined,
      model: (options.model ?? agent.defaultModel) || undefined,
      skills: normalizeStringList(options.skills) ?? normalizeStringList(agent.defaultSkills),
      skillDirs: normalizeStringList(options.skillDirs),
    };
    copyDefinedRuntimeOptions(createRequest, options);

    let result: Awaited<ReturnType<typeof agentApi.createSession>>;
    try {
      result = await agentApi.createSession(createRequest, options.apiUrl);
    } catch (error) {
      if (tempSessionId) agentModel.removeSession(tempSessionId);
      throw error;
    }

    if (result?.error || !result?.session?.sessionId) {
      if (tempSessionId) agentModel.removeSession(tempSessionId);
      throw new Error(result?.error || "创建会话失败");
    }

    const sessionName = result.session.title || explicitName || defaultSessionTitle(result.session.sessionId);
    const session = buildCreatedSessionInfo({
      session: result.session,
      normalizedAgentId,
      permissionMode,
      cwd: exposeWorkspacePath(result.session.cwd),
      createdAt: Date.now(),
      name: sessionName,
    });

    if (tempSessionId) agentModel.removeSession(tempSessionId);
    registerCreatedSession(session, {
      agentId: normalizedAgentId,
      name: sessionName,
      hideFromMainList: options.hideFromMainList,
    });
    return {
      sessionId: result.session.sessionId,
      session,
      created: true as const,
    };
  })().finally(() => {
    pendingSessionCreations.delete(creationKey);
  });

  pendingSessionCreations.set(creationKey, creationPromise);
  return await creationPromise;
}

export async function ensureAgentSession(options: {
  agentId: string;
  promptSlot?: PromptSlotConfig;
  cwd?: string | null;
  name?: string;
  hideFromMainList?: boolean;
  reuseExisting?: boolean;
  existingSessionId?: string | null;
  includeHidden?: boolean;
  match?: (session: AgentProcessInfo) => boolean;
  model?: string;
  permissionMode?: string;
  systemPrompt?: string;
  skills?: string[];
  skillDirs?: string[];
  apiUrl?: string;
}): Promise<{
  sessionId: string;
  session: AgentProcessInfo;
  created: boolean;
}> {
  if (options.existingSessionId) {
    const restored = await fetchSessionById(
      options.existingSessionId,
      {
        agentId: options.agentId,
        name: options.name,
        hideFromMainList: options.hideFromMainList,
        match: options.match,
      },
      options.apiUrl,
    );
    if (restored) {
      return {
        sessionId: restored.sessionId,
        session: restored,
        created: false,
      };
    }
  }

  if (options.reuseExisting !== false) {
    const reusable = findReusableSession({
      agentId: options.agentId,
      cwd: options.cwd,
      match: options.match,
    });
    if (reusable) {
      registerHydratedSession(reusable, {
        agentId: options.agentId,
        name: options.name,
        hideFromMainList: options.hideFromMainList,
      });
      return {
        sessionId: reusable.sessionId,
        session: reusable,
        created: false,
      };
    }
  }

  return await createAgentSession(options);
}

export async function refreshSessionsInBackground(
  apiUrl?: string,
  options: { preserveExistingOnEmpty?: boolean } = {},
): Promise<void> {
  try {
    const sessions = await agentApi.listSessions(apiUrl);
    if (!Array.isArray(sessions)) return;
    applySessionListToStore(sessions, options);
  } catch (error) {
    console.warn("[session-bootstrap] failed to refresh session list:", error instanceof Error ? error.message : error);
  }
}

export async function reloadSessions(apiUrl?: string): Promise<AgentProcessInfo[]> {
  const sessions = await agentApi.listSessions(apiUrl);
  if (!Array.isArray(sessions)) {
    return [];
  }
  return applySessionListToStore(sessions);
}

export function chooseNextSession(options?: {
  preferAgentId?: string | null;
  excludeSessionId?: string | null;
}): string | null {
  const candidates = [...agentModel.state.sdkSessions]
    .filter((session) => isReusableSession(session) && session.sessionId !== options?.excludeSessionId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const preferred = options?.preferAgentId
    ? candidates.find(
        (session) =>
          agentRegistryModel.resolveSessionAgentId(session.sessionId, session.agentId ?? null) ===
          options.preferAgentId,
      )
    : null;
  return preferred?.sessionId ?? candidates[0]?.sessionId ?? null;
}

export async function destroySessionAndRefresh(options: {
  sessionId: string;
  preferAgentId?: string | null;
  deleteFromBackend?: boolean;
  apiUrl?: string;
}): Promise<string | null> {
  const { sessionId, preferAgentId, deleteFromBackend = true, apiUrl } = options;
  if (deleteFromBackend) {
    await agentApi.deleteSession(sessionId, apiUrl);
  }
  disconnectSession(sessionId);
  agentRegistryModel.removeSessionAgent(sessionId);
  agentModel.removeSession(sessionId);
  const nextSessionId = chooseNextSession({
    preferAgentId,
    excludeSessionId: sessionId,
  });
  agentModel.setCurrentSession(nextSessionId);
  await refreshSessionsInBackground(apiUrl, {
    preserveExistingOnEmpty: true,
  });
  return nextSessionId;
}

export async function handleMissingSession(options: {
  sessionId: string;
  preferAgentId?: string | null;
  apiUrl?: string;
}): Promise<string | null> {
  const localSession = agentModel.state.sdkSessions.find((session) => session.sessionId === options.sessionId);
  if (localSession && isReusableSession(localSession) && isRecentLocalSession(localSession)) {
    console.warn("[session-bootstrap] preserving recent local session after transient missing-session response");
    await refreshSessionsInBackground(options.apiUrl, {
      preserveExistingOnEmpty: true,
    });
    return options.sessionId;
  }
  return await destroySessionAndRefresh({
    sessionId: options.sessionId,
    preferAgentId: options.preferAgentId,
    deleteFromBackend: false,
    apiUrl: options.apiUrl,
  });
}

export async function relaunchSessionAndRebind(options: {
  sessionId: string;
  preferAgentId?: string | null;
  makeCurrent?: boolean;
  apiUrl?: string;
}): Promise<string> {
  const { sessionId, preferAgentId, makeCurrent = true, apiUrl } = options;
  const agentId = preferAgentId ?? agentRegistryModel.resolveSessionAgentId(sessionId);
  const result = await agentApi.relaunchSession(sessionId, apiUrl);
  if (!result?.sessionId) {
    throw new Error("会话重启失败");
  }
  const nextSessionId = result.sessionId;
  disconnectSession(sessionId);
  agentRegistryModel.removeSessionAgent(sessionId);
  agentModel.removeSession(sessionId);

  const restored = await fetchSessionById(
    nextSessionId,
    {
      agentId: agentId ?? undefined,
    },
    apiUrl,
  );
  if (!restored) {
    throw new Error("重启后会话恢复失败");
  }
  await reloadSessions(apiUrl).catch(() => []);
  if (makeCurrent) {
    agentModel.setCurrentSession(nextSessionId);
  }
  return nextSessionId;
}
