import { apiClient } from "@/lib/api/client";
import type { McpServerConfig } from "@/lib/mcp-server-config";
import { toQueryString } from "@/lib/shared";
import type {
  AiSettings,
  AppearanceSettings,
  EditorSettings,
  GeneralSettings,
  NetworkSettings,
  OcrSettings,
  SearchSettings,
  SecurityMonitorSettings,
  StorageSettings,
} from "@/types/config";

export type {
  AiSettings,
  AppearanceSettings,
  EditorSettings,
  GeneralSettings,
  ModelConfig,
  NetworkSettings,
  OcrBackendSettings,
  OcrBackendType,
  OcrOutputFormat,
  OcrRequestFormat,
  OcrSettings,
  ProviderConfig,
  SearchSettings,
  SecurityMonitorSettings,
  StorageSettings,
} from "@/types/config";

export type { McpServerConfig } from "@/lib/mcp-server-config";

/** 菜单插件:自定义左侧菜单项(名称/图标/跳转地址/位置/权限)。后端存于平台配置,运行时合并进侧栏。 */
export interface MenuPlugin {
  id: string;
  name: string;
  /** lucide 图标名(白名单映射,未知回退通用图标)。 */
  icon?: string;
  /** 跳转地址:站内 /admin/... 路径或外部 http(s)://(AgentUI 页面型可留空)。 */
  url?: string;
  /** AgentUI 页面内容(HTML);填了则该菜单项打开站内宿主页、经 AgentUI 沙箱渲染,而非跳转。 */
  html?: string;
  /** Markdown 页面内容;填了则该菜单项打开站内宿主页、渲染 Markdown(url/html 之外的第三种,三者互斥)。 */
  markdown?: string;
  /** AgentUI 额外 CDN 白名单(默认 jsdelivr/unpkg/esm.sh/tailwind 之外追加)。 */
  cdnAllowlist?: string[];
  /** 外部地址是否新开标签页。 */
  openInNewTab?: boolean;
  /** 排序权重(升序,排在内置菜单之后)。 */
  position?: number;
  /** 是否启用(缺省视为启用)。 */
  enabled?: boolean;
  /** 仅超级管理员可见。 */
  superAdminOnly?: boolean;
  /** 权限码门槛。 */
  permission?: string;
  /** 内置示例标记(UI 提示不可删)。 */
  builtin?: boolean;
}

export interface PlatformSettings {
  appName?: string;
  logoUrl?: string;
  language: string;
  publicBaseUrl?: string;
  publicApiBaseUrl?: string;
  gitPublicBaseUrl?: string;
  defaultOrganizationSlug?: string;
  registrationMode: "adminOnly" | "inviteOnly" | "open";
  maintenanceMode: boolean;
  supportEmail?: string;
  /** 数据源 Excel 上传大小上限(MB);集中在平台配置页编辑,后端运行时强制。 */
  uploadMaxExcelMb?: number;
  /** 内核会话工作区文件上传大小上限(MB);同样平台配置页编辑、运行时强制。 */
  uploadMaxWorkspaceFileMb?: number;
  /** 自定义左侧菜单插件。 */
  menuPlugins?: MenuPlugin[];
}

export interface AssetSettings {
  defaultVisibility: "private" | "organization" | "public";
  maxUploadSizeMb: number;
  allowedKinds: string[];
  requireActionsValidation: boolean;
  buildPackageOnActionsValidation: boolean;
  keepSourceSnapshots: boolean;
}

export interface PackageSettings {
  registryHost?: string;
  defaultNamespace?: string;
  defaultVisibility: "private" | "organization" | "public";
  immutableTags: boolean;
  allowAnonymousPull: boolean;
  retentionDays: number;
  maxArtifactSizeMb: number;
}

export interface MarketplaceSettings {
  enabled: boolean;
  reviewRequired: boolean;
  allowOrgPrivateListings: boolean;
  autoDelistVulnerable: boolean;
  featuredReviewRequired: boolean;
}

export interface RuntimeSettings {
  defaultNamespace?: string;
  defaultRuntimeClass?: string;
  defaultCpuLimit: string;
  defaultMemoryLimit: string;
  maxReplicas: number;
  requireResourceLimits: boolean;
  allowPrivilegedContainers: boolean;
  imagePullPolicy: "IfNotPresent" | "Always" | "Never";
}

export type LlmSettings = AiSettings;

export interface OAuthProviderSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes?: string[];
  clientSecretConfigured?: boolean;
}

export interface OAuthSettings {
  github: OAuthProviderSettings;
}

export interface EmailSettings {
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  passwordConfigured?: boolean;
  fromAddress: string;
  fromName: string;
}

export interface NotificationSettings {
  channels: Record<"in_app" | "email" | "webhook", boolean>;
  digestFrequency: "realtime" | "hourly" | "daily";
  webhookUrl: string;
  retentionDays: string;
  categories: Record<"system" | "account" | "knowledge" | "asset" | "runtime" | "resource", boolean>;
  levels: Record<"info" | "success" | "warning" | "error", boolean>;
}

