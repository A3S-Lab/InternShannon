// Browser-compatible constants (no process.env access)
// Environment variables are injected at build time via import.meta.env or defaults

import { resolveBrowserGatewayUrl, resolveDesktopGatewayUrl } from "./desktop-gateway-url";

// =============================================================================
// LLM Provider & Model Types
// =============================================================================

export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelLimit {
  context: number;
  output: number;
}

export interface ModelModalities {
  input: string[];
  output: string[];
}

export interface ModelConfig {
  id: string;
  name: string;
  family?: string;
  /** Per-model override (e.g. proxy for a specific model) */
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  sessionIdHeader?: string;
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
  temperature?: boolean;
  releaseDate?: string;
  modalities?: ModelModalities;
  cost?: ModelCost;
  limit?: ModelLimit;
}

export interface ProviderConfig {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  sessionIdHeader?: string;
  models: ModelConfig[];
}

// =============================================================================
// Search Engine Types
// =============================================================================

export type SearchEngineId = "ddg" | "brave" | "bing" | "wiki" | "sogou" | "360" | "google" | "baidu" | "bingchina";

export interface SearchEngineInfo {
  id: SearchEngineId;
  name: string;
  requiresBrowser: boolean;
  description: string;
}

export const SEARCH_ENGINES: SearchEngineInfo[] = [
  {
    id: "ddg",
    name: "DuckDuckGo",
    requiresBrowser: false,
    description: "默认搜索引擎，无需浏览器",
  },
  {
    id: "brave",
    name: "Brave Search",
    requiresBrowser: false,
    description: "隐私优先搜索引擎",
  },
  {
    id: "bing",
    name: "Bing",
    requiresBrowser: false,
    description: "微软搜索引擎",
  },
  {
    id: "wiki",
    name: "Wikipedia",
    requiresBrowser: false,
    description: "维基百科搜索",
  },
  {
    id: "sogou",
    name: "搜狗",
    requiresBrowser: true,
    description: "搜狗搜索（需要浏览器）",
  },
  {
    id: "360",
    name: "360搜索",
    requiresBrowser: true,
    description: "360搜索（需要浏览器）",
  },
  {
    id: "google",
    name: "Google",
    requiresBrowser: true,
    description: "谷歌搜索（需要浏览器）",
  },
  {
    id: "baidu",
    name: "百度",
    requiresBrowser: true,
    description: "百度搜索（需要浏览器）",
  },
  {
    id: "bingchina",
    name: "必应中国",
    requiresBrowser: true,
    description: "必应中国版（需要浏览器）",
  },
];

const isBrowserRuntime = typeof window !== "undefined";

const isDev =
  !isBrowserRuntime && typeof process !== "undefined"
    ? process.env.NODE_ENV === "development"
    : import.meta.env?.MODE === "development";

const browserGatewayEnv = {
  PUBLIC_DESKTOP_GATEWAY_URL: import.meta.env?.PUBLIC_DESKTOP_GATEWAY_URL,
  VITE_API_URL: import.meta.env?.VITE_API_URL,
  PUBLIC_API_BASE_URL: import.meta.env?.PUBLIC_API_BASE_URL,
};

const gatewayUrl =
  !isBrowserRuntime && typeof process !== "undefined"
    ? resolveDesktopGatewayUrl({}, process.env)
    : resolveBrowserGatewayUrl(browserGatewayEnv);

const appName =
  typeof process !== "undefined"
    ? process.env.PUBLIC_DESKTOP_APP_NAME || "InternShannon"
    : import.meta.env?.PUBLIC_DESKTOP_APP_NAME || "InternShannon";

const runtimeMode =
  typeof process !== "undefined"
    ? process.env.PUBLIC_DESKTOP_RUNTIME || "web"
    : import.meta.env?.PUBLIC_DESKTOP_RUNTIME || "web";

