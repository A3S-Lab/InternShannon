/**
 * Search Engine Settings Section
 *
 * Configure a3s-search default engines, browser backend, and proxy settings.
 */

import { useReactive } from "ahooks";
import { AlertCircle, CheckCircle2, Download, FolderOpen, Globe2, RefreshCw, Save, Search, Shield } from "lucide-react";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notifyClientError } from "@/lib/client-error";
import { SEARCH_ENGINES } from "@/lib/constants";
import { desktopOnlyMessage, invokeDesktop, openNativeDialog } from "@/lib/tauri-runtime";
import settingsModel, { type BrowserBackend, type SearchConfig, type SearchEngineId } from "@/models/settings.model";
import {
  resolveSearchBrowserStatusFeedback,
  resolveSearchSaveButton,
  resolveSearchSaveFeedback,
  type SearchBrowserStatusFeedback,
  type SearchSaveFeedback,
  type SearchSaveStatus,
} from "./search-section-state";
import { SettingsCard, SettingsSection } from "./shared";

type SearchBrowserStatus = {
  backend: BrowserBackend;
  installed: boolean;
  path?: string | null;
  version?: string | null;
  supported: boolean;
  message?: string | null;
};

const LANGUAGES = [
  { value: "zh-CN", label: "中文" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
];

const SAFESEARCH_OPTIONS = [
  { value: "moderate", label: "适中" },
  { value: "strict", label: "严格" },
  { value: "off", label: "关闭" },
] as const;

function browserPath(config: Pick<SearchConfig, "browserBackend" | "lightpandaPath" | "chromePath">): string {
  return config.browserBackend === "lightpanda" ? config.lightpandaPath : config.chromePath;
}

function SearchSaveStatusPanel({ feedback }: { feedback: SearchSaveFeedback }) {
  const Icon = feedback.tone === "success" ? CheckCircle2 : feedback.tone === "error" ? AlertCircle : RefreshCw;
  const toneClass =
    feedback.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : feedback.tone === "error"
        ? "border-destructive/20 bg-destructive/5 text-destructive"
        : "border-primary/20 bg-primary/5 text-primary";

  return (
    <div
      role={feedback.role}
      aria-live={feedback.ariaLive}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${toneClass}`}
    >
      <Icon className={feedback.tone === "info" ? "mt-0.5 size-4 shrink-0 animate-spin" : "mt-0.5 size-4 shrink-0"} />
      <div className="min-w-0">
        <div className="font-medium">{feedback.title}</div>
        <div className="mt-0.5 break-words leading-5 opacity-80">{feedback.description}</div>
      </div>
    </div>
  );
}

function SearchBrowserStatusIcon({ feedback }: { feedback: SearchBrowserStatusFeedback }) {
  if (feedback.tone === "success") {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />;
  }

  if (feedback.tone === "info") {
    return <RefreshCw className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />;
  }

  return (
    <AlertCircle
      className={`mt-0.5 size-4 shrink-0 ${feedback.tone === "error" ? "text-destructive" : "text-amber-600"}`}
    />
  );
}

export function SearchSection() {
  const snap = useSnapshot(settingsModel.state);
  const config = snap.search;
  const configuredBrowserPath = browserPath(config);
  const proxyPoolValue = config.proxyPool.join("\n");
  const ui = useReactive({
    checking: false,
    downloading: false,
    status: null as SearchBrowserStatus | null,
    browserStatusError: null as string | null,
    proxyPoolText: config.proxyPool.join("\n"),
    saveStatus: { kind: "idle" } as SearchSaveStatus,
  });
  const saveFeedback = resolveSearchSaveFeedback(ui.saveStatus);
  const saveButton = resolveSearchSaveButton(ui.saveStatus);
  const browserStatusFeedback = resolveSearchBrowserStatusFeedback({
    checking: ui.checking,
    status: ui.status,
    error: ui.browserStatusError,
  });

  const refreshBrowserStatus = useCallback(async () => {
    ui.checking = true;
    ui.browserStatusError = null;
    try {
      const status = await invokeDesktop<SearchBrowserStatus>("get_search_browser_status", {
        backend: config.browserBackend,
        configuredPath: configuredBrowserPath || null,
      });
      ui.status = status;
      ui.browserStatusError = null;
      if (status.path) {
        if (status.backend === "lightpanda") {
          settingsModel.setSearchConfig({ lightpandaPath: status.path });
        } else {
          settingsModel.setSearchConfig({ chromePath: status.path });
        }
      }
    } catch (error) {
      ui.status = null;
      const normalized = notifyClientError(error, {
        title: "浏览器检测不可用",
        message: error instanceof Error ? error.message : desktopOnlyMessage("浏览器检测"),
        severity: "info",
        source: "settings.search.browser-status",
      });
      ui.browserStatusError = normalized.message;
    } finally {
      ui.checking = false;
    }
  }, [config.browserBackend, configuredBrowserPath, ui]);

  useEffect(() => {
    void refreshBrowserStatus();
  }, [refreshBrowserStatus]);

  useEffect(() => {
    ui.proxyPoolText = proxyPoolValue;
  }, [proxyPoolValue, ui]);

  const setConfig = (patch: Partial<SearchConfig>) => {
    settingsModel.setSearchConfig(patch);
    if ("browserBackend" in patch || "chromePath" in patch || "lightpandaPath" in patch) {
      ui.status = null;
      ui.browserStatusError = null;
    }
    if (ui.saveStatus.kind !== "saving") {
      ui.saveStatus = { kind: "idle" };
    }
  };

  const toggleEngine = (engineId: SearchEngineId, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...config.enabledEngines, engineId]))
      : config.enabledEngines.filter((id) => id !== engineId);
    setConfig({ enabledEngines: next.length > 0 ? next : ["ddg"] });
  };

  const handlePickBrowser = async () => {
    const selected = await openNativeDialog({
      directory: false,
      multiple: false,
    });
    if (typeof selected !== "string") {
      toast.info(desktopOnlyMessage("选择浏览器路径"));
      return;
    }
    if (config.browserBackend === "lightpanda") {
      setConfig({ lightpandaPath: selected });
    } else {
      setConfig({ chromePath: selected });
    }
    void refreshBrowserStatus();
  };

  const handleDownloadBrowser = async () => {
    ui.downloading = true;
    try {
      const status = await invokeDesktop<SearchBrowserStatus>("download_search_browser", { backend: "lightpanda" });
      ui.status = status;
      if (status.path) {
        setConfig({
          browserBackend: "lightpanda",
          lightpandaPath: status.path,
        });
        try {
          ui.saveStatus = { kind: "saving" };
          await settingsModel.syncToBackend();
          ui.saveStatus = { kind: "saved" };
        } catch (error) {
          const normalized = notifyClientError(error, {
            title: "Lightpanda 已下载，但路径保存失败",
            severity: "warning",
            source: "settings.search.lightpanda-path",
            display: "inline",
          });
          ui.saveStatus = { kind: "error", message: normalized.message };
        }
      }
      toast.success("Lightpanda 已下载");
    } catch (error) {
      notifyClientError(error, {
        title: "浏览器下载失败",
        source: "settings.search.browser-download",
      });
    } finally {
      ui.downloading = false;
    }
  };

  const handleProxyPoolChange = (value: string) => {
    ui.proxyPoolText = value;
    setConfig({
      proxyPool: value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    });
  };

  const handleSave = async () => {
    ui.saveStatus = { kind: "saving" };
    try {
      await settingsModel.syncToBackend();
      ui.saveStatus = { kind: "saved" };
      toast.success("搜索配置已保存");
    } catch (error) {
      const normalized = notifyClientError(error, {
        title: "搜索配置保存失败",
        source: "settings.search.save",
        display: "inline",
      });
      ui.saveStatus = { kind: "error", message: normalized.message };
    }
  };

  return (
    <SettingsSection title="搜索引擎" description="配置搜索引擎、无头浏览器和代理。" icon={Search} accentColor="blue">
      <div className="space-y-4">
        <SettingsCard
          title="默认搜索引擎"
          description="至少保留一个启用项，浏览器型引擎会使用下方后端。"
          icon={Globe2}
          accentColor="blue"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {SEARCH_ENGINES.map((engine) => {
              const checked = config.enabledEngines.includes(engine.id);
              const checkboxId = `search-engine-${engine.id}`;
              return (
                <label
                  key={engine.id}
                  htmlFor={checkboxId}
                  className="flex min-h-[78px] cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-primary/40"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    onCheckedChange={(value: boolean | "indeterminate") => toggleEngine(engine.id, value === true)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800">{engine.name}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{engine.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </SettingsCard>

        <SettingsCard
          title="浏览器后端"
          description="Lightpanda 可由书小安自动下载，Chrome 会检测本机安装。"
          icon={Download}
          accentColor="emerald"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto_auto]">
              <Select
                value={config.browserBackend}
                onValueChange={(value: string) => setConfig({ browserBackend: value as BrowserBackend })}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lightpanda">Lightpanda</SelectItem>
                  <SelectItem value="chrome">Chrome</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={browserPath(config)}
                onChange={(event) =>
                  config.browserBackend === "lightpanda"
                    ? setConfig({ lightpandaPath: event.target.value })
                    : setConfig({ chromePath: event.target.value })
                }
                className="h-11 font-mono text-sm"
                placeholder="浏览器可执行文件路径"
              />
              <Button type="button" variant="outline" className="h-11 shrink-0" onClick={handlePickBrowser}>
                <FolderOpen className="size-4" />
                浏览
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0"
                onClick={refreshBrowserStatus}
                disabled={ui.checking}
              >
                <RefreshCw className={ui.checking ? "size-4 animate-spin" : "size-4"} />
                检测
              </Button>
            </div>

            <div
              role={browserStatusFeedback.role}
              aria-live={browserStatusFeedback.ariaLive}
              className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2">
                <SearchBrowserStatusIcon feedback={browserStatusFeedback} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{browserStatusFeedback.title}</div>
                  <div className="mt-1 break-all text-xs leading-5 text-slate-500">
                    {browserStatusFeedback.description}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                className="h-10 shrink-0"
                onClick={handleDownloadBrowser}
                disabled={ui.downloading || config.browserBackend !== "lightpanda"}
              >
                <Download className="size-4" />
                {ui.downloading ? "下载中" : "下载 Lightpanda"}
              </Button>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          title="搜索参数"
          description="控制语言、安全搜索、结果数量和代理。"
          icon={Shield}
          accentColor="slate"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Select value={config.language} onValueChange={(value) => setConfig({ language: value })}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={config.safesearch}
                onValueChange={(value) =>
                  setConfig({
                    safesearch: value as SearchConfig["safesearch"],
                  })
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SAFESEARCH_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={5}
                max={120}
                value={config.timeout}
                onChange={(event) =>
                  setConfig({
                    timeout: Math.max(5, Number(event.target.value) || 30),
                  })
                }
                className="h-11"
                placeholder="超时秒数"
              />
              <Input
                type="number"
                min={1}
                max={50}
                value={config.limit}
                onChange={(event) =>
                  setConfig({
                    limit: Math.max(1, Number(event.target.value) || 10),
                  })
                }
                className="h-11"
                placeholder="结果数量"
              />
            </div>
            <Input
              value={config.proxy}
              onChange={(event) => setConfig({ proxy: event.target.value })}
              className="h-11 font-mono text-sm"
              placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:7890"
            />
            <textarea
              value={ui.proxyPoolText}
              onChange={(event) => handleProxyPoolChange(event.target.value)}
              className="min-h-[92px] w-full rounded-md border border-[var(--col-border)] bg-[var(--col-bg13)] px-3 py-2 font-mono text-sm text-[var(--col-text01)] outline-none transition-colors placeholder:text-[var(--col-text05)] focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/30"
              placeholder="代理池，每行一个 URL"
            />
            {saveFeedback ? <SearchSaveStatusPanel feedback={saveFeedback} /> : null}
            <div className="flex justify-end">
              <Button
                className="h-11"
                onClick={handleSave}
                disabled={saveButton.disabled}
                aria-label={saveButton.ariaLabel}
              >
                {saveButton.disabled ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saveButton.label}
              </Button>
            </div>
          </div>
        </SettingsCard>
      </div>
    </SettingsSection>
  );
}
