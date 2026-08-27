import type {
    IKernelRuntimeConfigService,
    KernelRuntimeModelsConfig,
} from "../domain/services/kernel-runtime-config.service.interface";
import { KernelSessionRuntimeStateService } from "./kernel-session-runtime-state.service";
import type { ActiveSession } from "./session-runtime.types";

describe("KernelSessionRuntimeStateService", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("reuses the fetched models config inside the TTL window", async () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000);
        const runtimeConfigService = runtimeConfigServiceMock([
            modelConfig("boyue/gpt-5", "boyue", "gpt-5", "boyue-key"),
            modelConfig("zhipu/glm-5.2", "zhipu", "glm-5.2", "zhipu-key"),
        ]);
        const service = new KernelSessionRuntimeStateService(runtimeConfigService);

        await service.refreshModelsConfig();
        await service.refreshModelsConfig();

        expect(runtimeConfigService.getModelsConfig).toHaveBeenCalledTimes(1);
        expect(service.runtimeConfigBuilder().resolveDefaultModel({})).toBe("boyue/gpt-5");
    });

    it("refetches models config after invalidation even inside the TTL window", async () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000);
        const runtimeConfigService = runtimeConfigServiceMock([
            modelConfig("boyue/gpt-5", "boyue", "gpt-5", "boyue-key"),
            modelConfig("zhipu/glm-5.2", "zhipu", "glm-5.2", "zhipu-key"),
        ]);
        const service = new KernelSessionRuntimeStateService(runtimeConfigService);

        await service.refreshModelsConfig();
        service.invalidateModelsConfig("test");
        await service.refreshModelsConfig();

        expect(runtimeConfigService.getModelsConfig).toHaveBeenCalledTimes(2);
        expect(service.runtimeConfigBuilder().resolveDefaultModel({})).toBe("zhipu/glm-5.2");
    });

    it("does not remove active sessions when invalidating models config", () => {
        const service = new KernelSessionRuntimeStateService(runtimeConfigServiceMock([]));
        const activeSession = makeActiveSession();

        service.setActiveSession("session-1", activeSession);
        service.invalidateModelsConfig("test");

        expect(service.getActiveSession("session-1")).toBe(activeSession);
        expect(service.activeSessionIds()).toEqual(["session-1"]);
    });

    it("reports both requested and resolved models in runtime summaries", () => {
        const service = new KernelSessionRuntimeStateService(runtimeConfigServiceMock([]));
        const activeSession = makeActiveSession();
        activeSession.runtimeOverrides.model = "zhipu/glm-5.2";
        activeSession.resolvedModel = "zhipu/glm-5.2";
        service.setActiveSession("session-1", activeSession);

        expect(service.activeSessionSummaries(1_500)).toEqual([
            expect.objectContaining({
                sessionId: "session-1",
                requestedModel: "zhipu/glm-5.2",
                resolvedModel: "zhipu/glm-5.2",
            }),
        ]);
    });

    it("keeps one authoritative operation per session and correlates its run id", () => {
        const service = new KernelSessionRuntimeStateService(runtimeConfigServiceMock([]));

        expect(service.tryBeginOperation("session-1", "operation-1", 1_000)).toBe(true);
        expect(service.tryBeginOperation("session-1", "operation-2", 1_001)).toBe(false);
        expect(service.updateOperationPhase("session-1", "operation-1", "compacting")).toBe(true);
        expect(service.associateOperationRunId("session-1", "operation-1", "message-1")).toBe(true);
        expect(service.activeOperation("session-1")).toEqual({
            operationId: "operation-1",
            runId: "message-1",
            phase: "compacting",
            startedAt: 1_000,
        });
        expect(service.finishOperation("session-1", "operation-2")).toBe(false);
        expect(service.isOperationActive("session-1")).toBe(true);
        expect(service.finishOperation("session-1", "operation-1")).toBe(true);
        expect(service.isOperationActive("session-1")).toBe(false);
    });

    it("preserves an owned operation while replacing only its runtime instance", () => {
        const service = new KernelSessionRuntimeStateService(runtimeConfigServiceMock([]));
        const fixedModel = "fixed-provider/fixed-model";
        service.setActiveSession("session-1", makeActiveSession());
        service.tryBeginOperation("session-1", "operation-1");
        service.patchRuntimeOverrides("session-1", { model: fixedModel });

        service.deleteActiveSession("session-1", {
            preserveOperation: true,
            preserveRuntimeOverrides: true,
        });

        expect(service.getActiveSession("session-1")).toBeUndefined();
        expect(service.activeOperation("session-1")?.operationId).toBe("operation-1");
        expect(service.runtimeOverrides("session-1")).toEqual({ model: fixedModel });
    });

    it("never classifies an in-flight runtime as idle", () => {
        const service = new KernelSessionRuntimeStateService(runtimeConfigServiceMock([]));
        const active = makeActiveSession();
        active.lastActivityAt = 1_000;
        service.setActiveSession("session-1", active);
        service.tryBeginOperation("session-1", "operation-1", 1_100);

        expect(service.idleSessionIds(100, 10_000)).toEqual([]);
        expect(service.finishOperation("session-1", "operation-1")).toBe(true);
        expect(service.idleSessionIds(100, 10_000)).toEqual(["session-1"]);
    });

    it("detects runtime-affecting patches without blocking metadata-only updates", () => {
        const service = new KernelSessionRuntimeStateService(runtimeConfigServiceMock([]));
        expect(service.patchAffectsRuntime({ model: "zhipu/glm-5.2" })).toBe(true);
        expect(service.patchAffectsRuntime({ permissionMode: "plan" })).toBe(true);
        expect(service.patchAffectsRuntime({ name: "renamed session" })).toBe(false);
    });
});

function runtimeConfigServiceMock(configs: KernelRuntimeModelsConfig[]): jest.Mocked<IKernelRuntimeConfigService> {
    return {
        getModelsConfig: jest.fn(async () => configs.shift() ?? null),
        getAssistantDefaults: jest.fn(async () => null),
    };
}

function modelConfig(
    defaultModel: string,
    providerName: string,
    modelId: string,
    apiKey: string,
): KernelRuntimeModelsConfig {
    return {
        defaultModel,
        providers: [
            {
                name: providerName,
                apiKey,
                models: [
                    {
                        id: modelId,
                        name: modelId,
                        family: modelId,
                    },
                ],
            },
        ],
    };
}

function makeActiveSession(): ActiveSession {
    return {
        session: { close: jest.fn() } as unknown as ActiveSession["session"],
        workspace: "/workspace",
        agentId: "default",
        userId: "desktop-user",
        runtimeKey: "runtime-key",
        runtimeOverrides: {},
        nativeConfirmationEnabled: false,
        nativeConfirmedToolKeys: new Set(),
        createdAt: 1_000,
        lastActivityAt: 1_000,
    };
}
