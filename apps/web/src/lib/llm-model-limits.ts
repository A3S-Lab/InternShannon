export const DEFAULT_MODEL_CONTEXT_LIMIT = 128000;
export const DEFAULT_MODEL_OUTPUT_LIMIT = 65536;
export const HIGH_OUTPUT_MODEL_LIMIT = 128000;
export const LEGACY_DEFAULT_MODEL_OUTPUT_LIMIT = 4096;

export const PRODUCT_MODERN_CONTEXT_LIMIT = 258000;
export const OPENAI_MODERN_CONTEXT_LIMIT = PRODUCT_MODERN_CONTEXT_LIMIT;
export const ANTHROPIC_CONTEXT_LIMIT = 200000;
export const PREVIOUS_OPENAI_MODERN_CONTEXT_LIMIT = 400000;
export const PREVIOUS_ONE_MILLION_CONTEXT_LIMIT = 1000000;
export const PREVIOUS_GEMINI_CONTEXT_LIMIT = 1048576;

export interface ModelLimitInput {
  context?: number | string | null;
  output?: number | string | null;
}

export interface ResolvedModelLimit {
  context: number;
  output: number;
}

const HIGH_OUTPUT_MODEL_PATTERNS = [
  /^gpt-5(?:[.\-]|$)/i,
  /^claude-(?:fable-5|mythos-5|opus-(?:4[.\-][678]|5)|sonnet-(?:4[.\-]6|5))/i,
  /(?:deepseek-v4|deepseek-v3\.2)/i,
];

const GPT5_MODEL_PATTERN = /^gpt-5(?:[.\-]|$)/i;
const GPT5_SMALL_MODEL_TOKEN_PATTERN = /(?:^|[.\-])(?:mini|nano|lite)(?:[.\-]|$)/i;
const OPENAI_MODERN_CONTEXT_PATTERNS = [/^(?:o[134]|o\d)/i];
const ANTHROPIC_ONE_MILLION_CONTEXT_PATTERNS = [
  /^claude-(?:fable-5|mythos-5|opus-(?:4[.\-][678]|5)|sonnet-(?:4[.\-]6|5))/i,
];
const GENERATED_CONTEXT_DEFAULT_LIMITS = new Set([
  16385,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  ANTHROPIC_CONTEXT_LIMIT,
  PRODUCT_MODERN_CONTEXT_LIMIT,
  PREVIOUS_OPENAI_MODERN_CONTEXT_LIMIT,
  PREVIOUS_ONE_MILLION_CONTEXT_LIMIT,
  PREVIOUS_GEMINI_CONTEXT_LIMIT,
]);
const GENERATED_OUTPUT_DEFAULT_LIMITS = new Set([LEGACY_DEFAULT_MODEL_OUTPUT_LIMIT, 8192, 16384, DEFAULT_MODEL_OUTPUT_LIMIT]);

export function resolveModelLimitPreset(modelId: string | null | undefined): ResolvedModelLimit {
  const id = modelId?.trim() ?? "";
  const variants = modelIdVariants(id);
  return {
    context: resolvePresetContext(variants),
    output: matchesAny(variants, HIGH_OUTPUT_MODEL_PATTERNS)
      ? HIGH_OUTPUT_MODEL_LIMIT
      : DEFAULT_MODEL_OUTPUT_LIMIT,
  };
}

export function resolveModelLimit(modelId: string | null | undefined, limit?: ModelLimitInput | null): ResolvedModelLimit {
  const preset = resolveModelLimitPreset(modelId);
  const storedContext = positiveFiniteNumber(limit?.context);
  const context =
    storedContext === undefined || shouldUpgradeGeneratedContextDefault(storedContext, preset.context)
      ? preset.context
      : storedContext;
  const storedOutput = positiveFiniteNumber(limit?.output);
  const output =
    storedOutput === undefined || shouldUpgradeGeneratedOutputDefault(storedOutput, preset.output)
      ? preset.output
      : storedOutput;
  return { context, output };
}

function resolvePresetContext(modelIds: readonly string[]): number {
  if (matchesAny(modelIds, ANTHROPIC_ONE_MILLION_CONTEXT_PATTERNS)) return PRODUCT_MODERN_CONTEXT_LIMIT;
  if (modelIds.some((modelId) => /^gemini/i.test(modelId))) return PRODUCT_MODERN_CONTEXT_LIMIT;
  if (modelIds.some((modelId) => /^claude/i.test(modelId))) return ANTHROPIC_CONTEXT_LIMIT;
  if (modelIds.some(isOpenAiOneMillionContextModel)) return PRODUCT_MODERN_CONTEXT_LIMIT;
  if (modelIds.some((modelId) => GPT5_MODEL_PATTERN.test(modelId))) return OPENAI_MODERN_CONTEXT_LIMIT;
  if (matchesAny(modelIds, OPENAI_MODERN_CONTEXT_PATTERNS)) return OPENAI_MODERN_CONTEXT_LIMIT;
  return DEFAULT_MODEL_CONTEXT_LIMIT;
}

function isOpenAiOneMillionContextModel(modelId: string): boolean {
  return GPT5_MODEL_PATTERN.test(modelId) && !GPT5_SMALL_MODEL_TOKEN_PATTERN.test(modelId);
}

function shouldUpgradeGeneratedContextDefault(storedContext: number, presetContext: number): boolean {
  if (storedContext === presetContext || !GENERATED_CONTEXT_DEFAULT_LIMITS.has(storedContext)) return false;
  if (storedContext < presetContext) return true;
  return presetContext === PRODUCT_MODERN_CONTEXT_LIMIT && storedContext > presetContext;
}

function shouldUpgradeGeneratedOutputDefault(storedOutput: number, presetOutput: number): boolean {
  return storedOutput < presetOutput && GENERATED_OUTPUT_DEFAULT_LIMITS.has(storedOutput);
}

function matchesAny(values: readonly string[], patterns: readonly RegExp[]): boolean {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

function modelIdVariants(modelId: string): string[] {
  const leaf = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
  return leaf && leaf !== modelId ? [modelId, leaf] : [modelId];
}

function positiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
