import { KernelRuntimeConfigBuilder } from './kernel-runtime-config.builder';

describe('KernelRuntimeConfigBuilder', () => {
    const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
    const originalAppPort = process.env.APP_PORT;
    const originalSelfApiBaseUrl = process.env.SELF_API_BASE_URL;

    afterEach(() => {
        restoreEnv('OPENAI_API_KEY', originalOpenAiApiKey);
        restoreEnv('APP_PORT', originalAppPort);
        restoreEnv('SELF_API_BASE_URL', originalSelfApiBaseUrl);
    });

    it('preserves slashes inside provider-qualified model ids', () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'openai/bailian/deepseek-v4-pro',
            providers: [
                {
                    name: 'openai',
                    apiKey: 'openai-key',
                    models: [
                        {
                            id: 'bailian/deepseek-v4-pro',
                            name: 'bailian/deepseek-v4-pro',
                            family: 'deepseek',
                        },
                    ],
                },
            ],
        });

        expect(builder.resolveDefaultModel({})).toBe('openai/bailian/deepseek-v4-pro');
        expect(builder.resolvedModelApiKeyMissing('openai/bailian/deepseek-v4-pro')).toBe(false);

        const hcl = builder.buildAgentConfig({});
        expect(hcl).toContain('default_model = "openai/bailian/deepseek-v4-pro"');
        expect(hcl).toContain('models "bailian/deepseek-v4-pro"');
        expect(hcl).not.toContain('models "bailian"');
    });

    it('reports empty model configuration without inventing openai/gpt-4', () => {
        delete process.env.OPENAI_API_KEY;
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: '',
            providers: [],
        });

        expect(() => builder.resolveDefaultModel({})).toThrow(
            'No AI model configured. Please configure a default model and provider API key in System > AI settings, or set OPENAI_API_KEY in the environment.',
        );
        expect(() => builder.resolveDefaultModel({})).not.toThrow(/openai\/gpt-4/);
    });

    it('keeps the specific missing-key error when a default model is explicitly configured', () => {
        delete process.env.OPENAI_API_KEY;
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'openai/gpt-4o',
            providers: [],
        });

        expect(() => builder.resolveDefaultModel({})).toThrow(
            'No valid API key configured for default model openai/gpt-4o.',
        );
    });

    it('does not silently fall back when an explicitly selected session model is unavailable', () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'boyue/gpt-5',
            providers: [
                {
                    name: 'boyue',
                    apiKey: 'boyue-key',
                    models: [{ id: 'gpt-5', name: 'GPT-5', family: 'openai' }],
                },
            ],
        });

        expect(() => builder.resolveDefaultModel({ model: 'zhipu/glm-5.2' })).toThrow(
            'No valid API key configured for selected session model zhipu/glm-5.2.',
        );
    });

    it('uses an explicitly selected credentialed session model instead of the configured default', () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'boyue/gpt-5',
            providers: [
                {
                    name: 'boyue',
                    apiKey: 'boyue-key',
                    models: [{ id: 'gpt-5', name: 'GPT-5', family: 'openai' }],
                },
                {
                    name: 'zhipu',
                    apiKey: 'zhipu-key',
                    models: [{ id: 'glm-5.2', name: 'GLM-5.2', family: 'glm' }],
                },
            ],
        });

        expect(builder.resolveDefaultModel({ model: 'zhipu/glm-5.2' })).toBe('zhipu/glm-5.2');
    });

    it('normalizes the standard Zhipu base URL before the SDK appends its fixed API path', () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'zhipu/glm-5.2',
            providers: [
                {
                    name: 'zhipu',
                    apiKey: 'zhipu-key',
                    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
                    models: [{ id: 'glm-5.2', name: 'GLM-5.2', family: 'openai' }],
                },
            ],
        });

        expect(builder.buildAgentConfig({})).toContain('baseUrl = "https://open.bigmodel.cn"');
    });

    it('routes the Zhipu Coding Plan URL through the local compatibility endpoint', () => {
        process.env.APP_PORT = '29670';
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'zhipu/glm-5.2',
            providers: [
                {
                    name: 'zhipu',
                    apiKey: 'zhipu-key',
                    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
                    models: [{ id: 'glm-5.2', name: 'GLM-5.2', family: 'openai' }],
                },
            ],
        });

        expect(builder.buildAgentConfig({})).toContain(
            'baseUrl = "http://127.0.0.1:29670/api/v1/kernel/llm-compat/zhipu-coding"',
        );
    });

    it('normalizes model-level Zhipu URLs before they override the provider base URL', () => {
        process.env.APP_PORT = '29670';
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'zhipu/glm-5.2',
            providers: [
                {
                    name: 'zhipu',
                    apiKey: 'zhipu-key',
                    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
                    models: [
                        {
                            id: 'glm-5.2',
                            name: 'GLM-5.2',
                            family: 'openai',
                            baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/',
                        },
                    ],
                },
            ],
        });

        const hcl = builder.buildAgentConfig({});

        expect(hcl).toContain('  baseUrl = "https://open.bigmodel.cn"');
        expect(hcl).toContain(
            '    baseUrl = "http://127.0.0.1:29670/api/v1/kernel/llm-compat/zhipu-coding"',
        );
        expect(hcl).not.toContain('baseUrl = "https://open.bigmodel.cn/api/coding/paas/v4/"');
    });

    it('uses the sidecar default port for Coding Plan compatibility when APP_PORT is unset', () => {
        delete process.env.APP_PORT;
        delete process.env.SELF_API_BASE_URL;
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'zhipu/glm-5.2',
            providers: [
                {
                    name: 'zhipu',
                    apiKey: 'zhipu-key',
                    models: [
                        {
                            id: 'glm-5.2',
                            name: 'GLM-5.2',
                            family: 'openai',
                            baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
                        },
                    ],
                },
            ],
        });

        expect(builder.buildAgentConfig({})).toContain(
            'baseUrl = "http://127.0.0.1:29653/api/v1/kernel/llm-compat/zhipu-coding"',
        );
    });

    it('ignores persisted model snapshots when a session follows the default model', () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'openai/gpt-4o',
            providers: [
                {
                    name: 'openai',
                    apiKey: 'openai-key',
                    models: [{ id: 'gpt-4o', name: 'GPT-4o', family: 'gpt-4o' }],
                },
                {
                    name: 'zhipu',
                    apiKey: 'zhipu-key',
                    models: [{ id: 'glm-4.5', name: 'GLM-4.5', family: 'glm' }],
                },
            ],
        });

        expect(
            builder.sessionMetadataOverrides({
                metadata: {
                    model: 'zhipu/glm-4.5',
                    followDefaultModel: true,
                },
            }).model,
        ).toBeUndefined();

        expect(
            builder.sessionMetadataOverrides({
                metadata: {
                    model: 'zhipu/glm-4.5',
                    followDefaultModel: false,
                },
            }).model,
        ).toBe('zhipu/glm-4.5');
    });

    it('writes normalized limits for configured models', () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: 'openai/gpt-5.5',
            providers: [
                {
                    name: 'openai',
                    apiKey: 'openai-key',
                    models: [
                        {
                            id: 'gpt-5.5',
                            name: 'GPT-5.5',
                            family: 'openai',
                            limit: { context: 128000, output: 4096 },
                        },
                        {
                            id: 'custom-frontier',
                            name: 'Custom Frontier',
                            family: 'custom',
                        },
                    ],
                },
            ],
        });

        const hcl = builder.buildAgentConfig({});

        expect(hcl).toMatch(/models "gpt-5\.5" \{[\s\S]*limit = \{\n      output = 128000\n      context = 258000\n    \}/);
        expect(hcl).toMatch(
            /models "custom-frontier" \{[\s\S]*limit = \{\n      output = 65536\n      context = 128000\n    \}/,
        );
    });

    it('writes normalized limits for env-only synthetic models', () => {
        process.env.OPENAI_API_KEY = 'env-openai-key';
        const builder = new KernelRuntimeConfigBuilder(null);

        const hcl = builder.buildAgentConfig({ model: 'openai/gpt-5.5' });

        expect(hcl).toMatch(/models "gpt-5\.5" \{[\s\S]*limit = \{\n      output = 128000\n      context = 258000\n    \}/);
    });

    it('guards generated datasets from being streamed through large inline write arguments', () => {
        const builder = new KernelRuntimeConfigBuilder(null);

        const extra = builder.composeExtraSlot({});

        expect(extra).toContain('generated datasets');
        expect(extra).toContain('100 KB');
        expect(extra).toContain('do not stream the final artifact through one large inline write argument');
        expect(extra).toContain('Ordinary hand-authored source files');
        expect(extra).toContain('A single huge write is not a batch edit');
    });
});

function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
