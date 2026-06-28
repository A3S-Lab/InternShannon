import {
    createDefaultOcrSettings,
    type OcrBackendConfig,
    type OcrBackendType,
    type OcrOutputFormat,
    type OcrRequestFormat,
    type OcrSettings as PackageOcrSettings,
} from '@a3s-lab/ocr';

/**
 * 模型配置
 */
export class ModelConfig {
    id!: string;
    name!: string;
    family?: string;
    apiKey?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    sessionIdHeader?: string;
    attachment!: boolean;
    reasoning!: boolean;
    toolCall!: boolean;
    temperature!: boolean;
    releaseDate?: string;
    modalities?: { input: string[]; output: string[] };
    cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
    limit?: { context: number; output: number };
}

/**
 * AI 提供商配置
 */
export class ProviderConfig {
    name!: string;
    apiKey?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    sessionIdHeader?: string;
    models!: ModelConfig[];
}

/**
 * LLM 配置
 */
export class LlmSettings {
    defaultModel!: string;
    providers!: ProviderConfig[];
    mcpServers?: unknown[];
    maxToolRounds?: number;
    thinkingBudget?: number;
    /** Per-tool execution timeout in ms; falls back to kernel default if unset. */
    toolTimeoutMs?: number;
    /** Lane queue dispatch timeout in ms; falls back to kernel default if unset. */
    queueTimeoutMs?: number;
    /** Overall ceiling for a single message run in ms. */
    maxExecutionTimeMs?: number;
    /** Stall watchdog soft threshold (ms) — emit a stream_stalled heartbeat. */
    streamStallWarningMs?: number;
    /** Stall watchdog hard threshold (ms) for idle/model-stream silence — force-cancel a wedged session. */
    streamStallHardMs?: number;
    /** Stall watchdog hard threshold (ms) while a tool is mid-execution — defaults to a longer window so legitimate long tools aren't preempted. */
    streamStallActiveToolHardMs?: number;
    /** Same-tool circuit breaker: cancel after this many consecutive failures. */
    maxConsecutiveToolErrors?: number;
    /** Auto-retry budget for the "model thinking" stall (event_stream_stalled with activeTools=0 and !outputStarted); 0 disables retry. */
    maxStreamRetries?: number;
}

/**
 * OCR 后端配置。形状对齐 @a3s-lab/ocr 的 OcrBackendConfig:
 * 由系统配置保存连接参数,运行时按 type 创建 MinerU / PaddleOCR / Unlimited-OCR / custom adapter。
 */
export class OcrBackendSettings implements OcrBackendConfig {
    name!: string;
    type!: OcrBackendType;
    enabled!: boolean;
    baseUrl!: string;
    endpoint?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    model?: string;
    outputFormat?: OcrOutputFormat;
    requestFormat?: OcrRequestFormat;
    options?: Record<string, unknown>;
}

/**
 * OCR 配置
 */
export class OcrSettings implements PackageOcrSettings {
    defaultBackend!: string;
    backends!: OcrBackendSettings[];
}

/**
 * 编辑器配置
 */
export class EditorSettings {
    tabSize!: number;
    wordWrap!: boolean;
    lineNumbers!: 'off' | 'on' | 'relative' | 'interval';
    indentGuides!: boolean;
    fontSize!: number;
    fontFamily!: string;
    cursorStyle?: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';
    syntaxHighlighting!: boolean;

    // === 前端扩展字段 ===
    fontLigatures!: boolean;
    insertSpaces!: boolean;
    detectIndentation!: boolean;
    wordWrapColumn!: number;
    minimap!: boolean;
    renderWhitespace!: 'none' | 'boundary' | 'all' | 'selection';
    cursorBlinking!: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
    formatOnPaste!: boolean;
    bracketPairColorization!: boolean;
    stickyScroll!: boolean;
    contextmenu!: boolean;
    codeLens!: boolean;
    showFoldingControls!: 'mouseover' | 'always';
    glyphMargin!: boolean;
    colorDecorators!: boolean;
    renderLineHighlight!: 'none' | 'all' | 'line' | 'gutter';
    matchBrackets!: 'never' | 'near' | 'always';
    keybindings!: Record<string, string>;
}

