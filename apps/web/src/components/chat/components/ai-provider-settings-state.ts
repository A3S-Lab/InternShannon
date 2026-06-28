import type { ModelConfig, ProviderConfig } from "@/lib/shared";

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
  context: number;
  output: number;
  toolCall?: boolean;
  temperature?: boolean;
  attachment?: boolean;
  reasoning?: boolean;
}

const DEFAULT_IMPORTED_MODEL_PRESET: ImportedModelPreset = {
  context: 128000,
  output: 4096,
  toolCall: true,
  temperature: true,
  attachment: false,
  reasoning: false,
};

const IMPORTED_MODEL_PRESETS: Array<{ match: RegExp; preset: ImportedModelPreset }> = [
  {
    match: /^(?:o[134]|o\d|gpt-4\.1|gpt-4o)/i,
    preset: { family: "openai", context: 128000, output: 16384, toolCall: true, temperature: true },
  },
  {
    match: /^gpt-3\.5/i,
    preset: { family: "openai", context: 16385, output: 4096, toolCall: true, temperature: true },
  },
  {
    match: /^claude/i,
    preset: { family: "anthropic", context: 200000, output: 8192, toolCall: true, temperature: true },
  },
  {
    match: /(?:deepseek-reasoner|r1|reasoning)/i,
    preset: { family: "reasoning", context: 128000, output: 8192, toolCall: true, temperature: true, reasoning: true },
  },
  {
    match: /(?:deepseek|qwen|glm|moonshot|kimi|mistral|llama)/i,
    preset: { context: 128000, output: 8192, toolCall: true, temperature: true },
  },
  {
    match: /^gemini/i,
    preset: { family: "gemini", context: 1000000, output: 8192, toolCall: true, temperature: true, attachment: true },
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
  return {
    id,
    name: model.name.trim() || id,
    family: preset.family,
    toolCall: preset.toolCall ?? DEFAULT_IMPORTED_MODEL_PRESET.toolCall,
    temperature: preset.temperature ?? DEFAULT_IMPORTED_MODEL_PRESET.temperature,
    attachment: preset.attachment ?? DEFAULT_IMPORTED_MODEL_PRESET.attachment,
    reasoning: preset.reasoning ?? DEFAULT_IMPORTED_MODEL_PRESET.reasoning,
    modalities: { input: ["text"], output: ["text"] },
    limit: {
      context: preset.context,
      output: preset.output,
    },
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
