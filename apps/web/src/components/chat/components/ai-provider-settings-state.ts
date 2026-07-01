import type { ModelConfig, ProviderConfig } from "@/lib/shared";
import {
  resolveModelLimit,
  resolveModelLimitPreset,
} from "../../../lib/llm-model-limits.ts";

export interface ProviderConnectionDraft {
  apiKey: string;
  baseUrl: string;
}

export type ProviderConnectionDraftMap = Readonly<Record<string, ProviderConnectionDraft | undefined>>;

let providerConnectionDraftMemory: Record<string, ProviderConnectionDraft> = {};

function cloneProviderConnectionDrafts(drafts: ProviderConnectionDraftMap): Record<string, ProviderConnectionDraft> {
  const next: Record<string, ProviderConnectionDraft> = {};
  for (const [providerName, draft] of Object.entries(drafts)) {
    if (!draft) continue;
    next[providerName] = {
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl,
    };
  }
  return next;
}

export function readProviderConnectionDraftMemory(): Record<string, ProviderConnectionDraft> {
  return cloneProviderConnectionDrafts(providerConnectionDraftMemory);
}

export function writeProviderConnectionDraftMemory(
  drafts: ProviderConnectionDraftMap,
): Record<string, ProviderConnectionDraft> {
  providerConnectionDraftMemory = cloneProviderConnectionDrafts(drafts);
  return readProviderConnectionDraftMemory();
}

export function resetProviderConnectionDraftMemory() {
  providerConnectionDraftMemory = {};
}

export function providerConnectionDraftFromProvider(provider: Pick<ProviderConfig, "apiKey" | "baseUrl">) {
  return {
    apiKey: provider.apiKey || "",
    baseUrl: provider.baseUrl || "",
  };
}

export function resolveProviderConnectionDraft(
  provider: Pick<ProviderConfig, "name" | "apiKey" | "baseUrl">,
  drafts: ProviderConnectionDraftMap,
): ProviderConnectionDraft {
  return drafts[provider.name] ?? providerConnectionDraftFromProvider(provider);
}

export function storeProviderConnectionDraft(
  drafts: ProviderConnectionDraftMap,
  providerName: string,
  draft: ProviderConnectionDraft,
): Record<string, ProviderConnectionDraft> {
  return {
    ...drafts,
    [providerName]: {
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl,
    },
  };
}

export function pruneProviderConnectionDrafts(
  drafts: ProviderConnectionDraftMap,
  providers: readonly Pick<ProviderConfig, "name">[],
): Record<string, ProviderConnectionDraft> {
  const providerNames = new Set(providers.map((provider) => provider.name));
  const next: Record<string, ProviderConnectionDraft> = {};
  let changed = false;

  for (const [providerName, draft] of Object.entries(drafts)) {
    if (!draft || !providerNames.has(providerName)) {
      changed = true;
      continue;
    }
    next[providerName] = draft;
  }

  return changed ? next : (drafts as Record<string, ProviderConnectionDraft>);
}

export function providerConnectionPatchFromDraft(draft: ProviderConnectionDraft) {
  return {
    apiKey: draft.apiKey.trim() || undefined,
    baseUrl: draft.baseUrl.trim() || undefined,
  };
}

export interface FetchedProviderModel {
  id: string;
  name: string;
}

export type ProviderModelImportStatus = "new" | "existing";
export type ProviderModelImportFilter = "all" | "new" | "existing";

export interface ProviderModelImportRow {
  id: string;
  name: string;
  status: ProviderModelImportStatus;
  selected: boolean;
}

interface ImportedModelPreset {
  family?: string;
  toolCall?: boolean;
  temperature?: boolean;
  attachment?: boolean;
  reasoning?: boolean;
}

const DEFAULT_IMPORTED_MODEL_PRESET: ImportedModelPreset = {
  toolCall: true,
  temperature: true,
  attachment: false,
  reasoning: false,
};

