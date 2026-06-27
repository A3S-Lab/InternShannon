export type AssetRuntimeBindingKind = 'agent' | 'workflow' | 'service' | 'job' | 'mcp' | 'tool';
export type AssetRuntimeTargetKind = 'asset' | 'package' | 'image' | 'workflow';
export type AssetRuntimeProtocol = 'http' | 'grpc' | 'stdio' | 'websocket';

/**
 * 工具/智能体的隔离级别 —— 决定后端调度路径
 *  - native:    平台内置,in-process 直接调用,无隔离开销
 *  - serving:   按需启动的轻量 Function 实例(共享 Runtime image + 源码挂载)
 *               冷启动 200-500ms,scale-to-zero
 *  - container: 标准容器 Deployment,自带镜像,长驻或弹性副本
 */
export type AssetRuntimeIsolation = 'native' | 'serving' | 'container';

/**
 * serving 隔离级别下使用的共享 Runtime 镜像标识 —— 决定语言/版本
 * container 模式忽略此字段(由 runtime.image 决定);native 模式不适用
 */
export type AssetSharedRuntime = 'node-20' | 'python-3.11' | 'deno-1' | 'wasm-1';

export interface AssetRuntimeTarget {
    kind: AssetRuntimeTargetKind;
    packageId?: string;
    version?: string;
    image?: string;
    workflowId?: string;
    ref?: string;
}

export interface AssetRuntimeSpec {
    kind?: string;
    image?: string;
    command?: string;
    args: string[];
    entrypoint?: string;
    workingDirectory?: string;
    /**
     * serving 模式下指定共享 Runtime 镜像(node-20 / python-3.11 / …),
     * 由 RuntimePackageResolverService.resolveLaunchSpec 解析为实际镜像。
     * container 模式忽略此字段,以 image 为准。
     */
    sharedRuntime?: AssetSharedRuntime;
}

export interface AssetRuntimeEnvBinding {
    name: string;
    value?: string;
    secretRef?: string;
    required: boolean;
    description?: string;
}

export interface AssetRuntimePortBinding {
    name?: string;
    port: number;
    protocol: AssetRuntimeProtocol;
    public: boolean;
}

export interface AssetRuntimeResourceBinding {
    cpu?: string;
    memory?: string;
    storage?: string;
    gpu?: string;
    replicas?: number;
    concurrency?: number;
    timeoutSeconds?: number;
}

export interface AssetRuntimeNetworkBinding {
    ports: AssetRuntimePortBinding[];
    endpointPath?: string;
}

export interface AssetRuntimeBinding {
    version: 1;
    kind: AssetRuntimeBindingKind;
    /**
     * 隔离级别 —— 决定后端调度路径(native / serving / container)。
     * 缺省值 'container',保证已有数据继续按容器 Deployment 路径走。
     */
    isolation: AssetRuntimeIsolation;
    target: AssetRuntimeTarget;
    runtime: AssetRuntimeSpec;
    env: AssetRuntimeEnvBinding[];
    requiredSecrets: string[];
    resources: AssetRuntimeResourceBinding;
    network: AssetRuntimeNetworkBinding;
    enabled: boolean;
    metadata: Record<string, unknown>;
    createdBy?: string;
    updatedBy?: string;
    createdAt: string;
    updatedAt: string;
}

export type AssetRuntimeBindingIssueSeverity = 'error' | 'warning' | 'info';

export interface AssetRuntimeBindingIssue {
    code: string;
    severity: AssetRuntimeBindingIssueSeverity;
    message: string;
    path?: string;
    details?: Record<string, unknown>;
}

export interface AssetRuntimeBindingValidation {
    assetId: string;
    configured: boolean;
    valid: boolean;
    requiredSecrets: string[];
    missingSecrets: string[];
    expiredSecrets: string[];
    issues: AssetRuntimeBindingIssue[];
    checkedAt: string;
}

export const ASSET_RUNTIME_BINDING_KINDS: AssetRuntimeBindingKind[] = ['agent', 'workflow', 'service', 'job', 'mcp', 'tool'];
export const ASSET_RUNTIME_TARGET_KINDS: AssetRuntimeTargetKind[] = ['asset', 'package', 'image', 'workflow'];
export const ASSET_RUNTIME_PROTOCOLS: AssetRuntimeProtocol[] = ['http', 'grpc', 'stdio', 'websocket'];
export const ASSET_RUNTIME_ISOLATIONS: AssetRuntimeIsolation[] = ['native', 'serving', 'container'];
export const ASSET_SHARED_RUNTIMES: AssetSharedRuntime[] = ['node-20', 'python-3.11', 'deno-1', 'wasm-1'];

/** 未显式设置 isolation 时使用的默认值,保证既有数据按容器路径继续工作。 */
export const DEFAULT_ASSET_RUNTIME_ISOLATION: AssetRuntimeIsolation = 'container';

export function isAssetRuntimeBindingKind(value: unknown): value is AssetRuntimeBindingKind {
    return typeof value === 'string' && ASSET_RUNTIME_BINDING_KINDS.includes(value as AssetRuntimeBindingKind);
}

export function isAssetRuntimeTargetKind(value: unknown): value is AssetRuntimeTargetKind {
    return typeof value === 'string' && ASSET_RUNTIME_TARGET_KINDS.includes(value as AssetRuntimeTargetKind);
}

export function isAssetRuntimeProtocol(value: unknown): value is AssetRuntimeProtocol {
    return typeof value === 'string' && ASSET_RUNTIME_PROTOCOLS.includes(value as AssetRuntimeProtocol);
}

export function isAssetRuntimeIsolation(value: unknown): value is AssetRuntimeIsolation {
    return typeof value === 'string' && ASSET_RUNTIME_ISOLATIONS.includes(value as AssetRuntimeIsolation);
}

export function isAssetSharedRuntime(value: unknown): value is AssetSharedRuntime {
    return typeof value === 'string' && ASSET_SHARED_RUNTIMES.includes(value as AssetSharedRuntime);
}
