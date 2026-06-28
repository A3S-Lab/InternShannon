import { useReactive } from "ahooks";
import { Pencil, PlugZap, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { agentApi, type McpServerStatus } from "@/lib/agent-api";
import { notifyClientError } from "@/lib/client-error";
import { type McpServerConfig, normalizeMcpServerConfigs } from "@/lib/mcp-server-config";
import { BUILTIN_MCP_LIBRARY } from "./builtin-mcp-library";
import {
  formatMcpActionError,
  isMcpServerRowActionPending,
  type McpServerRowActionRef,
  resolveMcpServerFormValidation,
  resolveMcpServerRowActionFeedback,
  resolveMcpServerSavePlan,
} from "./mcp-section-state";
import { SettingsCard, SettingsSection } from "./shared";

function parseKeyValueLines(input: string): Record<string, string> | undefined {
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;

  const out: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseArgs(input: string): string[] | undefined {
  const args = input
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return args.length > 0 ? args : undefined;
}

function toKeyValueLines(input?: Record<string, string>): string {
  if (!input) return "";
  return Object.entries(input)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function toArgsText(input?: string[]): string {
  return input?.join(" ") ?? "";
}

function readMcpServerConfigs(config: unknown): McpServerConfig[] {
  if (!config || typeof config !== "object") return [];
  const settings = config as {
    mcpServers?: unknown;
    ai?: { mcpServers?: unknown };
  };
  if (Array.isArray(settings.ai?.mcpServers)) return normalizeMcpServerConfigs(settings.ai.mcpServers);
  if (Array.isArray(settings.mcpServers)) return normalizeMcpServerConfigs(settings.mcpServers);
  return [];
}

export function McpSection() {
  const state = useReactive({
    loading: false,
    servers: {} as Record<string, McpServerStatus>,
    globalConfigs: [] as McpServerConfig[],
    saving: false,
    actionError: "",
    pendingServerAction: null as McpServerRowActionRef | null,
    serverActionError: null as (McpServerRowActionRef & { message?: string | null }) | null,
    statusFilter: "all" as "all" | "enabled" | "connected",
    name: "",
    transport: "stdio" as "stdio" | "http",
    command: "",
    args: "",
    url: "",
    headersInput: "",
    envInput: "",
    timeoutSecs: "60",
    editingName: null as string | null,
  });

  const resetForm = useCallback(() => {
    state.name = "";
    state.transport = "stdio";
    state.command = "";
    state.args = "";
    state.url = "";
    state.headersInput = "";
    state.envInput = "";
    state.timeoutSecs = "60";
    state.editingName = null;
    state.actionError = "";
  }, [state]);

  const fillFormFromConfig = useCallback(
    (config: McpServerConfig) => {
      state.name = config.name;
      state.actionError = "";
      state.envInput = toKeyValueLines(config.env);
      state.timeoutSecs = String(config.tool_timeout_secs ?? 60);
      if (config.transport.type === "stdio") {
        state.transport = "stdio";
        state.command = config.transport.command;
        state.args = toArgsText(config.transport.args);
        state.url = "";
        state.headersInput = "";
      } else {
        state.transport = "http";
        state.url = config.transport.url;
        state.headersInput = toKeyValueLines(config.transport.headers);
        state.command = "";
        state.args = "";
      }
    },
    [state],
  );

  const importFromLibrary = useCallback(
    (key: string) => {
      const item = BUILTIN_MCP_LIBRARY.find((p) => p.key === key);
      if (!item) return;
      // 一键预填:从官方库选一个,免手写 transport/command/args;需密钥的预填空 env 行让用户补值。
      state.editingName = null;
      state.actionError = "";
      state.transport = "stdio";
      state.name = item.suggestedName;
      state.command = item.command;
      state.args = item.args.join(" ");
      state.url = "";
      state.headersInput = "";
      state.envInput = (item.env ?? []).map((k) => `${k}=`).join("\n");
      state.timeoutSecs = "60";
    },
    [state],
  );

  const refresh = useCallback(async () => {
    state.loading = true;
    try {
      const [status, config] = await Promise.all([agentApi.listMcpServers(), agentApi.fetchConfig().catch(() => ({}))]);
      state.servers = status || {};
      state.globalConfigs = readMcpServerConfigs(config);
    } catch (error) {
      notifyClientError(error, {
        title: "加载 MCP 服务状态失败",
        source: "settings.mcp.refresh",
      });
    } finally {
      state.loading = false;
    }
  }, [state]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const formValidation = useMemo(
    () =>
      resolveMcpServerFormValidation({
        name: state.name,
        transport: state.transport,
        command: state.command,
        url: state.url,
      }),
    [state.name, state.transport, state.command, state.url],
  );

  const handleSave = async () => {
    if (!formValidation.canSave) return;

    const timeout = Number.parseInt(state.timeoutSecs, 10);
    const config: McpServerConfig = {
      name: state.name.trim(),
      transport:
        state.transport === "stdio"
          ? {
              type: "stdio",
              command: state.command.trim(),
              args: parseArgs(state.args),
            }
          : {
              type: "http",
              url: state.url.trim(),
              headers: parseKeyValueLines(state.headersInput),
            },
      env: parseKeyValueLines(state.envInput),
      tool_timeout_secs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60,
      enabled: true,
    };
    const savePlan = resolveMcpServerSavePlan({
      editingName: state.editingName,
      nextName: config.name,
    });

    state.saving = true;
    state.actionError = "";
    try {
      await agentApi.addMcpServer(config);
      if (savePlan.removePreviousAfterUpsert && savePlan.previousName) {
        await agentApi.removeMcpServer(savePlan.previousName);
      }
      toast.success(savePlan.successMessage);
      resetForm();
      await refresh();
    } catch (error) {
      const normalized = notifyClientError(error, {
        title: "保存 MCP 服务失败",
        source: "settings.mcp.save",
        display: "inline",
      });
      state.actionError = formatMcpActionError(normalized.message || error);
      await refresh().catch(() => undefined);
    } finally {
      state.saving = false;
    }
  };

  const handleRemove = async (serverName: string) => {
    try {
      await agentApi.removeMcpServer(serverName);
      toast.success(`MCP 服务 ${serverName} 已移除`);
      if (state.serverActionError?.serverName === serverName) {
        state.serverActionError = null;
      }
      await refresh();
    } catch (error) {
      const normalized = notifyClientError(error, {
        title: "移除 MCP 服务失败",
        source: "settings.mcp.remove",
        display: "inline",
      });
      state.serverActionError = {
        serverName,
        kind: "remove",
        message: normalized.message || formatMcpActionError(error),
      };
    } finally {
      state.pendingServerAction = null;
    }
  };

  const handleToggleEnabled = async (config: McpServerConfig, enabled: boolean) => {
    state.pendingServerAction = { serverName: config.name, kind: "toggle" };
    state.serverActionError = null;
    try {
      await agentApi.addMcpServer({ ...config, enabled });
      toast.success(`MCP 服务 ${config.name} 已${enabled ? "启用" : "禁用"}`);
      if (state.editingName === config.name) {
        fillFormFromConfig({ ...config, enabled });
      }
      await refresh();
    } catch (error) {
      const normalized = notifyClientError(error, {
        title: "更新 MCP 服务状态失败",
        source: "settings.mcp.toggle",
        display: "inline",
      });
      state.serverActionError = {
        serverName: config.name,
        kind: "toggle",
        message: normalized.message || formatMcpActionError(error),
      };
    } finally {
      state.pendingServerAction = null;
    }
  };

  const configByName = useMemo(
    () => Object.fromEntries(state.globalConfigs.map((cfg) => [cfg.name, cfg])),
    [state.globalConfigs],
  );
  const displayNames = useMemo(() => {
    const names = new Set<string>(state.globalConfigs.map((cfg) => cfg.name));
    for (const name of Object.keys(state.servers)) names.add(name);
    return Array.from(names);
  }, [state.globalConfigs, state.servers]);
  const filteredNames = useMemo(() => {
    if (state.statusFilter === "all") return displayNames;
    return displayNames.filter((name) => {
      const config = configByName[name];
      const status = state.servers[name];
      if (state.statusFilter === "enabled") return (config?.enabled ?? true) === true;
      return !!status?.connected;
    });
  }, [state.statusFilter, displayNames, configByName, state.servers]);
  const filterCounts = useMemo(() => {
    const all = displayNames.length;
    const enabled = displayNames.filter((name) => (configByName[name]?.enabled ?? true) === true).length;
    const connected = displayNames.filter((name) => !!state.servers[name]?.connected).length;
    return { all, enabled, connected };
  }, [displayNames, configByName, state.servers]);

  return (
    <SettingsSection
      title="MCP 服务"
      description="管理全局 MCP 服务，供所有会话复用。"
      icon={PlugZap}
      accentColor="blue"
    >
      <SettingsCard
        title="全局服务状态"
        description="查看和管理所有已注册的 MCP 服务"
        icon={PlugZap}
        accentColor="blue"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Button
                  variant={state.statusFilter === "all" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    state.statusFilter = "all";
                  }}
                >
                  全部({filterCounts.all})
                </Button>
                <Button
                  variant={state.statusFilter === "enabled" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    state.statusFilter = "enabled";
                  }}
                >
                  已启用({filterCounts.enabled})
                </Button>
                <Button
                  variant={state.statusFilter === "connected" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    state.statusFilter = "connected";
                  }}
                >
                  已连接({filterCounts.connected})
                </Button>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={refresh} disabled={state.loading}>
              <RefreshCcw className="size-3 mr-1" />
              刷新
            </Button>
          </div>
          {filteredNames.length === 0 ? (
            <p className="text-xs text-slate-500">
              {state.statusFilter === "all" ? "当前没有已注册的 MCP 服务。" : "当前筛选条件下没有匹配的 MCP 服务。"}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredNames.map((serverName) => {
                const status = state.servers[serverName];
                const config = configByName[serverName];
                const isToggling = isMcpServerRowActionPending(state.pendingServerAction, serverName, "toggle");
                const isRemoving = isMcpServerRowActionPending(state.pendingServerAction, serverName, "remove");
                const rowActionFeedback = state.serverActionError
                  ? resolveMcpServerRowActionFeedback(state.serverActionError, serverName)
                  : null;
                const rowActionBusy = isToggling || isRemoving;
                return (
                  <div key={serverName} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span
                        className={`size-2 rounded-full ${status?.connected ? "bg-emerald-500" : "bg-slate-400"}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{serverName}</p>
                        <p className="text-[11px] text-slate-500">
                          {config?.enabled === false ? "已禁用" : status?.connected ? "已连接" : "未连接"}
                          {typeof status?.tool_count === "number" ? ` · ${status.tool_count} tools` : ""}
                        </p>
                        {status?.error && !status.connected ? (
                          <p className="mt-0.5 break-all text-[11px] text-destructive" title={status.error}>
                            连接失败：{status.error}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!config || rowActionBusy}
                          onClick={() => {
                            if (!config) return;
                            handleToggleEnabled(config, !(config.enabled ?? true));
                          }}
                        >
                          {isToggling ? "更新中" : config?.enabled === false ? "启用" : "禁用"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!config || rowActionBusy}
                          onClick={() => {
                            if (!config) return;
                            state.editingName = serverName;
                            state.serverActionError = null;
                            fillFormFromConfig(config);
                          }}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-500"
                          disabled={rowActionBusy}
                          onClick={() => {
                            state.pendingServerAction = { serverName, kind: "remove" };
                            state.serverActionError = null;
                            handleRemove(serverName);
                          }}
                          aria-label={`移除 MCP 服务 ${serverName}`}
                        >
                          {isRemoving ? <RefreshCcw className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                        </Button>
                      </div>
                    </div>
                    {rowActionFeedback ? (
                      <div
                        role={rowActionFeedback.role}
                        aria-live={rowActionFeedback.ariaLive}
                        className="mt-2 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
                      >
                        <div className="font-medium">{rowActionFeedback.title}</div>
                        <div className="mt-0.5 break-words leading-5 opacity-80">{rowActionFeedback.description}</div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard
        title={state.editingName ? `编辑全局 MCP 服务：${state.editingName}` : "添加全局 MCP 服务"}
        description="配置 MCP 服务的传输方式、命令和环境变量"
        icon={Plus}
        accentColor="emerald"
      >
        <div className="space-y-4">
          {!state.editingName ? (
            <div className="space-y-1.5 rounded-md border border-emerald-100 bg-emerald-50/40 p-3">
              <Label className="text-xs font-medium text-emerald-700">从官方库导入</Label>
              <Select value="" onValueChange={(v) => importFromLibrary(v)}>
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue placeholder="选一个官方 MCP 自动预填命令/参数/环境变量…" />
                </SelectTrigger>
                <SelectContent>
                  {BUILTIN_MCP_LIBRARY.map((item) => (
                    <SelectItem key={item.key} value={item.key} className="text-sm">
                      <span className="font-medium">{item.title}</span>
                      <span className="ml-2 text-xs text-slate-500">{item.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500">
                免手写 transport/command/args;选后可继续微调,需密钥的会预留空 env 行待你补值。
              </p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">服务名</Label>
              <Input
                className="h-10 text-sm font-mono"
                placeholder="filesystem"
                value={state.name}
                onChange={(e) => {
                  state.name = e.target.value;
                  state.actionError = "";
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">传输方式</Label>
              <Select
                value={state.transport}
                onValueChange={(v) => {
                  state.transport = v as "stdio" | "http";
                  state.actionError = "";
                }}
              >
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio" className="text-sm">
                    stdio
                  </SelectItem>
                  <SelectItem value="http" className="text-sm">
                    http
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {state.transport === "stdio" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Command</Label>
                <Input
                  className="h-10 text-sm font-mono"
                  placeholder="npx"
                  value={state.command}
                  onChange={(e) => {
                    state.command = e.target.value;
                    state.actionError = "";
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Args（空格分隔）</Label>
                <Input
                  className="h-10 text-sm font-mono"
                  placeholder="-y @modelcontextprotocol/server-filesystem /path"
                  value={state.args}
                  onChange={(e) => {
                    state.args = e.target.value;
                    state.actionError = "";
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">URL</Label>
              <Input
                className="h-10 text-sm font-mono"
                placeholder="http://127.0.0.1:8787/mcp"
                value={state.url}
                onChange={(e) => {
                  state.url = e.target.value;
                  state.actionError = "";
                }}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Headers（KEY=VALUE，每行一个）</Label>
              <textarea
                className="w-full min-h-[72px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono"
                placeholder="Authorization=Bearer ..."
                value={state.headersInput}
                onChange={(e) => {
                  state.headersInput = e.target.value;
                  state.actionError = "";
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Env（KEY=VALUE，每行一个）</Label>
              <textarea
                className="w-full min-h-[72px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono"
                placeholder="API_TOKEN=..."
                value={state.envInput}
                onChange={(e) => {
                  state.envInput = e.target.value;
                  state.actionError = "";
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1.5 w-32">
              <Label className="text-xs text-slate-600">超时（秒）</Label>
              <Input
                type="number"
                min={1}
                className="h-10 text-sm"
                value={state.timeoutSecs}
                onChange={(e) => {
                  state.timeoutSecs = e.target.value;
                  state.actionError = "";
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              {state.editingName && (
                <Button variant="outline" size="sm" className="h-10 text-sm" onClick={resetForm}>
                  取消编辑
                </Button>
              )}
              <Button
                size="sm"
                className="h-10 text-sm"
                disabled={!formValidation.canSave || state.saving}
                onClick={handleSave}
                aria-label={state.saving ? "正在保存 MCP 服务配置" : formValidation.saveButtonAriaLabel}
              >
                {state.saving ? <RefreshCcw className="size-4 mr-1 animate-spin" /> : <Plus className="size-4 mr-1" />}
                {state.saving ? "保存中" : state.editingName ? "保存更新" : "添加服务"}
              </Button>
            </div>
          </div>
          {!formValidation.canSave && !state.actionError ? (
            <output
              aria-live="polite"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
            >
              <div className="font-medium">{formValidation.title}</div>
              <div className="mt-0.5 break-words leading-5 opacity-80">{formValidation.description}</div>
            </output>
          ) : null}
          {state.actionError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              <div className="font-medium">保存 MCP 服务失败</div>
              <div className="mt-0.5 break-words leading-5 opacity-80">{state.actionError}</div>
            </div>
          ) : null}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