const IMPORTED_MODEL_PRESETS: Array<{ match: RegExp; preset: ImportedModelPreset }> = [
  {
    match: /^gpt-5(?:[.\-]|$)/i,
    preset: {
      family: "openai",
      toolCall: true,
      temperature: true,
      reasoning: true,
    },
  },
  {
    match: /^(?:o[134]|o\d)/i,
    preset: {
      family: "openai",
      toolCall: true,
      temperature: true,
      reasoning: true,
    },
  },
  {
    match: /^claude-(?:fable-5|opus-(?:4[.\-]8|5)|sonnet-5)/i,
    preset: {
      family: "anthropic",
      toolCall: true,
      temperature: true,
      reasoning: true,
    },
  },
  {
    match: /^claude/i,
    preset: {
      family: "anthropic",
      toolCall: true,
      temperature: true,
      reasoning: true,
    },
  },
  {
    match: /(?:deepseek-v4|deepseek-v3\.2)/i,
    preset: {
      family: "deepseek",
      toolCall: true,
      temperature: true,
      reasoning: true,
    },
  },
  {
    match: /(?:deepseek-reasoner|r1|reasoning)/i,
    preset: {
      family: "reasoning",
      toolCall: true,
      temperature: true,
      reasoning: true,
    },
  },
  {
    match: /(?:deepseek|qwen|glm|moonshot|kimi|mistral|llama)/i,
    preset: {
      toolCall: true,
      temperature: true,
    },
  },
  {
    match: /^gemini/i,
    preset: {
      family: "gemini",
      toolCall: true,
      temperature: true,
      attachment: true,
      reasoning: true,
    },
  },
];

export function buildProviderModelImportRows(
  fetchedModels: readonly FetchedProviderModel[],
  existingModels: readonly Pick<ModelConfig, "id">[],
  selectedIds: ReadonlySet<string> = new Set(),
): ProviderModelImportRow[] {
  const existingIds = new Set(existingModels.map((model) => model.id));
  const seen = new Set<string>();
  const rows: ProviderModelImportRow[] = [];

  for (const model of fetchedModels) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    const status: ProviderModelImportStatus = existingIds.has(id) ? "existing" : "new";
    rows.push({
      id,
      name: model.name.trim() || id,
      status,
      selected: status === "new" && selectedIds.has(id),
    });
    seen.add(id);
  }

  return rows;
}

export function filterProviderModelImportRows(
  rows: readonly ProviderModelImportRow[],
  query: string,
  filter: ProviderModelImportFilter,
): ProviderModelImportRow[] {
  const normalizedQuery = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== "all" && row.status !== filter) return false;
    if (!normalizedQuery) return true;
    return row.id.toLowerCase().includes(normalizedQuery) || row.name.toLowerCase().includes(normalizedQuery);
  });
}

export function hydrateFetchedProviderModel(model: FetchedProviderModel): ModelConfig {
  const id = model.id.trim();
  const preset = resolveImportedModelPreset(id);
  const limit = resolveModelLimitPreset(id);
  return {
    id,
    name: model.name.trim() || id,
    family: preset.family,
    toolCall: preset.toolCall ?? DEFAULT_IMPORTED_MODEL_PRESET.toolCall,
    temperature: preset.temperature ?? DEFAULT_IMPORTED_MODEL_PRESET.temperature,
    attachment: preset.attachment ?? DEFAULT_IMPORTED_MODEL_PRESET.attachment,
    reasoning: preset.reasoning ?? DEFAULT_IMPORTED_MODEL_PRESET.reasoning,
    modalities: { input: ["text"], output: ["text"] },
    limit,
  };
}

export function resolveEditableModelLimit(model?: Pick<ModelConfig, "id" | "limit"> | null): {
  context: number;
  output: number;
} {
  return resolveModelLimit(model?.id ?? "", model?.limit);
}

export function resolveModelLimitDraftAfterModelIdChange(
  nextModelId: string,
  draft: { context: string; output: string },
  touched: { context: boolean; output: boolean },
): { context: string; output: string } {
  const presetLimit = resolveEditableModelLimit({ id: nextModelId });
  return {
    context: touched.context ? draft.context : String(presetLimit.context),
    output: touched.output ? draft.output : String(presetLimit.output),
  };
}

export function hydrateSelectedProviderModels(rows: readonly ProviderModelImportRow[]): ModelConfig[] {
  return rows
    .filter((row) => row.status === "new" && row.selected)
    .map((row) => hydrateFetchedProviderModel({ id: row.id, name: row.name }));
}

function resolveImportedModelPreset(modelId: string): ImportedModelPreset {
  const matched = IMPORTED_MODEL_PRESETS.find(({ match }) => match.test(modelId));
  return {
    ...DEFAULT_IMPORTED_MODEL_PRESET,
    ...(matched?.preset ?? {}),
  };
}