/**
 * 外观配置
 */
export class AppearanceSettings {
    theme!: 'light' | 'dark' | 'system';
    sideBarPosition!: 'left' | 'right';
    statusBar!: boolean;
    activityBar!: boolean;
    zoomLevel?: number;
}

/**
 * 通用配置
 */
export class GeneralSettings {
    appName?: string;
    language!: string;
    splashScreen!: boolean;
    restoreWorkspace!: boolean;
    workspacePath?: string;
}

/**
 * 菜单插件:桌面本地自定义的左侧菜单项。最小化的「插件系统」——一条插件 = 一个侧栏菜单贡献
 * (名称 / 图标 / 跳转地址 / 位置 / 可见性元数据)。存于平台配置,运行时合并进侧栏。url 为内部 `/admin/*`
 * 路径(站内路由)或外部 `http(s)://`(配 openInNewTab 新开页)。
 */
export class MenuPlugin {
    /** 稳定标识(管理/去重用)。 */
    id!: string;
    /** 菜单显示名。 */
    name!: string;
    /** lucide 图标名(前端按白名单映射,未知回退到通用图标);留空亦可。 */
    icon?: string;
    /** 跳转地址:站内 `/admin/...` 路径,或外部 `http(s)://`。AgentUI 页面型可留空(用 html)。 */
    url?: string;
    /** AgentUI 页面内容(agent 生成的 HTML);填了则该菜单项打开站内宿主页、经 AgentUI 沙箱渲染,
     *  而非按 url 跳转。 */
    html?: string;
    /** Markdown 页面内容;填了则该菜单项打开站内宿主页、渲染 Markdown(url/html 之外的第三种)。 */
    markdown?: string;
    /** AgentUI 额外 CDN 白名单(在内置默认 jsdelivr/unpkg/esm.sh/tailwind 之外追加);用于页面从
     *  其它 CDN 引入 React/Vue 等框架。 */
    cdnAllowlist?: string[];
    /** 外部地址是否新开标签页(站内路由忽略此项)。 */
    openInNewTab?: boolean;
    /** 排序权重(升序;插件统一排在内置菜单之后)。 */
    position?: number;
    /** 是否启用(false=隐藏,保留配置)。缺省视为启用。 */
    enabled?: boolean;
    /** 旧前端兼容字段:桌面版不再区分超级管理员。 */
    superAdminOnly?: boolean;
    /** 旧前端兼容字段:桌面版仅作为菜单可见性元数据保留。 */
    permission?: string;
    /** 内置示例插件标记(只读展示用,UI 提示不可删)。 */
    builtin?: boolean;
}

/**
 * 平台配置
 */
export class PlatformSettings {
    appName?: string;
    logoUrl?: string;
    language!: string;
    publicBaseUrl?: string;
    publicApiBaseUrl?: string;
    gitPublicBaseUrl?: string;
    defaultOrganizationSlug?: string;
    registrationMode!: 'adminOnly' | 'inviteOnly' | 'open';
    maintenanceMode!: boolean;
    supportEmail?: string;
    /** 数据源 Excel 上传大小上限(MB)。集中在平台配置页编辑;上传站点在运行时读取。 */
    uploadMaxExcelMb?: number;
    /** 内核会话工作区文件上传大小上限(MB)。同样在平台配置页编辑、运行时读取(单发 + 分片均生效)。 */
    uploadMaxWorkspaceFileMb?: number;
    /** 菜单插件:自定义左侧菜单项,运行时合并进侧栏(见 MenuPlugin / 「插件管理」页)。 */
    menuPlugins?: MenuPlugin[];
}

/**
 * 数字资产配置
 */
export class AssetSettings {
    defaultVisibility!: 'private' | 'organization' | 'public';
    maxUploadSizeMb!: number;
    allowedKinds!: string[];
    requireActionsValidation!: boolean;
    buildPackageOnActionsValidation!: boolean;
    keepSourceSnapshots!: boolean;
}

