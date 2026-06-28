import { OCR_BACKEND_TYPES, OCR_OUTPUT_FORMATS, OCR_REQUEST_FORMATS } from '@a3s-lab/ocr';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsIn,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';

const REGISTRATION_MODES = ['adminOnly', 'inviteOnly', 'open'] as const;
const VISIBILITY_OPTIONS = ['private', 'organization', 'public'] as const;
const IMAGE_PULL_POLICIES = ['IfNotPresent', 'Always', 'Never'] as const;
const THEMES = ['light', 'dark', 'system'] as const;
const SIDEBAR_POSITIONS = ['left', 'right'] as const;
const LINE_NUMBER_MODES = ['off', 'on', 'relative', 'interval'] as const;
const CURSOR_STYLES = ['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'] as const;
const RENDER_WHITESPACE_OPTIONS = ['none', 'boundary', 'all', 'selection'] as const;
const CURSOR_BLINKING_OPTIONS = ['blink', 'smooth', 'phase', 'expand', 'solid'] as const;
const SHOW_FOLDING_CONTROLS_OPTIONS = ['mouseover', 'always'] as const;
const RENDER_LINE_HIGHLIGHT_OPTIONS = ['none', 'all', 'line', 'gutter'] as const;
const MATCH_BRACKETS_OPTIONS = ['never', 'near', 'always'] as const;
const SAFESEARCH_OPTIONS = ['off', 'moderate', 'strict'] as const;
const DIGEST_FREQUENCIES = ['realtime', 'hourly', 'daily'] as const;
const STORAGE_PROVIDERS = ['local'] as const;
const SECURITY_MONITOR_DATA_SOURCES = ['mock', 'live'] as const;
export class ModelModalitiesRequestDto {
    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    input!: string[];

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    output!: string[];
}

export class ModelCostRequestDto {
    @ApiProperty()
    @IsNumber()
    input!: number;

    @ApiProperty()
    @IsNumber()
    output!: number;

    @ApiProperty()
    @IsNumber()
    cacheRead!: number;

    @ApiProperty()
    @IsNumber()
    cacheWrite!: number;
}

export class ModelLimitRequestDto {
    @ApiProperty()
    @IsNumber()
    context!: number;

    @ApiProperty()
    @IsNumber()
    output!: number;
}

export class ModelConfigRequestDto {
    @ApiProperty()
    @IsString()
    id!: string;

    @ApiProperty()
    @IsString()
    name!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    family?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    apiKey?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    baseUrl?: string;

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    headers?: Record<string, string>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    sessionIdHeader?: string;

    @ApiProperty()
    @IsBoolean()
    attachment!: boolean;

    @ApiProperty()
    @IsBoolean()
    reasoning!: boolean;

    @ApiProperty()
    @IsBoolean()
    toolCall!: boolean;

    @ApiProperty()
    @IsBoolean()
    temperature!: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    releaseDate?: string;

