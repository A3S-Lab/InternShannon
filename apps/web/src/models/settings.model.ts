import { proxy } from "valtio";
import { waitForBackendReady } from "@/lib/backend-ready";
import { configApi } from "@/lib/config-api";
import constants from "@/lib/constants";
import { AppError } from "@/lib/error";
import { setGatewayBaseUrl } from "@/lib/http";
import { type McpServerConfig, normalizeMcpServerConfigs } from "@/lib/mcp-server-config";
import { cloneJsonCompat } from "@/lib/runtime-environment";
import { invokeDesktopOptional } from "@/lib/tauri-runtime";
import { workspaceApi } from "@/lib/workspace-api";
import { getAgentRuntimeOptional } from "@/runtime";
import {
  backendAppearanceToFrontend,
  backendEditorToFrontend,
  backendLlmSettings,
  backendNetworkToFrontend,
  backendSearchToFrontend,
  backendSecurityToFrontend,
  backendStorageToFrontend,
  frontendAppearanceToBackend,
  frontendEditorToBackend,
  frontendNetworkToBackend,
  frontendSearchToBackend,
  frontendSecurityToBackend,
  frontendStorageToBackend,
  normalizeLegacyModelRef,
  normalizeSecretForBackend,
} from "./settings-backend-mappers";
import { normalizeBackendModelConfig } from "./settings-model-config-normalization";
import {
  createRuntimeModelConfigSnapshot,
  resolveRuntimeApiKey,
  resolveRuntimeBaseUrl,
} from "./settings-runtime-model-config-state";
import { resolveMigratedDesktopWorkspaceRoot } from "./workspace-root-migration";

export { normalizeLegacyModelRef } from "./settings-backend-mappers";

// =============================================================================
// Types - Import from lib constants to avoid duplication
// =============================================================================

import type {
  ModelConfig,
  ModelCost,
  ModelLimit,
  ModelModalities,
  NetworkSettings,
  ProviderConfig,
  SearchEngineId,
  SearchEngineInfo,
  StorageSettings,
} from "@/lib/constants";
import { SEARCH_ENGINES } from "@/lib/constants";

export type {
  ModelCost,
  ModelLimit,
  ModelModalities,
  ModelConfig,
  ProviderConfig,
  NetworkSettings,
  SearchEngineId,
  SearchEngineInfo,
  StorageSettings,
};

export { SEARCH_ENGINES };

function normalizeDisplayAppName(value?: string | null): string {
  const candidate = value?.trim() || "";
  if (!candidate) return "";
  return /^(?:internShannon|shu\s*xiao\s*an|shuxiaoan|xiaoan|书小安)(?:\s*OS)?$/i.test(candidate)
    ? "书小安"
    : candidate;
}

/** Headless browser backend */
export type BrowserBackend = "chrome" | "lightpanda";

export interface SearchConfig {
  /** Enabled search engine IDs */
  enabledEngines: SearchEngineId[];
  /** Headless browser backend */
  browserBackend: BrowserBackend;
  /** Path to Chrome executable */
  chromePath: string;
  /** Path to Lightpanda executable */
  lightpandaPath: string;
  /** Proxy URL (http/socks5) */
  proxy: string;
  /** Proxy pool URLs for IP rotation */
  proxyPool: string[];
  /** Default search language */
  language: string;
  /** Safe search level */
  safesearch: "off" | "moderate" | "strict";
  /** Per-engine timeout in seconds */
  timeout: number;
  /** Maximum results per search */
  limit: number;
}

export type WordWrapSetting = "off" | "on" | "wordWrapColumn" | "bounded";
export type CursorStyle = "line" | "block" | "underline" | "line-thin" | "block-outline" | "underline-thin";
export type CursorBlinking = "blink" | "smooth" | "phase" | "expand" | "solid";
export type RenderWhitespace = "none" | "boundary" | "all" | "selection";

export interface EditorSettings {
  // Font
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
  // Indentation
  tabSize: number;
  insertSpaces: boolean;
  detectIndentation: boolean;
  indentGuides: boolean;
  // Display
  wordWrap: WordWrapSetting;
  wordWrapColumn: number;
  minimap: boolean;
  lineNumbers: "off" | "on" | "relative" | "interval";
  renderWhitespace: RenderWhitespace;
  syntaxHighlighting: boolean;
  // Cursor & Selection
  cursorStyle: CursorStyle;
  cursorBlinking: CursorBlinking;
  // Editing behavior
  formatOnPaste: boolean;
  bracketPairColorization: boolean;
  stickyScroll: boolean;
  // Context menu & CodeLens
  contextmenu: boolean;
  codeLens: boolean;
  // Monaco-specific display options
  showFoldingControls: "mouseover" | "always";
  glyphMargin: boolean;
  colorDecorators: boolean;
  renderLineHighlight: "none" | "all" | "line" | "gutter";
  matchBrackets: "never" | "near" | "always";
  // Custom keybindings: action id → combo string (e.g. "ctrl+shift+k")
  keybindings: Record<string, string>;
}