const DEFAULT_WORKSPACE_ASSET_BASE = "/workspace";
const localStorageKeyPrefix =
  typeof process !== "undefined"
    ? process.env.PUBLIC_DESKTOP_STORAGE_PREFIX || "internshannon"
    : import.meta.env?.PUBLIC_DESKTOP_STORAGE_PREFIX || "internshannon";

const assetBasePath =
  !isBrowserRuntime && typeof process !== "undefined"
    ? process.env.PUBLIC_DESKTOP_ASSET_BASE_URL || process.env.PUBLIC_DESKTOP_BASE_URL || DEFAULT_WORKSPACE_ASSET_BASE
    : import.meta.env?.PUBLIC_DESKTOP_ASSET_BASE_URL ||
      import.meta.env?.PUBLIC_DESKTOP_BASE_URL ||
      DEFAULT_WORKSPACE_ASSET_BASE;

const normalisedAssetBasePath = assetBasePath.endsWith("/") ? assetBasePath.slice(0, -1) : assetBasePath;

export const COPY_FEEDBACK_MS = 2000;
const normalisedAssetBase = normalisedAssetBasePath === "/" ? "" : normalisedAssetBasePath;

export function workspaceAssetPath(assetPath: string): string {
  const cleanPath = assetPath.replace(/^\/+/, "");
  if (!cleanPath) return normalisedAssetBase || ".";
  return normalisedAssetBase ? `${normalisedAssetBase}/${cleanPath}` : `./${cleanPath}`;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
  requestId?: string;
  timestamp?: string;
}

/** One field's validation failure, mirrored from the backend contract. */
export interface FieldError {
  field: string;
  messages: string[];
}

/** Structured error details. `fieldErrors` is present on parameter-validation failures. */
export interface ApiErrorDetails {
  fieldErrors?: FieldError[];
  [key: string]: unknown;
}

export interface ApiErrorResponse {
  /** HTTP status code. */
  code: number;
  /** Business status code — the single source of truth for error classification. */
  status?: string;
  message: string;
  details?: ApiErrorDetails;
  requestId?: string;
  timestamp?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PageQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface GeneralSettings {
  appName?: string;
  language: string;
  splashScreen: boolean;
  restoreWorkspace: boolean;
  workspacePath?: string;
}

export interface AppearanceSettings {
  theme: "light" | "dark" | "system";
  sideBarPosition: "left" | "right";
  statusBar: boolean;
  activityBar: boolean;
  zoomLevel?: number;
}

export interface NetworkSettings {
  upstreamProxyUrl?: string;
  proxyPool?: string[];
  connectionTimeout: number;
  readTimeout: number;
}

export interface StorageSettings {
  defaultProvider?: "s3" | "local" | "rustfs";
  rustfsEndpoint?: string;
  rustfsPublicEndpoint?: string;
  rustfsAccessKey?: string;
  rustfsSecretKey?: string;
  rustfsBucket?: string;
  localStoragePath?: string;
}

export interface AiSettings {
  defaultModel: string;
  providers: ProviderConfig[];
  mcpServers?: unknown[];
  maxToolRounds?: number;
  thinkingBudget?: number;
  toolTimeoutMs?: number;
  queueTimeoutMs?: number;
  maxExecutionTimeMs?: number;
  streamStallWarningMs?: number;
  streamStallHardMs?: number;
  streamStallActiveToolHardMs?: number;
  maxConsecutiveToolErrors?: number;
  maxStreamRetries?: number;
}

// =============================================================================
// Provider Colors
// =============================================================================

export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  openai: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  zhipu: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
};

export function pColor(n: string): string {
  return PROVIDER_COLORS[n] || "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
}

export default {
  isDev,
  name: appName,
  description: "认知驱动的个人智能助手",
  gatewayUrl,
  runtimeMode,
  localStorageKeyPrefix,
  assetBasePath: normalisedAssetBasePath,
  workspaceAssetPath: workspaceAssetPath,
};
