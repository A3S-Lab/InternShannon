import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import AnthropicLogoUrl from "@/assets/images/logos/llm/anthropic.svg";
import OpenAiLogoUrl from "@/assets/images/logos/llm/openai.svg";
import ZhipuLogoUrl from "@/assets/images/logos/llm/zhipu.svg";
import { configApi, type ProviderModelCandidate } from "@/lib/api/config";
import type { ModelConfig, ProviderConfig } from "@/lib/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../ui";
import {
  ProviderDefaultPill,
  ProviderEmptyState,
  ProviderSettingsSection,
  ProviderStatusPill,
  ProviderTag,
} from "./provider-settings-layout";
import {
  buildProviderModelImportRows,
  filterProviderModelImportRows,
  hydrateSelectedProviderModels,
  providerConnectionPatchFromDraft,
  pruneProviderConnectionDrafts,
  readProviderConnectionDraftMemory,
  resolveProviderConnectionDraft,
  storeProviderConnectionDraft,
  type ProviderConnectionDraft,
  type ProviderModelImportFilter,
  type ProviderModelImportRow,
  type ProviderConnectionDraftMap,
  writeProviderConnectionDraftMemory,
} from "./ai-provider-settings-state";

const OPENAI_COMPATIBLE_PROVIDER_OPTION = "openai-compatible";

export const PROVIDER_OPTIONS = [
  {
    value: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
  },
  {
    value: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    value: "zhipu",
    label: "智谱 GLM",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    value: OPENAI_COMPATIBLE_PROVIDER_OPTION,
    label: "OpenAI 兼容接口",
    defaultBaseUrl: "",
  },
] as const;

type ProviderHealthTone = "success" | "warning" | "neutral";
type LlmProviderLogoMeta = {
  label: string;
  brandColor: string;
  logoUrl?: string;
  initials: string;
};

const DEFAULT_MODEL_MENU_ID = "default-model";
const PROVIDER_MENU_PREFIX = "provider:";
const PROVIDER_LOGO_META: Record<string, LlmProviderLogoMeta> = {
  anthropic: { label: "Anthropic", brandColor: "#D97757", logoUrl: AnthropicLogoUrl, initials: "A" },
  openai: { label: "OpenAI", brandColor: "#111827", logoUrl: OpenAiLogoUrl, initials: "AI" },
  zhipu: { label: "智谱 GLM", brandColor: "#2563EB", logoUrl: ZhipuLogoUrl, initials: "智" },
};

const integerFormatter = new Intl.NumberFormat("zh-CN");

function formatInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? integerFormatter.format(value) : "-";
}

function providerMenuId(providerName: string) {
  return `${PROVIDER_MENU_PREFIX}${providerName}`;
}

function providerNameFromMenuId(menuId: string) {
  return menuId.startsWith(PROVIDER_MENU_PREFIX) ? menuId.slice(PROVIDER_MENU_PREFIX.length) : "";
}

function getProviderLogoMeta(providerName: string): LlmProviderLogoMeta {
  const normalized = providerName.trim().toLowerCase();
  const option = PROVIDER_OPTIONS.find((item) => item.value === normalized);
  const label = option?.label ?? providerName;
  const fallbackInitials = label
    .replace(/\(.+\)/, "")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return PROVIDER_LOGO_META[normalized] ?? { label, brandColor: "#64748B", initials: fallbackInitials || "LLM" };
}

function providerHasCredential(provider: ProviderConfig) {
  return Boolean(provider.apiKey?.trim() || provider.models.some((model) => model.apiKey?.trim()));
}

function providerCredentialLabel(provider: ProviderConfig) {
  if (provider.apiKey?.trim()) return "Provider Key";
  if (provider.models.some((model) => model.apiKey?.trim())) return "模型覆盖";
  if (provider.name === "openai") return "环境变量";
  return "未配置";
}

function modelCredentialLabel(provider: ProviderConfig, model: ModelConfig) {
  if (model.apiKey?.trim()) return "模型覆盖";
  if (provider.apiKey?.trim()) return "继承";
  if (provider.name === "openai") return "环境变量";
  return "缺少凭据";
}

function defaultCredentialTone(
  provider: ProviderConfig | undefined,
  model: ModelConfig | undefined,
): ProviderHealthTone {
  if (!provider || !model) return "warning";
  if (model.apiKey?.trim() || provider.apiKey?.trim() || provider.name === "openai") return "success";
  return "warning";
}

function buildHealthIssues({
  providers,
  defaultProvider,
  defaultModel,
  validationIssues = [],
}: {
  providers: ProviderConfig[];
  defaultProvider: string;
  defaultModel: string;
  validationIssues?: string[];
}) {
  const issues = [...validationIssues];
  const defProvider = providers.find((provider) => provider.name === defaultProvider);
  const defModel = defProvider?.models.find((model) => model.id === defaultModel);

  if (providers.length > 0 && (!defProvider || !defModel)) {
    issues.push("默认模型未指向有效配置");
  }
  for (const provider of providers) {
    if (provider.models.length === 0) {
      issues.push(`${provider.name} 还没有模型`);
    }
    if (!providerHasCredential(provider) && provider.name !== "openai") {
      issues.push(`${provider.name} 没有显式凭据`);
    }
  }
  if (defProvider && defModel && defaultCredentialTone(defProvider, defModel) === "warning") {
    issues.push("默认模型缺少可确认的凭据");
  }

  return Array.from(new Set(issues));
}

function CapabilityPill({ active, children }: { active: boolean | undefined; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded border px-2 text-[11px] font-medium",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-border bg-muted/30 text-muted-foreground",
      )}
    >
      {active ? "支持" : "关闭"} {children}
    </span>
  );
}

