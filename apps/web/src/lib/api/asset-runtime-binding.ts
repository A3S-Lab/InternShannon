import { apiClient } from "./client";

export type AssetRuntimeIsolation = "native" | "serving" | "container";
export type AssetSharedRuntime = "node-20" | "python-3.11" | "deno-1" | "wasm-1";
export type AssetRuntimeBindingKind = "agent" | "service" | "job" | "mcp" | "tool";

export const ASSET_RUNTIME_ISOLATIONS: Array<{
  value: AssetRuntimeIsolation;
  label: string;
  description: string;
}> = [
  {
    value: "container",
    label: "Container 容器",
    description: "标准容器 Deployment,自带镜像,长驻或弹性副本。适合高 QPS / 长驻服务。",
  },
  {
    value: "serving",
    label: "Serving 函数",
    description:
      "按需启动的轻量 Function 实例,共享 Runtime 镜像 + 源码挂载。冷启动 200-500ms,scale-to-zero。适合低 QPS 工具。",
  },
  {
    value: "native",
    label: "Native 内置",
    description: "平台内置 in-process 直接调用,无隔离开销。仅限平台预置资产。",
  },
];

export const ASSET_SHARED_RUNTIMES: Array<{ value: AssetSharedRuntime; label: string }> = [
  { value: "node-20", label: "Node.js 20" },
  { value: "python-3.11", label: "Python 3.11" },
  { value: "deno-1", label: "Deno 1" },
  { value: "wasm-1", label: "WebAssembly 1" },
];

export interface AssetRuntimeSpec {
  kind?: string;
  image?: string;
  command?: string;
  args?: string[];
  entrypoint?: string;
  workingDirectory?: string;
  sharedRuntime?: AssetSharedRuntime;
}

export interface AssetRuntimeBindingIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
}

export interface AssetRuntimeBinding {
  version: 1;
  kind: AssetRuntimeBindingKind;
  isolation: AssetRuntimeIsolation;
  runtime: AssetRuntimeSpec;
  env: Array<{ name: string; value?: string; secretRef?: string; required: boolean; description?: string }>;
  requiredSecrets: string[];
  resources: {
    cpu?: string;
    memory?: string;
    storage?: string;
    gpu?: string;
    replicas?: number;
    concurrency?: number;
    timeoutSeconds?: number;
  };
  network: {
    ports: Array<{ name?: string; port: number; protocol: string; public: boolean }>;
    endpointPath?: string;
  };
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
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

export interface AssetRuntimeBindingState {
  assetId: string;
  configured: boolean;
  binding?: AssetRuntimeBinding;
  validation: AssetRuntimeBindingValidation;
}

export interface UpsertAssetRuntimeBindingInput {
  kind?: AssetRuntimeBindingKind;
  isolation?: AssetRuntimeIsolation;
  target?: { kind?: string; packageId?: string; version?: string; image?: string };
  runtime?: Partial<AssetRuntimeSpec>;
  env?: Array<{ name: string; value?: string; secretRef?: string; required?: boolean; description?: string }>;
  requiredSecrets?: string[];
  resources?: AssetRuntimeBinding["resources"];
  network?: { ports?: AssetRuntimeBinding["network"]["ports"]; endpointPath?: string };
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export const assetRuntimeBindingApi = {
  get: (assetId: string) =>
    apiClient.get<AssetRuntimeBindingState>(`/api/assets/${assetId}/runtime-binding`),
  upsert: (assetId: string, input: UpsertAssetRuntimeBindingInput) =>
    apiClient.put<AssetRuntimeBindingState>(`/api/assets/${assetId}/runtime-binding`, input),
  validate: (assetId: string) =>
    apiClient.post<AssetRuntimeBindingValidation>(
      `/api/assets/${assetId}/runtime-binding/validate`,
      {},
    ),
  remove: (assetId: string) =>
    apiClient.delete<void>(`/api/assets/${assetId}/runtime-binding`),
};
