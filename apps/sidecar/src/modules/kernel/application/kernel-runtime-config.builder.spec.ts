import { KernelRuntimeConfigBuilder } from './kernel-runtime-config.builder';

describe('KernelRuntimeConfigBuilder', () => {
    const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
        restoreEnv('OPENAI_API_KEY', originalOpenAiApiKey);
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

    it('guards large generated data from being streamed through inline write arguments', () => {
        const builder = new KernelRuntimeConfigBuilder(null);

        const extra = builder.composeExtraSlot({});

        expect(extra).toContain('do not stream the final artifact through a large inline write argument');
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
