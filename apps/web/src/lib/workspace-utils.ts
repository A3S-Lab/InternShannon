import agentRegistryModel from "@/models/agent-registry.model";
import settingsModel from "@/models/settings.model";
import { isDefaultAgentId } from "./builtins";
import { currentUserStorageScope } from "./browser-storage";
import type { AgentProfile } from "./agent-profile.types";
import { allowsLocalWorkspacePaths } from "./runtime-environment";
import { workspaceApi } from "./workspace-api";
import { isRemoteWorkspacePath, joinWorkspacePath, normalizeWorkspacePath } from "./workspace-path";
import { buildSessionWorkspacePath } from "./session-workspace-path";
/**
 * Workspace utilities for managing agent default workspaces and session workspaces.
 *
 * All filesystem operations are delegated to NestJS sidecar via workspace-api.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceReadiness = {
  workspaceRoot: string;
  rootExists: boolean;
  agentsExists: boolean;
  sessionsExists: boolean;
  needsRepair: boolean;
  platform: string;
  isWindows: boolean;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

function fallbackWorkspaceReadiness(configuredRoot?: string | null): WorkspaceReadiness {
  const configured = configuredRoot?.trim() || "";
  const saved = settingsModel.state.agentDefaults.workspaceRoot?.trim() || "";
  const workspaceRoot = allowsLocalWorkspacePaths() ? configured || saved : remoteWorkspaceRoot(configured) || remoteWorkspaceRoot(saved);
  const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
  const rootReady = workspaceRoot.length > 0;
  return {
    workspaceRoot,
    rootExists: rootReady,
    agentsExists: rootReady,
    sessionsExists: rootReady,
    needsRepair: !rootReady,
    platform: "web",
    isWindows,
  };
}

function workspaceUserScopeFallback(): string {
  return allowsLocalWorkspacePaths() ? "local" : "default";
}

function currentWorkspaceUserScope(): string {
  return currentUserStorageScope(workspaceUserScopeFallback());
}

function remoteWorkspaceRoot(value?: string | null): string {
  const normalized = normalizeWorkspacePath(value);
  return isRemoteWorkspacePath(normalized) ? normalized : "";
}

// ---------------------------------------------------------------------------
// Private helpers — sidecar-backed filesystem operations
// ---------------------------------------------------------------------------

async function fsMkdir(path: string): Promise<void> {
  await workspaceApi.mkdir(path);
}

// ---------------------------------------------------------------------------
// Internal implementation helpers
// ---------------------------------------------------------------------------

/**
 * Get the runtime default workspace root for the current app mode.
 * Web/cloud only accepts remote storage URIs; desktop/Tauri may use local paths.
 */
async function getDefaultWorkspaceRoot(): Promise<string> {
  try {
    const root = await workspaceApi.getDefaultRoot();
    return allowsLocalWorkspacePaths() ? normalizeWorkspacePath(root) : remoteWorkspaceRoot(root);
  } catch {
    const configured = settingsModel.state.agentDefaults.workspaceRoot?.trim() || "";
    return allowsLocalWorkspacePaths() ? normalizeWorkspacePath(configured) : remoteWorkspaceRoot(configured);
  }
}

const INVALID_WORKSPACE_PATH_CHARS = new Set(["<", ">", ":", '"', "|", "?", "*", "\\"]);

function replaceInvalidWorkspacePathCharacters(value: string): string {
  let result = "";
  for (const char of value) {
    result += char.charCodeAt(0) < 32 || INVALID_WORKSPACE_PATH_CHARS.has(char) ? "-" : char;
  }
  return result;
}

export async function getEffectiveWorkspaceRoot(): Promise<string> {
  if (!allowsLocalWorkspacePaths()) {
    return await getDefaultWorkspaceRoot();
  }
  const configured = settingsModel.state.agentDefaults.workspaceRoot?.trim();
  if (configured) {
    return configured;
  }
  return await getDefaultWorkspaceRoot();
}

export async function inspectWorkspaceReadiness(configuredRoot?: string | null): Promise<WorkspaceReadiness> {
  const workspaceRoot = allowsLocalWorkspacePaths() ? configuredRoot?.trim() : undefined;
  try {
    return await workspaceApi.inspectReadiness(workspaceRoot || undefined);
  } catch {
    return fallbackWorkspaceReadiness(configuredRoot);
  }
}

