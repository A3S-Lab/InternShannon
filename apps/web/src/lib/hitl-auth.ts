/**
 * HITL (Human-in-the-Loop) 授权管理
 *
 * 功能：
 * 1. 管理工具调用授权请求
 * 2. 支持三种授权范围：once（仅一次）、task（当前任务）、session（整个会话）
 * 3. 授权策略持久化存储
 * 4. 自动授权规则管理
 */

import { proxy } from "valtio";
import {
  onUserStorageScopeChange,
  readUserJsonStorage,
  readUserStorage,
  writeUserJsonStorage,
  writeUserStorage,
} from "@/lib/browser-storage";
import type { ToolConfirmationRequest } from "./socket-types";

// =============================================================================
// Types
// =============================================================================

/**
 * 授权范围
 */
export type AuthorizationScope = "once" | "task" | "session";

/**
 * 授权策略
 */
export interface AuthorizationPolicy {
  /** 工具名称 */
  toolName: string;
  /** 授权范围 */
  scope: AuthorizationScope;
  /** 会话 ID（session 范围时使用） */
  sessionId?: string;
  /** 任务 ID（task 范围时使用） */
  taskId?: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 过期时间戳（可选） */
  expiresAt?: number;
}

/**
 * 授权决策
 */
export interface AuthorizationDecision {
  /** 是否批准 */
  approved: boolean;
  /** 授权范围 */
  scope?: AuthorizationScope;
  /** 决策原因 */
  reason?: string;
  /** 是否自动决策 */
  automatic?: boolean;
}

/**
 * HITL 授权状态
 */
export interface HitlAuthState {
  /** 授权策略列表 */
  policies: AuthorizationPolicy[];
  /** 待处理的授权请求（按会话 ID 索引） */
  pendingRequests: Record<string, ToolConfirmationRequest | null>;
  /** 授权历史记录 */
  history: Array<{
    requestId: string;
    toolName: string;
    decision: AuthorizationDecision;
    timestamp: number;
  }>;
  /** 是否启用自动授权 */
  autoAuthEnabled: boolean;
  /** 全局信任的工具列表 */
  trustedTools: string[];
}

// =============================================================================
// State
// =============================================================================

export const hitlAuthState = proxy<HitlAuthState>({
  policies: [],
  pendingRequests: {},
  history: [],
  autoAuthEnabled: false,
  trustedTools: [],
});

// =============================================================================
// Storage Keys
// =============================================================================

const STORAGE_KEYS = {
  POLICIES: "hitl_auth_policies",
  TRUSTED_TOOLS: "hitl_trusted_tools",
  AUTO_AUTH_ENABLED: "hitl_auto_auth_enabled",
  HISTORY: "hitl_auth_history",
} as const;

// =============================================================================
// Storage Functions
// =============================================================================

/**
 * 从存储加载授权策略
 */
function loadPoliciesFromStorage(): AuthorizationPolicy[] {
  try {
    const policies = readUserJsonStorage<AuthorizationPolicy[]>(STORAGE_KEYS.POLICIES, []);

    // 过滤掉已过期的策略
    const now = Date.now();
    return policies.filter((policy) => {
      if (!policy.expiresAt) return true;
      return policy.expiresAt > now;
    });
  } catch (error) {
    console.error("Failed to load policies from storage:", error);
    return [];
  }
}

/**
 * 保存授权策略到存储
 */
function savePoliciesToStorage(policies: AuthorizationPolicy[]): void {
  try {
    writeUserJsonStorage(STORAGE_KEYS.POLICIES, policies);
  } catch (error) {
    console.error("Failed to save policies to storage:", error);
  }
}

/**
 * 从存储加载信任的工具列表
 */
function loadTrustedToolsFromStorage(): string[] {
  try {
    return readUserJsonStorage<string[]>(STORAGE_KEYS.TRUSTED_TOOLS, []);
  } catch (error) {
    console.error("Failed to load trusted tools from storage:", error);
    return [];
  }
}

/**
 * 保存信任的工具列表到存储
 */
function saveTrustedToolsToStorage(tools: string[]): void {
  try {
    writeUserJsonStorage(STORAGE_KEYS.TRUSTED_TOOLS, tools);
  } catch (error) {
    console.error("Failed to save trusted tools to storage:", error);
  }
}

/**
 * 从存储加载自动授权开关
 */
function loadAutoAuthEnabledFromStorage(): boolean {
  try {
    const stored = readUserStorage(STORAGE_KEYS.AUTO_AUTH_ENABLED);
    return stored === "true";
  } catch (error) {
    console.error("Failed to load auto auth enabled from storage:", error);
    return false;
  }
}

/**
 * 保存自动授权开关到存储
 */
function saveAutoAuthEnabledToStorage(enabled: boolean): void {
  try {
    writeUserStorage(STORAGE_KEYS.AUTO_AUTH_ENABLED, String(enabled));
  } catch (error) {
    console.error("Failed to save auto auth enabled to storage:", error);
  }
}

// =============================================================================
// Policy Management
// =============================================================================

