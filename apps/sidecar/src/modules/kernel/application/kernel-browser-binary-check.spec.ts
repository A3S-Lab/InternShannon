import {
    __resetBrowserBinaryStatusForTests,
    classifyWebSearchReadiness,
    verifyBrowserBinary,
    webSearchBrowserBlockReason,
} from './kernel-browser-binary-check';

describe('kernel browser binary readiness', () => {
    afterEach(() => __resetBrowserBinaryStatusForTests());

    it('marks a pinned existing runtime searchable', () => {
        const env: NodeJS.ProcessEnv = { LIGHTPANDA: '/runtime/lightpanda' };
        const status = verifyBrowserBinary(env, path => path === '/runtime/lightpanda');

        expect(status).toEqual({ available: true, reasonCode: 'ok', reason: null });
        expect(classifyWebSearchReadiness(env, status)).toEqual({ ready: true, reason: 'ok' });
        expect(webSearchBrowserBlockReason({ toolName: 'web_search' }, status)).toBeNull();
    });

    it('blocks web_search when no runtime is pinned instead of allowing an SDK download', () => {
        const env: NodeJS.ProcessEnv = {};
        const status = verifyBrowserBinary(env, () => false);

        expect(status.available).toBe(false);
        expect(status.reason).toContain('未固定');
        expect(classifyWebSearchReadiness(env, status)).toEqual({ ready: false, reason: 'no_pin' });
        expect(webSearchBrowserBlockReason({ toolName: 'web_search' }, status)).toContain('设置 → 搜索引擎');
        expect(webSearchBrowserBlockReason({ toolName: 'knowledge_search' }, status)).toBeNull();
    });

    it('removes a broken pin and reports a missing binary', () => {
        const env: NodeJS.ProcessEnv = { CHROME: '/missing/chrome' };
        const status = verifyBrowserBinary(env, () => false);

        expect(env.CHROME).toBeUndefined();
        expect(status.available).toBe(false);
        expect(classifyWebSearchReadiness(env, status)).toEqual({ ready: false, reason: 'binary_missing' });
    });

    it('keeps web search ready when one pin is broken but the fallback pin is usable', () => {
        const env: NodeJS.ProcessEnv = {
            LIGHTPANDA: '/missing/lightpanda',
            CHROME: '/runtime/chrome',
        };
        const status = verifyBrowserBinary(env, path => path === '/runtime/chrome');

        expect(env.LIGHTPANDA).toBeUndefined();
        expect(env.CHROME).toBe('/runtime/chrome');
        expect(status).toEqual({ available: true, reasonCode: 'ok', reason: null });
    });

    it('rejects a pinned path when the executable probe rejects it', () => {
        const env: NodeJS.ProcessEnv = { CHROME: '/runtime/not-executable' };
        const status = verifyBrowserBinary(env, () => false);

        expect(status.available).toBe(false);
        expect(status.reasonCode).toBe('binary_missing');
        expect(status.reason).toContain('不是可执行文件');
    });
});