export interface SecuritySettings {
  allowTelemetry: boolean;
  checkUpdates: boolean;
  sessionTimeoutMinutes: number;
  passwordMinLength: number;
  auditRetentionDays: number;
  requireEmailVerification: boolean;
  allowSuperAdminToken: boolean;
}

/**
 * 默认智能助手(default agent)的平台全局运行配置。超管在「系统 → 智能助手」各页编辑,
 * 后端读修写整对象;空字段一律回退到内置默认(name 空 = 内置默认名「InternShannon」、
 * avatar 空 = 内置默认头像、systemPrompt 空 = 内置基础提示词、model 空 = 跟随 LLM 默认、
 * skills 空 = 内置 CORE_AGENT_SKILL_NAMES)。
 */
export interface AssistantSettings {
  /** 助手名称;留空使用内置默认名(InternShannon)。 */
  name?: string;
  /** 头像 URL;留空使用内置默认头像。 */
  avatar?: string;
  /** 简短描述。 */
  description?: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  thinkingBudget?: number;
  maxToolRounds?: number;
  maxParseRetries?: number;
  circuitBreakerThreshold?: number;
  continuationEnabled?: boolean;
  maxContinuationTurns?: number;
  planningMode?: "auto" | "enabled" | "disabled";
  goalTracking?: boolean;
  builtinSkills?: boolean;
  enforceActiveSkillToolRestrictions?: boolean;
  autoCompact?: boolean;
  autoCompactThreshold?: number;
  toolTimeoutMs?: number;
  queueTimeoutMs?: number;
  maxExecutionTimeMs?: number;
  streamStallWarningMs?: number;
  streamStallHardMs?: number;
  streamStallActiveToolHardMs?: number;
  maxConsecutiveToolErrors?: number;
  maxStreamRetries?: number;
  autoParallel?: boolean;
  maxParallelTasks?: number;
  autoDelegation?: {
    enabled?: boolean;
    autoParallel?: boolean;
    minConfidence?: number;
    maxTasks?: number;
  };
  artifactStoreLimits?: {
    maxArtifacts?: number;
    maxBytes?: number;
  };
  retentionLimits?: {
    maxRunsRetained?: number;
    maxEventsPerRun?: number;
    maxTraceEvents?: number;
    maxTerminalSubagentTasks?: number;
  };
  skills?: string[];
  /** 全局 MCP 服务列表;形状对齐内核 RuntimeMcpServerConfig(见 lib/mcp-server-config)。 */
  mcpServers?: McpServerConfig[];
}

export interface AppSettings {
  platform: PlatformSettings;
  assets: AssetSettings;
  packages: PackageSettings;
  marketplace: MarketplaceSettings;
  runtime: RuntimeSettings;
  general: GeneralSettings;
  appearance: AppearanceSettings;
  editor: EditorSettings;
  llm: LlmSettings;
  ocr: OcrSettings;
  search: SearchSettings;
  oauth: OAuthSettings;
  email: EmailSettings;
  notifications: NotificationSettings;
  security: SecuritySettings;
  network: NetworkSettings;
  storage: StorageSettings;
}

export interface SystemInfo {
  appName?: string;
  logoUrl?: string;
  version: string;
}

export interface ConfigEntry {
  key: string;
  value: string;
  version?: number;
  revision?: number;
}

export interface ConfigEntryPage {
  items: ConfigEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface ConfigEntryQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  prefix?: string;
}

export interface UpsertConfigEntryRequest {
  key: string;
  value: string;
}