export async function ensureWorkspaceReadiness(configuredRoot?: string | null): Promise<WorkspaceReadiness> {
  const workspaceRoot = allowsLocalWorkspacePaths() ? configuredRoot?.trim() : undefined;
  try {
    return await workspaceApi.ensureReadiness(workspaceRoot || undefined);
  } catch {
    return fallbackWorkspaceReadiness(configuredRoot);
  }
}

export function formatWorkspaceValidationError(readiness: WorkspaceReadiness): string {
  const missing: string[] = [];
  if (!readiness.rootExists) missing.push("工作区根目录");
  if (!readiness.agentsExists) missing.push("agents 目录");
  if (!readiness.sessionsExists) missing.push("sessions 目录");

  if (readiness.isWindows) {
    return `Windows 工作区不可用: ${missing.join("、")}缺失。当前路径: ${readiness.workspaceRoot}。请点击"修复工作区"自动创建目录，或在设置 > 工作区中改为一个真实存在的目录。`;
  }

  return `工作区不可用: ${missing.join("、")}缺失。当前路径: ${readiness.workspaceRoot}。请点击"修复工作区"自动创建目录，或在设置 > 工作区中修改路径。`;
}

async function getConfiguredWorkspaceRoot(): Promise<string> {
  if (!allowsLocalWorkspacePaths()) {
    return await getDefaultWorkspaceRoot();
  }
  let workspaceRoot = settingsModel.state.agentDefaults.workspaceRoot;
  if (!workspaceRoot) {
    workspaceRoot = await getDefaultWorkspaceRoot();
  }
  return workspaceRoot;
}

/**
 * Get the current user's workspace root: {workspaceRoot}/users/{userId}
 */
export async function getCurrentUserWorkspaceRoot(): Promise<string> {
  const workspaceRoot = await getConfiguredWorkspaceRoot();
  return joinWorkspacePath(workspaceRoot, "users", currentWorkspaceUserScope());
}

/**
 * Get agent workspace path: {workspaceRoot}/users/{userId}/agents/{agentId}
 */
export async function getAgentWorkspacePath(agentId: string): Promise<string> {
  const workspaceRoot = await getCurrentUserWorkspaceRoot();
  return joinWorkspacePath(workspaceRoot, "agents", agentId);
}

function normalizeWorkspacePathSegment(value: string | number | null | undefined, fallback: string): string {
  const normalized = replaceInvalidWorkspacePathCharacters(String(value ?? ""))
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return normalized && normalized !== "." && normalized !== ".." ? normalized : fallback;
}

/**
 * Get current user's skill workspace path: {workspaceRoot}/users/{userId}/skills
 * Personal skills are owned by the signed-in/local user, not by a specific agent.
 */
export async function getUserSkillsPath(userId: string | number | null | undefined): Promise<string> {
  const workspaceRoot = await getConfiguredWorkspaceRoot();
  const userSegment = normalizeWorkspacePathSegment(userId, workspaceUserScopeFallback());
  return joinWorkspacePath(workspaceRoot, "users", userSegment, "skills");
}

/**
 * Get shared skills path: {workspaceRoot}/users/{userId}/shared/skills
 * Shared skills are available to all agents owned by the current user.
 */
export async function getSharedSkillsPath(userId?: string | number | null): Promise<string> {
  if (userId !== undefined) {
    const workspaceRoot = await getConfiguredWorkspaceRoot();
    const userSegment = normalizeWorkspacePathSegment(userId, workspaceUserScopeFallback());
    return joinWorkspacePath(workspaceRoot, "users", userSegment, "shared", "skills");
  }
  const workspaceRoot = await getCurrentUserWorkspaceRoot();
  return joinWorkspacePath(workspaceRoot, "shared", "skills");
}

/**
 * Get session workspace path: {workspaceRoot}/users/{userId}/sessions/{agentId}-YYYYMMDD-HHmmssSSS
 */
export async function getSessionWorkspacePath(agentId: string): Promise<string | null> {
  const workspaceRoot = await getEffectiveWorkspaceRoot();
  if (!workspaceRoot.trim()) {
    return null;
  }
  const userWorkspaceRoot = joinWorkspacePath(workspaceRoot, "users", currentWorkspaceUserScope());
  return buildSessionWorkspacePath(userWorkspaceRoot, agentId);
}

