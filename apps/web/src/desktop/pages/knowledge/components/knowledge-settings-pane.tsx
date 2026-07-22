import { useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import type { WikiConfig } from "@/lib/api/assets";
import { DEFAULT_KNOWLEDGE_EMBEDDING } from "../knowledge-page-utils";
import { KNOWLEDGE_RETRIEVAL_PRESETS, retrievalPresetId } from "../knowledge-retrieval-state";

export function KnowledgeSettingsPane(props: {
  config: WikiConfig | null;
  busy: boolean;
  onSave: (embedding: WikiConfig["embedding"]) => void;
}) {
  const [draft, setDraft] = useState<WikiConfig["embedding"] | null>(props.config?.embedding ?? null);
  useEffect(() => setDraft(props.config?.embedding ?? null), [props.config]);
  if (!draft) return <div className="p-4 text-xs text-muted-foreground">配置不可用</div>;
  const update = (patch: Partial<WikiConfig["embedding"]>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  const presetId = retrievalPresetId(draft);
  return (
    <div className="h-full overflow-y-auto bg-[#f7f7f5] p-3">
      <div className="space-y-3">
        <label className="block text-[11px] font-medium text-muted-foreground">
          检索模式
          <select
            value={presetId}
            onChange={(event) => {
              const preset =
                KNOWLEDGE_RETRIEVAL_PRESETS[event.target.value as keyof typeof KNOWLEDGE_RETRIEVAL_PRESETS];
              if (preset) update(preset);
            }}
            className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-foreground"
          >
            {Object.entries(KNOWLEDGE_RETRIEVAL_PRESETS).map(([id, preset]) => (
              <option key={id} value={id}>
                {preset.label}
              </option>
            ))}
            {presetId === "custom" ? <option value="custom">自定义</option> : null}
          </select>
          <span className="mt-1 block text-[10px] font-normal leading-4 text-muted-foreground">
            精确匹配更保守；高召回会返回更多可能相关的内容。
          </span>
        </label>
        <details className="rounded-md border border-border-light bg-white p-2">
          <summary className="cursor-pointer text-[11px] font-medium text-foreground">高级参数</summary>
          <div className="mt-3 space-y-3">
            <label className="block text-[11px] font-medium text-muted-foreground">
              向量服务
              <input
                value={draft.provider}
                onChange={(event) => update({ provider: event.target.value })}
                className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-foreground"
              />
            </label>
            <label className="block text-[11px] font-medium text-muted-foreground">
              向量模型
              <input
                value={draft.model}
                onChange={(event) => update({ model: event.target.value })}
                className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-foreground"
              />
            </label>
            <label className="block text-[11px] font-medium text-muted-foreground">
              向量维度（1–4096）
              <input
                type="number"
                min={1}
                max={4096}
                value={draft.dimensions}
                onChange={(event) =>
                  update({ dimensions: Math.max(1, Math.min(4096, Number(event.target.value) || 1)) })
                }
                className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-foreground"
              />
            </label>
            <label className="block text-[11px] font-medium text-muted-foreground">
              关键词权重 {draft.keywordWeight.toFixed(1)}
              <input
                aria-label="关键词检索权重"
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={draft.keywordWeight}
                onChange={(event) => update({ keywordWeight: Number(event.target.value) })}
                className="mt-1 w-full"
              />
            </label>
            <label className="block text-[11px] font-medium text-muted-foreground">
              语义权重 {draft.vectorWeight.toFixed(1)}
              <input
                aria-label="语义检索权重"
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={draft.vectorWeight}
                onChange={(event) => update({ vectorWeight: Number(event.target.value) })}
                className="mt-1 w-full"
              />
            </label>
            <label className="block text-[11px] font-medium text-muted-foreground">
              结果聚焦度 {draft.mmrLambda.toFixed(2)}
              <input
                aria-label="结果聚焦度"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={draft.mmrLambda}
                onChange={(event) => update({ mmrLambda: Number(event.target.value) })}
                className="mt-1 w-full"
              />
            </label>
          </div>
        </details>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => props.onSave(draft)}
            disabled={props.busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            <Save className="size-3.5" />
            保存
          </button>
          <button
            type="button"
            onClick={() => {
              const defaults = { ...DEFAULT_KNOWLEDGE_EMBEDDING };
              setDraft(defaults);
              props.onSave(defaults);
            }}
            disabled={props.busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
            恢复默认
          </button>
        </div>
      </div>
    </div>
  );
}