/**
 * 添加授权策略
 */
export function addAuthorizationPolicy(
  toolName: string,
  scope: AuthorizationScope,
  sessionId?: string,
  taskId?: string
): void {
  const policy: AuthorizationPolicy = {
    toolName,
    scope,
    sessionId,
    taskId,
    createdAt: Date.now(),
  };

  // 设置过期时间
  if (scope === "task") {
    // 任务范围：1小时后过期
    policy.expiresAt = Date.now() + 60 * 60 * 1000;
  } else if (scope === "session") {
    // 会话范围：24小时后过期
    policy.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  }

  hitlAuthState.policies.push(policy);
  savePoliciesToStorage(hitlAuthState.policies);

  console.log(`[HITL] Added authorization policy:`, policy);
}

/**
 * 移除授权策略
 */
export function removeAuthorizationPolicy(index: number): void {
  if (index >= 0 && index < hitlAuthState.policies.length) {
    const removed = hitlAuthState.policies.splice(index, 1);
    savePoliciesToStorage(hitlAuthState.policies);
    console.log(`[HITL] Removed authorization policy:`, removed[0]);
  }
}

/**
 * 清除所有授权策略
 */
export function clearAllPolicies(): void {
  hitlAuthState.policies = [];
  savePoliciesToStorage([]);
  console.log("[HITL] Cleared all authorization policies");
}

/**
 * 清除特定会话的授权策略
 */
export function clearSessionPolicies(sessionId: string): void {
  hitlAuthState.policies = hitlAuthState.policies.filter(
    (policy) => policy.sessionId !== sessionId
  );
  savePoliciesToStorage(hitlAuthState.policies);
  console.log(`[HITL] Cleared policies for session: ${sessionId}`);
}

/**
 * 清除特定任务的授权策略
 */
export function clearTaskPolicies(taskId: string): void {
  hitlAuthState.policies = hitlAuthState.policies.filter(
    (policy) => policy.taskId !== taskId
  );
  savePoliciesToStorage(hitlAuthState.policies);
  console.log(`[HITL] Cleared policies for task: ${taskId}`);
}

/**
 * 清除已过期的授权策略
 */
export function cleanupExpiredPolicies(): void {
  const now = Date.now();
  const before = hitlAuthState.policies.length;

  hitlAuthState.policies = hitlAuthState.policies.filter((policy) => {
    if (!policy.expiresAt) return true;
    return policy.expiresAt > now;
  });

  const after = hitlAuthState.policies.length;
  if (before !== after) {
    savePoliciesToStorage(hitlAuthState.policies);
    console.log(`[HITL] Cleaned up ${before - after} expired policies`);
  }
}

// =============================================================================
// Trusted Tools Management
// =============================================================================

/**
 * 添加信任的工具
 */
export function addTrustedTool(toolName: string): void {
  if (!hitlAuthState.trustedTools.includes(toolName)) {
    hitlAuthState.trustedTools.push(toolName);
    saveTrustedToolsToStorage(hitlAuthState.trustedTools);
    console.log(`[HITL] Added trusted tool: ${toolName}`);
  }
}

/**
 * 移除信任的工具
 */
export function removeTrustedTool(toolName: string): void {
  const index = hitlAuthState.trustedTools.indexOf(toolName);
  if (index !== -1) {
    hitlAuthState.trustedTools.splice(index, 1);
    saveTrustedToolsToStorage(hitlAuthState.trustedTools);
    console.log(`[HITL] Removed trusted tool: ${toolName}`);
  }
}

/**
 * 检查工具是否被信任
 */
export function isTrustedTool(toolName: string): boolean {
  return hitlAuthState.trustedTools.includes(toolName);
}

// =============================================================================
// Authorization Decision
// =============================================================================

/**
 * 检查是否有匹配的授权策略
 */
function findMatchingPolicy(
  toolName: string,
  sessionId: string,
  taskId?: string
): AuthorizationPolicy | null {
  const now = Date.now();

  // 按优先级查找：once > task > session
  for (const policy of hitlAuthState.policies) {
    // 检查是否过期
    if (policy.expiresAt && policy.expiresAt <= now) {
      continue;
    }

    // 检查工具名称
    if (policy.toolName !== toolName) {
      continue;
    }

    // 检查范围
    if (policy.scope === "once") {
      // once 策略只能使用一次，找到后立即移除
      const index = hitlAuthState.policies.indexOf(policy);
      if (index !== -1) {
        hitlAuthState.policies.splice(index, 1);
        savePoliciesToStorage(hitlAuthState.policies);
      }
      return policy;
    } else if (policy.scope === "task") {
      if (policy.taskId === taskId) {
        return policy;
      }
    } else if (policy.scope === "session") {
      if (policy.sessionId === sessionId) {
        return policy;
      }
    }
  }

  return null;
}

/**
 * 自动决策授权请求
 */