export interface SettingsState {
  /** 应用名称 */
  appName: string;
  defaultProvider: string;
  defaultModel: string;
  providers: ProviderConfig[];
  /** Gateway base URL (empty = use default) */
  baseUrl: string;
  /** Code editor preferences */
  editorSettings: EditorSettings;
  /** Global agent behavior defaults */
  agentDefaults: {
    maxTurns: number; // 0 = unlimited
    sensitiveTools: string[];
    /** Root workspace directory. agents/ and sessions/ subdirs are created automatically. */
    workspaceRoot: string;
  };
  /** System-level LLM runtime defaults applied to new agent sessions. */
  llmRuntime: {
    mcpServers: McpServerConfig[];
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
  };
  /** Appearance settings (theme, sidebar, etc.) */
  appearance: {
    theme: "light" | "dark" | "system";
    sideBarPosition: "left" | "right";
    statusBar: boolean;
    activityBar: boolean;
    zoomLevel: number;
  };
  /** Security settings */
  security: {
    allowTelemetry: boolean;
    checkUpdates: boolean;
  };
  /** Network settings */
  network: {
    proxyUrl: string;
    proxyAuth: string;
    timeout: number;
    maxRetries: number;
  };
  /** Search engine and browser settings */
  search: SearchConfig;
  /** Storage settings */
  storage: {
    storageBackend: "file";
    sessionsDir: string;
    skillDirs: string[];
    agentDirs: string[];
  };
}

// =============================================================================
// Persistence
// =============================================================================

const FIXED_GATEWAY_URL = "http://127.0.0.1:29653";

const DEFAULT_SENSITIVE_TOOLS = [
  "bash",
  "shell",
  "sh",
  "zsh",
  "edit",
  "write",
  "delete",
  "rm",
  "git",
  "network*",
  "http*",
  "curl",
  "wget",
  "mcp*",
];