function LlmProviderLogo({ providerName, className }: { providerName: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const meta = getProviderLogoMeta(providerName);
  const logoUrl = meta.logoUrl || "";

  if (!logoUrl || failed) {
    return (
      <span
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-md text-xs font-bold text-white",
          className,
        )}
        style={{ backgroundColor: meta.brandColor }}
      >
        {meta.initials}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex size-9 items-center justify-center overflow-hidden rounded-md bg-background shadow-sm ring-1 ring-black/5",
        className,
      )}
    >
      <img
        src={logoUrl}
        alt={`${meta.label} logo`}
        className="size-5 object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function DefaultModelLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md bg-sky-50 text-sky-700 ring-1 ring-sky-100",
        className,
      )}
    >
      <Star className="size-4 fill-current" aria-hidden="true" />
    </span>
  );
}

function LlmMenuStatusBadge({ tone, children }: { tone: ProviderHealthTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium",
        tone === "success" && "border-emerald-100 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-100 bg-amber-50 text-amber-700",
        tone === "neutral" && "border-border-light bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function ConfigIssuesNotice({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-amber-700">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <div className="font-semibold text-foreground">有 {issues.length} 项需要确认</div>
        <div className="mt-0.5 flex flex-wrap gap-1.5">
          {issues.slice(0, 4).map((issue) => (
            <span key={issue} className="rounded border border-amber-200 bg-white/70 px-1.5 py-0.5 text-[11px]">
              {issue}
            </span>
          ))}
          {issues.length > 4 ? (
            <span className="rounded border border-amber-200 bg-white/70 px-1.5 py-0.5 text-[11px]">
              +{issues.length - 4}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AddProviderDialog({
  open,
  onOpenChange,
  existingProviderNames,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingProviderNames: string[];
  onAdd: (provider: ProviderConfig) => void;
}) {
  const [name, setName] = useState("");
  const [customName, setCustomName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const providerSelectId = useId();
  const customNameInputId = useId();
  const apiKeyInputId = useId();
  const baseUrlInputId = useId();
  const existingProviderNameSet = new Set(existingProviderNames);
  const providerName = name === OPENAI_COMPATIBLE_PROVIDER_OPTION ? customName.trim() : name;

  useEffect(() => {
    if (!open) {
      setName("");
      setCustomName("");
      setApiKey("");
      setBaseUrl("");
    }
  }, [open]);

  function handleProviderSelect(value: string) {
    setName(value);
    if (value !== OPENAI_COMPATIBLE_PROVIDER_OPTION) {
      setCustomName("");
    }
    const option = PROVIDER_OPTIONS.find((o) => o.value === value);
    if (option) {
      setBaseUrl(option.defaultBaseUrl);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>添加 Provider</DialogTitle>
          <DialogDescription>先创建服务提供商，再为它添加可用模型。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={providerSelectId} className="text-xs text-muted-foreground">
              类型
            </label>
            <Select value={name} onValueChange={handleProviderSelect}>
              <SelectTrigger id={providerSelectId} className="h-9">
                <SelectValue placeholder="选择服务提供商" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.value !== OPENAI_COMPATIBLE_PROVIDER_OPTION && existingProviderNameSet.has(opt.value)}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {name === OPENAI_COMPATIBLE_PROVIDER_OPTION ? (
            <div className="space-y-1.5">
              <label htmlFor={customNameInputId} className="text-xs text-muted-foreground">
                Provider 标识
              </label>
              <Input
                id={customNameInputId}
                name="provider-compatible-name"
                autoComplete="off"
                spellCheck={false}
                placeholder="如 groq、together、ollama…"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="h-9 font-mono"
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor={apiKeyInputId} className="text-xs text-muted-foreground">
              API Key
            </label>
            <Input
              id={apiKeyInputId}
              name="provider-api-key"
              autoComplete="off"
              spellCheck={false}
              type="password"
              placeholder="可选，留空使用环境变量…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={baseUrlInputId} className="text-xs text-muted-foreground">
              Base URL
            </label>
            <Input
              id={baseUrlInputId}
              name="provider-base-url"
              autoComplete="off"
              inputMode="url"
              type="url"
              spellCheck={false}
              placeholder="可选，留空使用默认值…"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="h-9"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!providerName}
            onClick={() => {
              if (existingProviderNameSet.has(providerName)) {
                toast.error(`"${providerName}" 已存在`);
                return;
              }
              onAdd({
                name: providerName,
                apiKey: apiKey.trim() || undefined,
                baseUrl: baseUrl.trim() || undefined,
                models: [],
              });
            }}
          >
            <Plus className="mr-1 size-4" aria-hidden="true" />
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelDialog({
  open,
  onOpenChange,
  title,
  description,
  initialModel,
  existingModelIds = [],
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initialModel?: ModelConfig | null;
  existingModelIds?: string[];
  onSubmit: (model: ModelConfig | Partial<ModelConfig>) => void;
}) {
  const isEdit = Boolean(initialModel);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [family, setFamily] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [context, setContext] = useState("128000");
  const [output, setOutput] = useState("4096");
  const [toolCall, setToolCall] = useState(true);
  const [temperature, setTemperature] = useState(true);
  const [attachment, setAttachment] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const modelIdInputId = useId();
  const modelNameInputId = useId();
  const modelFamilyInputId = useId();
  const modelApiKeyInputId = useId();
  const modelBaseUrlInputId = useId();
  const contextInputId = useId();
  const outputInputId = useId();
  const toolCallSwitchId = useId();
  const temperatureSwitchId = useId();
  const attachmentSwitchId = useId();
  const reasoningSwitchId = useId();

  useEffect(() => {
    if (!open) return;
    setId(initialModel?.id || "");
    setName(initialModel?.name || "");
    setFamily(initialModel?.family || "");
    setApiKey(initialModel?.apiKey || "");
    setBaseUrl(initialModel?.baseUrl || "");
    setContext(String(initialModel?.limit?.context || 128000));
    setOutput(String(initialModel?.limit?.output || 4096));
    setToolCall(initialModel?.toolCall ?? true);
    setTemperature(initialModel?.temperature ?? true);
    setAttachment(initialModel?.attachment ?? false);
    setReasoning(initialModel?.reasoning ?? false);
  }, [open, initialModel]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={modelIdInputId} className="text-xs text-muted-foreground">
              模型 ID
            </label>
            <Input
              id={modelIdInputId}
              name="model-id"
              autoComplete="off"
              spellCheck={false}
              className="h-9 font-mono"
              placeholder="如 gpt-4o-mini…"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={modelNameInputId} className="text-xs text-muted-foreground">
              显示名称
            </label>
            <Input
              id={modelNameInputId}
              name="model-name"
              autoComplete="off"
              placeholder="如 GPT-4o Mini…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor={modelFamilyInputId} className="text-xs text-muted-foreground">
              模型族
            </label>
            <Input
              id={modelFamilyInputId}
              name="model-family"
              autoComplete="off"
              spellCheck={false}
              placeholder="可选，如 gpt-4o、claude-3.5…"
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              className="h-9 font-mono"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor={modelApiKeyInputId} className="text-xs text-muted-foreground">
              API Key 覆盖
            </label>
            <Input
              id={modelApiKeyInputId}
              name="model-api-key"
              autoComplete="off"
              spellCheck={false}
              type="password"
              placeholder="可选，覆盖 Provider 的 API Key…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor={modelBaseUrlInputId} className="text-xs text-muted-foreground">
              Base URL 覆盖
            </label>
            <Input
              id={modelBaseUrlInputId}
              name="model-base-url"
              autoComplete="off"
              inputMode="url"
              type="url"
              spellCheck={false}
              className="h-9 font-mono"
              placeholder="可选，覆盖 Provider 的 Base URL…"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={contextInputId} className="text-xs text-muted-foreground">
              上下文窗口
            </label>
            <Input
              id={contextInputId}
              name="model-context-window"
              autoComplete="off"
              className="h-9 font-mono"
              inputMode="numeric"
              type="number"
              min={1}
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={outputInputId} className="text-xs text-muted-foreground">
              最大输出
            </label>
            <Input
              id={outputInputId}
              name="model-output-limit"
              autoComplete="off"
              className="h-9 font-mono"
              inputMode="numeric"
              type="number"
              min={1}
              value={output}
              onChange={(e) => setOutput(e.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <label
              htmlFor={toolCallSwitchId}
              className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border-light bg-muted/25 px-2.5"
            >
              <span className="text-xs font-medium text-foreground">Tool Call</span>
              <Switch id={toolCallSwitchId} checked={toolCall} onCheckedChange={setToolCall} />
            </label>
            <label
              htmlFor={reasoningSwitchId}
              className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border-light bg-muted/25 px-2.5"
            >
              <span className="text-xs font-medium text-foreground">Reasoning</span>
              <Switch id={reasoningSwitchId} checked={reasoning} onCheckedChange={setReasoning} />
            </label>
            <label
              htmlFor={attachmentSwitchId}
              className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border-light bg-muted/25 px-2.5"
            >
              <span className="text-xs font-medium text-foreground">Attachment</span>
              <Switch id={attachmentSwitchId} checked={attachment} onCheckedChange={setAttachment} />
            </label>
            <label
              htmlFor={temperatureSwitchId}
              className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border-light bg-muted/25 px-2.5"
            >
              <span className="text-xs font-medium text-foreground">Temperature</span>
              <Switch id={temperatureSwitchId} checked={temperature} onCheckedChange={setTemperature} />
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!id.trim()}
            onClick={() => {
              const nextId = id.trim();
              const duplicateId = existingModelIds.some((value) => value === nextId && value !== initialModel?.id);
              if (duplicateId) {
                toast.error(`模型 "${nextId}" 已存在`);
                return;
              }
              if (isEdit) {
                onSubmit({
                  id: nextId,
                  name: name.trim() || id.trim(),
                  family: family.trim() || undefined,
                  apiKey: apiKey.trim() || undefined,
                  baseUrl: baseUrl.trim() || undefined,
                  toolCall,
                  temperature,
                  attachment,
                  reasoning,
                  limit: {
                    context: Number(context) || 128000,
                    output: Number(output) || 4096,
                  },
                });
                return;
              }

              onSubmit({
                id: nextId,
                name: name.trim() || id.trim(),
                family: family.trim() || undefined,
                apiKey: apiKey.trim() || undefined,
                baseUrl: baseUrl.trim() || undefined,
                toolCall,
                temperature,
                attachment,
                reasoning,
                modalities: { input: ["text"], output: ["text"] },
                limit: {
                  context: Number(context) || 128000,
                  output: Number(output) || 4096,
                },
              } satisfies ModelConfig);
            }}
          >
            {isEdit ? "保存" : "添加模型"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TooltipIconButton({
  label,
  children,
  className,
  variant = "ghost",
  onClick,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  variant?: "ghost" | "outline";
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="icon-sm"
          className={cn("shrink-0", className)}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ConfirmIconButton({
  label,
  title,
  description,
  children,
  className,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn("shrink-0", className)}
              aria-label={label}
            >
              {children}
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={onConfirm}>
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function fetchProviderModelsErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "模型列表拉取失败";
}

function ProviderModelImportDialog({
  open,
  onOpenChange,
  providerName,
  rows,
  onToggleModel,
  onSelectRows,
  onClearSelection,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
  rows: ProviderModelImportRow[];
  onToggleModel: (modelId: string, selected: boolean) => void;
  onSelectRows: (rows: ProviderModelImportRow[]) => void;
  onClearSelection: () => void;
  onImport: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProviderModelImportFilter>("new");
  const searchInputId = useId();
  const filterSelectId = useId();
  const visibleRows = useMemo(() => filterProviderModelImportRows(rows, query, filter), [rows, query, filter]);
  const selectedCount = rows.filter((row) => row.selected).length;
  const newCount = rows.filter((row) => row.status === "new").length;
  const existingCount = rows.length - newCount;
  const visibleSelectableRows = visibleRows.filter((row) => row.status === "new");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setFilter("new");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>从 {providerName} 导入模型</DialogTitle>
          <DialogDescription>
            共 {rows.length} 个模型，{newCount} 个可导入，{existingCount} 个已存在。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_auto_auto] md:items-end">
            <div className="space-y-1.5">
              <label htmlFor={searchInputId} className="text-xs text-muted-foreground">
                搜索模型
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={searchInputId}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="按模型 ID 或名称搜索"
                  className="h-8 pl-8 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={filterSelectId} className="text-xs text-muted-foreground">
                范围
              </label>
              <Select value={filter} onValueChange={(value) => setFilter(value as ProviderModelImportFilter)}>
                <SelectTrigger id={filterSelectId} className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">未导入</SelectItem>
                  <SelectItem value="existing">已存在</SelectItem>
                  <SelectItem value="all">全部</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={visibleSelectableRows.length === 0}
              onClick={() => onSelectRows(visibleSelectableRows)}
            >
              选择当前筛选结果
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              disabled={selectedCount === 0}
              onClick={onClearSelection}
            >
              清空选择
            </Button>
          </div>

          <div className="overflow-hidden rounded-md border border-border-light">
            <div className="max-h-[420px] overflow-y-auto">
              {visibleRows.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">没有匹配的模型</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12">选择</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead className="w-24">状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((row) => {
                      const exists = row.status === "existing";
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="py-2">
                            <Checkbox
                              checked={row.selected}
                              disabled={exists}
                              aria-label={`选择 ${row.id}`}
                              onCheckedChange={(checked) => onToggleModel(row.id, checked === true)}
                            />
                          </TableCell>
                          <TableCell className="min-w-0 py-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{row.name}</div>
                              <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" translate="no">
                                {row.id}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-2">
                            <span
                              className={cn(
                                "inline-flex h-6 items-center rounded border px-2 text-[11px] font-medium",
                                exists
                                  ? "border-border bg-muted/30 text-muted-foreground"
                                  : "border-emerald-100 bg-emerald-50 text-emerald-700",
                              )}
                            >
                              {exists ? "已存在" : "可导入"}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={selectedCount === 0} onClick={onImport}>
            <Download className="size-3.5" aria-hidden="true" />
            导入已选 {selectedCount > 0 ? selectedCount : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderCard({
  provider,
  connectionDraft,
  isDefault,
  defaultModelId,
  initialExpanded,
  onSetDefault,
  onRemove,
  onConnectionDraftChange,
  onUpdateProvider,
  onAddModel,
  onAddModels,
  onUpdateModel,
  onRemoveModel,
}: {
  provider: ProviderConfig;
  connectionDraft: ProviderConnectionDraft;
  isDefault: boolean;
  defaultModelId: string;
  initialExpanded?: boolean;
  onSetDefault: (providerName: string, modelId: string) => void;
  onRemove: () => void;
  onConnectionDraftChange: (draft: ProviderConnectionDraft) => void;
  onUpdateProvider: (patch: Partial<Omit<ProviderConfig, "name">>) => void;
  onAddModel: (model: ModelConfig) => void;
  onAddModels?: (models: ModelConfig[]) => void;
  onUpdateModel: (modelId: string, patch: Partial<ModelConfig>) => void;
  onRemoveModel: (modelId: string) => void;
}) {
  const [expanded, setExpanded] = useState(() => initialExpanded ?? (isDefault || provider.models.length === 0));
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey, setApiKey] = useState(connectionDraft.apiKey);
  const [baseUrl, setBaseUrl] = useState(connectionDraft.baseUrl);
  const [addingModel, setAddingModel] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ProviderModelCandidate[]>([]);
  const [selectedFetchedModelIds, setSelectedFetchedModelIds] = useState<Set<string>>(() => new Set());
  const providerApiKeyInputId = useId();
  const providerBaseUrlInputId = useId();

  useEffect(() => {
    setApiKey(connectionDraft.apiKey);
    setBaseUrl(connectionDraft.baseUrl);
  }, [connectionDraft.apiKey, connectionDraft.baseUrl]);

  const defaultModel = provider.models.find((model) => model.id === defaultModelId);
  const providerConfigured = providerHasCredential(provider) || provider.name === "openai";
  const defaultModelName = defaultModel?.name ?? (isDefault && defaultModelId ? defaultModelId : "未设置");
  const addModelLabel = `为 ${provider.name} 添加模型`;
  const refreshModelsLabel = `刷新 ${provider.name} 模型列表`;
  const credentialLabel = providerCredentialLabel(provider);
  const importRows = useMemo(
    () => buildProviderModelImportRows(fetchedModels, provider.models, selectedFetchedModelIds),
    [fetchedModels, provider.models, selectedFetchedModelIds],
  );

  async function handleFetchProviderModels() {
    const draft = { apiKey, baseUrl };
    onConnectionDraftChange(draft);
    setFetchingModels(true);
    try {
      const result = await configApi.fetchProviderModels({
        providerName: provider.name,
        ...providerConnectionPatchFromDraft(draft),
        headers: provider.headers,
      });
      setFetchedModels(result.models);
      setSelectedFetchedModelIds(new Set());
      setImportDialogOpen(true);
      toast.success(`已拉取 ${result.models.length} 个模型`);
    } catch (error) {
      toast.error(fetchProviderModelsErrorMessage(error));
    } finally {
      setFetchingModels(false);
    }
  }

  function handleToggleFetchedModel(modelId: string, selected: boolean) {
    setSelectedFetchedModelIds((ids) => {
      const next = new Set(ids);
      if (selected) {
        next.add(modelId);
      } else {
        next.delete(modelId);
      }
      return next;
    });
  }

  function handleSelectFetchedModelRows(rows: ProviderModelImportRow[]) {
    setSelectedFetchedModelIds((ids) => {
      const next = new Set(ids);
      for (const row of rows) {
        if (row.status === "new") next.add(row.id);
      }
      return next;
    });
  }

  function handleImportFetchedModels() {
    const models = hydrateSelectedProviderModels(importRows);
    if (models.length === 0) return;
    if (onAddModels) {
      onAddModels(models);
    } else {
      for (const model of models) {
        onAddModel(model);
      }
    }
    setImportDialogOpen(false);
    setSelectedFetchedModelIds(new Set());
  }

  return (
    <div className="rounded-md border border-border-light bg-white">
      <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <LlmProviderLogo providerName={provider.name} className="size-8 shrink-0 rounded-md" />
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ProviderTag>{provider.name}</ProviderTag>
            {isDefault ? <ProviderDefaultPill /> : null}
            <ProviderStatusPill configured={providerConfigured} />
            <span className="text-xs text-muted-foreground">{provider.models.length} 个模型</span>
            <span className="text-xs text-muted-foreground">
              凭据: <span className="text-foreground">{credentialLabel}</span>
            </span>
            <span className="min-w-0 max-w-[260px] truncate text-xs text-muted-foreground">
              默认模型: <span className="text-foreground">{defaultModelName}</span>
            </span>
            {provider.baseUrl ? (
              <span className="min-w-0 max-w-[260px] truncate font-mono text-xs text-muted-foreground" translate="no">
                {provider.baseUrl}
              </span>
            ) : null}
          </span>
        </button>
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            aria-label={refreshModelsLabel}
            title={refreshModelsLabel}
            disabled={fetchingModels}
            onClick={() => void handleFetchProviderModels()}
          >
            {fetchingModels ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">刷新模型</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            aria-label={addModelLabel}
            title={addModelLabel}
            onClick={() => setAddingModel(true)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">添加模型</span>
          </Button>
          <ConfirmIconButton
            label="删除 Provider"
            title={`删除 ${provider.name} Provider？`}
            description={`此操作会移除该 Provider 下的 ${provider.models.length} 个模型配置。`}
            className="text-destructive hover:text-destructive"
            onConfirm={onRemove}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </ConfirmIconButton>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-border-light">
          <div className="grid gap-2 border-b border-border-light bg-muted/20 p-3 lg:grid-cols-[minmax(220px,1.1fr)_minmax(220px,1fr)_auto] lg:items-end">
            <div className="space-y-1.5">
              <label htmlFor={providerApiKeyInputId} className="flex items-center gap-1 text-xs text-muted-foreground">
                <KeyRound className="size-3.5" aria-hidden="true" />
                API Key
              </label>
              <div className="flex gap-1.5">
                <Input
                  id={providerApiKeyInputId}
                  name={`${provider.name}-provider-api-key`}
                  autoComplete="off"
                  spellCheck={false}
                  type={showApiKey ? "text" : "password"}
                  placeholder="留空使用环境变量…"
                  value={apiKey}
                  onChange={(e) => {
                    const nextApiKey = e.target.value;
                    setApiKey(nextApiKey);
                    onConnectionDraftChange({ apiKey: nextApiKey, baseUrl });
                  }}
                  className="h-8"
                />
                <TooltipIconButton
                  label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  variant="outline"
                  className="h-8 w-8"
                  onClick={() => setShowApiKey((value) => !value)}
                >
                  {showApiKey ? (
                    <EyeOff className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="size-3.5" aria-hidden="true" />
                  )}
                </TooltipIconButton>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={providerBaseUrlInputId} className="text-xs text-muted-foreground">
                Base URL
              </label>
              <Input
                id={providerBaseUrlInputId}
                name={`${provider.name}-provider-base-url`}
                autoComplete="off"
                inputMode="url"
                type="url"
                spellCheck={false}
                className="h-8 font-mono"
                placeholder="留空使用默认值…"
                value={baseUrl}
                onChange={(e) => {
                  const nextBaseUrl = e.target.value;
                  setBaseUrl(nextBaseUrl);
                  onConnectionDraftChange({ apiKey, baseUrl: nextBaseUrl });
                }}
              />
            </div>
            <Button
              className="h-8"
              onClick={() => {
                const draft = { apiKey, baseUrl };
                onConnectionDraftChange(draft);
                onUpdateProvider(providerConnectionPatchFromDraft(draft));
                toast.success("连接配置已更新");
              }}
            >
              应用连接
            </Button>
          </div>
          <div>
            {provider.models.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">当前 Provider 还没有模型</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-12">默认</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead className="hidden md:table-cell">能力</TableHead>
                    <TableHead className="hidden w-24 lg:table-cell">上下文</TableHead>
                    <TableHead className="hidden w-20 lg:table-cell">输出</TableHead>
                    <TableHead className="hidden w-24 xl:table-cell">凭据</TableHead>
                    <TableHead className="w-24 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {provider.models.map((model) => {
                    const isDefaultModel = isDefault && model.id === defaultModelId;
                    const hasOverride = Boolean(model.apiKey || model.baseUrl);
                    const credentialMode = modelCredentialLabel(provider, model);

                    return (
                      <TableRow key={model.id}>
                        <TableCell className="py-1.5">
                          <TooltipIconButton
                            label={isDefaultModel ? "当前默认模型" : "设为默认模型"}
                            className={cn(
                              isDefaultModel && "text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700",
                            )}
                            onClick={() => onSetDefault(provider.name, model.id)}
                          >
                            <Star className={cn("size-3.5", isDefaultModel && "fill-current")} aria-hidden="true" />
                          </TooltipIconButton>
                        </TableCell>
                        <TableCell className="min-w-[160px] py-1.5 text-foreground">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <div className="truncate text-[13px] font-medium">{model.name}</div>
                              {isDefaultModel ? (
                                <span className="shrink-0 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                                  默认
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" translate="no">
                              {model.id}
                            </div>
                            {model.family ? (
                              <div
                                className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
                                translate="no"
                              >
                                {model.family}
                              </div>
                            ) : null}
                            <div className="mt-0.5 text-xs text-muted-foreground lg:hidden">
                              上下文{" "}
                              <span className="font-mono tabular-nums">{formatInteger(model.limit?.context)}</span>
                              <span className="mx-1.5">/</span>
                              输出 <span className="font-mono tabular-nums">{formatInteger(model.limit?.output)}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden py-1.5 md:table-cell">
                          <div className="flex flex-wrap gap-1">
                            <CapabilityPill active={model.toolCall ?? true}>工具</CapabilityPill>
                            <CapabilityPill active={model.reasoning}>推理</CapabilityPill>
                            <CapabilityPill active={model.attachment}>附件</CapabilityPill>
                          </div>
                        </TableCell>
                        <TableCell className="hidden py-1.5 font-mono tabular-nums text-foreground lg:table-cell">
                          {formatInteger(model.limit?.context)}
                        </TableCell>
                        <TableCell className="hidden py-1.5 font-mono tabular-nums text-foreground lg:table-cell">
                          {formatInteger(model.limit?.output)}
                        </TableCell>
                        <TableCell className="hidden py-1.5 xl:table-cell">
                          <span
                            className={cn(
                              "inline-flex h-6 items-center rounded border px-2 text-[11px]",
                              hasOverride
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : credentialMode === "缺少凭据"
                                  ? "border-red-100 bg-red-50 text-red-600"
                                  : "border-border bg-muted/30 text-muted-foreground",
                            )}
                          >
                            {credentialMode}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5">
                          <div className="flex justify-end gap-1">
                            <TooltipIconButton label="编辑模型" onClick={() => setEditingModel(model)}>
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </TooltipIconButton>
                            <ConfirmIconButton
                              label="删除模型"
                              title={`删除 ${model.name}？`}
                              description="此操作会移除该模型配置。"
                              className="text-destructive hover:text-destructive"
                              onConfirm={() => onRemoveModel(model.id)}
                            >
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            </ConfirmIconButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      ) : null}

      <ModelDialog
        open={addingModel}
        onOpenChange={setAddingModel}
        title={`为 ${provider.name} 添加模型`}
        description="填写模型 ID、名称和覆盖配置。"
        existingModelIds={provider.models.map((model) => model.id)}
        onSubmit={(model) => {
          onAddModel(model as ModelConfig);
          setAddingModel(false);
        }}
      />
      <ModelDialog
        open={Boolean(editingModel)}
        onOpenChange={(open) => {
          if (!open) setEditingModel(null);
        }}
        title="编辑模型"
        description="修改模型显示名称和覆盖配置。"
        initialModel={editingModel}
        existingModelIds={provider.models.map((model) => model.id)}
        onSubmit={(patch) => {
          if (!editingModel) return;
          onUpdateModel(editingModel.id, patch);
          setEditingModel(null);
        }}
      />
      <ProviderModelImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        providerName={provider.name}
        rows={importRows}
        onToggleModel={handleToggleFetchedModel}
        onSelectRows={handleSelectFetchedModelRows}
        onClearSelection={() => setSelectedFetchedModelIds(new Set())}
        onImport={handleImportFetchedModels}
      />
    </div>
  );
}

function LlmConfigNotice({
  providers,
  defaultProvider,
  defaultModel,
  validationIssues,
}: {
  providers: ProviderConfig[];
  defaultProvider: string;
  defaultModel: string;
  validationIssues: string[];
}) {
  const issues = buildHealthIssues({ providers, defaultProvider, defaultModel, validationIssues });

  return <ConfigIssuesNotice issues={issues} />;
}

function DefaultRoutePanel({
  providers,
  defaultProvider,
  defaultModel,
  onSetDefault,
}: {
  providers: ProviderConfig[];
  defaultProvider: string;
  defaultModel: string;
  onSetDefault: (providerName: string, modelId: string) => void;
}) {
  const defaultProviderSelectId = useId();
  const defaultModelSelectId = useId();
  const defProvider = providers.find((p) => p.name === defaultProvider);
  const defModel = defProvider?.models.find((m) => m.id === defaultModel);
  const tone = defaultCredentialTone(defProvider, defModel);
  const credentialLabel = defProvider && defModel ? modelCredentialLabel(defProvider, defModel) : "未设置";

  return (
    <ProviderSettingsSection
      density="compact"
      title="默认模型"
      description={
        defProvider && defModel ? `${defProvider.name}/${defModel.id}` : "选择新建会话默认使用的 Provider 和模型。"
      }
      extra={
        <span
          className={cn(
            "inline-flex h-6 items-center rounded border px-2 text-[11px] font-medium",
            tone === "success"
              ? "border-emerald-100 bg-emerald-50 text-emerald-700"
              : "border-amber-100 bg-amber-50 text-amber-700",
          )}
        >
          {credentialLabel}
        </span>
      }
    >
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={defaultProviderSelectId} className="text-xs font-medium text-muted-foreground">
            默认 Provider
          </label>
          <Select
            value={defaultProvider || undefined}
            onValueChange={(providerName) => {
              const provider = providers.find((item) => item.name === providerName);
              const modelId = provider?.models[0]?.id || "";
              onSetDefault(providerName, modelId);
            }}
            disabled={providers.length === 0}
          >
            <SelectTrigger id={defaultProviderSelectId} className="h-9">
              <SelectValue placeholder="选择 Provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider.name} value={provider.name}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={defaultModelSelectId} className="text-xs font-medium text-muted-foreground">
            默认模型
          </label>
          <Select
            value={defaultModel || undefined}
            disabled={!defProvider}
            onValueChange={(modelId) => {
              if (!defProvider) return;
              onSetDefault(defProvider.name, modelId);
            }}
          >
            <SelectTrigger id={defaultModelSelectId} className="h-9">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {defProvider?.models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </ProviderSettingsSection>
  );
}

function providerMenuTone(provider: ProviderConfig): ProviderHealthTone {
  if (provider.models.length === 0) return "warning";
  if (providerHasCredential(provider) || provider.name === "openai") return "success";
  return "neutral";
}

function providerMenuLabel(provider: ProviderConfig) {
  if (provider.models.length === 0) return "无模型";
  if (providerHasCredential(provider) || provider.name === "openai") return "已配置";
  return "待凭据";
}

function LlmProviderNav({
  providers,
  selectedMenuId,
  defaultProvider,
  defaultModel,
  onSelectMenu,
  hideDefaultRoute = false,
}: {
  providers: ProviderConfig[];
  selectedMenuId: string;
  defaultProvider: string;
  defaultModel: string;
  onSelectMenu: (menuId: string) => void;
  hideDefaultRoute?: boolean;
}) {
  const defProvider = providers.find((provider) => provider.name === defaultProvider);
  const defModel = defProvider?.models.find((model) => model.id === defaultModel);
  const defaultTone = defaultCredentialTone(defProvider, defModel);
  const defaultLabel = defProvider && defModel ? "已设置" : "待设置";

  return (
    <div className="space-y-1">
      {hideDefaultRoute ? null : (
      <button
        type="button"
        aria-current={selectedMenuId === DEFAULT_MODEL_MENU_ID ? "page" : undefined}
        onClick={() => onSelectMenu(DEFAULT_MODEL_MENU_ID)}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors",
          selectedMenuId === DEFAULT_MODEL_MENU_ID
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <DefaultModelLogo className="size-9 rounded-md" />
        <span className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium">默认模型</span>
          <span
            className={cn(
              "mt-0.5 block truncate text-xs",
              selectedMenuId === DEFAULT_MODEL_MENU_ID
                ? "text-primary/70"
                : "text-muted-foreground/80 group-hover:text-muted-foreground",
            )}
          >
            {defProvider && defModel ? `${defProvider.name} / ${defModel.name}` : "选择会话默认模型"}
          </span>
        </span>
        <LlmMenuStatusBadge tone={defaultTone}>{defaultLabel}</LlmMenuStatusBadge>
      </button>
      )}

      {providers.map((provider) => {
        const menuId = providerMenuId(provider.name);
        const active = selectedMenuId === menuId;
        const meta = getProviderLogoMeta(provider.name);
        return (
          <button
            key={provider.name}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onSelectMenu(menuId)}
            className={cn(
              "group flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <LlmProviderLogo providerName={provider.name} className="size-9 rounded-md" />
            <span className="min-w-0 flex-1">
              <span className="truncate text-sm font-medium">{meta.label}</span>
              <span
                className={cn(
                  "mt-0.5 block truncate text-xs",
                  active ? "text-primary/70" : "text-muted-foreground/80 group-hover:text-muted-foreground",
                )}
              >
                {provider.models.length} 个模型 · {provider.baseUrl || provider.name}
              </span>
            </span>
            <LlmMenuStatusBadge tone={providerMenuTone(provider)}>{providerMenuLabel(provider)}</LlmMenuStatusBadge>
          </button>
        );
      })}
    </div>
  );
}

function LlmMobileNav({
  providers,
  selectedMenuId,
  onSelectMenu,
  hideDefaultRoute = false,
}: {
  providers: ProviderConfig[];
  selectedMenuId: string;
  onSelectMenu: (menuId: string) => void;
  hideDefaultRoute?: boolean;
}) {
  return (
    <div className="border-b border-border-light bg-background p-2 md:hidden">
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {hideDefaultRoute ? null : (
          <button
            type="button"
            aria-current={selectedMenuId === DEFAULT_MODEL_MENU_ID ? "page" : undefined}
            onClick={() => onSelectMenu(DEFAULT_MODEL_MENU_ID)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm transition-colors",
              selectedMenuId === DEFAULT_MODEL_MENU_ID
                ? "border-primary/20 bg-primary/10 text-primary"
                : "border-border-light bg-background text-muted-foreground",
            )}
          >
            <DefaultModelLogo className="size-6 rounded" />
            默认模型
          </button>
        )}
        {providers.map((provider) => {
          const menuId = providerMenuId(provider.name);
          const active = selectedMenuId === menuId;
          return (
            <button
              key={provider.name}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelectMenu(menuId)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm transition-colors",
                active
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "border-border-light bg-background text-muted-foreground",
              )}
            >
              <LlmProviderLogo providerName={provider.name} className="size-6 rounded" />
              {getProviderLogoMeta(provider.name).label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface AiProviderSettingsProps {
  providers: ProviderConfig[];
  defaultProvider: string;
  defaultModel: string;
  validationIssues?: string[];
  onSetDefault: (providerName: string, modelId: string) => void;
  onAddProvider: (provider: ProviderConfig) => void;
  onRemoveProvider: (providerName: string) => void;
  onUpdateProvider: (providerName: string, patch: Partial<Omit<ProviderConfig, "name">>) => void;
  onAddModel: (providerName: string, model: ModelConfig) => void;
  onAddModels?: (providerName: string, models: ModelConfig[]) => void;
  onUpdateModel: (providerName: string, modelId: string, patch: Partial<ModelConfig>) => void;
  onRemoveModel: (providerName: string, modelId: string) => void;
  onRebuildCache?: () => Promise<void>;
  isRebuildingCache?: boolean;
  showValidationNotice?: boolean;
  /** 隐藏左侧「默认模型」菜单项与面板(云端 LLM 配置页把默认模型切换挪到了页头保存按钮旁)。 */
  hideDefaultRoute?: boolean;
}

export function AiProviderSettings({
  providers,
  defaultProvider,
  defaultModel,
  validationIssues = [],
  onSetDefault,
  onAddProvider,
  onRemoveProvider,
  onUpdateProvider,
  onAddModel,
  onAddModels,
  onUpdateModel,
  onRemoveModel,
  onRebuildCache,
  isRebuildingCache = false,
  showValidationNotice = true,
  hideDefaultRoute = false,
}: AiProviderSettingsProps) {
  const [addingProvider, setAddingProvider] = useState(false);
  const [selectedMenuId, setSelectedMenuId] = useState(DEFAULT_MODEL_MENU_ID);
  const [providerConnectionDrafts, setProviderConnectionDrafts] = useState<ProviderConnectionDraftMap>(() =>
    readProviderConnectionDraftMemory(),
  );
  const modelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);
  const selectedProviderName = providerNameFromMenuId(selectedMenuId);
  const selectedProvider = providers.find((provider) => provider.name === selectedProviderName);

  useEffect(() => {
    if (!selectedMenuId.startsWith(PROVIDER_MENU_PREFIX)) return;
    if (providers.some((provider) => provider.name === selectedProviderName)) return;
    setSelectedMenuId(DEFAULT_MODEL_MENU_ID);
  }, [providers, selectedMenuId, selectedProviderName]);

  // hideDefaultRoute(云端):默认模型菜单项已隐藏,自动把选中项从「默认模型」切到首个 Provider。
  useEffect(() => {
    if (!hideDefaultRoute || selectedMenuId !== DEFAULT_MODEL_MENU_ID) return;
    const first = providers[0];
    if (first) setSelectedMenuId(providerMenuId(first.name));
  }, [hideDefaultRoute, selectedMenuId, providers]);

  useEffect(() => {
    setProviderConnectionDrafts((drafts) => {
      const nextDrafts = pruneProviderConnectionDrafts(drafts, providers);
      writeProviderConnectionDraftMemory(nextDrafts);
      return nextDrafts;
    });
  }, [providers]);

  const handleAddProvider = (provider: ProviderConfig) => {
    onAddProvider(provider);
    setSelectedMenuId(providerMenuId(provider.name));
    setAddingProvider(false);
  };

  const handleRemoveSelectedProvider = (providerName: string) => {
    onRemoveProvider(providerName);
    setSelectedMenuId(DEFAULT_MODEL_MENU_ID);
  };

  return (
    <div className="space-y-2">
      {showValidationNotice ? (
        <LlmConfigNotice
          providers={providers}
          defaultProvider={defaultProvider}
          defaultModel={defaultModel}
          validationIssues={validationIssues}
        />
      ) : null}

      <div className="overflow-hidden rounded-md border border-border-light bg-background">
        <div className="flex min-h-[520px] flex-col md:flex-row">
          <aside className="hidden w-64 shrink-0 flex-col border-r border-border-light bg-background md:flex">
            <div className="border-b border-border-light px-4 py-3">
              <div className="text-sm font-semibold text-foreground">模型 Provider</div>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {providers.length} 个 Provider，{modelCount} 个模型
              </p>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="LLM Provider">
              <LlmProviderNav
                providers={providers}
                selectedMenuId={selectedMenuId}
                defaultProvider={defaultProvider}
                defaultModel={defaultModel}
                onSelectMenu={setSelectedMenuId}
                hideDefaultRoute={hideDefaultRoute}
              />
            </nav>

            <div className="space-y-2 border-t border-border-light p-3">
              {onRebuildCache ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full justify-start"
                  onClick={() => void onRebuildCache()}
                  disabled={isRebuildingCache}
                >
                  {isRebuildingCache ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                  清除缓存
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="h-8 w-full justify-start"
                onClick={() => setAddingProvider(true)}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                添加 Provider
              </Button>
            </div>
          </aside>

          <LlmMobileNav
            providers={providers}
            selectedMenuId={selectedMenuId}
            onSelectMenu={setSelectedMenuId}
            hideDefaultRoute={hideDefaultRoute}
          />

          <div className="min-w-0 flex-1 bg-background p-2 md:p-3">
            {selectedMenuId === DEFAULT_MODEL_MENU_ID ? (
              <div className="space-y-2">
                {hideDefaultRoute ? null : (
                  <DefaultRoutePanel
                    providers={providers}
                    defaultProvider={defaultProvider}
                    defaultModel={defaultModel}
                    onSetDefault={onSetDefault}
                  />
                )}
                {providers.length === 0 ? (
                  <ProviderEmptyState
                    icon={Bot}
                    title="还没有 LLM Provider"
                    description="先添加服务提供商，再配置可用模型。"
                    action={
                      <Button type="button" className="h-8" onClick={() => setAddingProvider(true)}>
                        <Plus className="mr-1 size-4" aria-hidden="true" />
                        立即添加
                      </Button>
                    }
                  />
                ) : null}
              </div>
            ) : selectedProvider ? (
              <ProviderCard
                key={selectedProvider.name}
                provider={selectedProvider}
                connectionDraft={resolveProviderConnectionDraft(selectedProvider, providerConnectionDrafts)}
                isDefault={selectedProvider.name === defaultProvider}
                defaultModelId={defaultModel}
                initialExpanded
                onSetDefault={onSetDefault}
                onRemove={() => handleRemoveSelectedProvider(selectedProvider.name)}
                onConnectionDraftChange={(draft) => {
                  setProviderConnectionDrafts((drafts) => {
                    const nextDrafts = storeProviderConnectionDraft(drafts, selectedProvider.name, draft);
                    writeProviderConnectionDraftMemory(nextDrafts);
                    return nextDrafts;
                  });
                }}
                onUpdateProvider={(patch) => onUpdateProvider(selectedProvider.name, patch)}
                onAddModel={(model) => onAddModel(selectedProvider.name, model)}
                onAddModels={onAddModels ? (models) => onAddModels(selectedProvider.name, models) : undefined}
                onUpdateModel={(modelId, patch) => onUpdateModel(selectedProvider.name, modelId, patch)}
                onRemoveModel={(modelId) => onRemoveModel(selectedProvider.name, modelId)}
              />
            ) : (
              <ProviderEmptyState
                icon={Bot}
                title="请选择 Provider"
                description="从左侧选择一个 Provider，或先添加新的模型服务。"
                action={
                  <Button type="button" className="h-8" onClick={() => setAddingProvider(true)}>
                    <Plus className="mr-1 size-4" aria-hidden="true" />
                    添加 Provider
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2 md:hidden">
        {onRebuildCache ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void onRebuildCache()}
            disabled={isRebuildingCache}
          >
            {isRebuildingCache ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            清除缓存
          </Button>
        ) : null}
        <Button type="button" size="sm" className="h-8" onClick={() => setAddingProvider(true)}>
          <Plus className="size-3.5" aria-hidden="true" />
          添加 Provider
        </Button>
      </div>

      <AddProviderDialog
        open={addingProvider}
        onOpenChange={setAddingProvider}
        existingProviderNames={providers.map((provider) => provider.name)}
        onAdd={handleAddProvider}
      />
    </div>
  );
}