export interface FetchProviderModelsRequest {
  providerName: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface ProviderModelCandidate {
  id: string;
  name: string;
}

export interface ProviderModelListResponse {
  providerName: string;
  baseUrl: string;
  models: ProviderModelCandidate[];
}

function toQuery(params?: ConfigEntryQuery | { key?: string }) {
  return toQueryString(params as Record<string, string | number | boolean | null | undefined> | undefined);
}

function categoryPath(name: string) {
  return `/api/config/categories/${name}`;
}

export const configApi = {
  systemInfo: () => apiClient.get<SystemInfo>("/api/config/public/system-info"),
  /** 启用的菜单插件(所有登录用户;前端再按权限/超管过滤后合并进侧栏)。 */
  listMenuPlugins: () => apiClient.get<MenuPlugin[]>("/api/plugins/menu"),
  listEntries: (params?: ConfigEntryQuery) => apiClient.get<ConfigEntryPage>(`/api/config/entries${toQuery(params)}`),
  getEntry: (key: string) => apiClient.get<ConfigEntry>(`/api/config/entries/value${toQuery({ key })}`),
  upsertEntry: (entry: UpsertConfigEntryRequest) => apiClient.put<ConfigEntry>("/api/config/entries", entry),
  deleteEntry: (key: string) => apiClient.delete<void>(`/api/config/entries${toQuery({ key })}`),
  get: () => apiClient.get<AppSettings>("/api/config"),
  getLlm: () => apiClient.get<LlmSettings>(categoryPath("llm")),
  getOcr: () => apiClient.get<OcrSettings>(categoryPath("ocr")),
  getPlatform: () => apiClient.get<PlatformSettings>(categoryPath("platform")),
  getAssets: () => apiClient.get<AssetSettings>(categoryPath("assets")),
  getPackages: () => apiClient.get<PackageSettings>(categoryPath("packages")),
  getMarketplace: () => apiClient.get<MarketplaceSettings>(categoryPath("marketplace")),
  getRuntime: () => apiClient.get<RuntimeSettings>(categoryPath("runtime")),
  getGeneral: () => apiClient.get<GeneralSettings>(categoryPath("general")),
  getAppearance: () => apiClient.get<AppearanceSettings>(categoryPath("appearance")),
  getEditor: () => apiClient.get<EditorSettings>(categoryPath("editor")),
  getSearch: () => apiClient.get<SearchSettings>(categoryPath("search")),
  getSecurityMonitor: () => apiClient.get<SecurityMonitorSettings>(categoryPath("security-monitor")),
  getOAuth: () => apiClient.get<OAuthSettings>("/api/config/oauth"),
  getEmail: () => apiClient.get<EmailSettings>("/api/config/email"),
  getSecurity: () => apiClient.get<SecuritySettings>("/api/config/security"),
  getNetwork: () => apiClient.get<NetworkSettings>("/api/config/network"),
  getStorage: () => apiClient.get<StorageSettings>("/api/config/storage"),
  getStorageFromEnv: () => apiClient.get<StorageSettings>("/api/config/storage/from-env"),
  getAssistant: () => apiClient.get<AssistantSettings>("/api/config/assistant"),
  // Aliases for backward compatibility
  getAi: () => apiClient.get<LlmSettings>(categoryPath("llm")),
  saveAi: (llm: LlmSettings) => apiClient.put<void>(categoryPath("llm"), llm),
  saveOcr: (ocr: OcrSettings) => apiClient.put<void>(categoryPath("ocr"), ocr),
  save: (settings: AppSettings) => apiClient.put<void>("/api/config", settings),
  patch: (settings: Partial<AppSettings>) => apiClient.patch<AppSettings>("/api/config", settings),
  fetchProviderModels: (payload: FetchProviderModelsRequest) =>
    apiClient.post<ProviderModelListResponse>("/api/config/llm/providers/models/fetch", payload, {
      timeoutMs: 30000,
      suppressErrorToast: true,
    }),
  reset: () => apiClient.post<AppSettings>("/api/config/reset"),
  savePlatform: (platform: PlatformSettings) => apiClient.put<void>(categoryPath("platform"), platform),
  saveAssets: (assets: AssetSettings) => apiClient.put<void>(categoryPath("assets"), assets),
  savePackages: (packages: PackageSettings) => apiClient.put<void>(categoryPath("packages"), packages),
  saveMarketplace: (marketplace: MarketplaceSettings) => apiClient.put<void>(categoryPath("marketplace"), marketplace),
  saveRuntime: (runtime: RuntimeSettings) => apiClient.put<void>(categoryPath("runtime"), runtime),
  saveGeneral: (general: GeneralSettings) => apiClient.put<void>(categoryPath("general"), general),
  saveAppearance: (appearance: AppearanceSettings) => apiClient.put<void>(categoryPath("appearance"), appearance),
  saveEditor: (editor: EditorSettings) => apiClient.put<void>(categoryPath("editor"), editor),
  saveSearch: (search: SearchSettings) => apiClient.put<void>(categoryPath("search"), search),
  saveSecurityMonitor: (securityMonitor: SecurityMonitorSettings) =>
    apiClient.put<void>(categoryPath("security-monitor"), securityMonitor),
  saveLlm: (llm: LlmSettings) => apiClient.put<void>(categoryPath("llm"), llm),
  saveOcrSettings: (ocr: OcrSettings) => apiClient.put<void>(categoryPath("ocr"), ocr),
  saveOAuth: (oauth: OAuthSettings) => apiClient.put<void>("/api/config/oauth", oauth),
  saveEmail: (email: EmailSettings) => apiClient.put<void>("/api/config/email", email),
  saveSecurity: (security: SecuritySettings) => apiClient.put<void>("/api/config/security", security),
  saveNetwork: (network: NetworkSettings) => apiClient.put<void>("/api/config/network", network),
  saveStorage: (storage: StorageSettings) =>
    apiClient.put<void>("/api/config/storage", {
      rustfsEndpoint: storage.rustfsEndpoint,
      rustfsPublicEndpoint: storage.rustfsPublicEndpoint,
      rustfsAccessKey: storage.rustfsAccessKey,
      rustfsSecretKey: storage.rustfsSecretKey,
      rustfsBucket: storage.rustfsBucket,
    }),
  saveAssistant: (assistant: AssistantSettings) => apiClient.put<void>("/api/config/assistant", assistant),
};
