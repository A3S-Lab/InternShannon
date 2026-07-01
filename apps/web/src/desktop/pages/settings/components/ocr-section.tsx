import { useReactive } from "ahooks";
import { AlertCircle, CheckCircle2, Eye, RefreshCw, Save, ScanText } from "lucide-react";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { configApi, type OcrBackendSettings, type OcrOutputFormat, type OcrRequestFormat, type OcrSettings } from "@/lib/api/config";
import { notifyClientError } from "@/lib/client-error";
import { SettingsCard, SettingsSection } from "./shared";

const OUTPUT_FORMATS: Array<{ value: OcrOutputFormat; label: string }> = [
  { value: "text", label: "Text" },
  { value: "markdown", label: "Markdown" },
  { value: "json", label: "JSON" },
];

const REQUEST_FORMATS: Array<{ value: OcrRequestFormat; label: string }> = [
  { value: "multipart", label: "Multipart" },
  { value: "json-base64", label: "JSON Base64" },
  { value: "openai-vision", label: "OpenAI Vision" },
];

type LoadStatus = "idle" | "loading" | "ready" | "error";
type SaveStatus = "idle" | "saving" | "saved" | "error";

function cloneOcrSettings(settings: OcrSettings): OcrSettings {
  return {
    defaultBackend: settings.defaultBackend,
    backends: settings.backends.map((backend) => ({
      ...backend,
      headers: { ...(backend.headers ?? {}) },
      options: { ...(backend.options ?? {}) },
    })),
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 必须是对象");
  }
  return parsed as Record<string, unknown>;
}

function formatJsonObject(value?: Record<string, unknown>): string {
  if (!value || Object.keys(value).length === 0) return "";
  return JSON.stringify(value, null, 2);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-600">{label}</Label>
      {children}
    </div>
  );
}