    @ApiPropertyOptional({ type: () => ModelModalitiesRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => ModelModalitiesRequestDto)
    modalities?: ModelModalitiesRequestDto;

    @ApiPropertyOptional({ type: () => ModelCostRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => ModelCostRequestDto)
    cost?: ModelCostRequestDto;

    @ApiPropertyOptional({ type: () => ModelLimitRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => ModelLimitRequestDto)
    limit?: ModelLimitRequestDto;
}

export class ProviderConfigRequestDto {
    @ApiProperty()
    @IsString()
    name!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    apiKey?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    baseUrl?: string;

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    headers?: Record<string, string>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    sessionIdHeader?: string;

    @ApiProperty({ type: () => [ModelConfigRequestDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ModelConfigRequestDto)
    models!: ModelConfigRequestDto[];
}

export class LlmSettingsRequestDto {
    @ApiProperty()
    @IsString()
    defaultModel!: string;

    @ApiProperty({ type: () => [ProviderConfigRequestDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProviderConfigRequestDto)
    providers!: ProviderConfigRequestDto[];

    @ApiPropertyOptional({ type: [Object] })
    @IsOptional()
    @IsArray()
    mcpServers?: unknown[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxToolRounds?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    thinkingBudget?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    toolTimeoutMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    queueTimeoutMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxExecutionTimeMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    streamStallWarningMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    streamStallHardMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    streamStallActiveToolHardMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxConsecutiveToolErrors?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxStreamRetries?: number;

    // a3s-code runtime / OCR 设置对齐时由运行时写入 config/app/llm,DTO 必须声明,否则
    // GET 回来的整份配置带着它们 PUT 回去会被 forbidNonWhitelisted 打回(连切默认模型都存不了)。
    @ApiPropertyOptional({ type: Object, isArray: true })
    @IsOptional()
    @IsArray()
    ocrConfigs?: unknown[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    defaultOcrId?: string;
}

export class OcrBackendSettingsRequestDto {
    @ApiProperty()
    @IsString()
    name!: string;

    @ApiProperty({ enum: OCR_BACKEND_TYPES })
    @IsIn(OCR_BACKEND_TYPES)
    type!: 'mineru' | 'paddleocr' | 'unlimited-ocr' | 'custom';

    @ApiProperty()
    @IsBoolean()
    enabled!: boolean;

    @ApiProperty()
    @IsString()
    baseUrl!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    endpoint?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    apiKey?: string;

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    headers?: Record<string, string>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    timeoutMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    model?: string;

    @ApiPropertyOptional({ enum: OCR_OUTPUT_FORMATS })
    @IsOptional()
    @IsIn(OCR_OUTPUT_FORMATS)
    outputFormat?: 'text' | 'markdown' | 'json';

    @ApiPropertyOptional({ enum: OCR_REQUEST_FORMATS })
    @IsOptional()
    @IsIn(OCR_REQUEST_FORMATS)
    requestFormat?: 'multipart' | 'json-base64' | 'openai-vision';

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    options?: Record<string, unknown>;
}

export class OcrSettingsRequestDto {
    @ApiProperty()
    @IsString()
    defaultBackend!: string;

    @ApiProperty({ type: () => [OcrBackendSettingsRequestDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OcrBackendSettingsRequestDto)
    backends!: OcrBackendSettingsRequestDto[];
}

export class EditorSettingsRequestDto {
    @ApiProperty()
    @IsNumber()
    tabSize!: number;

    @ApiProperty()
    @IsBoolean()
    wordWrap!: boolean;

    @ApiProperty({ enum: LINE_NUMBER_MODES })
    @IsIn(LINE_NUMBER_MODES)
    lineNumbers!: 'off' | 'on' | 'relative' | 'interval';

    @ApiProperty()
    @IsBoolean()
    indentGuides!: boolean;

    @ApiProperty()
    @IsNumber()
    fontSize!: number;

    @ApiProperty()
    @IsString()
    fontFamily!: string;

    @ApiPropertyOptional({ enum: CURSOR_STYLES })
    @IsOptional()
    @IsIn(CURSOR_STYLES)
    cursorStyle?: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';

    @ApiProperty()
    @IsBoolean()
    syntaxHighlighting!: boolean;

    @ApiProperty()
    @IsBoolean()
    fontLigatures!: boolean;

    @ApiProperty()
    @IsBoolean()
    insertSpaces!: boolean;

    @ApiProperty()
    @IsBoolean()
    detectIndentation!: boolean;

    @ApiProperty()
    @IsNumber()
    wordWrapColumn!: number;

    @ApiProperty()
    @IsBoolean()
    minimap!: boolean;

    @ApiProperty({ enum: RENDER_WHITESPACE_OPTIONS })
    @IsIn(RENDER_WHITESPACE_OPTIONS)
    renderWhitespace!: 'none' | 'boundary' | 'all' | 'selection';

    @ApiProperty({ enum: CURSOR_BLINKING_OPTIONS })
    @IsIn(CURSOR_BLINKING_OPTIONS)
    cursorBlinking!: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';

    @ApiProperty()
    @IsBoolean()
    formatOnPaste!: boolean;

    @ApiProperty()
    @IsBoolean()
    bracketPairColorization!: boolean;

    @ApiProperty()
    @IsBoolean()
    stickyScroll!: boolean;

    @ApiProperty()
    @IsBoolean()
    contextmenu!: boolean;

    @ApiProperty()
    @IsBoolean()
    codeLens!: boolean;

    @ApiProperty({ enum: SHOW_FOLDING_CONTROLS_OPTIONS })
    @IsIn(SHOW_FOLDING_CONTROLS_OPTIONS)
    showFoldingControls!: 'mouseover' | 'always';

    @ApiProperty()
    @IsBoolean()
    glyphMargin!: boolean;

    @ApiProperty()
    @IsBoolean()
    colorDecorators!: boolean;

    @ApiProperty({ enum: RENDER_LINE_HIGHLIGHT_OPTIONS })
    @IsIn(RENDER_LINE_HIGHLIGHT_OPTIONS)
    renderLineHighlight!: 'none' | 'all' | 'line' | 'gutter';

    @ApiProperty({ enum: MATCH_BRACKETS_OPTIONS })
    @IsIn(MATCH_BRACKETS_OPTIONS)
    matchBrackets!: 'never' | 'near' | 'always';

    @ApiProperty({ type: Object })
    @IsObject()
    keybindings!: Record<string, string>;
}

export class AppearanceSettingsRequestDto {
    @ApiProperty({ enum: THEMES })
    @IsIn(THEMES)
    theme!: 'light' | 'dark' | 'system';

    @ApiProperty({ enum: SIDEBAR_POSITIONS })
    @IsIn(SIDEBAR_POSITIONS)
    sideBarPosition!: 'left' | 'right';

    @ApiProperty()
    @IsBoolean()
    statusBar!: boolean;

    @ApiProperty()
    @IsBoolean()
    activityBar!: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    zoomLevel?: number;
}

export class GeneralSettingsRequestDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    appName?: string;

    @ApiProperty()
    @IsString()
    language!: string;

    @ApiProperty()
    @IsBoolean()
    splashScreen!: boolean;

    @ApiProperty()
    @IsBoolean()
    restoreWorkspace!: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    workspacePath?: string;
}

export class MenuPluginRequestDto {
    @ApiProperty({ description: '稳定标识' })
    @IsString()
    id!: string;

    @ApiProperty({ description: '菜单显示名' })
    @IsString()
    name!: string;

    @ApiPropertyOptional({ description: 'lucide 图标名(白名单映射,未知回退通用图标)' })
    @IsOptional()
    @IsString()
    icon?: string;

    @ApiPropertyOptional({ description: '跳转地址:站内 /admin/... 或外部 http(s)://(AgentUI 页面型可留空)' })
    @IsOptional()
    @IsString()
    url?: string;

    @ApiPropertyOptional({ description: 'AgentUI 页面内容(HTML);填了则经 AgentUI 沙箱渲染而非跳转' })
    @IsOptional()
    @IsString()
    html?: string;

    @ApiPropertyOptional({ description: 'Markdown 页面内容;填了则该菜单项渲染 Markdown(url/html 之外的第三种)' })
    @IsOptional()
    @IsString()
    markdown?: string;

    @ApiPropertyOptional({ type: [String], description: 'AgentUI 额外 CDN 白名单(默认之外追加)' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    cdnAllowlist?: string[];

    @ApiPropertyOptional({ description: '外部地址是否新开标签页' })
    @IsOptional()
    @IsBoolean()
    openInNewTab?: boolean;

    @ApiPropertyOptional({ description: '排序权重(升序,排在内置菜单之后)' })
    @IsOptional()
    @IsNumber()
    position?: number;

    @ApiPropertyOptional({ description: '是否启用(缺省视为启用)' })
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiPropertyOptional({ description: '旧前端兼容字段:桌面版不再区分超级管理员' })
    @IsOptional()
    @IsBoolean()
    superAdminOnly?: boolean;

    @ApiPropertyOptional({ description: '旧前端兼容字段:桌面版仅作为菜单可见性元数据保留' })
    @IsOptional()
    @IsString()
    permission?: string;

    @ApiPropertyOptional({ description: '内置示例标记' })
    @IsOptional()
    @IsBoolean()
    builtin?: boolean;
}

export class PlatformSettingsRequestDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    appName?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    logoUrl?: string;

    @ApiProperty()
    @IsString()
    language!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    publicBaseUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    publicApiBaseUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    gitPublicBaseUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    defaultOrganizationSlug?: string;

    @ApiProperty({ enum: REGISTRATION_MODES })
    @IsIn(REGISTRATION_MODES)
    registrationMode!: 'adminOnly' | 'inviteOnly' | 'open';

    @ApiProperty()
    @IsBoolean()
    maintenanceMode!: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    supportEmail?: string;

    @ApiPropertyOptional({
        description:
            '数据源 Excel 上传大小上限(MB);上限受 FileInterceptor 绝对硬上限约束(默认 256MB, env DATASOURCE_EXCEL_MAX_MB)',
    })
    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(256)
    uploadMaxExcelMb?: number;

    @ApiPropertyOptional({ description: '内核会话工作区文件上传大小上限(MB);分片大文件经此限额,默认 512' })
    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(10240)
    uploadMaxWorkspaceFileMb?: number;

    @ApiPropertyOptional({ type: () => [MenuPluginRequestDto], description: '自定义左侧菜单插件' })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MenuPluginRequestDto)
    menuPlugins?: MenuPluginRequestDto[];
}

export class AssetSettingsRequestDto {
    @ApiProperty({ enum: VISIBILITY_OPTIONS })
    @IsIn(VISIBILITY_OPTIONS)
    defaultVisibility!: 'private' | 'organization' | 'public';

    @ApiProperty()
    @IsNumber()
    maxUploadSizeMb!: number;

    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    allowedKinds!: string[];

    @ApiProperty()
    @IsBoolean()
    requireActionsValidation!: boolean;

    @ApiProperty()
    @IsBoolean()
    buildPackageOnActionsValidation!: boolean;

    @ApiProperty()
    @IsBoolean()
    keepSourceSnapshots!: boolean;
}

export class PackageSettingsRequestDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    registryHost?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    defaultNamespace?: string;

    @ApiProperty({ enum: VISIBILITY_OPTIONS })
    @IsIn(VISIBILITY_OPTIONS)
    defaultVisibility!: 'private' | 'organization' | 'public';

    @ApiProperty()
    @IsBoolean()
    immutableTags!: boolean;

    @ApiProperty()
    @IsBoolean()
    allowAnonymousPull!: boolean;

    @ApiProperty()
    @IsNumber()
    retentionDays!: number;

    @ApiProperty()
    @IsNumber()
    maxArtifactSizeMb!: number;
}

export class MarketplaceSettingsRequestDto {
    @ApiProperty()
    @IsBoolean()
    enabled!: boolean;

    @ApiProperty()
    @IsBoolean()
    reviewRequired!: boolean;

    @ApiProperty()
    @IsBoolean()
    allowOrgPrivateListings!: boolean;

    @ApiProperty()
    @IsBoolean()
    autoDelistVulnerable!: boolean;

    @ApiProperty()
    @IsBoolean()
    featuredReviewRequired!: boolean;
}

export class RuntimeSettingsRequestDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    defaultNamespace?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    defaultRuntimeClass?: string;

    @ApiProperty()
    @IsString()
    defaultCpuLimit!: string;

    @ApiProperty()
    @IsString()
    defaultMemoryLimit!: string;

    @ApiProperty()
    @IsNumber()
    maxReplicas!: number;

    @ApiProperty()
    @IsBoolean()
    requireResourceLimits!: boolean;

    @ApiProperty()
    @IsBoolean()
    allowPrivilegedContainers!: boolean;

    @ApiProperty({ enum: IMAGE_PULL_POLICIES })
    @IsIn(IMAGE_PULL_POLICIES)
    imagePullPolicy!: 'IfNotPresent' | 'Always' | 'Never';
}

export class SearchSettingsRequestDto {
    @ApiProperty({ type: [String] })
    @IsArray()
    @IsString({ each: true })
    enabledEngines!: string[];

    @ApiProperty()
    @IsString()
    language!: string;

    @ApiProperty({ enum: SAFESEARCH_OPTIONS })
    @IsIn(SAFESEARCH_OPTIONS)
    safesearch!: 'off' | 'moderate' | 'strict';

    @ApiProperty()
    @IsNumber()
    timeout!: number;

    @ApiProperty()
    @IsNumber()
    limit!: number;
}

export class OAuthProviderSettingsRequestDto {
    @ApiProperty()
    @IsBoolean()
    enabled!: boolean;

    @ApiProperty()
    @IsString()
    clientId!: string;

    @ApiProperty()
    @IsString()
    clientSecret!: string;

    @ApiProperty()
    @IsString()
    callbackUrl!: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    scopes?: string[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    clientSecretConfigured?: boolean;
}

export class OAuthSettingsRequestDto {
    @ApiProperty({ type: () => OAuthProviderSettingsRequestDto })
    @ValidateNested()
    @Type(() => OAuthProviderSettingsRequestDto)
    github!: OAuthProviderSettingsRequestDto;
}

export class EmailSettingsRequestDto {
    @ApiProperty()
    @IsString()
    host!: string;

    @ApiProperty()
    @IsString()
    port!: string;

    @ApiProperty()
    @IsBoolean()
    secure!: boolean;

    @ApiProperty()
    @IsString()
    username!: string;

    @ApiProperty()
    @IsString()
    password!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    passwordConfigured?: boolean;

    @ApiProperty()
    @IsString()
    fromAddress!: string;

    @ApiProperty()
    @IsString()
    fromName!: string;
}

export class NotificationChannelsRequestDto {
    @ApiProperty()
    @IsBoolean()
    in_app!: boolean;

    @ApiProperty()
    @IsBoolean()
    email!: boolean;

    @ApiProperty()
    @IsBoolean()
    webhook!: boolean;
}

export class NotificationCategoriesRequestDto {
    @ApiProperty()
    @IsBoolean()
    system!: boolean;

    @ApiProperty()
    @IsBoolean()
    account!: boolean;

    @ApiProperty()
    @IsBoolean()
    access!: boolean;

    @ApiProperty()
    @IsBoolean()
    asset!: boolean;

    @ApiProperty()
    @IsBoolean()
    runtime!: boolean;

    @ApiProperty()
    @IsBoolean()
    resource!: boolean;
}

export class NotificationLevelsRequestDto {
    @ApiProperty()
    @IsBoolean()
    info!: boolean;

    @ApiProperty()
    @IsBoolean()
    success!: boolean;

    @ApiProperty()
    @IsBoolean()
    warning!: boolean;

    @ApiProperty()
    @IsBoolean()
    error!: boolean;
}

export class NotificationSettingsRequestDto {
    @ApiProperty({ type: () => NotificationChannelsRequestDto })
    @ValidateNested()
    @Type(() => NotificationChannelsRequestDto)
    channels!: NotificationChannelsRequestDto;

    @ApiProperty({ enum: DIGEST_FREQUENCIES })
    @IsIn(DIGEST_FREQUENCIES)
    digestFrequency!: 'realtime' | 'hourly' | 'daily';

    @ApiProperty()
    @IsString()
    webhookUrl!: string;

    @ApiProperty()
    @IsString()
    retentionDays!: string;

    @ApiProperty({ type: () => NotificationCategoriesRequestDto })
    @ValidateNested()
    @Type(() => NotificationCategoriesRequestDto)
    categories!: NotificationCategoriesRequestDto;

    @ApiProperty({ type: () => NotificationLevelsRequestDto })
    @ValidateNested()
    @Type(() => NotificationLevelsRequestDto)
    levels!: NotificationLevelsRequestDto;
}

export class SecuritySettingsRequestDto {
    @ApiProperty()
    @IsBoolean()
    allowTelemetry!: boolean;

    @ApiProperty()
    @IsBoolean()
    checkUpdates!: boolean;
}

export class NetworkSettingsRequestDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    upstreamProxyUrl?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    proxyPool?: string[];

    @ApiProperty()
    @IsNumber()
    connectionTimeout!: number;

    @ApiProperty()
    @IsNumber()
    readTimeout!: number;
}

export class SecurityMonitorSettingsRequestDto {
    @ApiProperty({ enum: SECURITY_MONITOR_DATA_SOURCES })
    @IsIn(SECURITY_MONITOR_DATA_SOURCES)
    dataSource!: 'mock' | 'live';

    @ApiProperty()
    @IsNumber()
    refreshIntervalSeconds!: number;

    @ApiProperty()
    @IsNumber()
    riskScoreMediumThreshold!: number;

    @ApiProperty()
    @IsNumber()
    riskScoreHighThreshold!: number;

    @ApiProperty()
    @IsNumber()
    realtimeRetentionDays!: number;
}

export class StorageSettingsRequestDto {
    @ApiPropertyOptional({ enum: STORAGE_PROVIDERS })
    @IsOptional()
    @IsIn(STORAGE_PROVIDERS)
    defaultProvider?: 'local';

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    localStoragePath?: string;
}

const PLANNING_MODES = ['auto', 'enabled', 'disabled'] as const;
const MCP_TRANSPORT_TYPES = ['stdio', 'http', 'streamable-http'] as const;

export class AssistantMcpTransportRequestDto {
    @ApiPropertyOptional({ enum: MCP_TRANSPORT_TYPES })
    @IsOptional()
    @IsIn(MCP_TRANSPORT_TYPES)
    type?: 'stdio' | 'http' | 'streamable-http';

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    command?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    args?: string[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    url?: string;

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    headers?: Record<string, string>;
}

export class AssistantMcpServerRequestDto {
    @ApiProperty()
    @IsString()
    name!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiProperty({ type: () => AssistantMcpTransportRequestDto })
    @ValidateNested()
    @Type(() => AssistantMcpTransportRequestDto)
    transport!: AssistantMcpTransportRequestDto;

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    env?: Record<string, string>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    tool_timeout_secs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    timeoutMs?: number;
}

/**
 * 默认智能助手（默认内核助手）全局配置请求体。结构与 {@link AssistantSettings} 一致；
 * 全部字段可选，空值/未设置等价于回退到内置默认。
 */
export class AssistantSettingsRequestDto {
    @ApiPropertyOptional({ description: "显示名称；'' = 内置默认。仅用于前端展示，不投影到运行时" })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ description: "头像图片 URL；'' = 内置默认头像。仅用于前端展示，不投影到运行时" })
    @IsOptional()
    @IsString()
    avatar?: string;

    @ApiPropertyOptional({ description: '简短描述；仅用于前端展示，不投影到运行时' })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ description: "覆盖内置 base prompt；'' = 使用内置 prompt" })
    @IsOptional()
    @IsString()
    systemPrompt?: string;

    @ApiPropertyOptional({ description: "'provider/model' 或 ''；'' = 跟随 LLM 默认模型" })
    @IsOptional()
    @IsString()
    model?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    temperature?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    thinkingBudget?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxToolRounds?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxParseRetries?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    circuitBreakerThreshold?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    continuationEnabled?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxContinuationTurns?: number;

    @ApiPropertyOptional({ enum: PLANNING_MODES })
    @IsOptional()
    @IsIn(PLANNING_MODES)
    planningMode?: 'auto' | 'enabled' | 'disabled';

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    goalTracking?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    builtinSkills?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    enforceActiveSkillToolRestrictions?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    autoCompact?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    autoCompactThreshold?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    toolTimeoutMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    queueTimeoutMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxExecutionTimeMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    streamStallWarningMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    streamStallHardMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    streamStallActiveToolHardMs?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxConsecutiveToolErrors?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxStreamRetries?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    autoParallel?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    maxParallelTasks?: number;

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    autoDelegation?: Record<string, unknown>;

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    artifactStoreLimits?: Record<string, unknown>;

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    retentionLimits?: Record<string, unknown>;

    @ApiPropertyOptional({ type: [String], description: '全局技能名；为空 = 内置 CORE_AGENT_SKILL_NAMES' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    skills?: string[];

    @ApiPropertyOptional({ type: () => [AssistantMcpServerRequestDto], description: '工具 / MCP 服务器配置' })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AssistantMcpServerRequestDto)
    mcpServers?: AssistantMcpServerRequestDto[];
}

export class AppSettingsRequestDto {
    @ApiProperty({ type: () => PlatformSettingsRequestDto })
    @ValidateNested()
    @Type(() => PlatformSettingsRequestDto)
    platform!: PlatformSettingsRequestDto;

    @ApiProperty({ type: () => AssetSettingsRequestDto })
    @ValidateNested()
    @Type(() => AssetSettingsRequestDto)
    assets!: AssetSettingsRequestDto;

    @ApiProperty({ type: () => PackageSettingsRequestDto })
    @ValidateNested()
    @Type(() => PackageSettingsRequestDto)
    packages!: PackageSettingsRequestDto;

    @ApiProperty({ type: () => MarketplaceSettingsRequestDto })
    @ValidateNested()
    @Type(() => MarketplaceSettingsRequestDto)
    marketplace!: MarketplaceSettingsRequestDto;

    @ApiProperty({ type: () => RuntimeSettingsRequestDto })
    @ValidateNested()
    @Type(() => RuntimeSettingsRequestDto)
    runtime!: RuntimeSettingsRequestDto;

    @ApiProperty({ type: () => GeneralSettingsRequestDto })
    @ValidateNested()
    @Type(() => GeneralSettingsRequestDto)
    general!: GeneralSettingsRequestDto;

    @ApiProperty({ type: () => AppearanceSettingsRequestDto })
    @ValidateNested()
    @Type(() => AppearanceSettingsRequestDto)
    appearance!: AppearanceSettingsRequestDto;

    @ApiProperty({ type: () => EditorSettingsRequestDto })
    @ValidateNested()
    @Type(() => EditorSettingsRequestDto)
    editor!: EditorSettingsRequestDto;

    @ApiProperty({ type: () => LlmSettingsRequestDto })
    @ValidateNested()
    @Type(() => LlmSettingsRequestDto)
    llm!: LlmSettingsRequestDto;

    @ApiPropertyOptional({ type: () => OcrSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => OcrSettingsRequestDto)
    ocr?: OcrSettingsRequestDto;

    @ApiProperty({ type: () => SearchSettingsRequestDto })
    @ValidateNested()
    @Type(() => SearchSettingsRequestDto)
    search!: SearchSettingsRequestDto;

    @ApiProperty({ type: () => OAuthSettingsRequestDto })
    @ValidateNested()
    @Type(() => OAuthSettingsRequestDto)
    oauth!: OAuthSettingsRequestDto;

    @ApiProperty({ type: () => EmailSettingsRequestDto })
    @ValidateNested()
    @Type(() => EmailSettingsRequestDto)
    email!: EmailSettingsRequestDto;

    @ApiProperty({ type: () => NotificationSettingsRequestDto })
    @ValidateNested()
    @Type(() => NotificationSettingsRequestDto)
    notifications!: NotificationSettingsRequestDto;

    @ApiProperty({ type: () => SecuritySettingsRequestDto })
    @ValidateNested()
    @Type(() => SecuritySettingsRequestDto)
    security!: SecuritySettingsRequestDto;

    @ApiProperty({ type: () => NetworkSettingsRequestDto })
    @ValidateNested()
    @Type(() => NetworkSettingsRequestDto)
    network!: NetworkSettingsRequestDto;

    @ApiProperty({ type: () => SecurityMonitorSettingsRequestDto })
    @ValidateNested()
    @Type(() => SecurityMonitorSettingsRequestDto)
    securityMonitor!: SecurityMonitorSettingsRequestDto;

    @ApiProperty({ type: () => StorageSettingsRequestDto })
    @ValidateNested()
    @Type(() => StorageSettingsRequestDto)
    storage!: StorageSettingsRequestDto;

    // Optional in the full-config payload: the dedicated PUT /config/assistant owns
    // this category, and older full-config clients may not send it yet. Absence
    // falls back to the persisted value / DEFAULT_SETTINGS.assistant ({}).
    @ApiPropertyOptional({ type: () => AssistantSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => AssistantSettingsRequestDto)
    assistant?: AssistantSettingsRequestDto;
}

export class PatchOAuthProviderSettingsRequestDto extends PartialType(OAuthProviderSettingsRequestDto) {}

export class PatchOAuthSettingsRequestDto {
    @ApiPropertyOptional({ type: () => PatchOAuthProviderSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchOAuthProviderSettingsRequestDto)
    github?: PatchOAuthProviderSettingsRequestDto;
}

export class PatchNotificationChannelsRequestDto extends PartialType(NotificationChannelsRequestDto) {}
export class PatchNotificationCategoriesRequestDto extends PartialType(NotificationCategoriesRequestDto) {}
export class PatchNotificationLevelsRequestDto extends PartialType(NotificationLevelsRequestDto) {}

export class PatchPlatformSettingsRequestDto extends PartialType(PlatformSettingsRequestDto) {}
export class PatchAssetSettingsRequestDto extends PartialType(AssetSettingsRequestDto) {}
export class PatchPackageSettingsRequestDto extends PartialType(PackageSettingsRequestDto) {}
export class PatchMarketplaceSettingsRequestDto extends PartialType(MarketplaceSettingsRequestDto) {}
export class PatchRuntimeSettingsRequestDto extends PartialType(RuntimeSettingsRequestDto) {}
export class PatchGeneralSettingsRequestDto extends PartialType(GeneralSettingsRequestDto) {}
export class PatchAppearanceSettingsRequestDto extends PartialType(AppearanceSettingsRequestDto) {}
export class PatchEditorSettingsRequestDto extends PartialType(EditorSettingsRequestDto) {}
export class PatchLlmSettingsRequestDto extends PartialType(LlmSettingsRequestDto) {}
export class PatchOcrBackendSettingsRequestDto extends PartialType(OcrBackendSettingsRequestDto) {}
export class PatchOcrSettingsRequestDto extends PartialType(OcrSettingsRequestDto) {}
export class PatchSearchSettingsRequestDto extends PartialType(SearchSettingsRequestDto) {}
export class PatchEmailSettingsRequestDto extends PartialType(EmailSettingsRequestDto) {}
export class PatchSecuritySettingsRequestDto extends PartialType(SecuritySettingsRequestDto) {}
export class PatchNetworkSettingsRequestDto extends PartialType(NetworkSettingsRequestDto) {}
export class PatchSecurityMonitorSettingsRequestDto extends PartialType(SecurityMonitorSettingsRequestDto) {}
export class PatchStorageSettingsRequestDto extends PartialType(StorageSettingsRequestDto) {}

export class PatchNotificationSettingsRequestDto {
    @ApiPropertyOptional({ type: () => PatchNotificationChannelsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchNotificationChannelsRequestDto)
    channels?: PatchNotificationChannelsRequestDto;

    @ApiPropertyOptional({ enum: DIGEST_FREQUENCIES })
    @IsOptional()
    @IsIn(DIGEST_FREQUENCIES)
    digestFrequency?: 'realtime' | 'hourly' | 'daily';

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    webhookUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    retentionDays?: string;

    @ApiPropertyOptional({ type: () => PatchNotificationCategoriesRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchNotificationCategoriesRequestDto)
    categories?: PatchNotificationCategoriesRequestDto;

    @ApiPropertyOptional({ type: () => PatchNotificationLevelsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchNotificationLevelsRequestDto)
    levels?: PatchNotificationLevelsRequestDto;
}

export class PatchAppSettingsRequestDto {
    @ApiPropertyOptional({ type: () => PatchPlatformSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchPlatformSettingsRequestDto)
    platform?: PatchPlatformSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchAssetSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchAssetSettingsRequestDto)
    assets?: PatchAssetSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchPackageSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchPackageSettingsRequestDto)
    packages?: PatchPackageSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchMarketplaceSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchMarketplaceSettingsRequestDto)
    marketplace?: PatchMarketplaceSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchRuntimeSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchRuntimeSettingsRequestDto)
    runtime?: PatchRuntimeSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchGeneralSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchGeneralSettingsRequestDto)
    general?: PatchGeneralSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchAppearanceSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchAppearanceSettingsRequestDto)
    appearance?: PatchAppearanceSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchEditorSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchEditorSettingsRequestDto)
    editor?: PatchEditorSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchLlmSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchLlmSettingsRequestDto)
    llm?: PatchLlmSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchOcrSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchOcrSettingsRequestDto)
    ocr?: PatchOcrSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchSearchSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchSearchSettingsRequestDto)
    search?: PatchSearchSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchOAuthSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchOAuthSettingsRequestDto)
    oauth?: PatchOAuthSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchEmailSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchEmailSettingsRequestDto)
    email?: PatchEmailSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchNotificationSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchNotificationSettingsRequestDto)
    notifications?: PatchNotificationSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchSecuritySettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchSecuritySettingsRequestDto)
    security?: PatchSecuritySettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchNetworkSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchNetworkSettingsRequestDto)
    network?: PatchNetworkSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchSecurityMonitorSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchSecurityMonitorSettingsRequestDto)
    securityMonitor?: PatchSecurityMonitorSettingsRequestDto;

    @ApiPropertyOptional({ type: () => PatchStorageSettingsRequestDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => PatchStorageSettingsRequestDto)
    storage?: PatchStorageSettingsRequestDto;
}

export const CONFIG_CATEGORY_REQUEST_DTO_MAP = {
    platform: PlatformSettingsRequestDto,
    assets: AssetSettingsRequestDto,
    packages: PackageSettingsRequestDto,
    marketplace: MarketplaceSettingsRequestDto,
    runtime: RuntimeSettingsRequestDto,
    general: GeneralSettingsRequestDto,
    appearance: AppearanceSettingsRequestDto,
    editor: EditorSettingsRequestDto,
    llm: LlmSettingsRequestDto,
    ocr: OcrSettingsRequestDto,
    search: SearchSettingsRequestDto,
    oauth: OAuthSettingsRequestDto,
    email: EmailSettingsRequestDto,
    notifications: NotificationSettingsRequestDto,
    security: SecuritySettingsRequestDto,
    network: NetworkSettingsRequestDto,
    'security-monitor': SecurityMonitorSettingsRequestDto,
    storage: StorageSettingsRequestDto,
    assistant: AssistantSettingsRequestDto,
} as const;

export type ConfigCategoryName = keyof typeof CONFIG_CATEGORY_REQUEST_DTO_MAP;