export async function prepareSessionWorkspacePath(
  agent?: AgentProfile | null,
  fallbackAgentId = "general",
): Promise<string | null> {
  const agentId = agent?.id || fallbackAgentId;
  let targetPath: string | null = null;

  if (isDefaultAgentId(agentId)) {
    targetPath = await getSessionWorkspacePath(agentId);
  } else if (agent?.autoWorkspaceMode === "agent") {
    targetPath = await getOrInitializeAgentWorkspace(agent.id);
  } else if (agent?.defaultWorkspace?.trim()) {
    const configuredWorkspace = agent.defaultWorkspace.trim();
    targetPath = allowsLocalWorkspacePaths()
      ? configuredWorkspace
      : remoteWorkspaceRoot(configuredWorkspace) || await getSessionWorkspacePath(agentId);
  } else {
    targetPath = await getSessionWorkspacePath(agentId);
  }

  if (!targetPath) {
    return null;
  }

  try {
    await fsMkdir(targetPath);
  } catch (error) {
    console.warn(
      "prepareSessionWorkspacePath mkdir failed, deferring directory creation to backend:",
      targetPath,
      error,
    );
  }
  return targetPath;
}

/**
 * Initialize default workspace for an agent.
 * Creates directory structure: {workspaceRoot}/users/{userId}/agents/{agentId}/{skills,tasks,knowledge}
 */
export async function initializeAgentWorkspace(agentId: string): Promise<string | null> {
  try {
    const agentWorkspace = await getAgentWorkspacePath(agentId);
    await workspaceApi.initAgent(agentWorkspace);

    agentRegistryModel.setAgentWorkspace(agentId, agentWorkspace);

    return agentWorkspace;
  } catch (err) {
    console.error("Failed to initialize agent workspace:", err);
    return null;
  }
}

/**
 * Get or initialize agent workspace.
 * Returns existing workspace if already configured, otherwise creates a new one.
 */
export async function getOrInitializeAgentWorkspace(agentId: string): Promise<string | null> {
  const existingWorkspace = agentRegistryModel.getAgentWorkspace(agentId);
  if (existingWorkspace && (allowsLocalWorkspacePaths() || remoteWorkspaceRoot(existingWorkspace))) {
    return existingWorkspace;
  }
  return await initializeAgentWorkspace(agentId);
}

/**
 * Resolve the preferred working directory for an agent when creating a session.
 */
export async function resolveAgentWorkingDirectory(agent?: AgentProfile | null): Promise<string | null> {
  return await prepareSessionWorkspacePath(agent);
}

/**
 * Initialize default skills for an agent.
 */
export async function initializeAgentDefaults(_sessionId: string, agentId: string): Promise<void> {
  try {
    const { getAgentById } = await import("./builtins");
    const agent = getAgentById(agentId);

    if (!agent) {
      console.warn(`Agent ${agentId} not found`);
      return;
    }

    const workspace = await getOrInitializeAgentWorkspace(agentId);
    if (!workspace) {
      console.warn("No workspace available for agent defaults");
      return;
    }
    await workspaceApi.initAgent(workspace);
  } catch (err) {
    console.error("Failed to initialize agent defaults:", err);
  }
}

/**
 * Initialize default skills for a marketplace agent.
 */
export async function initializeMarketplaceAgentDefaults(
  _sessionId: string,
  agent: {
    id: string;
    name: string;
    skills?: string[];
  },
): Promise<void> {
  try {
    const workspace = await getOrInitializeAgentWorkspace(agent.id);
    if (!workspace) {
      console.warn("No workspace available for marketplace agent defaults");
      return;
    }
  } catch (err) {
    console.error("Failed to initialize marketplace agent defaults:", err);
  }
}

export async function initializeBuiltinAgentDefaults(agentId: string): Promise<void> {
  try {
    const { BUILTIN_AGENTS } = await import("./builtins");
    const agent = BUILTIN_AGENTS.find((item) => item.id === agentId);

    if (!agent) {
      console.warn(`Builtin agent not found: ${agentId}`);
      return;
    }

    const workspace = await getOrInitializeAgentWorkspace(agentId);
    if (!workspace) {
      console.warn("No workspace available for builtin agent defaults");
      return;
    }
    await workspaceApi.initAgent(workspace);
  } catch (err) {
    console.error("Failed to initialize builtin agent defaults:", err);
  }
}
