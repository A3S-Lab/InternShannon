import {
    isWebSearchEmptyResult,
    toolFailureCircuitDecision,
    WEB_SEARCH_FAILURE_THRESHOLD,
} from './kernel-tool-failure-policy';

describe('kernel tool failure policy', () => {
    it('recognizes a successful transport with an empty web search result as a failure', () => {
        expect(isWebSearchEmptyResult('web_search', 'No results found for the query')).toBe(true);
        expect(isWebSearchEmptyResult('web_search', '未找到结果，请稍后重试')).toBe(true);
        expect(isWebSearchEmptyResult('web_search', '1. OpenAI — https://openai.com')).toBe(false);
        expect(isWebSearchEmptyResult('grep', 'No results found')).toBe(false);
    });

    it('stops web search after a small retry budget', () => {
        expect(
            toolFailureCircuitDecision({
                toolName: 'web_search',
                consecutiveFailures: WEB_SEARCH_FAILURE_THRESHOLD,
                totalFailures: WEB_SEARCH_FAILURE_THRESHOLD,
                sameToolThreshold: 3,
            }),
        ).toEqual({ open: true, threshold: WEB_SEARCH_FAILURE_THRESHOLD, scope: 'same_tool' });
    });

    it('stops a failure loop that hops between different tools', () => {
        expect(
            toolFailureCircuitDecision({
                toolName: 'search_skills',
                consecutiveFailures: 1,
                totalFailures: 4,
                sameToolThreshold: 3,
            }),
        ).toEqual({ open: true, threshold: 4, scope: 'all_tools' });
    });
});
