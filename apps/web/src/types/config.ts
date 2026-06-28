import type {
  AiSettings,
  AppearanceSettings,
  GeneralSettings,
  ModelConfig,
  NetworkSettings,
  ProviderConfig,
  SearchEngineId,
  StorageSettings,
} from "@/lib/constants";

export type {
  AiSettings,
  AppearanceSettings,
  GeneralSettings,
  ModelConfig,
  NetworkSettings,
  ProviderConfig,
  SearchEngineId,
  StorageSettings,
};

export interface EditorSettings {
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: "off" | "on" | "relative" | "interval";
  indentGuides: boolean;
  fontSize: number;
  fontFamily: string;
  cursorStyle?: "line" | "block" | "underline" | "line-thin" | "block-outline" | "underline-thin";
  syntaxHighlighting: boolean;
  fontLigatures: boolean;
  insertSpaces: boolean;
  detectIndentation: boolean;
  wordWrapColumn: number;
  minimap: boolean;
  renderWhitespace: "none" | "boundary" | "all" | "selection";
  cursorBlinking: "blink" | "smooth" | "phase" | "expand" | "solid";
  formatOnPaste: boolean;
  bracketPairColorization: boolean;
  stickyScroll: boolean;
  contextmenu: boolean;
  codeLens: boolean;
  showFoldingControls: "mouseover" | "always";
  glyphMargin: boolean;
  colorDecorators: boolean;
  renderLineHighlight: "none" | "all" | "line" | "gutter";
  matchBrackets: "never" | "near" | "always";
  keybindings: Record<string, string>;
}

export interface SecuritySettings {
  allowTelemetry: boolean;
  checkUpdates: boolean;
}

export interface SearchSettings {
  enabledEngines: SearchEngineId[];
  language: string;
  safesearch: "off" | "moderate" | "strict";
  timeout: number;
  limit: number;
}

export type OcrBackendType = "mineru" | "paddleocr" | "unlimited-ocr" | "custom";
export type OcrRequestFormat = "multipart" | "json-base64" | "openai-vision";
export type OcrOutputFormat = "text" | "markdown" | "json";

export interface OcrBackendSettings {
  name: string;
  type: OcrBackendType;
  enabled: boolean;
  baseUrl: string;
  endpoint?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  model?: string;
  outputFormat?: OcrOutputFormat;
  requestFormat?: OcrRequestFormat;
  options?: Record<string, unknown>;
}

export interface OcrSettings {
  defaultBackend: string;
  backends: OcrBackendSettings[];
}

export interface SecurityMonitorSettings {
  dataSource: "mock" | "live";
  refreshIntervalSeconds: number;
  riskScoreMediumThreshold: number;
  riskScoreHighThreshold: number;
  realtimeRetentionDays: number;
}

export interface AppSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  editor: EditorSettings;
  llm: AiSettings;
  ocr: OcrSettings;
  /** Legacy desktop setting name kept for backward-compatible local configs. */
  ai?: AiSettings;
  security: SecuritySettings;
  network: NetworkSettings;
  search: SearchSettings;
  storage: StorageSettings;
}