/**
 * 包管理配置
 */
export class PackageSettings {
    registryHost?: string;
    defaultNamespace?: string;
    defaultVisibility!: 'private' | 'organization' | 'public';
    immutableTags!: boolean;
    allowAnonymousPull!: boolean;
    retentionDays!: number;
    maxArtifactSizeMb!: number;
}

/**
 * 市场配置
 */
export class MarketplaceSettings {
    enabled!: boolean;
    reviewRequired!: boolean;
    allowOrgPrivateListings!: boolean;
    autoDelistVulnerable!: boolean;
    featuredReviewRequired!: boolean;
}

/**
 * 运行时配置
 */
export class RuntimeSettings {
    defaultNamespace?: string;
    defaultRuntimeClass?: string;
    defaultCpuLimit!: string;
    defaultMemoryLimit!: string;
    maxReplicas!: number;
    requireResourceLimits!: boolean;
    allowPrivilegedContainers!: boolean;
    imagePullPolicy!: 'IfNotPresent' | 'Always' | 'Never';
}

/**
 * 搜索配置
 *
 * 浏览器后端（lightpanda / chrome）由内核运行时自动探测：env (LIGHTPANDA/CHROME)
 * → PATH → 已知系统路径 → SDK 自动下载缓存。管理员不再需要在 UI 配置二进制路径。
 *
 * 搜索代理（HTTP/SOCKS）通过部署层的 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY env 控制；
 * 不在 admin UI 暴露，避免给操作员一个不会真正生效的开关（早期 proxy 字段只参与
 * system prompt 拼装，SDK 实际不读它）。
 */
export class SearchSettings {
    enabledEngines!: string[];
    language!: string;
    safesearch!: 'off' | 'moderate' | 'strict';
    timeout!: number;
    limit!: number;
}

/**
 * OAuth Provider 配置
 */
export class OAuthProviderSettings {
    enabled!: boolean;
    clientId!: string;
    clientSecret!: string;
    callbackUrl!: string;
    scopes?: string[];
    clientSecretConfigured?: boolean;
}

/**
 * OAuth 配置（第三方服务授权）
 */
export class OAuthSettings {
    github!: OAuthProviderSettings;
}

/**
 * 邮件服务器配置
 */
export class EmailSettings {
    host!: string;
    port!: string;
    secure!: boolean;
    username!: string;
    password!: string;
    passwordConfigured?: boolean;
    fromAddress!: string;
    fromName!: string;
}

/**
 * 通知渠道
 */
export type NotificationChannel = 'in_app' | 'email' | 'webhook';
/**
 * 通知分类
 */
export type NotificationCategory = 'system' | 'account' | 'access' | 'asset' | 'runtime' | 'resource';
/**
 * 通知级别
 */
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

/**
 * 通知配置
 */
export class NotificationSettings {
    channels!: Record<NotificationChannel, boolean>;
    digestFrequency!: 'realtime' | 'hourly' | 'daily';
    webhookUrl!: string;
    retentionDays!: string;
    categories!: Record<NotificationCategory, boolean>;
    levels!: Record<NotificationLevel, boolean>;
}

/**
 * 安全配置
 */
export class SecuritySettings {
    allowTelemetry!: boolean;
    checkUpdates!: boolean;
}

/**
 * 网络配置
 */
export class NetworkSettings {
    upstreamProxyUrl?: string;
    proxyPool?: string[];
    connectionTimeout!: number;
    readTimeout!: number;
}

/**
 * 安全监控配置
 */
export class SecurityMonitorSettings {
    dataSource!: 'mock' | 'live';
    refreshIntervalSeconds!: number;
    riskScoreMediumThreshold!: number;
    riskScoreHighThreshold!: number;
    realtimeRetentionDays!: number;
}

/**
 * 存储配置
 */
export class StorageSettings {
    defaultProvider!: 'local';
    localStoragePath?: string;
}