const DEFAULTS: SettingsState = {
  appName: "书小安",
  defaultProvider: "",
  defaultModel: "",
  providers: [],
  baseUrl: "",
  editorSettings: {
    // Font
    fontFamily: "'Maple Mono NF CN', 'Fira Code', monospace",
    fontSize: 14,
    fontLigatures: true,
    // Indentation
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: true,
    indentGuides: false,
    // Display
    wordWrap: "off",
    wordWrapColumn: 80,
    minimap: false,
    lineNumbers: "on",
    renderWhitespace: "selection",
    syntaxHighlighting: true,
    // Cursor & Selection
    cursorStyle: "line",
    cursorBlinking: "expand",
    // Editing behavior
    formatOnPaste: false,
    bracketPairColorization: true,
    stickyScroll: false,
    // Context menu & CodeLens
    contextmenu: false,
    codeLens: true,
    // Monaco-specific display options
    showFoldingControls: "mouseover",
    glyphMargin: true,
    colorDecorators: true,
    renderLineHighlight: "all",
    matchBrackets: "always",
    // Keybindings — VS Code style
    keybindings: {
      // Formatting
      "editor.bold": "ctrl+b",
      "editor.italic": "ctrl+i",
      "editor.underline": "ctrl+u",
      "editor.strikethrough": "ctrl+shift+s",
      "editor.code": "ctrl+e",
      "editor.heading": "ctrl+shift+h",
      "editor.bulletList": "ctrl+shift+8",
      "editor.orderedList": "ctrl+shift+7",
      "editor.blockquote": "ctrl+shift+9",
      "editor.codeBlock": "ctrl+shift+`",
      // Edit
      "editor.duplicateLine": "ctrl+d",
      "editor.deleteLine": "ctrl+y",
      "editor.moveLineUp": "alt+shift+up",
      "editor.moveLineDown": "alt+shift+down",
      "editor.copyLineUp": "ctrl+alt+shift+up",
      "editor.copyLineDown": "ctrl+alt+shift+down",
      "editor.indentLine": "tab",
      "editor.outdentLine": "shift+tab",
      "editor.toUpperCase": "ctrl+shift+u",
      "editor.toLowerCase": "",
      "editor.trimWhitespace": "",
      // Select
      "editor.selectNextMatch": "alt+j",
      "editor.selectAllMatches": "ctrl+alt+shift+j",
      // Comment
      "editor.toggleComment": "ctrl+/",
      "editor.blockComment": "ctrl+shift+/",
      // Format
      "editor.formatDocument": "ctrl+alt+l",
      // Find
      "editor.find": "ctrl+f",
      "editor.replace": "ctrl+r",
      // Navigate
      "editor.gotoLine": "ctrl+g",
      "editor.gotoDefinition": "f12",
      "editor.rename": "shift+f6",
      // Fold
      "editor.foldRegion": "ctrl+shift+[",
      "editor.unfoldRegion": "ctrl+shift+]",
      "editor.foldAll": "ctrl+shift+numpadsubtract",
      "editor.unfoldAll": "ctrl+shift+numpadadd",
      // Common
      "editor.save": "ctrl+s",
      "editor.undo": "ctrl+z",
      "editor.redo": "ctrl+shift+z",
      // Markdown
      "editor.toggleSourceMode": "ctrl+shift+m",
    },
  },
  agentDefaults: {
    maxTurns: 0,
    sensitiveTools: DEFAULT_SENSITIVE_TOOLS,
    workspaceRoot: "",
  },
  llmRuntime: {
    mcpServers: [],
    maxToolRounds: undefined,
    thinkingBudget: undefined,
    toolTimeoutMs: undefined,
    queueTimeoutMs: undefined,
    maxExecutionTimeMs: undefined,
    streamStallWarningMs: undefined,
    streamStallHardMs: undefined,
    streamStallActiveToolHardMs: undefined,
    maxConsecutiveToolErrors: undefined,
    maxStreamRetries: undefined,
  },
  appearance: {
    theme: "system",
    sideBarPosition: "left",
    statusBar: true,
    activityBar: true,
    zoomLevel: 1,
  },
  security: {
    allowTelemetry: true,
    checkUpdates: true,
  },
  network: {
    proxyUrl: "",
    proxyAuth: "",
    timeout: 30000,
    maxRetries: 3,
  },
  search: {
    enabledEngines: ["ddg", "brave", "bing"],
    browserBackend: "lightpanda",
    chromePath: "",
    lightpandaPath: "",
    proxy: "",
    proxyPool: [],
    language: "zh-CN",
    safesearch: "moderate",
    timeout: 30,
    limit: 10,
  },
  storage: {
    storageBackend: "file",
    sessionsDir: "",
    skillDirs: [],
    agentDirs: [],
  },
};

function loadSettings(): SettingsState {
  // 所有配置从后端加载，不再使用 localStorage
  return DEFAULTS;
}

const state = proxy<SettingsState>(loadSettings());
let runtimeGatewayUrl = constants.gatewayUrl || "";
let gatewayUrlHydrated = false;
let runtimeProviders: ProviderConfig[] = [];
let runtimeDefaultProvider = "";
let runtimeDefaultModel = "";
const SEED_CONFIG_FETCH_TIMEOUT_MS = 4000;
const WORKSPACE_DEFAULT_FETCH_TIMEOUT_MS = 2000;

type EmbeddedGatewayStatusSnapshot = {
  configuredUrl: string;
  host: string;
  port: number;
  started: boolean;
  lastError?: string | null;
  lastErrorStage?: string | null;
  lastErrorCode?: string | null;
  diagnosticReportPath?: string | null;
  portInUse: boolean;
  portOwnerPid?: number | null;
  portOwnerName?: string | null;
};

type LogWorkspaceStatusSnapshot = {
  workspaceRoot?: string | null;
  logDirectory?: string | null;
  activeLogFile?: string | null;
};

