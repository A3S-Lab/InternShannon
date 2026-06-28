import type {
  AiSettings as BackendAiSettings,
  EditorSettings as BackendEditorSettings,
  SearchSettings as BackendSearchSettings,
} from "@/types/config";
import type { NetworkSettings, SearchEngineId, StorageSettings } from "@/lib/constants";
import type { SearchConfig, SettingsState } from "./settings.model";

const LEGACY_GLM_PROVIDER = "glm";
const ZHIPU_PROVIDER = "zhipu";
const REDACTED_SECRET_PLACEHOLDER = "[configured]";
const DEFAULT_EDITOR_FONT_FAMILY = "'Maple Mono NF CN', 'Fira Code', monospace";
const SEARCH_ENGINE_IDS = ["ddg", "brave", "bing", "wiki", "sogou", "360", "google", "baidu", "bingchina"] as const;
const SEARCH_ENGINE_ID_SET = new Set<string>(SEARCH_ENGINE_IDS);

export function normalizeLegacyModelRef(rawModel?: string | unknown): string {
  if (!rawModel || typeof rawModel !== "string") return "";
  const trimmed = rawModel.trim();
  if (!trimmed) return "";
  if (!trimmed.includes("/")) return trimmed;
  const [providerName, modelId] = trimmed.split("/", 2);
  if (providerName === LEGACY_GLM_PROVIDER && modelId) {
    return `${ZHIPU_PROVIDER}/${modelId}`;
  }
  return trimmed;
}

function isRedactedSecretPlaceholder(value?: string | null): boolean {
  return value?.trim() === REDACTED_SECRET_PLACEHOLDER;
}