/**
 * MCP / 工具服务器配置（与内核运行时的 RuntimeMcpServerConfig 同构）。
 * 集中在 settings-schema 里独立声明，避免 config 域反向依赖 kernel 应用层类型。
 */
export interface AssistantMcpServerConfig {
    name: string;
    enabled?: boolean;
    transport: {
        type?: 'stdio' | 'http' | 'streamable-http';
        command?: string;
        args?: string[];
        url?: string;
        headers?: Record<string, string>;
    };
    env?: Record<string, string>;
    tool_timeout_secs?: number;
    timeoutMs?: number;
}

/**
 * 默认智能助手（默认内核助手, agentId='default'）全局配置。
 *
 * 全部字段可选；空值/未设置等价于回退到内置默认（内置 base prompt /
 * 跟随 LLM 默认模型 / CORE_AGENT_SKILL_NAMES 内置技能）。该配置由超管在
 * 桌面配置层统一管理，运行时对 agentId==='default'（含旧版别名 super-admin）的会话
 * 具有最高优先级，覆盖前端通过会话 metadata 下发的同名字段。
 */
export class AssistantSettings {
    /** 显示名称；'' = 内置默认（internShannon）。仅用于前端展示，不投影到运行时。 */
    name?: string;
    /** 头像图片 URL；'' = 内置默认头像。仅用于前端展示，不投影到运行时。 */
    avatar?: string;
    /** 简短描述；仅用于前端展示，不投影到运行时。 */
    description?: string;
    /** 覆盖内置 base prompt；'' = 使用内置 prompt。 */
    systemPrompt?: string;
    /** 'provider/model' 或 ''；'' = 跟随 LLM 默认模型。 */
    model?: string;
    temperature?: number;
    thinkingBudget?: number;
    maxToolRounds?: number;
    continuationEnabled?: boolean;
    maxContinuationTurns?: number;
    planningMode?: 'auto' | 'enabled' | 'disabled';
    goalTracking?: boolean;
    builtinSkills?: boolean;
    /** SDK 4.2+ active-skill allowed-tools 是否全局限制普通会话工具调用。 */
    enforceActiveSkillToolRestrictions?: boolean;
    /** Max consecutive malformed tool-call / parser recovery attempts before abort. */
    maxParseRetries?: number;
    /** Max consecutive LLM API failures before the SDK circuit breaker aborts. */
    circuitBreakerThreshold?: number;
    autoCompact?: boolean;
    autoCompactThreshold?: number;
    /** Per-tool execution timeout in milliseconds. */
    toolTimeoutMs?: number;
    /** Lane queue dispatch timeout in milliseconds. */
    queueTimeoutMs?: number;
    /** Overall ceiling for a single message run in milliseconds. */
    maxExecutionTimeMs?: number;
    /** Stall watchdog soft threshold in milliseconds. */
    streamStallWarningMs?: number;
    /** Stall watchdog hard threshold while no tool is in flight. */
    streamStallHardMs?: number;
    /** Stall watchdog hard threshold while a tool is in flight. */
    streamStallActiveToolHardMs?: number;
    /** Same-tool consecutive failure circuit breaker. */
    maxConsecutiveToolErrors?: number;
    /** Auto-retry budget for model-thinking stream stalls. */
    maxStreamRetries?: number;
    /** Global kill switch for automatic parallel child-agent fan-out. */
    autoParallel?: boolean;
    /** Sibling parallel branches cap for child-agent fan-out. */
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
    /** 全局技能名；为空 = 内置 CORE_AGENT_SKILL_NAMES。 */
    skills?: string[];
    /** 工具 / MCP 服务器配置。 */
    mcpServers?: AssistantMcpServerConfig[];
}

/**
 * 完整应用配置
 */
