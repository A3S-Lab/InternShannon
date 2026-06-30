import { apiRawFetch, apiRawUpload } from "./api/client";
import { waitForBackendReady } from "./backend-ready";
import { CORE_AGENT_SKILLS, type CoreAgentSkill } from "./core-skills";
import { AppError } from "./error";
import { apiUrl } from "./http";
import { type McpServerConfig, normalizeMcpServerConfigs } from "./mcp-server-config";
import { allowsLocalWorkspacePaths } from "./runtime-environment";
import type { AgentInfo, AgentProcessInfo } from "./types";
import { exposeWorkspacePath } from "./workspace-path";

export { type McpServerConfig, normalizeMcpServerConfigs } from "./mcp-server-config";

export interface McpServerStatus {
  name: string;
  connected: boolean;
  enabled: boolean;
  tool_count: number;
  error?: string;
}

interface AiConfigWithMcp {
  mcpServers?: McpServerConfig[];
  providers?: Array<{
    name?: string;
    models?: Array<{
      id?: string;
      name?: string;
    }>;
  }>;
  [key: string]: unknown;
}

interface MarketAgentListParams {
  q?: string;
  search?: string;
  tags?: string[];
  page?: number;
  page_size?: number;
}

interface MarketAgentListResponse {
  items: AgentInfo[];
  total: number;
  page: number;
  page_size: number;
}

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

const jsonHeaders = { "Content-Type": "application/json" };

/** Standard API response wrapper */
interface ApiResponseWrapper<T> {
  code: number;
  message: string;
  data: T;
  requestId?: string;
  timestamp?: string;
}

type UnknownRecord = Record<string, unknown>;
type SessionUpdateRequest = Partial<CreateSessionRequest> & UnknownRecord;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function listItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isRecord(value) && Array.isArray(value.items) ? value.items : [];
}

function errorMessageFromPayload(payload: UnknownRecord | null): string | undefined {
  return optionalString(payload?.message) ?? optionalString(payload?.error);
}

/** Check if response is standard wrapper and unwrap it */
function unwrapResponse<T>(response: unknown): T {
  if (
    response !== null &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    "data" in response &&
    (("code" in response && "message" in response) || "_meta" in response)
  ) {
    return (response as ApiResponseWrapper<T>).data;
  }
  return response as T;
}

async function safeFetch<T = unknown>(url: string, init?: RequestInit, apiUrl?: string): Promise<T> {
  if (!apiUrl) {
    await waitForBackendReady({ timeoutMs: 15000 });
  }
  if (apiUrl) {
    // When apiUrl is provided, url might be:
    // 1. A full URL like "http://127.0.0.1:29653/api/kernel/sessions?limit=100"
    // 2. Just a path like "/sessions?limit=100"
    // We need to extract the path portion when url is a full URL
    let path = url;
    try {
      const urlObj = new URL(url);
      path = urlObj.pathname + urlObj.search;
    } catch {
      // URL parsing failed, assume url is already a path
      path = url.startsWith("/") ? url : `/${url}`;
    }
    const normalizedApiUrl = apiUrl.replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return directFetch(normalizedApiUrl, normalizedPath, init);
  }
  const res = await apiRawFetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let payload: UnknownRecord | null = null;
    try {
      const parsed = text ? (JSON.parse(text) as unknown) : null;
      payload = isRecord(parsed) ? parsed : null;
    } catch {
      payload = null;
    }
    throw AppError.fromResponse(
      {
        status: res.status,
        data: (payload ?? undefined) as
          | { status?: string; message?: string; details?: Record<string, unknown>; requestId?: string }
          | undefined,
      },
      errorMessageFromPayload(payload) || text || `${init?.method ?? "GET"} ${url} failed`,
    );
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return unwrapResponse(await res.json());
  return null as T;
}

function kernelRequest(path: string, apiUrl?: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!apiUrl) return apiUrlForKernel(normalized);
  return isKernelApiBase(apiUrl) ? normalized : `/kernel${normalized}`;
}

function apiUrlForKernel(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return apiUrl(`/kernel${normalized}`);
}

function isKernelApiBase(baseUrl: string): boolean {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed, "http://local.invalid");
    return parsed.pathname.replace(/\/+$/, "").endsWith("/kernel");
  } catch {
    return trimmed.endsWith("/kernel");
  }
}

