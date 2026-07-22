export const DEFAULT_MAX_TOTAL_TOOL_ERRORS = 4;
export const WEB_SEARCH_FAILURE_THRESHOLD = 2;

export function isWebSearchEmptyResult(toolName: string, output: unknown): boolean {
    if (toolName.trim().toLowerCase() !== 'web_search' || typeof output !== 'string') return false;
    const normalized = output.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized) return true;
    return (
        /\bno (?:search )?results?\b/.test(normalized) ||
        /\b0 results?\b/.test(normalized) ||
        normalized.includes('未找到结果') ||
        normalized.includes('没有搜索结果') ||
        normalized.includes('搜索无结果')
    );
}
export function toolFailureCircuitDecision(input: {
    toolName: string;
    consecutiveFailures: number;
    totalFailures: number;
    sameToolThreshold: number;
    totalFailureThreshold?: number;
}): { open: boolean; threshold: number; scope: 'same_tool' | 'all_tools' | null } {
    const sameToolThreshold =
        input.toolName.trim().toLowerCase() === 'web_search'
            ? Math.min(input.sameToolThreshold, WEB_SEARCH_FAILURE_THRESHOLD)
            : input.sameToolThreshold;
    if (input.consecutiveFailures >= sameToolThreshold) {
        return { open: true, threshold: sameToolThreshold, scope: 'same_tool' };
    }
    const totalThreshold = input.totalFailureThreshold ?? DEFAULT_MAX_TOTAL_TOOL_ERRORS;
    if (input.totalFailures >= totalThreshold) {
        return { open: true, threshold: totalThreshold, scope: 'all_tools' };
    }
    return { open: false, threshold: sameToolThreshold, scope: null };
}