export class AppSettings {
    platform!: PlatformSettings;
    assets!: AssetSettings;
    packages!: PackageSettings;
    marketplace!: MarketplaceSettings;
    runtime!: RuntimeSettings;
    general!: GeneralSettings;
    appearance!: AppearanceSettings;
    editor!: EditorSettings;
    llm!: LlmSettings;
    ocr!: OcrSettings;
    search!: SearchSettings;
    oauth!: OAuthSettings;
    email!: EmailSettings;
    notifications!: NotificationSettings;
    security!: SecuritySettings;
    network!: NetworkSettings;
    securityMonitor!: SecurityMonitorSettings;
    storage!: StorageSettings;
    assistant!: AssistantSettings;
}

/**
 * 默认配置
 */
/** 上传大小默认上限(MB)——唯一事实源:DEFAULT_SETTINGS 与各上传站点的回退都引用它,代码里不再散落数字。 */
export const DEFAULT_UPLOAD_MAX_EXCEL_MB = 50;
export const DEFAULT_UPLOAD_MAX_WORKSPACE_FILE_MB = 512;

/**
 * 内置示例插件的页面内容:一个运行在 AgentUI 沙箱里的 React 页面——从 CDN 引入 React(UMD,
 * 无需 Babel,用 React.createElement),经 `host.call("apiGet", { path })` 桥读平台数据并渲染。
 * 演示「插件页 = AgentUI 沙箱 + 任意框架 + 受控 host 能力」。
 */
