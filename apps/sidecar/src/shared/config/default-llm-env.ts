export const A3S_LLM_ENV_NAMES = [
  'A3S_LLM_PROVIDER',
  'A3S_LLM_MODEL_ID',
  'A3S_LLM_BASE_URL',
  'A3S_LLM_API_KEY',
] as const;

export interface DefaultLlmEnvSettings {
  defaultModel?: string | null;
  providers?: Array<{
    name?: string | null;
    apiKey?: string | null;
    baseUrl?: string | null;
    models?: Array<{
      id?: string | null;
      name?: string | null;
      apiKey?: string | null;
      baseUrl?: string | null;
    }>;
  }>;
}

/**
 * Resolves internShannon's default LLM (defaultModel + its hosting provider) into
 * environment variables consumed by built-in agent containers.
 */
export function buildDefaultLlmEnv(settings: DefaultLlmEnvSettings | null | undefined): Array<{ name: string; value: string }> {
  if (!settings) return [];
  const defaultModelRaw = settings.defaultModel?.trim();
  if (!defaultModelRaw) return [];

  let providerHint: string | undefined;
  let defaultModelId = defaultModelRaw;
  const slashAt = defaultModelRaw.indexOf('/');
  if (slashAt > 0) {
    providerHint = defaultModelRaw.slice(0, slashAt);
    defaultModelId = defaultModelRaw.slice(slashAt + 1);
  }

  const providers = settings.providers ?? [];
  const orderedProviders = providerHint
    ? [...providers.filter(provider => provider.name === providerHint), ...providers.filter(provider => provider.name !== providerHint)]
    : providers;

  for (const provider of orderedProviders) {
    const model = (provider.models ?? []).find(candidate => candidate.id === defaultModelId || candidate.name === defaultModelId);
    if (!model || !provider.name) {
      continue;
    }

    const apiKey = (model.apiKey || provider.apiKey || '').trim();
    const baseUrl = (model.baseUrl || provider.baseUrl || '').trim();
    const env: Array<{ name: string; value: string }> = [
      { name: 'A3S_LLM_PROVIDER', value: provider.name },
      { name: 'A3S_LLM_MODEL_ID', value: model.id?.trim() || defaultModelId },
    ];
    if (baseUrl) env.push({ name: 'A3S_LLM_BASE_URL', value: baseUrl });
    if (apiKey) env.push({ name: 'A3S_LLM_API_KEY', value: apiKey });
    return env;
  }

  return [];
}
