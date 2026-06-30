import { KernelRuntimeConfigBuilder } from './kernel-runtime-config.builder';

describe('KernelRuntimeConfigBuilder', () => {
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
});
