import type { ProviderConfig } from "../lib/constants.ts";

export interface RuntimeModelConfigSnapshot {
  providers: ProviderConfig[];
  defaultProvider: string;
  defaultModel: string;
}

export function createRuntimeModelConfigSnapshot(input: {
  providers: readonly ProviderConfig[];
  defaultProvider: string;
  defaultModel: string;
}): RuntimeModelConfigSnapshot {
  return {
    providers: JSON.parse(JSON.stringify(input.providers)) as ProviderConfig[],
    defaultProvider: input.defaultProvider,
    defaultModel: input.defaultModel,
  };
}

export function resolveRuntimeApiKey(
  snapshot: Pick<RuntimeModelConfigSnapshot, "providers">,
  providerName: string,
  modelId: string,
): string {
  const provider = snapshot.providers.find((item) => item.name === providerName);
  if (!provider) return "";
  const model = provider.models.find((item) => item.id === modelId);
  return model?.apiKey?.trim() || provider.apiKey?.trim() || "";
}

export function resolveRuntimeBaseUrl(
  snapshot: Pick<RuntimeModelConfigSnapshot, "providers">,
  providerName: string,
  modelId: string,
): string {
  const provider = snapshot.providers.find((item) => item.name === providerName);
  if (!provider) return "";
  const model = provider.models.find((item) => item.id === modelId);
  return model?.baseUrl?.trim() || provider.baseUrl?.trim() || "";
}