async function directFetch<T = unknown>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${baseUrl}${path}`;
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await apiRawFetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let payload: UnknownRecord | null = null;
    try {
      const parsed = text ? (JSON.parse(text) as unknown) : null;
      payload = isRecord(parsed) ? parsed : null;
    } catch {
      payload = null;
    }
    throw AppError.fromResponse(
      {
        status: res.status,
        data: (payload ?? undefined) as
          | { status?: string; message?: string; details?: Record<string, unknown>; requestId?: string }
          | undefined,
      },
      errorMessageFromPayload(payload) || text || `${init?.method ?? "GET"} ${url} failed`,
    );
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return unwrapResponse(await res.json());
  return null as T;
}

function toTimestamp(value: unknown): number {
  if (typeof value === "number") {
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}

function toProcessState(value: unknown): AgentProcessInfo["state"] {
  if (value === "starting" || value === "connected" || value === "running" || value === "exited") {
    return value;
  }
  if (value === "completed" || value === "aborted") return "exited";
  return "connected";
}

function normalizeSessionInfo(raw: unknown, defaults: Partial<AgentProcessInfo> = {}): AgentProcessInfo | null {
  if (!isRecord(raw)) return null;
  const nested = isRecord(raw.session) ? raw.session : null;
  const sessionId =
    optionalString(raw.sessionId) ?? optionalString(raw.id) ?? optionalString(nested?.sessionId) ?? defaults.sessionId;
  if (!sessionId) return null;

  const metadata = isRecord(raw.metadata)
    ? raw.metadata
    : isRecord(nested?.metadata)
      ? nested.metadata
      : defaults.metadata;
  const agentId = optionalString(raw.agentId) ?? optionalString(nested?.agentId) ?? defaults.agentId ?? null;
  const assetId =
    optionalString(raw.assetId) ??
    optionalString(nested?.assetId) ??
    optionalString(metadata?.assetId) ??
    defaults.assetId;
  const agentPhase =
    optionalString(raw.agentPhase) ??
    optionalString(nested?.agentPhase) ??
    optionalString(metadata?.agentPhase) ??
    defaults.agentPhase;

  const rawCwd = optionalString(raw.cwd) ?? optionalString(nested?.cwd) ?? defaults.cwd ?? "";
  const cwd = exposeWorkspacePath(rawCwd, { allowLocal: allowsLocalWorkspacePaths() });
  const rawExitCode = raw.exitCode ?? nested?.exitCode;
  const exitCode =
    rawExitCode === null
      ? null
      : (optionalNumber(rawExitCode) ?? (defaults.exitCode === undefined ? null : defaults.exitCode));

  return {
    sessionId,
    agentId,
    pid: optionalNumber(raw.pid) ?? defaults.pid,
    state: toProcessState(raw.state ?? raw.status ?? nested?.state ?? nested?.status ?? defaults.state),
    exitCode,
    model: optionalString(raw.model) ?? optionalString(nested?.model) ?? defaults.model,
    followDefaultModel:
      optionalBoolean(raw.followDefaultModel) ??
      optionalBoolean(nested?.followDefaultModel) ??
      defaults.followDefaultModel,
    permissionMode:
      optionalString(raw.permissionMode) ?? optionalString(nested?.permissionMode) ?? defaults.permissionMode,
    cwd,
    createdAt: toTimestamp(raw.createdAt ?? nested?.createdAt ?? raw.updatedAt ?? defaults.createdAt),
    cliSessionId: optionalString(raw.cliSessionId) ?? optionalString(nested?.cliSessionId) ?? defaults.cliSessionId,
    name:
      optionalString(raw.name) ??
      optionalString(raw.title) ??
      optionalString(nested?.name) ??
      optionalString(nested?.title) ??
      defaults.name,
    assetId: assetId?.trim(),
    agentPhase: agentPhase?.trim(),
    metadata,
  };
}

function normalizeSessionList(raw: unknown): AgentProcessInfo[] {
  return listItems(raw)
    .map((item: unknown) => normalizeSessionInfo(item))
    .filter((item: AgentProcessInfo | null): item is AgentProcessInfo => Boolean(item));
}

function normalizeMessageList(raw: unknown): unknown[] {
  return listItems(raw);
}

function unsupportedApi<T>(name: string): Promise<T> {
  return Promise.reject(
    new AppError({
      code: 501,
      errorCode: "SIDECAR_ENDPOINT_NOT_IMPLEMENTED",
      message: `${name} is not implemented by the local sidecar API`,
    }),
  );
}

async function getAiConfig(): Promise<AiConfigWithMcp> {
  return safeFetch<AiConfigWithMcp>(apiUrl("/config/categories/llm"));
}

async function saveMcpServers(mcpServers: McpServerConfig[]): Promise<void> {
  const current = await getAiConfig();
  await safeFetch(apiUrl("/config/categories/llm"), {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify({
      ...current,
      mcpServers,
    }),
  });
}

function aiConfigToModelOptions(config: AiConfigWithMcp): ModelOption[] {
  const options: Array<{ id: string; name: string; provider: string }> = [];
  for (const provider of config.providers ?? []) {
    const providerName = provider.name?.trim();
    if (!providerName) continue;
    for (const model of provider.models ?? []) {
      const id = model.id?.trim();
      if (!id) continue;
      options.push({
        id,
        name: model.name?.trim() || id,
        provider: providerName,
      });
    }
  }
  return options;
}

// =============================================================================
// Kernel API — these map to the NestJS KernelModule endpoints
// =============================================================================

export interface SessionResponse {
  id?: string;
  sessionId?: string;
  agentId?: string;
  title?: string;
  userId?: string;
  status?: string;
  state?: string;
  model?: string;
  followDefaultModel?: boolean;
  permissionMode?: string;
  cwd?: string;
  assetId?: string;
  agentPhase?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  metadata?: Record<string, unknown>;
  // for createSession response
  success?: boolean;
  session?: {
    sessionId?: string;
    title?: string;
    cwd?: string;
    agentId?: string;
    model?: string;
    followDefaultModel?: boolean;
    permissionMode?: string;
    assetId?: string;
    agentPhase?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  error?: string;
  // for listSessions
  name?: string;
}

export interface CreateSessionRequest {
  agentId?: string;
  title?: string;
  model?: string;
  followDefaultModel?: boolean;
  permissionMode?: string;
  cwd?: string;
  systemPrompt?: string;
  skills?: string[];
  skillDirs?: string[];
  mcpServers?: McpServerConfig[];
  baseUrl?: string;
  apiKey?: string;
  builtinSkills?: boolean;
  planningMode?: "auto" | "enabled" | "disabled";
  goalTracking?: boolean;
  maxToolRounds?: number;
  continuationEnabled?: boolean;
  maxContinuationTurns?: number;
  autoCompact?: boolean;
  autoCompactThreshold?: number;
  temperature?: number;
  thinkingBudget?: number;
  searchConfig?: unknown;
  workerAgents?: Array<{
    name: string;
    description: string;
    kind?: string;
    hidden?: boolean;
    permissions?: {
      deny?: string[];
      allow?: string[];
      ask?: string[];
      defaultDecision?: string;
      enabled?: boolean;
    };
    model?: string;
    prompt?: string;
    maxSteps?: number;
    confirmationInheritance?: string;
  }>;
  inlineSkills?: Array<{
    name: string;
    kind: "instruction" | "persona" | string;
    content: string;
  }>;
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
  toolTimeoutMs?: number;
  queueTimeoutMs?: number;
  maxExecutionTimeMs?: number;
  streamStallWarningMs?: number;
  streamStallHardMs?: number;
  streamStallActiveToolHardMs?: number;
  maxConsecutiveToolErrors?: number;
  maxStreamRetries?: number;
  [key: string]: unknown;
}

/** One knowledge-base hit — matches the backend wiki/knowledge search hit shape. */
export interface KnowledgeSearchHit {
  path: string;
  title: string;
  type: string | null;
  snippet: string;
  score: number;
}

/** Response of the personal / docs knowledge search endpoints. */
export interface KnowledgeSearchResult {
  assetId: string;
  query: string;
  hits: KnowledgeSearchHit[];
}

/** Which knowledge base InternShannon can ground against. */
export type KnowledgeBaseScope = "personal" | "docs";

function normalizeKnowledgeSearchResult(raw: unknown, query: string): KnowledgeSearchResult {
  const record = isRecord(raw) ? raw : {};
  const hits = (Array.isArray(record.hits) ? record.hits : [])
    .filter(isRecord)
    .map((hit) => ({
      path: optionalString(hit.path) ?? "",
      title: optionalString(hit.title) ?? optionalString(hit.path) ?? "未命名片段",
      type: optionalString(hit.type) ?? null,
      snippet: optionalString(hit.snippet) ?? "",
      score: optionalNumber(hit.score) ?? 0,
    }))
    .filter((hit) => hit.path || hit.snippet);
  return {
    assetId: optionalString(record.assetId) ?? "",
    query: optionalString(record.query) ?? query,
    hits,
  };
}

/** One row of the durable kernel memory base — matches the backend MemoryResponseDto exactly. */
export interface KernelMemoryItem {
  id: string;
  sessionId: string | null;
  layer: "resource" | "artifact" | "insight";
  action: "stored" | "recalled" | "cleared";
  content: string | null;
  memoryId: string | null;
  metadata: Record<string, unknown>;
  /** ISO 8601 string on the wire (serialized Date). */
  createdAt: string;
}

/** Standard paginated envelope returned by GET /kernel/me/memories. */
export interface KernelMemoryPage {
  items: KernelMemoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface ListMemoriesParams {
  page?: number;
  limit?: number;
  layer?: KernelMemoryItem["layer"];
  action?: KernelMemoryItem["action"];
}

function normalizeKernelMemoryItem(raw: unknown): KernelMemoryItem | null {
  if (!isRecord(raw)) return null;
  const layer = raw.layer;
  const action = raw.action;
  const id = optionalString(raw.id);
  if (!id) return null;
  if (layer !== "resource" && layer !== "artifact" && layer !== "insight") return null;
  if (action !== "stored" && action !== "recalled" && action !== "cleared") return null;
  return {
    id,
    sessionId: optionalString(raw.sessionId) ?? null,
    layer,
    action,
    content: optionalString(raw.content) ?? null,
    memoryId: optionalString(raw.memoryId) ?? null,
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
    createdAt: optionalString(raw.createdAt) ?? new Date().toISOString(),
  };
}

function normalizeKernelMemoryPage(raw: unknown, params: ListMemoriesParams): KernelMemoryPage {
  const envelope = isRecord(raw) ? raw : {};
  const items = listItems(envelope)
    .map(normalizeKernelMemoryItem)
    .filter((item): item is KernelMemoryItem => Boolean(item));
  const total = optionalNumber(envelope.total) ?? items.length;
  const page = optionalNumber(envelope.page) ?? params.page ?? 1;
  const limit = optionalNumber(envelope.limit) ?? params.limit ?? items.length;
  const totalPages = optionalNumber(envelope.totalPages) ?? Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasNext: typeof envelope.hasNext === "boolean" ? envelope.hasNext : page < totalPages,
    hasPrevious: typeof envelope.hasPrevious === "boolean" ? envelope.hasPrevious : page > 1,
  };
}

export interface KernelVerificationCommand {
  id: string;
  kind: string;
  description: string;
  command: string;
  required?: boolean;
  timeoutMs?: number;
}

export interface KernelRuntimeVerificationView {
  reports?: unknown;
  summary?: unknown;
  summaryText?: string;
  presets?: unknown;
}

export interface SessionWorkspaceUploadResult {
  success: boolean;
  message?: string;
  uploadId?: string;
  path: string;
  workspacePath: string;
  fileName: string;
  size: number;
  mimeType?: string;
  sha256?: string;
}

export type SessionWorkspaceUploadOptions = {
  conflictStrategy?: "overwrite" | "rename";
  onProgress?: (loaded: number, total: number) => void;
  chunkSize?: number;
  forceChunked?: boolean;
};

interface SessionWorkspaceUploadProgressResult {
  uploadId: string;
  status: "uploading" | "completed";
  path: string;
  fileName: string;
  size: number;
  mimeType?: string;
  chunkSize?: number;
  chunkCount?: number;
  receivedChunks: number;
  uploadedBytes: number;
  progress: number;
  completed: boolean;
  result?: SessionWorkspaceUploadResult;
}

const DEFAULT_WORKSPACE_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

function kernelUploadUrl(path: string, apiUrl?: string): string {
  const requestPath = kernelRequest(path, apiUrl);
  if (!apiUrl) return requestPath;
  const normalizedApiUrl = apiUrl.replace(/\/+$/, "");
  const normalizedPath = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  return `${normalizedApiUrl}${normalizedPath}`;
}

async function uploadSessionWorkspaceFile(
  url: string,
  path: string,
  file: File,
  options?: SessionWorkspaceUploadOptions,
): Promise<SessionWorkspaceUploadResult> {
  const chunkSize = options?.chunkSize ?? DEFAULT_WORKSPACE_UPLOAD_CHUNK_SIZE;
  if (file.size > 0 && (options?.forceChunked || file.size > chunkSize)) {
    return uploadSessionWorkspaceFileInChunks(url, path, file, chunkSize, options);
  }

  const form = new FormData();
  form.append("path", path);
  if (options?.conflictStrategy) form.append("conflictStrategy", options.conflictStrategy);
  form.append("file", file, file.name);

  const response = await apiRawUpload(url, {
    method: "POST",
    body: form,
    onUploadProgress: options?.onProgress,
  });

  const text = await response.text();
  if (!response.ok) {
    let message = text || `上传失败：${response.status} ${response.statusText}`;
    try {
      const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
      if (typeof payload.message === "string") message = payload.message;
      else if (typeof payload.error === "string") message = payload.error;
    } catch {
      // Keep the raw response text.
    }
    throw new Error(message);
  }

  const payload = text ? JSON.parse(text) : {};
  return unwrapResponse<SessionWorkspaceUploadResult>(payload);
}

async function readUploadJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let message = text || `上传失败：${response.status} ${response.statusText}`;
    try {
      const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
      if (typeof payload.message === "string") message = payload.message;
      else if (typeof payload.error === "string") message = payload.error;
    } catch {
      // Keep the raw response text.
    }
    throw new Error(message);
  }
  const payload = text ? JSON.parse(text) : {};
  return unwrapResponse<T>(payload);
}

async function uploadSessionWorkspaceFileInChunks(
  url: string,
  path: string,
  file: File,
  chunkSize: number,
  options?: SessionWorkspaceUploadOptions,
): Promise<SessionWorkspaceUploadResult> {
  const safeChunkSize = Math.max(1, Math.floor(chunkSize));
  let uploadId = "";
  let completedResult: SessionWorkspaceUploadResult | undefined;
  let offset = 0;
  options?.onProgress?.(0, file.size);

  while (offset < file.size) {
    const start = offset;
    const end = Math.min(file.size, start + safeChunkSize);
    const chunk = file.slice(start, end);
    const form = new FormData();
    if (uploadId) form.append("uploadId", uploadId);
    else {
      form.append("path", path);
      form.append("fileName", file.name);
      if (file.type) form.append("mimeType", file.type);
      form.append("size", String(file.size));
      if (options?.conflictStrategy) form.append("conflictStrategy", options.conflictStrategy);
    }
    form.append("chunk", chunk, file.name);

    const response = await apiRawUpload(`${url}/chunks`, {
      method: "POST",
      body: form,
      onUploadProgress: (loaded) => {
        options?.onProgress?.(Math.min(file.size, start + loaded), file.size);
      },
    });
    const progress = await readUploadJson<SessionWorkspaceUploadProgressResult>(response);
    uploadId = progress.uploadId;
    options?.onProgress?.(progress.uploadedBytes, progress.size);
    if (progress.uploadedBytes <= start && !progress.completed) {
      throw new Error("上传进度未推进，请重试");
    }
    offset = progress.uploadedBytes;
    if (progress.completed) {
      completedResult = progress.result;
      break;
    }
  }

  if (!completedResult) {
    throw new Error("上传完成但服务端未返回文件结果");
  }
  options?.onProgress?.(completedResult.size, completedResult.size);
  return completedResult;
}

export const agentApi = {
  // ---------- Kernel endpoints ----------

  /** POST /api/kernel/sessions */
  createSession: (params: CreateSessionRequest, apiUrl?: string) =>
    safeFetch<SessionResponse>(
      kernelRequest("/sessions", apiUrl),
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(params),
      },
      apiUrl,
    ),

  /** GET /api/kernel/sessions */
  listSessions: async (apiUrl?: string) =>
    normalizeSessionList(await safeFetch(kernelRequest("/sessions?limit=100", apiUrl), undefined, apiUrl)),

  /** GET /api/kernel/sessions/:id */
  getSession: async (id: string, apiUrl?: string) =>
    normalizeSessionInfo(await safeFetch(kernelRequest(`/sessions/${id}`, apiUrl), undefined, apiUrl)),

  /** POST /api/kernel/sessions/:id/workspace/files/upload */
  uploadSessionWorkspaceFile: async (
    id: string,
    path: string,
    file: File,
    options?: SessionWorkspaceUploadOptions,
    apiUrl?: string,
  ): Promise<SessionWorkspaceUploadResult> => {
    if (!apiUrl) await waitForBackendReady({ timeoutMs: 15000 });
    return uploadSessionWorkspaceFile(
      kernelUploadUrl(`/sessions/${encodeURIComponent(id)}/workspace/files/upload`, apiUrl),
      path,
      file,
      options,
    );
  },

  /** DELETE /api/kernel/sessions/:id */
  deleteSession: (id: string, apiUrl?: string) =>
    safeFetch(kernelRequest(`/sessions/${id}`, apiUrl), { method: "DELETE" }, apiUrl),

  /** GET /api/kernel/sessions/:id/messages */
  getSessionMessages: (id: string, apiUrl?: string) =>
    safeFetch(kernelRequest(`/sessions/${id}/messages`, apiUrl), undefined, apiUrl).then(normalizeMessageList),

  /** GET /api/kernel/sessions/:id/status */
  getSessionRuntimeStatus: (id: string, apiUrl?: string) =>
    safeFetch(kernelRequest(`/sessions/${encodeURIComponent(id)}/status`, apiUrl), undefined, apiUrl),

  /**
   * GET /api/v1/kernel/me/memories — the durable, user-scoped kernel memory base
   * (InternShannon's stored / recalled / cleared memories), newest-first, paginated,
   * with optional layer / action filters. Read-only.
   */
  listMemories: async (params: ListMemoriesParams = {}, apiUrl?: string): Promise<KernelMemoryPage> => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.layer) qs.set("layer", params.layer);
    if (params.action) qs.set("action", params.action);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const raw = await safeFetch(kernelRequest(`/me/memories${suffix}`, apiUrl), undefined, apiUrl);
    return normalizeKernelMemoryPage(raw, params);
  },

  /**
   * Knowledge grounding search InternShannon can draw on:
   * - `personal` → GET /api/v1/assets/me/knowledge/search (current user's personal KB).
   * - `docs` → GET /api/v1/assets/docs/knowledge/search (local InternShannon docs KB).
   * Both return { assetId, query, hits:[{path,title,type,snippet,score}] }.
   */
  searchKnowledge: async (scope: KnowledgeBaseScope, q: string, limit = 8): Promise<KnowledgeSearchResult> => {
    const qs = new URLSearchParams({ q });
    if (limit) qs.set("limit", String(limit));
    const base = scope === "docs" ? "/assets/docs/knowledge/search" : "/assets/me/knowledge/search";
    const raw = await safeFetch(apiUrl(`${base}?${qs.toString()}`));
    return normalizeKnowledgeSearchResult(raw, q);
  },

  /** GET /api/kernel/sessions/:id/runtime/runs */
  getSessionRuntimeRuns: (id: string, apiUrl?: string) =>
    safeFetch<unknown[]>(kernelRequest(`/sessions/${encodeURIComponent(id)}/runtime/runs`, apiUrl), undefined, apiUrl),

  /** GET /api/kernel/sessions/:id/runtime/runs/:runId/events */
  getSessionRunEvents: (id: string, runId: string, apiUrl?: string) =>
    safeFetch<unknown[]>(
      kernelRequest(`/sessions/${encodeURIComponent(id)}/runtime/runs/${encodeURIComponent(runId)}/events`, apiUrl),
      undefined,
      apiUrl,
    ),

  /** POST /api/kernel/sessions/:id/runtime/runs/:runId/cancel */
  cancelSessionRun: (id: string, runId: string, apiUrl?: string) =>
    safeFetch(
      kernelRequest(`/sessions/${encodeURIComponent(id)}/runtime/runs/${encodeURIComponent(runId)}/cancel`, apiUrl),
      { method: "POST", headers: jsonHeaders },
      apiUrl,
    ),

  /** GET /api/kernel/sessions/:id/runtime/subagent-tasks */
  listSessionSubagentTasks: (id: string, apiUrl?: string) =>
    safeFetch<unknown[]>(
      kernelRequest(`/sessions/${encodeURIComponent(id)}/runtime/subagent-tasks`, apiUrl),
      undefined,
      apiUrl,
    ),

  /** POST /api/kernel/sessions/:id/runtime/subagent-tasks/:taskId/cancel */
  cancelSessionSubagentTask: (id: string, taskId: string, apiUrl?: string) =>
    safeFetch(
      kernelRequest(
        `/sessions/${encodeURIComponent(id)}/runtime/subagent-tasks/${encodeURIComponent(taskId)}/cancel`,
        apiUrl,
      ),
      { method: "POST", headers: jsonHeaders },
      apiUrl,
    ),

  /** GET /api/kernel/sessions/:id/runtime/verification */
  getSessionVerification: (id: string, apiUrl?: string) =>
    safeFetch<KernelRuntimeVerificationView>(
      kernelRequest(`/sessions/${encodeURIComponent(id)}/runtime/verification`, apiUrl),
      undefined,
      apiUrl,
    ),

  /** POST /api/kernel/sessions/:id/runtime/verification/commands */
  verifySessionCommands: (id: string, subject: string, commands: KernelVerificationCommand[], apiUrl?: string) =>
    safeFetch(
      kernelRequest(`/sessions/${encodeURIComponent(id)}/runtime/verification/commands`, apiUrl),
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ subject, commands }),
      },
      apiUrl,
    ),

  /** GET /api/kernel/sessions/:id/runtime/artifact?uri=... */
  getSessionArtifact: (id: string, uri: string, apiUrl?: string) =>
    safeFetch(
      kernelRequest(`/sessions/${encodeURIComponent(id)}/runtime/artifact?uri=${encodeURIComponent(uri)}`, apiUrl),
      undefined,
      apiUrl,
    ),

  listAgents: async (): Promise<AgentInfo[]> => {
    const raw = await safeFetch(apiUrl("/open/kernel/agents"));
    return listItems(raw)
      .filter(isRecord)
      .map((item) => ({
        id: optionalString(item.id) ?? "",
        name: optionalString(item.name) ?? "",
        description: optionalString(item.description) ?? "",
        tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
      }))
      .filter((item) => item.id && item.name);
  },

  listMarketAgents: async (params?: MarketAgentListParams, apiUrl?: string): Promise<MarketAgentListResponse> => {
    const qs = new URLSearchParams();
    const query = params?.q ?? params?.search;
    if (query) qs.set("q", query);
    for (const tag of params?.tags ?? []) {
      if (tag.trim()) qs.append("tags", tag.trim());
    }
    if (params?.page) qs.set("page", String(params.page));
    if (params?.page_size) qs.set("page_size", String(params.page_size));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return safeFetch<MarketAgentListResponse>(`/market/agents${suffix}`, undefined, apiUrl);
  },

  configureSession: async (
    id: string,
    params?: SessionUpdateRequest,
    apiUrl?: string,
  ): Promise<{ ok: boolean; model?: string }> => {
    const requestSession = apiUrl
      ? <T>(path: string, init?: RequestInit) => directFetch<T>(apiUrl, path, init)
      : <T>(path: string, init?: RequestInit) => safeFetch<T>(path, init);
    const session = await requestSession<SessionResponse>(kernelRequest(`/sessions/${id}`, apiUrl), {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(params ?? {}),
    });
    return { ok: true, model: session?.model || params?.model };
  },

  updateSession: (id: string, updates?: SessionUpdateRequest, apiUrl?: string): Promise<unknown> =>
    safeFetch(
      kernelRequest(`/sessions/${id}`, apiUrl),
      {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify(updates ?? {}),
      },
      apiUrl,
    ),

  setSessionMcpServers: (id: string, mcpServers: McpServerConfig[], apiUrl?: string): Promise<unknown> =>
    agentApi.updateSession(id, { mcpServers }, apiUrl),

  getSessionMcpServers: async (id: string, apiUrl?: string): Promise<McpServerConfig[]> => {
    const raw = await safeFetch(kernelRequest(`/sessions/${id}`, apiUrl), undefined, apiUrl);
    const session = isRecord(raw) ? raw : {};
    const nestedSession = isRecord(session.session) ? session.session : {};
    const metadata = isRecord(session.metadata)
      ? session.metadata
      : isRecord(nestedSession.metadata)
        ? nestedSession.metadata
        : {};
    return normalizeMcpServerConfigs(metadata.mcpServers);
  },

  relaunchSession: async (id: string, apiUrl?: string): Promise<{ sessionId: string }> => {
    const current = await safeFetch(kernelRequest(`/sessions/${id}`, apiUrl), undefined, apiUrl);
    const currentRecord = isRecord(current) ? current : {};
    const session = isRecord(currentRecord.session) ? currentRecord.session : currentRecord;
    const metadata = isRecord(session.metadata) ? session.metadata : {};
    const created = await agentApi.createSession(
      {
        agentId: optionalString(session.agentId),
        title: optionalString(session.title) || optionalString(session.name),
        cwd: optionalString(session.cwd),
        ...metadata,
      },
      apiUrl,
    );
    return {
      sessionId: created.session?.sessionId || created.sessionId || created.id || "",
    };
  },

  listModelOptions: (): Promise<ModelOption[]> => getAiConfig().then(aiConfigToModelOptions),

  listSkills: async (): Promise<CoreAgentSkill[]> => CORE_AGENT_SKILLS,

  listCommands: (): Promise<unknown[]> => unsupportedApi<unknown[]>("listCommands"),

  sendAgentMessage: (_id: string, _target: string, _content: string): Promise<unknown> =>
    unsupportedApi<unknown>("sendAgentMessage"),

  execBash: (_id: string, _command: string): Promise<{ output: string; success: boolean }> =>
    unsupportedApi<{ output: string; success: boolean }>("execBash"),

  setAutoExecute: (id: string, enabled: boolean, apiUrl?: string): Promise<unknown> =>
    agentApi.updateSession(id, { autoExecute: enabled }, apiUrl),

  fetchConfig: (): Promise<unknown> => safeFetch(apiUrl("/config")),

  getLlmDebugStatus: (): Promise<unknown> => safeFetch(apiUrl("/config/diagnostics/llm")),

  updateConfig: (patch?: unknown): Promise<unknown> =>
    safeFetch(apiUrl("/config"), {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(patch ?? {}),
    }),

  clearConfigCache: (): Promise<{ ok: boolean; cleared: string }> =>
    safeFetch<{ ok: boolean; cleared: string }>(apiUrl("/config/cache"), { method: "DELETE" }),

  getKnowledgeBaseCapabilities: (): Promise<unknown> => unsupportedApi<unknown>("getKnowledgeBaseCapabilities"),

  listKnowledgeBases: (): Promise<unknown[]> => unsupportedApi<unknown[]>("listKnowledgeBases"),

  getSessionStats: (): Promise<unknown> => unsupportedApi<unknown>("getSessionStats"),

  getAgentDirectory: (): Promise<unknown> => unsupportedApi<unknown>("getAgentDirectory"),

  listMcpServers: (): Promise<Record<string, McpServerStatus>> =>
    getAiConfig().then((config) => {
      const servers = normalizeMcpServerConfigs(config.mcpServers);
      return Object.fromEntries(
        servers.map((server) => [
          server.name,
          {
            name: server.name,
            enabled: server.enabled !== false,
            connected: false,
            tool_count: 0,
          } satisfies McpServerStatus,
        ]),
      );
    }),

  addMcpServer: async (config: McpServerConfig): Promise<{ ok: true }> => {
    const current = await getAiConfig();
    const servers = normalizeMcpServerConfigs(current.mcpServers);
    const next = [...servers.filter((server) => server.name !== config.name), config];
    await saveMcpServers(next);
    return { ok: true };
  },

  removeMcpServer: async (name: string): Promise<{ ok: true }> => {
    const current = await getAiConfig();
    const servers = normalizeMcpServerConfigs(current.mcpServers);
    await saveMcpServers(servers.filter((server) => server.name !== name));
    return { ok: true };
  },
};
