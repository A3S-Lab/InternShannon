import type { ModelConfig, ProviderConfig } from "../lib/constants.ts";
import { resolveModelLimit, type ModelLimitInput } from "../lib/llm-model-limits.ts";

const REDACTED_SECRET_PLACEHOLDER = "[configured]";

export interface NormalizedBackendModelConfig {
  providers: ProviderConfig[];
  defaultProvider: string;
  defaultModel: string;
}

export function splitProviderModelRef(rawRef: string): { providerName: string; modelId: string } | null {
  const slashIndex = rawRef.indexOf("/");
  if (slashIndex < 0) return null;
  const providerName = rawRef.slice(0, slashIndex).trim();
  const modelId = rawRef.slice(slashIndex + 1).trim();
  if (!providerName || !modelId) return null;
  return { providerName, modelId };
}

export function normalizeBackendModelConfig(value: {
  providers?: unknown;
  defaultModel?: unknown;
  default_model?: unknown;
}): NormalizedBackendModelConfig {
  const providers = normalizeProviders(value.providers);
  const fallbackProvider = providers[0]?.name ?? "";
  const fallbackModel = providers[0]?.models[0]?.id ?? "";
  const defaultRef = normalizeString(value.defaultModel ?? value.default_model);
  const resolvedDefault = resolveDefaultModelRef(providers, defaultRef);

  return {
    providers,
    defaultProvider: resolvedDefault?.provider ?? fallbackProvider,
    defaultModel: resolvedDefault?.model ?? fallbackModel,
  };
}

function normalizeProviders(value: unknown): ProviderConfig[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.flatMap((item): ProviderConfig[] => {
    const record = normalizeRecord(item);
    if (!record) return [];

    const name = normalizeString(record.name);
    if (!name || seen.has(name)) return [];
    seen.add(name);

    const provider: ProviderConfig = {
      name,
      models: normalizeModels(record.models),
    };

    const apiKey = normalizeSecret(record.apiKey ?? record.api_key);
    const baseUrl = normalizeString(record.baseUrl ?? record.base_url);
    if (apiKey) provider.apiKey = apiKey;
    if (baseUrl) provider.baseUrl = baseUrl;

    return [provider];
  });
}

function normalizeModels(value: unknown): ModelConfig[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.flatMap((item): ModelConfig[] => {
    const record = normalizeRecord(item);
    if (!record) return [];

    const id = normalizeString(record.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);

    const model: ModelConfig = {
      id,
      name: normalizeString(record.name) || id,
    };

    const family = normalizeString(record.family);
    const apiKey = normalizeSecret(record.apiKey ?? record.api_key);
    const baseUrl = normalizeString(record.baseUrl ?? record.base_url);
    const attachment = normalizeOptionalBoolean(record.attachment);
    const reasoning = normalizeOptionalBoolean(record.reasoning);
    const toolCall = normalizeOptionalBoolean(record.toolCall ?? record.tool_call);
    const temperature = normalizeOptionalBoolean(record.temperature);
    const releaseDate = normalizeDisplayText(record.releaseDate ?? record.release_date);
    const modalities = normalizeModalities(record.modalities);
    const cost = normalizeCost(record.cost);
    const limit = resolveModelLimit(id, normalizeLimit(record.limit));

    if (family) model.family = family;
    if (apiKey) model.apiKey = apiKey;
    if (baseUrl) model.baseUrl = baseUrl;
    if (attachment !== undefined) model.attachment = attachment;
    if (reasoning !== undefined) model.reasoning = reasoning;
    if (toolCall !== undefined) model.toolCall = toolCall;
    if (temperature !== undefined) model.temperature = temperature;
    if (releaseDate) model.releaseDate = releaseDate;
    if (modalities) model.modalities = modalities;
    if (cost) model.cost = cost;
    model.limit = limit;

    return [model];
  });
}

function resolveDefaultModelRef(
  providers: readonly ProviderConfig[],
  rawRef: string | null,
): { provider: string; model: string } | null {
  if (!rawRef) return null;

  if (rawRef.includes("/")) {
    const parsed = splitProviderModelRef(rawRef);
    if (!parsed) return null;
    const { providerName, modelId } = parsed;
    const provider = providers.find((item) => item.name === providerName);
    if (!provider) return null;
    return provider.models.some((model) => model.id === modelId) ? { provider: providerName, model: modelId } : null;
  }

  for (const provider of providers) {
    if (provider.models.some((model) => model.id === rawRef)) {
      return { provider: provider.name, model: rawRef };
    }
  }
  return null;
}

function normalizeModalities(value: unknown): ModelConfig["modalities"] | undefined {
  const record = normalizeRecord(value);
  if (!record) return undefined;
  const input = normalizeStringList(record.input);
  const output = normalizeStringList(record.output);
  if (input.length === 0 && output.length === 0) return undefined;
  return { input, output };
}

function normalizeCost(value: unknown): ModelConfig["cost"] | undefined {
  const record = normalizeRecord(value);
  if (!record) return undefined;

  const input = normalizeFiniteNumber(record.input);
  const output = normalizeFiniteNumber(record.output);
  if (input === undefined || output === undefined) return undefined;

  const cost: NonNullable<ModelConfig["cost"]> = { input, output };
  const cacheRead = normalizeFiniteNumber(record.cacheRead ?? record.cache_read);
  const cacheWrite = normalizeFiniteNumber(record.cacheWrite ?? record.cache_write);
  if (cacheRead !== undefined) cost.cacheRead = cacheRead;
  if (cacheWrite !== undefined) cost.cacheWrite = cacheWrite;
  return cost;
}

function normalizeLimit(value: unknown): ModelLimitInput | undefined {
  const record = normalizeRecord(value);
  if (!record) return undefined;

  const context = normalizeFiniteNumber(record.context);
  const output = normalizeFiniteNumber(record.output);
  if (context === undefined && output === undefined) return undefined;

  const limit: ModelLimitInput = {};
  if (context !== undefined) limit.context = context;
  if (output !== undefined) limit.output = output;
  return limit;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = normalizeString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeSecret(value: unknown): string | undefined {
  const text = normalizeString(value);
  if (!text) return undefined;
  if (text === REDACTED_SECRET_PLACEHOLDER) return REDACTED_SECRET_PLACEHOLDER;
  return text;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDisplayText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