const EXAMPLE_PLUGIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; color: #1f2937; background: #fff; }
    .card { max-width: 600px; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px 22px; }
    h1 { font-size: 17px; margin: 0 0 6px; }
    .muted { color: #6b7280; font-size: 13px; line-height: 1.6; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; font-size: 13px; }
    .err { color: #dc2626; font-size: 13px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    var h = React.createElement;
    function App() {
      var s = React.useState(null), me = s[0], setMe = s[1];
      var e = React.useState(null), err = e[0], setErr = e[1];
      React.useEffect(function () {
        host.call("apiGet", { path: "/api/v1/health" })
          .then(function (res) { setMe(res && res.data ? res.data : res); })
          .catch(function (ex) { setErr(String(ex && ex.message ? ex.message : ex)); });
      }, []);
      return h("div", { className: "card" },
        h("h1", null, "🧩 AgentUI 示例插件(React)"),
        h("p", { className: "muted" },
          "这是运行在 AgentUI 沙箱里的 React 页面:从 CDN 引入 React,经 ",
          h("code", null, 'host.call("apiGet")'),
          " 读取本地 sidecar 状态。在「插件管理 / 我的菜单」里复制这段 HTML 即可改成你自己的页面。"),
        err ? h("p", { className: "err" }, "apiGet 失败:" + err)
          : me ? h("p", null, "sidecar 状态:", h("code", null, me.status || me.version || "ok"))
          : h("p", { className: "muted" }, "加载中…")
      );
    }
    ReactDOM.createRoot(document.getElementById("root")).render(h(App));
  </script>
</body>
</html>`;

export const DEFAULT_SETTINGS: AppSettings = {
    platform: {
        appName: 'InternShannon',
        logoUrl: '',
        language: 'zh-CN',
        publicBaseUrl: '',
        publicApiBaseUrl: '',
        gitPublicBaseUrl: '',
        defaultOrganizationSlug: 'default',
        registrationMode: 'inviteOnly',
        maintenanceMode: false,
        supportEmail: '',
        uploadMaxExcelMb: DEFAULT_UPLOAD_MAX_EXCEL_MB,
        uploadMaxWorkspaceFileMb: DEFAULT_UPLOAD_MAX_WORKSPACE_FILE_MB,
        // 内置示例插件:一个 AgentUI 沙箱 React 页面(html 型),开箱演示「插件页 = 任意框架 + host.call 取数据」。
        // 默认启用;在「系统 → 插件管理 / 我的菜单」可改内容/名称/位置或新增。
        menuPlugins: [
            {
                id: 'example-plugin',
                name: '示例插件',
                icon: 'Puzzle',
                html: EXAMPLE_PLUGIN_HTML,
                position: 100,
                enabled: true,
                builtin: true,
            },
        ],
    },
    assets: {
        defaultVisibility: 'organization',
        maxUploadSizeMb: 512,
        allowedKinds: ['source', 'document', 'dataset', 'model', 'mcp', 'container'],
        requireActionsValidation: true,
        buildPackageOnActionsValidation: true,
        keepSourceSnapshots: true,
    },
    packages: {
        registryHost: '',
        defaultNamespace: 'internshannon',
        defaultVisibility: 'organization',
        immutableTags: true,
        allowAnonymousPull: false,
        retentionDays: 90,
        maxArtifactSizeMb: 2048,
    },
    marketplace: {
        enabled: true,
        reviewRequired: true,
        allowOrgPrivateListings: true,
        autoDelistVulnerable: true,
        featuredReviewRequired: true,
    },
    runtime: {
        defaultNamespace: 'internshannon-runtime',
        defaultRuntimeClass: '',
        defaultCpuLimit: '1000m',
        defaultMemoryLimit: '1Gi',
        maxReplicas: 3,
        requireResourceLimits: true,
        allowPrivilegedContainers: false,
        imagePullPolicy: 'IfNotPresent',
    },
    general: {
        appName: 'InternShannon',
        language: 'zh-CN',
        splashScreen: true,
        restoreWorkspace: true,
        workspacePath: '',
    },
    appearance: {
        theme: 'system',
        sideBarPosition: 'left',
        statusBar: true,
        activityBar: true,
        zoomLevel: 1,
    },
    editor: {
        tabSize: 4,
        wordWrap: true,
        lineNumbers: 'on',
        indentGuides: false,
        fontSize: 14,
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        syntaxHighlighting: true,
        // 前端扩展字段
        fontLigatures: true,
        insertSpaces: true,
        detectIndentation: true,
        wordWrapColumn: 80,
        minimap: false,
        renderWhitespace: 'selection',
        cursorBlinking: 'blink',
        formatOnPaste: false,
        bracketPairColorization: true,
        stickyScroll: false,
        contextmenu: true,
        codeLens: true,
        showFoldingControls: 'mouseover',
        glyphMargin: true,
        colorDecorators: true,
        renderLineHighlight: 'all',
        matchBrackets: 'always',
        keybindings: {},
    },
    llm: {
        defaultModel: 'openai/gpt-4',
        providers: [],
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
    ocr: createDefaultOcrSettings(),
    search: {
        enabledEngines: ['ddg', 'brave', 'bing'],
        language: 'zh-CN',
        safesearch: 'moderate',
        timeout: 30,
        limit: 10,
    },
    oauth: {
        github: {
            enabled: false,
            clientId: '',
            clientSecret: '',
            callbackUrl: '',
            scopes: ['read:user', 'user:email'],
        },
    },
    email: {
        host: '',
        port: '587',
        secure: false,
        username: '',
        password: '',
        fromAddress: '',
        fromName: '',
    },
    notifications: {
        channels: { in_app: true, email: false, webhook: false },
        digestFrequency: 'realtime',
        webhookUrl: '',
        retentionDays: '30',
        categories: {
            system: true,
            account: true,
            access: true,
            asset: true,
            runtime: false,
            resource: false,
        },
        levels: { info: true, success: true, warning: true, error: true },
    },
    security: {
        allowTelemetry: false,
        checkUpdates: true,
    },
    network: {
        upstreamProxyUrl: '',
        proxyPool: [],
        connectionTimeout: 30,
        readTimeout: 60,
    },
    securityMonitor: {
        dataSource: 'mock',
        refreshIntervalSeconds: 6,
        riskScoreMediumThreshold: 40,
        riskScoreHighThreshold: 70,
        realtimeRetentionDays: 7,
    },
    storage: {
        defaultProvider: 'local',
        localStoragePath: '',
    },
    // 默认智能助手全局配置默认空对象：所有字段未设置即回退到内置默认。空对象不会触发
    // persistMissingCategoryDefaults 的回填(hasMissingDefaults({}, {}) === false)。
    assistant: {},
};
