import { KernelRuntimeConfigBuilder } from "./kernel-runtime-config.builder";

describe("KernelRuntimeConfigBuilder", () => {
    const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
    const originalAppPort = process.env.APP_PORT;
    const originalSelfApiBaseUrl = process.env.SELF_API_BASE_URL;

    afterEach(() => {
        restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey);
        restoreEnv("APP_PORT", originalAppPort);
        restoreEnv("SELF_API_BASE_URL", originalSelfApiBaseUrl);
    });

    it("preserves slashes inside provider-qualified model ids", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "openai/bailian/deepseek-v4-pro",
            providers: [
                {
                    name: "openai",
                    apiKey: "openai-key",
                    models: [
                        {
                            id: "bailian/deepseek-v4-pro",
                            name: "bailian/deepseek-v4-pro",
                            family: "deepseek",
                        },
                    ],
                },
            ],
        });

        expect(builder.resolveDefaultModel({})).toBe("openai/bailian/deepseek-v4-pro");
        expect(builder.resolvedModelApiKeyMissing("openai/bailian/deepseek-v4-pro")).toBe(false);

        const hcl = builder.buildAgentConfig({});
        expect(hcl).toContain('default_model = "openai/bailian/deepseek-v4-pro"');
        expect(hcl).toContain('models "bailian/deepseek-v4-pro"');
        expect(hcl).not.toContain('models "bailian"');
    });

    it("states that quick-action prefill is sent from the user perspective", () => {
        const builder = new KernelRuntimeConfigBuilder({ defaultModel: "", providers: [] });

        const prompt = builder.composeExtraSlot({});

        expect(prompt).toContain("sent verbatim as the next USER message");
        expect(prompt).toContain("我授权你使用我的个人知识库并继续检索");
        expect(prompt).toContain("never from the ASSISTANT perspective");
    });

    it("reports empty model configuration without inventing openai/gpt-4", () => {
        delete process.env.OPENAI_API_KEY;
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "",
            providers: [],
        });

        expect(() => builder.resolveDefaultModel({})).toThrow(
            "No AI model configured. Please configure a default model and provider API key in System > AI settings, or set OPENAI_API_KEY in the environment.",
        );
        expect(() => builder.resolveDefaultModel({})).not.toThrow(/openai\/gpt-4/);
    });

    it("keeps the specific missing-key error when a default model is explicitly configured", () => {
        delete process.env.OPENAI_API_KEY;
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "openai/gpt-4o",
            providers: [],
        });

        expect(() => builder.resolveDefaultModel({})).toThrow(
            "No valid API key configured for default model openai/gpt-4o.",
        );
    });

    it("does not replace an explicit uncredentialed default with an env-only OpenAI model", () => {
        process.env.OPENAI_API_KEY = "env-openai-key";
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "zhipu/glm-5.2",
            providers: [],
        });

        expect(() => builder.resolveDefaultModel({})).toThrow(
            "No valid API key configured for default model zhipu/glm-5.2.",
        );
    });

    it("does not auto-switch to another credentialed model when the configured default has no key", () => {
        delete process.env.OPENAI_API_KEY;
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "boyue/gpt-5",
            providers: [
                {
                    name: "boyue",
                    apiKey: "",
                    models: [{ id: "gpt-5", name: "GPT-5", family: "openai" }],
                },
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    models: [{ id: "glm-5.2", name: "GLM-5.2", family: "glm" }],
                },
            ],
        });

        expect(() => builder.resolveDefaultModel({})).toThrow(
            "No valid API key configured for default model boyue/gpt-5.",
        );
    });

    it("requires a configured default instead of auto-selecting the first credentialed model", () => {
        delete process.env.OPENAI_API_KEY;
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "",
            providers: [
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    models: [{ id: "glm-5.2", name: "GLM-5.2", family: "glm" }],
                },
            ],
        });

        expect(() => builder.resolveDefaultModel({})).toThrow(
            "No AI model configured. Please configure a default model and provider API key in System > AI settings, or set OPENAI_API_KEY in the environment.",
        );
    });

    it("does not silently fall back when an explicitly selected session model is unavailable", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "boyue/gpt-5",
            providers: [
                {
                    name: "boyue",
                    apiKey: "boyue-key",
                    models: [{ id: "gpt-5", name: "GPT-5", family: "openai" }],
                },
            ],
        });

        expect(() => builder.resolveDefaultModel({ model: "zhipu/glm-5.2" })).toThrow(
            "No valid API key configured for selected session model zhipu/glm-5.2.",
        );
    });

    it("uses an explicitly selected credentialed session model instead of the configured default", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "boyue/gpt-5",
            providers: [
                {
                    name: "boyue",
                    apiKey: "boyue-key",
                    models: [{ id: "gpt-5", name: "GPT-5", family: "openai" }],
                },
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    models: [{ id: "glm-5.2", name: "GLM-5.2", family: "glm" }],
                },
            ],
        });

        expect(builder.resolveDefaultModel({ model: "zhipu/glm-5.2" })).toBe("zhipu/glm-5.2");
    });

    it("allows an explicit manual model selection even when the configured default has no key", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "boyue/gpt-5",
            providers: [
                {
                    name: "boyue",
                    apiKey: "",
                    models: [{ id: "gpt-5", name: "GPT-5", family: "openai" }],
                },
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    models: [{ id: "glm-5.2", name: "GLM-5.2", family: "glm" }],
                },
            ],
        });

        expect(builder.resolveDefaultModel({ model: "zhipu/glm-5.2" })).toBe("zhipu/glm-5.2");
    });

    it("keeps a Unicode provider URL and key paired behind a stable ASCII runtime alias", () => {
        process.env.APP_PORT = "29670";
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "智谱/glm-5",
            providers: [
                {
                    name: "智谱",
                    apiKey: "zhipu-paired-key",
                    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
                    models: [{ id: "glm-5", name: "GLM-5", family: "openai" }],
                },
            ],
        });

        const runtimeModel = builder.resolveRuntimeModel({});
        const hcl = builder.buildAgentConfig({});

        expect(builder.resolveDefaultModel({})).toBe("智谱/glm-5");
        expect(runtimeModel).toMatch(/^provider-[a-f0-9]{16}\/glm-5$/);
        expect(hcl).toContain(`default_model = "${runtimeModel}"`);
        expect(hcl).toContain(`providers "${runtimeModel.split("/")[0]}" {`);
        expect(hcl).toContain('  apiKey = "zhipu-paired-key"');
        expect(hcl).toContain('baseUrl = "http://127.0.0.1:29670/api/v1/kernel/llm-compat/zhipu-coding"');
        expect(hcl).not.toContain("智谱");
    });

    it("normalizes a standard Zhipu URL even when the provider display name is Unicode", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "智谱/glm-5",
            providers: [
                {
                    name: "智谱",
                    apiKey: "zhipu-paired-key",
                    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
                    models: [{ id: "glm-5", name: "GLM-5", family: "openai" }],
                },
            ],
        });

        expect(builder.buildAgentConfig({})).toContain('baseUrl = "https://open.bigmodel.cn"');
    });

    it("normalizes the standard Zhipu base URL before the SDK appends its fixed API path", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "zhipu/glm-5.2",
            providers: [
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
                    models: [{ id: "glm-5.2", name: "GLM-5.2", family: "openai" }],
                },
            ],
        });

        expect(builder.buildAgentConfig({})).toContain('baseUrl = "https://open.bigmodel.cn"');
    });

    it("routes the Zhipu Coding Plan URL through the local compatibility endpoint", () => {
        process.env.APP_PORT = "29670";
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "zhipu/glm-5.2",
            providers: [
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
                    models: [{ id: "glm-5.2", name: "GLM-5.2", family: "openai" }],
                },
            ],
        });

        const hcl = builder.buildAgentConfig({});

        expect(hcl).toContain('baseUrl = "http://127.0.0.1:29670/api/v1/kernel/llm-compat/zhipu-coding"');
        expect(hcl).not.toContain("x-internshannon-session-id");
    });

    it("preserves an explicit session correlation header instead of replacing it", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "zhipu/glm-5.2",
            providers: [
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
                    sessionIdHeader: "x-custom-session",
                    models: [{ id: "glm-5.2", name: "GLM-5.2", family: "openai" }],
                },
            ],
        });

        const hcl = builder.buildAgentConfig({});
        expect(hcl).toContain('sessionIdHeader = "x-custom-session"');
        expect(hcl).not.toContain('sessionIdHeader = "x-internshannon-session-id"');
    });

    it("normalizes model-level Zhipu URLs before they override the provider base URL", () => {
        process.env.APP_PORT = "29670";
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "zhipu/glm-5.2",
            providers: [
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
                    models: [
                        {
                            id: "glm-5.2",
                            name: "GLM-5.2",
                            family: "openai",
                            baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/",
                        },
                    ],
                },
            ],
        });

        const hcl = builder.buildAgentConfig({});

        expect(hcl).toContain('  baseUrl = "https://open.bigmodel.cn"');
        expect(hcl).toContain('    baseUrl = "http://127.0.0.1:29670/api/v1/kernel/llm-compat/zhipu-coding"');
        expect(hcl).not.toContain('baseUrl = "https://open.bigmodel.cn/api/coding/paas/v4/"');
    });

    it("uses the sidecar default port for Coding Plan compatibility when APP_PORT is unset", () => {
        delete process.env.APP_PORT;
        delete process.env.SELF_API_BASE_URL;
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "zhipu/glm-5.2",
            providers: [
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    models: [
                        {
                            id: "glm-5.2",
                            name: "GLM-5.2",
                            family: "openai",
                            baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
                        },
                    ],
                },
            ],
        });

        expect(builder.buildAgentConfig({})).toContain(
            'baseUrl = "http://127.0.0.1:29653/api/v1/kernel/llm-compat/zhipu-coding"',
        );
    });

    it("ignores persisted model snapshots when a session follows the default model", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "openai/gpt-4o",
            providers: [
                {
                    name: "openai",
                    apiKey: "openai-key",
                    models: [{ id: "gpt-4o", name: "GPT-4o", family: "gpt-4o" }],
                },
                {
                    name: "zhipu",
                    apiKey: "zhipu-key",
                    models: [{ id: "glm-4.5", name: "GLM-4.5", family: "glm" }],
                },
            ],
        });

        expect(
            builder.sessionMetadataOverrides({
                metadata: {
                    model: "zhipu/glm-4.5",
                    followDefaultModel: true,
                },
            }).model,
        ).toBeUndefined();

        expect(
            builder.sessionMetadataOverrides({
                metadata: {
                    model: "zhipu/glm-4.5",
                    followDefaultModel: false,
                },
            }).model,
        ).toBe("zhipu/glm-4.5");
    });

    it("writes normalized limits for configured models", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "openai/gpt-5.5",
            providers: [
                {
                    name: "openai",
                    apiKey: "openai-key",
                    models: [
                        {
                            id: "gpt-5.5",
                            name: "GPT-5.5",
                            family: "openai",
                            limit: { context: 128000, output: 4096 },
                        },
                        {
                            id: "custom-frontier",
                            name: "Custom Frontier",
                            family: "custom",
                        },
                    ],
                },
            ],
        });

        const hcl = builder.buildAgentConfig({});

        expect(hcl).toMatch(
            /models "gpt-5\.5" \{[\s\S]*limit = \{\n      output = 128000\n      context = 258000\n    \}/,
        );
        expect(hcl).toMatch(
            /models "custom-frontier" \{[\s\S]*limit = \{\n      output = 65536\n      context = 128000\n    \}/,
        );
        expect(builder.resolveModelContextLimit({})).toBe(258000);
    });

    it("uses the selected model effective context limit instead of the default model limit", () => {
        const builder = new KernelRuntimeConfigBuilder({
            defaultModel: "boyue/gpt-5",
            providers: [
                {
                    name: "boyue",
                    apiKey: "boyue-key",
                    models: [{ id: "gpt-5", name: "GPT-5", family: "openai", limit: { context: 200000 } }],
                },
                {
                    name: "custom",
                    apiKey: "custom-key",
                    models: [
                        {
                            id: "long-context",
                            name: "Long Context",
                            family: "custom",
                            limit: { context: 320000 },
                        },
                    ],
                },
            ],
        });

        expect(builder.resolveModelContextLimit({})).toBe(258000);
        expect(builder.resolveModelContextLimit({ model: "custom/long-context" })).toBe(320000);
    });

    it("writes normalized limits for env-only synthetic models", () => {
        process.env.OPENAI_API_KEY = "env-openai-key";
        const builder = new KernelRuntimeConfigBuilder(null);

        const hcl = builder.buildAgentConfig({ model: "openai/gpt-5.5" });

        expect(hcl).toMatch(
            /models "gpt-5\.5" \{[\s\S]*limit = \{\n      output = 128000\n      context = 258000\n    \}/,
        );
    });

    it("guards generated datasets from being streamed through large inline write arguments", () => {
        const builder = new KernelRuntimeConfigBuilder(null);

        const extra = builder.composeExtraSlot({});

        expect(extra).toContain("generated datasets");
        expect(extra).toContain("100 KB");
        expect(extra).toContain("do not stream the final artifact through one large inline write argument");
        expect(extra).toContain("Ordinary hand-authored source files");
        expect(extra).toContain("A single huge write is not a batch edit");
    });

    it("grounds personal and product answers through the virtual OKF knowledge module", () => {
        const builder = new KernelRuntimeConfigBuilder(null);

        const extra = builder.composeExtraSlot({ allowCapabilities: true });

        expect(extra).toContain("mounted, authorized personal knowledge base");
        expect(extra).toContain("System-provided personal knowledge-base grounding");
        expect(extra).toContain("do not call `mcp__internshannon__knowledge_search`");
        expect(extra).toContain("scope `personal`");
        expect(extra).toContain("scope `docs`");
        expect(extra).toContain("mcp__internshannon__capabilities");
        expect(extra).toContain("mcp__internshannon__knowledge_search");
        expect(extra).toContain("mcp__internshannon__knowledge_read");
        expect(extra).toContain("mcp__internshannon__knowledge_query");
        expect(extra).toContain("deterministically plans");
        expect(extra).toContain("complete fail-closed parse with a revision pin");
        expect(extra).toContain("follows signed structured cursors within the bounded evidence budget");
        expect(extra).toContain("complete only after cursor exhaustion");
        expect(extra).toContain("duplicate row");
        expect(extra).toContain("do not guess a table, column, filter value, join, omitted row, or cursor");
        expect(extra).toContain("evidence as the fallback");
        expect(extra).toContain("do not ask the user for access");
        expect(extra).toContain("never fabricate knowledge content");
    });
});

function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}
