export interface StatusBarModelOption {
  value: string;
  modelId: string;
}

export interface RoutedSessionModel {
  providerName: string;
  modelId: string;
}

function routedModelValue(routed?: RoutedSessionModel): string {
  if (!routed?.modelId) return "";
  return routed.providerName ? `${routed.providerName}/${routed.modelId}` : routed.modelId;
}

function resolveAvailableModelValue(availableModels: StatusBarModelOption[], modelRef: string): string {
  if (!modelRef) return "";
  const exact = availableModels.find((item) => item.value === modelRef);
  if (exact) return exact.value;
  const byId = availableModels.filter((item) => item.modelId === modelRef);
  if (byId.length === 1) return byId[0].value;
  return modelRef;
}

export function resolveStatusBarModelValue(input: {
  availableModels: StatusBarModelOption[];
  sessionModel?: string;
  followDefaultModel?: boolean;
  routedModel?: RoutedSessionModel;
}): string {
  const { availableModels, followDefaultModel, routedModel } = input;
  const rawModel = followDefaultModel ? "" : input.sessionModel?.trim() || "";
  if (rawModel) {
    return resolveAvailableModelValue(availableModels, rawModel);
  }

  const routed = resolveAvailableModelValue(availableModels, routedModelValue(routedModel));
  if (routed) return routed;
  return availableModels[0]?.value ?? "";
}
