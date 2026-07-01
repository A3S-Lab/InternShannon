import { resolveModelLimit, resolveModelLimitPreset } from './model-limit-normalization';

describe('model-limit-normalization', () => {
    it('uses bounded modern defaults by model id', () => {
        expect(resolveModelLimitPreset('gpt-5.5-codex')).toEqual({ context: 258000, output: 128000 });
        expect(resolveModelLimitPreset('gpt-5.4-mini')).toEqual({ context: 258000, output: 128000 });
        expect(resolveModelLimitPreset('claude-opus-4-7')).toEqual({ context: 258000, output: 128000 });
        expect(resolveModelLimitPreset('claude-sonnet-5')).toEqual({ context: 258000, output: 128000 });
        expect(resolveModelLimitPreset('claude-sonnet-4.6')).toEqual({ context: 258000, output: 128000 });
        expect(resolveModelLimitPreset('claude-haiku-4.5')).toEqual({ context: 200000, output: 65536 });
        expect(resolveModelLimitPreset('gemini-2.5-pro')).toEqual({ context: 258000, output: 65536 });
        expect(resolveModelLimitPreset('custom-frontier')).toEqual({ context: 128000, output: 65536 });
        expect(resolveModelLimitPreset('openai/gpt-5.5-codex')).toEqual({ context: 258000, output: 128000 });
        expect(resolveModelLimitPreset('anthropic/claude-sonnet-5')).toEqual({ context: 258000, output: 128000 });
    });

    it('upgrades generated output and context defaults while preserving explicit overrides', () => {
        expect(resolveModelLimit('gpt-5.5', { context: 128000, output: 4096 })).toEqual({
            context: 258000,
            output: 128000,
        });
        expect(resolveModelLimit('claude-sonnet-5', { context: 200000, output: 8192 })).toEqual({
            context: 258000,
            output: 128000,
        });
        expect(resolveModelLimit('claude-opus-4-7', { context: 200000, output: 65536 })).toEqual({
            context: 258000,
            output: 128000,
        });
        expect(resolveModelLimit('gpt-5.5', { context: 1000000, output: 128000 })).toEqual({
            context: 258000,
            output: 128000,
        });
        expect(resolveModelLimit('gpt-5.4-mini', { context: 400000, output: 128000 })).toEqual({
            context: 258000,
            output: 128000,
        });
        expect(resolveModelLimit('gemini-2.5-pro', { context: 1000000, output: 16384 })).toEqual({
            context: 258000,
            output: 65536,
        });
        expect(resolveModelLimit('custom-frontier', { context: 128000, output: 4096 })).toEqual({
            context: 128000,
            output: 65536,
        });
        expect(resolveModelLimit('gpt-5.5', { context: 250000, output: 32000 })).toEqual({
            context: 250000,
            output: 32000,
        });
        expect(resolveModelLimit('custom-frontier', { context: '200000', output: '4096' })).toEqual({
            context: 200000,
            output: 65536,
        });
    });
});
