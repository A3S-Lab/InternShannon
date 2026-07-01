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

    it('detects attachment support from attachment flag or image input modalities', () => {
        const builder = new KernelRuntimeConfigBuilder({
            providers: [
                {
                    name: 'openai',
                    apiKey: 'openai-key',
                    models: [
                        { id: 'text-only', name: 'Text Only', family: 'text', attachment: false },
                        { id: 'attachment', name: 'Attachment', family: 'vision', attachment: true },
                        {
                            id: 'modalities',
                            name: 'Modalities',
                            family: 'vision',
                            attachment: false,
                            modalities: { input: ['text', 'image'], output: ['text'] },
                        },
                    ],
                },
            ],
        });

        expect(builder.modelSupportsAttachments('openai/text-only')).toBe(false);
        expect(builder.modelSupportsAttachments('openai/attachment')).toBe(true);
        expect(builder.modelSupportsAttachments('openai/modalities')).toBe(true);
        expect(builder.modelSupportsAttachments('openai/missing')).toBe(false);
    });
});