async function hydrateGatewayUrlFromRuntime(): Promise<void> {
  if (gatewayUrlHydrated) return;
  gatewayUrlHydrated = true;
  try {
    const url = await invokeDesktopOptional<string>("get_gateway_url");
    if (typeof url === "string" && url.trim()) {
      runtimeGatewayUrl = url.trim().replace(/\/+$/, "");
      setGatewayBaseUrl(runtimeGatewayUrl);
    }
  } catch {
    // Non-Tauri environments fall back to configured/default values.
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

// Seed lifecycle: backend is source of truth.
let _seedResolved = false;
let _seedResolve: () => void;
const _seedPromise = new Promise<void>((r) => {
  _seedResolve = r;
});

function resolveSeedOnce() {
  if (_seedResolved) return;
  _seedResolved = true;
  _seedResolve();
}

function extractDiagnosticReportPath(error: unknown): string | null {
  if (!(error instanceof AppError)) return null;
  // Unified contract carries extra context under `details` (was the legacy
  // ApiError.payload top-level body before the AppError consolidation).
  const details =
    error.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : null;
  const reportPath = details?.diagnostic_report;
  return typeof reportPath === "string" && reportPath.trim() ? reportPath.trim() : null;
}

async function captureConfigSyncDiagnostic(syncError: Error): Promise<string | null> {
  try {
    const [embeddedGateway, logWorkspace] = await Promise.all([
      invokeDesktopOptional<EmbeddedGatewayStatusSnapshot>("get_embedded_gateway_status").catch(() => null),
      invokeDesktopOptional<LogWorkspaceStatusSnapshot>("get_log_workspace_status").catch(() => null),
    ]);

    return await invokeDesktopOptional<string>("write_client_diagnostic_report", {
      payload: {
        kind: "agent-config-sync-failed",
        summary: "Saving AI model configuration from the desktop UI failed before a successful backend confirmation.",
        error: syncError.message,
        gatewayUrl: getGatewayUrl(),
        gatewayCandidates: getGatewayUrls(),
        defaultProvider: state.defaultProvider || undefined,
        defaultModel: state.defaultModel || undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        embeddedGateway: embeddedGateway ?? undefined,
        logWorkspace: logWorkspace ?? undefined,
      },
    });
  } catch (diagnosticError) {
    console.warn("Failed to capture automatic diagnostic report:", diagnosticError);
    return null;
  }
}

function toPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Wait until seedFromBackend has finished (resolves immediately if already done) */
function waitForSeed(): Promise<void> {
  return _seedPromise;
}

function getRuntimeProviders(): ProviderConfig[] {
  return runtimeProviders.length > 0 ? runtimeProviders : state.providers;
}

function getRuntimeDefaultProvider(): string {
  return runtimeDefaultProvider || state.defaultProvider;
}

function getRuntimeDefaultModel(): string {
  return runtimeDefaultModel || state.defaultModel;
}

function applyBackendModelConfig(cfg: { providers?: unknown; defaultModel?: unknown; default_model?: unknown }) {
  const { providers, defaultProvider, defaultModel } = normalizeBackendModelConfig(cfg);
  state.providers = providers;
  state.defaultProvider = defaultProvider;
  state.defaultModel = defaultModel;
  refreshRuntimeModelConfigCache();
}

function refreshRuntimeModelConfigCache() {
  const snapshot = createRuntimeModelConfigSnapshot({
    providers: state.providers,
    defaultProvider: state.defaultProvider,
    defaultModel: state.defaultModel,
  });
  runtimeProviders = snapshot.providers;
  runtimeDefaultProvider = snapshot.defaultProvider;
  runtimeDefaultModel = snapshot.defaultModel;
}

async function migrateLegacyDesktopWorkspaceRootFromDefault(): Promise<void> {
  const currentRoot = state.agentDefaults.workspaceRoot;
  if (!currentRoot.trim()) return;

  try {
    const defaultRoot = await withTimeout(
      workspaceApi.getDefaultRoot(),
      WORKSPACE_DEFAULT_FETCH_TIMEOUT_MS,
      "Loading default workspace root timed out",
    );
    const migratedRoot = resolveMigratedDesktopWorkspaceRoot(currentRoot, defaultRoot);
    if (migratedRoot !== currentRoot) {
      state.agentDefaults.workspaceRoot = migratedRoot;
      console.info("[settings] Migrated legacy desktop workspace root to current default:", migratedRoot);
    }
  } catch (error) {
    console.warn("[settings] Failed to check desktop workspace root migration:", error);
  }
}

// =============================================================================
// Actions
// =============================================================================

function setDefault(provider: string, model: string) {
  state.defaultProvider = provider;
  state.defaultModel = model;
}

function setBaseUrl(url: string) {
  void url;
  state.baseUrl = "";
}

function addProvider(provider: ProviderConfig) {
  state.providers.push(provider);
}

function updateProvider(name: string, patch: Partial<Omit<ProviderConfig, "name">>) {
  const p = state.providers.find((p) => p.name === name);
  if (p) Object.assign(p, patch);
}

function removeProvider(name: string) {
  const idx = state.providers.findIndex((p) => p.name === name);
  if (idx >= 0) state.providers.splice(idx, 1);
  // Reset default if removed
  if (state.defaultProvider === name) {
    const first = state.providers[0];
    state.defaultProvider = first?.name || "";
    state.defaultModel = first?.models[0]?.id || "";
  }
}

function addModel(providerName: string, model: ModelConfig) {
  const p = state.providers.find((p) => p.name === providerName);
  if (p) p.models.push(model);
}

function updateModel(providerName: string, modelId: string, patch: Partial<ModelConfig>) {
  const p = state.providers.find((p) => p.name === providerName);
  if (!p) return;
  const m = p.models.find((m) => m.id === modelId);
  if (!m) return;
  const nextId = patch.id?.trim() || modelId;
  if (nextId !== modelId && p.models.some((item) => item.id === nextId)) {
    return;
  }
  Object.assign(m, { ...patch, id: nextId });
  if (state.defaultProvider === providerName && state.defaultModel === modelId) {
    state.defaultModel = nextId;
  }
}

function removeModel(providerName: string, modelId: string) {
  const p = state.providers.find((p) => p.name === providerName);
  if (!p) return;
  const idx = p.models.findIndex((m) => m.id === modelId);
  if (idx >= 0) p.models.splice(idx, 1);
  // Reset default if removed
  if (state.defaultProvider === providerName && state.defaultModel === modelId) {
    state.defaultModel = p.models[0]?.id || "";
  }
}

function resetSettings() {
  Object.assign(state, cloneJsonCompat(DEFAULTS));
}

function setAgentDefaults(patch: Partial<SettingsState["agentDefaults"]>) {
  Object.assign(state.agentDefaults, patch);
}

function setEditorSettings(patch: Partial<EditorSettings>) {
  Object.assign(state.editorSettings, patch);
}

function setSearchConfig(patch: Partial<SearchConfig>) {
  Object.assign(state.search, patch);
}

/**
 * Seed settings from the backend config on startup.
 * Backend is the source of truth — always loads from backend.
 * Falls back to defaults if backend is unavailable.
 *
 * Uses ConfigModule /api/config/* endpoints for AI settings, with agent-api
 * as fallback for knowledge bases (not in ConfigModule).
 */
async function seedFromBackend(options?: { retries?: number; retryDelayMs?: number }): Promise<boolean> {
  const retries = options?.retries ?? 0;
  const retryDelayMs = options?.retryDelayMs ?? 400;

  try {
    await hydrateGatewayUrlFromRuntime();
    await waitForBackendReady({
      timeoutMs: Math.max(retries, 1) * retryDelayMs + SEED_CONFIG_FETCH_TIMEOUT_MS,
    });

    // Load all settings from ConfigModule
    try {
      const appSettings = await withTimeout(
        configApi.getSettings(),
        SEED_CONFIG_FETCH_TIMEOUT_MS,
        "Loading settings from backend timed out",
      );

      // Apply LLM settings (llm is the current backend schema; ai is legacy desktop config).
      const llmSettings = backendLlmSettings(appSettings);
      if (llmSettings) {
        applyBackendModelConfig({
          providers: llmSettings.providers ?? [],
          defaultModel: llmSettings.defaultModel,
        });
        state.llmRuntime.mcpServers = normalizeMcpServerConfigs(llmSettings.mcpServers);
        state.llmRuntime.maxToolRounds =
          typeof llmSettings.maxToolRounds === "number" ? llmSettings.maxToolRounds : undefined;
        state.llmRuntime.thinkingBudget =
          typeof llmSettings.thinkingBudget === "number" ? llmSettings.thinkingBudget : undefined;
        state.llmRuntime.toolTimeoutMs =
          typeof llmSettings.toolTimeoutMs === "number" ? llmSettings.toolTimeoutMs : undefined;
        state.llmRuntime.queueTimeoutMs =
          typeof llmSettings.queueTimeoutMs === "number" ? llmSettings.queueTimeoutMs : undefined;
        state.llmRuntime.maxExecutionTimeMs =
          typeof llmSettings.maxExecutionTimeMs === "number" ? llmSettings.maxExecutionTimeMs : undefined;
        state.llmRuntime.streamStallWarningMs =
          typeof llmSettings.streamStallWarningMs === "number" ? llmSettings.streamStallWarningMs : undefined;
        state.llmRuntime.streamStallHardMs =
          typeof llmSettings.streamStallHardMs === "number" ? llmSettings.streamStallHardMs : undefined;
        state.llmRuntime.streamStallActiveToolHardMs =
          typeof llmSettings.streamStallActiveToolHardMs === "number"
            ? llmSettings.streamStallActiveToolHardMs
            : undefined;
        state.llmRuntime.maxConsecutiveToolErrors =
          typeof llmSettings.maxConsecutiveToolErrors === "number" ? llmSettings.maxConsecutiveToolErrors : undefined;
        state.llmRuntime.maxStreamRetries =
          typeof llmSettings.maxStreamRetries === "number" ? llmSettings.maxStreamRetries : undefined;
      }

      // Apply editor settings
      if (appSettings.editor) {
        Object.assign(state.editorSettings, backendEditorToFrontend(appSettings.editor));
      }

      // Apply general settings (workspacePath, appName)
      if (appSettings.general) {
        if (appSettings.general.appName) {
          state.appName = normalizeDisplayAppName(appSettings.general.appName);
        }
        if (appSettings.general.workspacePath) {
          state.agentDefaults.workspaceRoot = appSettings.general.workspacePath;
        }
      }

      // Apply appearance settings
      if (appSettings.appearance) {
        Object.assign(state.appearance, backendAppearanceToFrontend(appSettings.appearance));
      }

      // Apply security settings
      if (appSettings.security) {
        Object.assign(state.security, backendSecurityToFrontend(appSettings.security));
      }

      // Apply network settings
      if (appSettings.network) {
        Object.assign(state.network, backendNetworkToFrontend(appSettings.network));
      }

      // Apply search settings
      if (appSettings.search) {
        Object.assign(state.search, backendSearchToFrontend(appSettings.search, DEFAULTS.search));
      }

      // Apply storage settings
      if (appSettings.storage) {
        Object.assign(state.storage, backendStorageToFrontend(appSettings.storage));
      }

      await migrateLegacyDesktopWorkspaceRootFromDefault();
    } catch (e) {
      console.warn("Failed to load settings from ConfigModule, using defaults:", e);
    }

    return true;
  } catch {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      return seedFromBackend({
        retries: retries - 1,
        retryDelayMs,
      });
    }
    // Backend unavailable — keep default values
    return false;
  } finally {
    resolveSeedOnce();
  }
}

/**
 * Sync current settings to the backend ConfigModule.
 * Called when the user saves settings in the UI.
 */
async function syncToBackend(): Promise<void> {
  try {
    // Sync all settings to ConfigModule
    await configApi.patchSettings({
      editor: frontendEditorToBackend(state.editorSettings),
      general: {
        appName: state.appName,
        language: "zh-CN",
        splashScreen: true,
        restoreWorkspace: true,
        workspacePath: state.agentDefaults.workspaceRoot,
      },
      llm: {
        defaultModel: `${state.defaultProvider}/${state.defaultModel}`,
        providers: state.providers.map((p) => ({
          name: p.name,
          apiKey: p.apiKey || undefined,
          baseUrl: p.baseUrl || undefined,
          headers: {},
          sessionIdHeader: undefined,
          models: p.models.map((m) => ({
            id: m.id,
            name: m.name,
            family: m.family || undefined,
            apiKey: m.apiKey || undefined,
            baseUrl: m.baseUrl || undefined,
            attachment: m.attachment ?? false,
            reasoning: m.reasoning ?? false,
            toolCall: m.toolCall ?? true,
            temperature: m.temperature ?? true,
            releaseDate: m.releaseDate || undefined,
            modalities: m.modalities || { input: ["text"], output: ["text"] },
            cost: m.cost || {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            limit: m.limit || { context: 128000, output: 4096 },
          })),
        })),
        mcpServers: toPlainJson(state.llmRuntime.mcpServers),
        maxToolRounds: state.llmRuntime.maxToolRounds,
        thinkingBudget: state.llmRuntime.thinkingBudget,
        toolTimeoutMs: state.llmRuntime.toolTimeoutMs,
        queueTimeoutMs: state.llmRuntime.queueTimeoutMs,
        maxExecutionTimeMs: state.llmRuntime.maxExecutionTimeMs,
        streamStallWarningMs: state.llmRuntime.streamStallWarningMs,
        streamStallHardMs: state.llmRuntime.streamStallHardMs,
        streamStallActiveToolHardMs: state.llmRuntime.streamStallActiveToolHardMs,
        maxConsecutiveToolErrors: state.llmRuntime.maxConsecutiveToolErrors,
        maxStreamRetries: state.llmRuntime.maxStreamRetries,
      },
      appearance: frontendAppearanceToBackend(state.appearance),
      security: frontendSecurityToBackend(state.security),
      network: frontendNetworkToBackend(state.network),
      search: frontendSearchToBackend(state.search),
      storage: frontendStorageToBackend(state.storage),
    });
    refreshRuntimeModelConfigCache();
  } catch (error) {
    const syncError = error instanceof Error ? error : new Error("配置未同步到后端");
    const reportPath = extractDiagnosticReportPath(error) || (await captureConfigSyncDiagnostic(syncError));
    if (reportPath) {
      console.warn("Automatic diagnostic report:", reportPath);
    }
    console.warn("Failed to sync AI settings to backend:", syncError);
    throw syncError;
  }
}

async function rebuildModelConfigCache(): Promise<void> {
  runtimeProviders = [];
  runtimeDefaultProvider = "";
  runtimeDefaultModel = "";
  await syncToBackend();
}

// =============================================================================
// Helpers
// =============================================================================

/** Resolve the effective API key for a model (model-level > provider-level) */
export function resolveApiKey(providerName: string, modelId: string): string {
  return normalizeSecretForBackend(resolveRuntimeApiKey({ providers: getRuntimeProviders() }, providerName, modelId)) || "";
}

/** Resolve the effective base URL for a model (model-level > provider-level) */
export function resolveBaseUrl(providerName: string, modelId: string): string {
  return resolveRuntimeBaseUrl({ providers: getRuntimeProviders() }, providerName, modelId);
}

export function getGatewayUrl(): string {
  const runtimeGatewayUrlFromContext = getAgentRuntimeOptional()?.gatewayUrl?.trim().replace(/\/+$/, "");
  return (
    runtimeGatewayUrlFromContext ||
    browserSameOriginGatewayUrl() ||
    runtimeGatewayUrl ||
    constants.gatewayUrl ||
    FIXED_GATEWAY_URL
  );
}

export function getGatewayUrls(): string[] {
  const runtimeGatewayUrlFromContext = getAgentRuntimeOptional()?.gatewayUrl?.trim().replace(/\/+$/, "");
  if (runtimeGatewayUrlFromContext) {
    return [runtimeGatewayUrlFromContext];
  }

  return Array.from(
    new Set(
      [browserSameOriginGatewayUrl(), runtimeGatewayUrl, constants.gatewayUrl, FIXED_GATEWAY_URL]
        .map((item) => item?.trim().replace(/\/+$/, ""))
        .filter(Boolean) as string[],
    ),
  );
}

function browserSameOriginGatewayUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (getAgentRuntimeOptional()?.isDesktop) return undefined;
  return window.location.origin.replace(/\/+$/, "");
}

export function getPreferredSessionModel(): {
  providerName: string;
  modelId: string;
} {
  const providers = getRuntimeProviders();
  const defaultProvider = getRuntimeDefaultProvider();
  const defaultModel = getRuntimeDefaultModel();
  const currentProvider = providers.find((p) => p.name === defaultProvider && p.models.length > 0);
  const currentModelId =
    currentProvider?.models.find((m) => m.id === defaultModel)?.id || currentProvider?.models[0]?.id || "";

  if (currentProvider && currentProvider.name !== "") {
    const hasCreds = !!currentProvider.apiKey || currentProvider.models.some((m) => !!m.apiKey);
    if (hasCreds) {
      return {
        providerName: currentProvider.name,
        modelId: currentModelId,
      };
    }
  }

  const nonLocal = providers.filter((p) => p.name !== "" && p.models.length > 0);
  const withCreds = nonLocal.find((p) => !!p.apiKey || p.models.some((m) => !!m.apiKey));
  if (withCreds) {
    return {
      providerName: withCreds.name,
      modelId: withCreds.models[0].id,
    };
  }

  if (nonLocal.length > 0) {
    // currentProvider is  and no non-local provider has credentials.
    // Stay on  so the user's explicit default is respected.
    // (If  is unavailable the user should configure a remote provider.)
    if (currentProvider) {
      return { providerName: currentProvider.name, modelId: currentModelId };
    }
    return {
      providerName: nonLocal[0].name,
      modelId: nonLocal[0].models[0].id,
    };
  }

  if (currentProvider) {
    return {
      providerName: currentProvider.name,
      modelId: currentModelId,
    };
  }

  const fallback = providers.find((p) => p.models.length > 0);
  return {
    providerName: fallback?.name || "",
    modelId: fallback?.models[0]?.id || "",
  };
}

export function getSystemSessionDefaults(): {
  mcpServers?: McpServerConfig[];
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
  searchConfig?: SearchConfig;
} {
  const defaults: {
    mcpServers?: McpServerConfig[];
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
    searchConfig?: SearchConfig;
  } = {};

  if (state.llmRuntime.mcpServers.length > 0) {
    defaults.mcpServers = toPlainJson(state.llmRuntime.mcpServers);
  }
  if (typeof state.llmRuntime.maxToolRounds === "number") {
    defaults.maxToolRounds = state.llmRuntime.maxToolRounds;
  }
  if (typeof state.llmRuntime.thinkingBudget === "number") {
    defaults.thinkingBudget = state.llmRuntime.thinkingBudget;
  }
  if (typeof state.llmRuntime.toolTimeoutMs === "number") {
    defaults.toolTimeoutMs = state.llmRuntime.toolTimeoutMs;
  }
  if (typeof state.llmRuntime.queueTimeoutMs === "number") {
    defaults.queueTimeoutMs = state.llmRuntime.queueTimeoutMs;
  }
  if (typeof state.llmRuntime.maxExecutionTimeMs === "number") {
    defaults.maxExecutionTimeMs = state.llmRuntime.maxExecutionTimeMs;
  }
  if (typeof state.llmRuntime.streamStallWarningMs === "number") {
    defaults.streamStallWarningMs = state.llmRuntime.streamStallWarningMs;
  }
  if (typeof state.llmRuntime.streamStallHardMs === "number") {
    defaults.streamStallHardMs = state.llmRuntime.streamStallHardMs;
  }
  if (typeof state.llmRuntime.streamStallActiveToolHardMs === "number") {
    defaults.streamStallActiveToolHardMs = state.llmRuntime.streamStallActiveToolHardMs;
  }
  if (typeof state.llmRuntime.maxConsecutiveToolErrors === "number") {
    defaults.maxConsecutiveToolErrors = state.llmRuntime.maxConsecutiveToolErrors;
  }
  if (typeof state.llmRuntime.maxStreamRetries === "number") {
    defaults.maxStreamRetries = state.llmRuntime.maxStreamRetries;
  }
  defaults.searchConfig = toPlainJson(state.search) as SearchConfig;

  return defaults;
}

function getConfiguredSessionModel(sessionModel?: string): {
  providerName: string;
  modelId: string;
} | null {
  const rawModel = normalizeLegacyModelRef(sessionModel);
  if (!rawModel) return null;

  const preferred = getPreferredSessionModel();

  if (rawModel.includes("/")) {
    const [providerName, modelId] = rawModel.split("/", 2);
    const provider = getRuntimeProviders().find((p) => p.name === providerName);
    if (!provider?.models.some((model) => model.id === modelId)) {
      return null;
    }
    return { providerName, modelId };
  }

  const matchedProviders = getRuntimeProviders().filter((provider) =>
    provider.models.some((model) => model.id === rawModel),
  );
  if (matchedProviders.length !== 1) return null;

  // Bare model IDs are legacy session state. They were often written from the
  // then-current default model, so treating them as permanently pinned causes
  // old sessions to stay stuck on stale defaults such as Kimi after the backend
  // default has changed to MiniMax/GLM. Only keep respecting the bare ID when
  // it still matches the current preferred default; otherwise fall back to the
  // current backend-default routing.
  if (preferred.modelId && rawModel !== preferred.modelId) {
    return null;
  }

  return {
    providerName: matchedProviders[0].name,
    modelId: rawModel,
  };
}

export function getSessionRoutingModel(
  sessionModel?: string,
  followDefaultModel?: boolean,
): {
  providerName: string;
  modelId: string;
} {
  if (followDefaultModel) {
    return getPreferredSessionModel();
  }
  const configuredSessionModel = getConfiguredSessionModel(sessionModel);
  if (configuredSessionModel) {
    return configuredSessionModel;
  }
  return getPreferredSessionModel();
}

/** Get all models across all providers as flat list */
export function getAllModels(): { provider: string; model: ModelConfig }[] {
  return getRuntimeProviders().flatMap((p) => p.models.map((m) => ({ provider: p.name, model: m })));
}

export default {
  state,
  setDefault,
  setBaseUrl,
  addProvider,
  updateProvider,
  removeProvider,
  addModel,
  updateModel,
  removeModel,
  resetSettings,
  setAgentDefaults,
  setEditorSettings,
  setSearchConfig,
  seedFromBackend,
  hydrateGatewayUrlFromRuntime,
  syncToBackend,
  rebuildModelConfigCache,
  waitForSeed,
  getPreferredSessionModel,
  getSystemSessionDefaults,
  getSessionRoutingModel,
};