export function normalizeSecretForBackend(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || isRedactedSecretPlaceholder(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function backendLlmSettings(appSettings: {
  llm?: BackendAiSettings;
  ai?: BackendAiSettings;
}): BackendAiSettings | undefined {
  return appSettings.llm ?? appSettings.ai;
}

export function frontendEditorToBackend(fe: SettingsState["editorSettings"]): BackendEditorSettings {
  return {
    tabSize: fe.tabSize,
    wordWrap: fe.wordWrap === "on" || fe.wordWrap === "wordWrapColumn" || fe.wordWrap === "bounded",
    lineNumbers: fe.lineNumbers,
    indentGuides: false,
    fontSize: fe.fontSize,
    fontFamily: fe.fontFamily,
    cursorStyle: fe.cursorStyle,
    syntaxHighlighting: true,
    fontLigatures: fe.fontLigatures,
    insertSpaces: fe.insertSpaces,
    detectIndentation: fe.detectIndentation,
    wordWrapColumn: fe.wordWrapColumn,
    minimap: fe.minimap,
    renderWhitespace: fe.renderWhitespace,
    cursorBlinking: fe.cursorBlinking,
    formatOnPaste: fe.formatOnPaste,
    bracketPairColorization: fe.bracketPairColorization,
    stickyScroll: fe.stickyScroll,
    contextmenu: fe.contextmenu,
    codeLens: fe.codeLens,
    showFoldingControls: fe.showFoldingControls,
    glyphMargin: fe.glyphMargin,
    colorDecorators: fe.colorDecorators,
    renderLineHighlight: fe.renderLineHighlight,
    matchBrackets: fe.matchBrackets,
    keybindings: fe.keybindings,
  };
}

export function backendEditorToFrontend(be: Partial<BackendEditorSettings> | unknown): SettingsState["editorSettings"] {
  const record = isRecord(be) ? be : {};
  return {
    tabSize: normalizeNumber(record.tabSize, 2),
    wordWrap: normalizeBoolean(record.wordWrap, false) ? "on" : "off",
    lineNumbers: normalizeEnum(record.lineNumbers, ["off", "on", "relative", "interval"], "on"),
    indentGuides: normalizeBoolean(record.indentGuides, false),
    fontSize: normalizeNumber(record.fontSize, 14),
    fontFamily: normalizeString(record.fontFamily, DEFAULT_EDITOR_FONT_FAMILY),
    cursorStyle: normalizeEnum(
      record.cursorStyle,
      ["line", "block", "underline", "line-thin", "block-outline", "underline-thin"],
      "line",
    ),
    syntaxHighlighting: normalizeBoolean(record.syntaxHighlighting, true),
    fontLigatures: normalizeBoolean(record.fontLigatures, true),
    insertSpaces: normalizeBoolean(record.insertSpaces, true),
    detectIndentation: normalizeBoolean(record.detectIndentation, true),
    wordWrapColumn: normalizeNumber(record.wordWrapColumn, 80),
    minimap: normalizeBoolean(record.minimap, false),
    renderWhitespace: normalizeEnum(record.renderWhitespace, ["none", "boundary", "all", "selection"], "selection"),
    cursorBlinking: normalizeEnum(record.cursorBlinking, ["blink", "smooth", "phase", "expand", "solid"], "blink"),
    formatOnPaste: normalizeBoolean(record.formatOnPaste, false),
    bracketPairColorization: normalizeBoolean(record.bracketPairColorization, true),
    stickyScroll: normalizeBoolean(record.stickyScroll, false),
    contextmenu: normalizeBoolean(record.contextmenu, true),
    codeLens: normalizeBoolean(record.codeLens, true),
    showFoldingControls: normalizeEnum(record.showFoldingControls, ["mouseover", "always"], "mouseover"),
    glyphMargin: normalizeBoolean(record.glyphMargin, true),
    colorDecorators: normalizeBoolean(record.colorDecorators, true),
    renderLineHighlight: normalizeEnum(record.renderLineHighlight, ["none", "all", "line", "gutter"], "all"),
    matchBrackets: normalizeEnum(record.matchBrackets, ["never", "near", "always"], "always"),
    keybindings: normalizeKeybindings(record.keybindings),
  };
}

export function frontendAppearanceToBackend(fe: SettingsState["appearance"]) {
  return {
    theme: fe.theme,
    sideBarPosition: fe.sideBarPosition,
    statusBar: fe.statusBar,
    activityBar: fe.activityBar,
    zoomLevel: fe.zoomLevel,
  };
}

export function backendAppearanceToFrontend(be: {
  theme?: string;
  sideBarPosition?: string;
  statusBar?: boolean;
  activityBar?: boolean;
  zoomLevel?: number;
} | unknown): SettingsState["appearance"] {
  const record = isRecord(be) ? be : {};
  return {
    theme: normalizeEnum(record.theme, ["light", "dark", "system"], "system"),
    sideBarPosition: normalizeEnum(record.sideBarPosition, ["left", "right"], "left"),
    statusBar: normalizeBoolean(record.statusBar, true),
    activityBar: normalizeBoolean(record.activityBar, true),
    zoomLevel: normalizeNumber(record.zoomLevel, 1),
  };
}

export function frontendSecurityToBackend(fe: SettingsState["security"]) {
  return {
    allowTelemetry: fe.allowTelemetry,
    checkUpdates: fe.checkUpdates,
  };
}

export function backendSecurityToFrontend(be: {
  allowTelemetry?: boolean;
  checkUpdates?: boolean;
} | unknown): SettingsState["security"] {
  const record = isRecord(be) ? be : {};
  return {
    allowTelemetry: normalizeBoolean(record.allowTelemetry, true),
    checkUpdates: normalizeBoolean(record.checkUpdates, true),
  };
}

export function frontendNetworkToBackend(fe: SettingsState["network"]) {
  return {
    upstreamProxyUrl: fe.proxyUrl || undefined,
    proxyPool: [],
    connectionTimeout: fe.timeout,
    readTimeout: fe.timeout,
  };
}

export function backendNetworkToFrontend(be: Partial<NetworkSettings> | unknown): SettingsState["network"] {
  const record = isRecord(be) ? be : {};
  return {
    proxyUrl: normalizeString(record.upstreamProxyUrl, ""),
    proxyAuth: "",
    timeout: normalizeNumber(record.connectionTimeout, 30000),
    maxRetries: 3,
  };
}

function isSearchEngineId(value: string): value is SearchEngineId {
  return SEARCH_ENGINE_ID_SET.has(value);
}

export function frontendSearchToBackend(fe: SettingsState["search"]): BackendSearchSettings {
  // Cloud search settings deliberately surface only the engine + language
  // controls. Two families are managed at the deployment layer instead:
  //   - browser binary path → SDK env (LIGHTPANDA / CHROME) + initContainer
  //   - HTTP/SOCKS proxy    → standard HTTPS_PROXY/HTTP_PROXY env on the API
  // Desktop persists those locally via its own settings flow.
  return {
    enabledEngines: fe.enabledEngines.filter(isSearchEngineId),
    language: fe.language,
    safesearch: fe.safesearch,
    timeout: fe.timeout,
    limit: fe.limit,
  };
}

export function backendSearchToFrontend(
  be: Partial<BackendSearchSettings> | unknown,
  fallback: SearchConfig,
): SearchConfig {
  const record = isRecord(be) ? be : {};
  const enabledEngines = normalizeSearchEngineIds(record.enabledEngines);

  return {
    enabledEngines: enabledEngines.length > 0 ? enabledEngines : [...fallback.enabledEngines],
    browserBackend: fallback.browserBackend,
    chromePath: fallback.chromePath,
    lightpandaPath: fallback.lightpandaPath,
    proxy: fallback.proxy,
    proxyPool: fallback.proxyPool,
    language: normalizeString(record.language, fallback.language),
    safesearch:
      record.safesearch === "off" || record.safesearch === "moderate" || record.safesearch === "strict"
        ? record.safesearch
        : fallback.safesearch,
    timeout: normalizeNumber(record.timeout, fallback.timeout),
    limit: normalizeNumber(record.limit, fallback.limit),
  };
}

export function frontendStorageToBackend(fe: SettingsState["storage"]) {
  return {
    defaultProvider: "local" as const,
    localStoragePath: fe.sessionsDir || undefined,
  };
}

export function backendStorageToFrontend(be: Partial<StorageSettings> | unknown): SettingsState["storage"] {
  const record = isRecord(be) ? be : {};
  return {
    storageBackend: "file",
    sessionsDir: normalizeString(record.localStoragePath, ""),
    skillDirs: [],
    agentDirs: [],
  };
}

function normalizeSearchEngineIds(value: unknown): SearchEngineId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<SearchEngineId>();
  const ids: SearchEngineId[] = [];
  for (const item of value) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || !isSearchEngineId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeKeybindings(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const keybindings: Record<string, string> = {};
  for (const [actionId, combo] of Object.entries(value)) {
    const id = actionId.trim();
    if (!id || typeof combo !== "string") continue;
    keybindings[id] = combo.trim();
  }
  return keybindings;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return fallback;
}

function normalizeEnum<const T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