function StatusPanel({
  status,
  message,
}: {
  status: LoadStatus | SaveStatus;
  message?: string | null;
}) {
  if (status === "idle" || status === "ready") return null;
  const tone = status === "saved" ? "success" : status === "error" ? "error" : "info";
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : RefreshCw;
  const title = status === "loading" ? "正在读取 OCR 配置" : status === "saving" ? "正在保存 OCR 配置" : status === "saved" ? "OCR 配置已保存" : "OCR 配置操作失败";
  const description = message ?? (status === "saved" ? "新的 OCR 后端设置会用于显式 OCR 接口。" : "");
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "error"
        ? "border-destructive/20 bg-destructive/5 text-destructive"
        : "border-primary/20 bg-primary/5 text-primary";

  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${toneClass}`}>
      <Icon className={tone === "info" ? "mt-0.5 size-4 shrink-0 animate-spin" : "mt-0.5 size-4 shrink-0"} />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {description ? <div className="mt-0.5 break-words leading-5 opacity-80">{description}</div> : null}
      </div>
    </div>
  );
}

export function OcrSection() {
  const ui = useReactive({
    loadStatus: "idle" as LoadStatus,
    saveStatus: "idle" as SaveStatus,
    error: null as string | null,
    settings: null as OcrSettings | null,
    selectedBackend: "",
    headersText: "",
    optionsText: "",
  });

  const selectedBackend = ui.settings?.backends.find((backend) => backend.name === ui.selectedBackend) ?? null;
  const enabledCount = ui.settings?.backends.filter((backend) => backend.enabled).length ?? 0;

  const selectBackend = useCallback(
    (name: string) => {
      ui.selectedBackend = name;
      const backend = ui.settings?.backends.find((item) => item.name === name);
      ui.headersText = formatJsonObject(backend?.headers);
      ui.optionsText = formatJsonObject(backend?.options);
    },
    [ui],
  );

  const loadSettings = useCallback(async () => {
    ui.loadStatus = "loading";
    ui.error = null;
    try {
      const settings = cloneOcrSettings(await configApi.getOcr());
      ui.settings = settings;
      selectBackend(settings.defaultBackend || settings.backends[0]?.name || "");
      ui.loadStatus = "ready";
    } catch (error) {
      const normalized = notifyClientError(error, {
        title: "OCR 配置读取失败",
        source: "settings.ocr.load",
        display: "inline",
      });
      ui.error = normalized.message;
      ui.loadStatus = "error";
    }
  }, [selectBackend, ui]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const patchSettings = (patch: Partial<OcrSettings>) => {
    if (!ui.settings) return;
    ui.settings = { ...ui.settings, ...patch };
    if (ui.saveStatus !== "saving") {
      ui.saveStatus = "idle";
      ui.error = null;
    }
  };

  const patchBackend = (patch: Partial<OcrBackendSettings>) => {
    if (!ui.settings || !selectedBackend) return;
    ui.settings = {
      ...ui.settings,
      backends: ui.settings.backends.map((backend) =>
        backend.name === selectedBackend.name ? { ...backend, ...patch } : backend,
      ),
    };
    if (ui.saveStatus !== "saving") {
      ui.saveStatus = "idle";
      ui.error = null;
    }
  };

  const handleSave = async () => {
    if (!ui.settings) return;
    ui.saveStatus = "saving";
    ui.error = null;
    try {
      if (selectedBackend) {
        patchBackend({
          headers: parseJsonObject(ui.headersText),
          options: parseJsonObject(ui.optionsText),
        });
      }
      await configApi.saveOcr(ui.settings);
      ui.saveStatus = "saved";
      toast.success("OCR 配置已保存");
    } catch (error) {
      const normalized = notifyClientError(error, {
        title: "OCR 配置保存失败",
        source: "settings.ocr.save",
        display: "inline",
      });
      ui.error = normalized.message;
      ui.saveStatus = "error";
    }
  };

  return (
    <SettingsSection title="OCR 服务" description="配置显式 OCR 接口使用的后端服务。" icon={ScanText} accentColor="emerald">
      <div className="space-y-4">
        <SettingsCard title="后端选择" description="至少启用一个后端后，/workspace/ocr 才会发起 OCR 请求。" icon={Eye} accentColor="emerald">
          <div className="space-y-4">
            <StatusPanel status={ui.loadStatus} message={ui.error} />
            {ui.settings ? (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
                  <Select value={ui.selectedBackend} onValueChange={selectBackend}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="选择 OCR 后端" />
                    </SelectTrigger>
                    <SelectContent>
                      {ui.settings.backends.map((backend) => (
                        <SelectItem key={backend.name} value={backend.name}>
                          {backend.name}
                          {backend.name === ui.settings?.defaultBackend ? "（默认）" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => selectedBackend && patchSettings({ defaultBackend: selectedBackend.name })}
                    disabled={!selectedBackend || selectedBackend.name === ui.settings.defaultBackend}
                  >
                    {selectedBackend?.name === ui.settings.defaultBackend ? "当前默认" : "设为默认"}
                  </Button>
                  <Button type="button" variant="outline" className="h-11" onClick={loadSettings} disabled={ui.loadStatus === "loading"}>
                    <RefreshCw className={ui.loadStatus === "loading" ? "size-4 animate-spin" : "size-4"} />
                    重新读取
                  </Button>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  已启用 {enabledCount} / {ui.settings.backends.length} 个 OCR 后端。当前默认后端：{ui.settings.defaultBackend || "未设置"}。
                </div>
              </>
            ) : null}
          </div>
        </SettingsCard>

        {selectedBackend ? (
          <SettingsCard title={selectedBackend.name} description="配置连接参数和请求格式。" icon={ScanText} accentColor="slate">
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">启用该后端</div>
                  <div className="mt-1 text-xs text-slate-500">关闭时显式 OCR 不会调用这个服务。</div>
                </div>
                <Switch checked={selectedBackend.enabled} onCheckedChange={(checked) => patchBackend({ enabled: checked })} />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Base URL">
                  <Input value={selectedBackend.baseUrl} onChange={(event) => patchBackend({ baseUrl: event.target.value })} className="h-11 font-mono text-sm" placeholder="http://localhost:30000" />
                </Field>
                <Field label="Endpoint">
                  <Input value={selectedBackend.endpoint ?? ""} onChange={(event) => patchBackend({ endpoint: event.target.value })} className="h-11 font-mono text-sm" placeholder="/ocr" />
                </Field>
                <Field label="请求格式">
                  <Select value={selectedBackend.requestFormat ?? "multipart"} onValueChange={(value) => patchBackend({ requestFormat: value as OcrRequestFormat })}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_FORMATS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="输出格式">
                  <Select value={selectedBackend.outputFormat ?? "text"} onValueChange={(value) => patchBackend({ outputFormat: value as OcrOutputFormat })}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTPUT_FORMATS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="模型">
                  <Input value={selectedBackend.model ?? ""} onChange={(event) => patchBackend({ model: event.target.value })} className="h-11 font-mono text-sm" placeholder="Unlimited-OCR" />
                </Field>
                <Field label="超时（毫秒）">
                  <Input
                    type="number"
                    min={1000}
                    value={selectedBackend.timeoutMs ?? 120000}
                    onChange={(event) => patchBackend({ timeoutMs: Math.max(1000, Number(event.target.value) || 120000) })}
                    className="h-11"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Headers JSON">
                  <Textarea value={ui.headersText} onChange={(event) => (ui.headersText = event.target.value)} className="min-h-[120px] font-mono text-xs" placeholder='{"Authorization":"Bearer ..."}' />
                </Field>
                <Field label="Options JSON">
                  <Textarea value={ui.optionsText} onChange={(event) => (ui.optionsText = event.target.value)} className="min-h-[120px] font-mono text-xs" placeholder='{"prompt":"Extract all visible text"}' />
                </Field>
              </div>

              <StatusPanel status={ui.saveStatus} message={ui.error} />
              <div className="flex justify-end">
                <Button type="button" className="h-11" onClick={handleSave} disabled={ui.saveStatus === "saving"}>
                  {ui.saveStatus === "saving" ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {ui.saveStatus === "saving" ? "保存中" : "保存 OCR 配置"}
                </Button>
              </div>
            </div>
          </SettingsCard>
        ) : null}
      </div>
    </SettingsSection>
  );
}
