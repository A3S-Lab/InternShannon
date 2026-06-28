export type SkillMarketEmptyStateContent = {
  title: string;
  description: string;
  retryLabel?: string;
  retryAriaLabel?: string;
};

export interface SkillMarketInitialSearchState {
  loading: boolean;
  apiAvailable: boolean | null;
  searchError: string | null;
}

export const INITIAL_SKILL_MARKET_SEARCH_STATE: SkillMarketInitialSearchState = {
  loading: true,
  apiAvailable: null,
  searchError: null,
};

const MAX_ERROR_DESCRIPTION_LENGTH = 140;

export function formatSkillMarketErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : "";
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "请求技能市场失败，请确认本地后端已启动。";
  if (normalized.length <= MAX_ERROR_DESCRIPTION_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_ERROR_DESCRIPTION_LENGTH - 1)}…`;
}

export function resolveSkillMarketEmptyState(
  apiAvailable: boolean | null,
  hasQuery: boolean,
  errorMessage?: string | null,
): SkillMarketEmptyStateContent {
  if (apiAvailable === false || apiAvailable === null) {
    const normalizedError = errorMessage?.trim();
    return {
      title: "后端技能市场暂不可用",
      description: normalizedError ? `最近一次请求失败：${normalizedError}` : "请确认本地后端已启动，或稍后重试。",
      retryLabel: "重试加载",
      retryAriaLabel: "重新加载技能市场",
    };
  }

  if (hasQuery) {
    return {
      title: "无匹配结果",
      description: "尝试其他关键词或分类",
    };
  }

  return {
    title: "暂无技能",
    description: "请先在资产中心上架技能 ZIP 制品",
  };
}