export function autoDecideAuthorization(
  request: ToolConfirmationRequest,
  taskId?: string
): AuthorizationDecision | null {
  // 如果未启用自动授权，返回 null
  if (!hitlAuthState.autoAuthEnabled) {
    return null;
  }

  // 检查是否是信任的工具
  if (isTrustedTool(request.toolName)) {
    return {
      approved: true,
      scope: "session",
      reason: "Trusted tool",
      automatic: true,
    };
  }

  // 查找匹配的授权策略
  const policy = findMatchingPolicy(request.toolName, request.sessionId, taskId);
  if (policy) {
    return {
      approved: true,
      scope: policy.scope,
      reason: `Matched ${policy.scope} policy`,
      automatic: true,
    };
  }

  // 没有匹配的策略，需要人工决策
  return null;
}

/**
 * 记录授权决策
 */
export function recordAuthorizationDecision(
  requestId: string,
  toolName: string,
  decision: AuthorizationDecision
): void {
  hitlAuthState.history.push({
    requestId,
    toolName,
    decision,
    timestamp: Date.now(),
  });

  // 只保留最近 100 条记录
  if (hitlAuthState.history.length > 100) {
    hitlAuthState.history = hitlAuthState.history.slice(-100);
  }

  console.log(`[HITL] Recorded authorization decision:`, {
    requestId,
    toolName,
    decision,
  });
}

// =============================================================================
// Request Management
// =============================================================================

/**
 * 设置待处理的授权请求
 */
export function setPendingRequest(
  sessionId: string,
  request: ToolConfirmationRequest | null
): void {
  hitlAuthState.pendingRequests[sessionId] = request;

  if (request) {
    console.log(`[HITL] Set pending request for session ${sessionId}:`, request);
  } else {
    console.log(`[HITL] Cleared pending request for session ${sessionId}`);
  }
}

/**
 * 获取待处理的授权请求
 */
export function getPendingRequest(
  sessionId: string
): ToolConfirmationRequest | null {
  return hitlAuthState.pendingRequests[sessionId] || null;
}

/**
 * 清除待处理的授权请求
 */
export function clearPendingRequest(sessionId: string): void {
  delete hitlAuthState.pendingRequests[sessionId];
  console.log(`[HITL] Cleared pending request for session ${sessionId}`);
}

// =============================================================================
// Settings
// =============================================================================

/**
 * 设置自动授权开关
 */
export function setAutoAuthEnabled(enabled: boolean): void {
  hitlAuthState.autoAuthEnabled = enabled;
  saveAutoAuthEnabledToStorage(enabled);
  console.log(`[HITL] Auto authorization ${enabled ? "enabled" : "disabled"}`);
}

/**
 * 获取自动授权开关
 */
export function isAutoAuthEnabled(): boolean {
  return hitlAuthState.autoAuthEnabled;
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * 初始化 HITL 授权管理
 */
export function initHitlAuth(): void {
  try {
    // 从存储加载数据
    hitlAuthState.policies = loadPoliciesFromStorage();
    hitlAuthState.trustedTools = loadTrustedToolsFromStorage();
    hitlAuthState.autoAuthEnabled = loadAutoAuthEnabledFromStorage();

    // 清理过期策略
    cleanupExpiredPolicies();

    console.log("[HITL] Authorization manager initialized", {
      policies: hitlAuthState.policies.length,
      trustedTools: hitlAuthState.trustedTools.length,
      autoAuthEnabled: hitlAuthState.autoAuthEnabled,
    });
  } catch (error) {
    console.error("[HITL] Failed to initialize authorization manager:", error);
  }
}

onUserStorageScopeChange(() => {
  hitlAuthState.policies = loadPoliciesFromStorage();
  hitlAuthState.trustedTools = loadTrustedToolsFromStorage();
  hitlAuthState.autoAuthEnabled = loadAutoAuthEnabledFromStorage();
  hitlAuthState.pendingRequests = {};
  hitlAuthState.history = [];
  cleanupExpiredPolicies();
});

// =============================================================================
// Statistics
// =============================================================================

/**
 * 获取授权统计信息
 */
export function getAuthorizationStats() {
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;

  const recentHistory = hitlAuthState.history.filter(
    (record) => record.timestamp >= last24h
  );

  const approved = recentHistory.filter((r) => r.decision.approved).length;
  const denied = recentHistory.filter((r) => !r.decision.approved).length;
  const automatic = recentHistory.filter((r) => r.decision.automatic).length;

  return {
    totalPolicies: hitlAuthState.policies.length,
    trustedTools: hitlAuthState.trustedTools.length,
    autoAuthEnabled: hitlAuthState.autoAuthEnabled,
    last24h: {
      total: recentHistory.length,
      approved,
      denied,
      automatic,
      manual: recentHistory.length - automatic,
    },
  };
}

// =============================================================================
// Auto-cleanup Timer
// =============================================================================

let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * 启动自动清理定时器
 */
export function startAutoCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }

  // 每小时清理一次过期策略
  cleanupTimer = setInterval(() => {
    cleanupExpiredPolicies();
  }, 60 * 60 * 1000);
}

/**
 * 停止自动清理定时器
 */
export function stopAutoCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
