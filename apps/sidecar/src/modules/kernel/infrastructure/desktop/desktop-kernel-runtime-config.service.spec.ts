import type { ConfigService } from "@/modules/config/domain/services/config-service.interface";
import { type AppSettings, DEFAULT_SETTINGS } from "@/modules/config/domain/services/settings-schema";
import { DEFAULT_LLM_API_TIMEOUT_MS } from "../../application/session-runtime.types";
import {
    DESKTOP_DEFAULT_MAX_STREAM_RETRIES,
    DESKTOP_DEFAULT_STREAM_STALL_HARD_MS,
    DESKTOP_DEFAULT_TOOL_INPUT_STREAM_STALL_HARD_MS,
    DesktopKernelRuntimeConfigService,
} from "./desktop-kernel-runtime-config.service";

function createConfigService(llm: AppSettings["llm"]): jest.Mocked<ConfigService> {
    return {
        getSettings: jest.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, llm }),
    } as unknown as jest.Mocked<ConfigService>;
}

describe("DesktopKernelRuntimeConfigService", () => {
    it("keeps empty desktop LLM settings unselected instead of injecting openai/gpt-4", async () => {
        const configService = createConfigService({
            defaultModel: "",
            providers: [],
            mcpServers: [],
        });
        const service = new DesktopKernelRuntimeConfigService(configService);

        const runtimeConfig = await service.getModelsConfig();

        expect(runtimeConfig?.defaultModel).toBe("");
        expect(runtimeConfig?.providers).toEqual([]);
    });

    it("normalizes legacy model limits before exposing runtime config", async () => {
        const configService = createConfigService({
            defaultModel: "openai/gpt-5.5",
            providers: [
                {
                    name: "openai",
                    apiKey: "openai-key",
                    baseUrl: "https://api.openai.com/v1",
                    headers: {},
                    models: [
                        {
                            id: "gpt-5.5",
                            name: "GPT-5.5",
                            family: "openai",
                            attachment: false,
                            reasoning: false,
                            toolCall: true,
                            temperature: true,
                            limit: { context: 128000, output: 4096 },
                        },
                    ],
                },
            ],
            mcpServers: [],
        });
        const service = new DesktopKernelRuntimeConfigService(configService);

        const runtimeConfig = await service.getModelsConfig();

        expect(runtimeConfig?.providers?.[0]?.models?.[0]?.limit).toEqual({ context: 258000, output: 128000 });
    });

    it("uses a shorter desktop default for tool input streaming stalls than active tool execution", async () => {
        const configService = createConfigService({
            defaultModel: "openai/gpt-4o",
            providers: [],
            mcpServers: [],
        });
        const service = new DesktopKernelRuntimeConfigService(configService);

        const runtimeConfig = await service.getModelsConfig();

        expect(runtimeConfig?.toolInputStreamStallHardMs).toBe(DESKTOP_DEFAULT_TOOL_INPUT_STREAM_STALL_HARD_MS);
        expect(runtimeConfig?.toolInputStreamStallHardMs).toBeLessThan(
            runtimeConfig?.streamStallActiveToolHardMs ?? Number.POSITIVE_INFINITY,
        );
    });

    it("keeps two desktop retries for blank model streams", async () => {
        const configService = createConfigService({
            defaultModel: "openai/gpt-4o",
            providers: [],
            mcpServers: [],
        });
        const service = new DesktopKernelRuntimeConfigService(configService);

        const runtimeConfig = await service.getModelsConfig();

        expect(DESKTOP_DEFAULT_MAX_STREAM_RETRIES).toBe(2);
        expect(runtimeConfig?.maxStreamRetries).toBe(DESKTOP_DEFAULT_MAX_STREAM_RETRIES);
    });

    it("keeps the outer model watchdog above the SDK request timeout and below the active-tool window", async () => {
        const configService = createConfigService({
            defaultModel: "openai/gpt-4o",
            providers: [],
            mcpServers: [],
        });
        const service = new DesktopKernelRuntimeConfigService(configService);

        const runtimeConfig = await service.getModelsConfig();

        expect(DESKTOP_DEFAULT_STREAM_STALL_HARD_MS).toBe(150_000);
        expect(runtimeConfig?.streamStallHardMs).toBe(DESKTOP_DEFAULT_STREAM_STALL_HARD_MS);
        expect(runtimeConfig?.streamStallHardMs).toBeGreaterThan(DEFAULT_LLM_API_TIMEOUT_MS);
        expect(runtimeConfig?.streamStallHardMs).toBeLessThan(
            runtimeConfig?.streamStallActiveToolHardMs ?? Number.POSITIVE_INFINITY,
        );
    });
});
