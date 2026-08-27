import type { ProviderConfig } from "../lib/constants.ts";

export interface RuntimeModelConfigSnapshot {
	providers: ProviderConfig[];
	defaultProvider: string;
	defaultModel: string;
}

export interface ResolvedRuntimeModel {
	providerName: string;
	modelId: string;
}

export const SESSION_MODEL_CONFIGURATION_ERROR =
	"当前会话没有可用的精确模型。请在“设置 > AI 服务”中手动选择模型并配置 API Key。";

export function formatResolvedRuntimeModel(
	model: ResolvedRuntimeModel | null,
): string | null {
	if (!model?.providerName.trim() || !model.modelId.trim()) return null;
	return `${model.providerName}/${model.modelId}`;
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
	const provider = snapshot.providers.find(
		(item) => item.name === providerName,
	);
	if (!provider) return "";
	const model = provider.models.find((item) => item.id === modelId);
	return model?.apiKey?.trim() || provider.apiKey?.trim() || "";
}

export function resolveRuntimeBaseUrl(
	snapshot: Pick<RuntimeModelConfigSnapshot, "providers">,
	providerName: string,
	modelId: string,
): string {
	const provider = snapshot.providers.find(
		(item) => item.name === providerName,
	);
	if (!provider) return "";
	const model = provider.models.find((item) => item.id === modelId);
	return model?.baseUrl?.trim() || provider.baseUrl?.trim() || "";
}

export function resolveExactRuntimeModel(
	snapshot: Pick<RuntimeModelConfigSnapshot, "providers">,
	providerName: string,
	modelId: string,
): ResolvedRuntimeModel | null {
	const normalizedProvider = providerName.trim();
	const normalizedModel = modelId.trim();
	if (!normalizedProvider || !normalizedModel) return null;
	const provider = snapshot.providers.find(
		(item) => item.name === normalizedProvider,
	);
	const model = provider?.models.find((item) => item.id === normalizedModel);
	if (!provider || !model) return null;
	if (!model.apiKey?.trim() && !provider.apiKey?.trim()) return null;
	return { providerName: normalizedProvider, modelId: normalizedModel };
}

export function resolvePinnedRuntimeModel(
	snapshot: Pick<RuntimeModelConfigSnapshot, "providers">,
	rawModel: string,
): ResolvedRuntimeModel | null {
	const normalized = rawModel.trim();
	if (!normalized) return null;
	const slashIndex = normalized.indexOf("/");
	if (slashIndex >= 0) {
		return resolveExactRuntimeModel(
			snapshot,
			normalized.slice(0, slashIndex),
			normalized.slice(slashIndex + 1),
		);
	}
	const matches = snapshot.providers.flatMap((provider) =>
		provider.models.some((model) => model.id === normalized)
			? [{ providerName: provider.name, modelId: normalized }]
			: [],
	);
	if (matches.length !== 1) return null;
	return resolveExactRuntimeModel(
		snapshot,
		matches[0].providerName,
		matches[0].modelId,
	);
}

export function resolveSessionRuntimeModel(
	snapshot: RuntimeModelConfigSnapshot,
	rawModel?: string,
	followDefaultModel?: boolean,
): ResolvedRuntimeModel | null {
	if (
		followDefaultModel === true ||
		(!rawModel?.trim() && followDefaultModel !== false)
	) {
		return resolveExactRuntimeModel(
			snapshot,
			snapshot.defaultProvider,
			snapshot.defaultModel,
		);
	}
	return resolvePinnedRuntimeModel(snapshot, rawModel ?? "");
}
