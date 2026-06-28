import type { AssetCategory, AssetVisibility } from "./assets";
import { type ApiRequestInit, apiClient } from "./client";

export interface KernelSession {
  id: string;
  sessionId: string;
  agentId: string;
  userId: string;
  title: string;
  cwd: string;
  status: "active" | "completed" | "aborted";
  createdAt: string;
  updatedAt: string;
  model?: string;
  followDefaultModel?: boolean;
  permissionMode?: string;
  metadata?: Record<string, unknown>;
  assetId?: string;
  boundAsset?: {
    id: string;
    name: string;
    category: AssetCategory | string;
    visibility: AssetVisibility | string;
    description?: string;
    lifecycleState?: string;
    starCount: number;
    forkCount: number;
    createdAt: string;
    updatedAt: string;
  };
  agentPhase?: string;
  workingDirectory?: string;
}

export interface KernelMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface KernelAgent {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface KernelAgentSearchParams {
  keyword?: string;
  limit?: number;
}

export interface KernelSessionListParams {
  page?: number;
  limit?: number;
  /** 只看「真正的对话」会话，排除知识/资产/系统等功能内部运行时会话（用户总览页用）。 */
  conversational?: boolean;
}

export interface CreateSessionRequest {
  agentId?: string;
  title?: string;
  cwd?: string;
  model?: string;
  followDefaultModel?: boolean;
  permissionMode?: string;
  systemPrompt?: string;
  apiKey?: string;
  baseUrl?: string;
  skills?: string[];
  skillDirs?: string[];
  mcpServers?: unknown[];
  builtinSkills?: boolean;
  planningMode?: string;
  goalTracking?: boolean;
  maxToolRounds?: number;
  continuationEnabled?: boolean;
  maxContinuationTurns?: number;
  autoCompact?: boolean;
  autoCompactThreshold?: number;
  temperature?: number;
  thinkingBudget?: number;
  toolTimeoutMs?: number;
  queueTimeoutMs?: number;
  maxExecutionTimeMs?: number;
  streamStallWarningMs?: number;
  streamStallHardMs?: number;
  streamStallActiveToolHardMs?: number;
  maxConsecutiveToolErrors?: number;
  maxStreamRetries?: number;
  autoDelegation?: {
    enabled?: boolean;
    autoParallel?: boolean;
    minConfidence?: number;
    maxTasks?: number;
  };
  autoParallel?: boolean;
  maxParallelTasks?: number;
  artifactStoreLimits?: {
    maxArtifacts?: number;
    maxBytes?: number;
  };
  searchConfig?: unknown;
  metadata?: Record<string, unknown>;
}

export interface CreateSessionResponse {
  success: boolean;
  session?: {
    sessionId: string;
    title: string;
    cwd: string;
    agentId?: string;
    model?: string;
    followDefaultModel?: boolean;
    permissionMode?: string;
    metadata?: Record<string, unknown>;
    assetId?: string;
    agentPhase?: string;
    workingDirectory?: string;
  };
  error?: string;
}

export interface RunSessionMessageResponse {
  sessionId: string;
  accepted: boolean;
  events?: unknown[];
  completedAt?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrevious?: boolean;
}

type QueryParams = Record<string, string | number | undefined>;

function toQuery(params?: QueryParams) {
  if (!params) return "";
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export const kernelApi = {
  async listAgents(params: KernelAgentSearchParams = {}): Promise<KernelAgent[]> {
    return apiClient.get<KernelAgent[]>(
      `/api/open/kernel/agents${toQuery({ keyword: params.keyword, limit: params.limit })}`,
    );
  },

  async listSessions(params: KernelSessionListParams = {}, options?: ApiRequestInit): Promise<KernelSession[]> {
    const response = await this.listSessionsPage(params, options);
    return response.items;
  },

  async listSessionsPage(
    params: KernelSessionListParams = {},
    options?: ApiRequestInit,
  ): Promise<PaginatedResponse<KernelSession>> {
    return apiClient.get<PaginatedResponse<KernelSession>>(
      `/api/kernel/sessions${toQuery({
        page: params.page,
        limit: params.limit,
        conversational: params.conversational ? "true" : undefined,
      })}`,
      options,
    );
  },

  async getSession(sessionId: string): Promise<KernelSession> {
    return apiClient.get<KernelSession>(`/api/kernel/sessions/${sessionId}`);
  },

  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    return apiClient.post<CreateSessionResponse>("/api/kernel/sessions", request);
  },

  async updateSession(sessionId: string, patch: Partial<KernelSession>): Promise<KernelSession> {
    return apiClient.patch<KernelSession>(`/api/kernel/sessions/${sessionId}`, patch);
  },

  async deleteSession(sessionId: string): Promise<void> {
    await apiClient.delete(`/api/kernel/sessions/${sessionId}`);
  },

  async listMessages(sessionId: string): Promise<KernelMessage[]> {
    const response = await apiClient.get<PaginatedResponse<KernelMessage>>(
      `/api/kernel/sessions/${sessionId}/messages`,
    );
    return response.items;
  },

  async runSessionMessage(sessionId: string, request: { content: string }): Promise<RunSessionMessageResponse> {
    return apiClient.post<RunSessionMessageResponse>(`/api/kernel/sessions/${sessionId}/messages`, request);
  },
};
