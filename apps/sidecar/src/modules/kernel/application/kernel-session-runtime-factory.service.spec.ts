import type { Session, SessionOptions } from "@a3s-lab/code";
import { promises as fs } from "fs";
import type { IKernelService } from "../domain/services/kernel-service.interface";
import type { AgentRegistry } from "./agents/agent-registry";
import { KernelSessionRuntimeFactory } from "./kernel-session-runtime-factory.service";
import type { KernelSessionRuntimeStateService } from "./kernel-session-runtime-state.service";
import {
    type ActiveSession,
    DEFAULT_AUTO_COMPACT_THRESHOLD,
    DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
    DEFAULT_LLM_API_TIMEOUT_MS,
    DEFAULT_MAX_TOOL_ROUNDS,
    type SessionRuntimeOverrides,
} from "./session-runtime.types";

describe("KernelSessionRuntimeFactory runtime workspace resolution", () => {
    let mkdirSpy: jest.SpiedFunction<typeof fs.mkdir>;

    beforeEach(() => {
        mkdirSpy = jest.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    });

    afterEach(() => {
        mkdirSpy.mockRestore();
    });

    it("accepts Windows drive-letter runtime workspaces", async () => {
        const factory = createRuntimeWorkspaceFactory();
        const workspace = "D:/AI/Project/agents/users/local/sessions/default-20260703-184231270";

        await expect(factory.resolveRuntimeWorkspace("session-windows", workspace)).resolves.toBe(workspace);
        expect(mkdirSpy).toHaveBeenCalledWith(workspace, { recursive: true });
    });

    it("rejects remote runtime workspaces", async () => {
        const factory = createRuntimeWorkspaceFactory();

        await expect(factory.resolveRuntimeWorkspace("session-remote", "s3://bucket/workspace")).rejects.toThrow(
            "Desktop runtime workspace must be a local path",
        );
        expect(mkdirSpy).not.toHaveBeenCalled();
    });
});

describe("KernelSessionRuntimeFactory HITL session options", () => {
    it("recreates a runtime for a model switch owned by the current operation", async () => {
        const existing = makeExistingActiveSession({ model: "boyue/gpt-5" });
        const harness = createHarness({
            existingSession: existing,
            activeOperation: { operationId: "operation-1", phase: "preparing", startedAt: 1_000 },
        });

        await harness.factory.getOrCreateSession({
            sessionId: "session-model-switch",
            overrides: { model: "zhipu/glm-5.2" },
            operationId: "operation-1",
            emit: jest.fn(),
        });

        expect(existing.session.close).toHaveBeenCalledTimes(1);
        expect(harness.runtimeState.deleteActiveSession).toHaveBeenCalledWith("session-model-switch", {
            preserveOperation: true,
            preserveRuntimeOverrides: true,
        });
        expect(harness.runtimeState.setActiveSession).toHaveBeenCalled();
    });

    it("rebuilds a closed runtime with the same runtime key and model", async () => {
        const fixedModel = "fixed-provider/fixed-model";
        const existing = makeExistingActiveSession({ model: fixedModel }, true);
        const harness = createHarness({
            existingSession: existing,
            activeOperation: { operationId: "operation-1", phase: "preparing", startedAt: 1_000 },
        });

        const replacement = await harness.factory.getOrCreateSession({
            sessionId: "session-closed-runtime",
            overrides: { model: fixedModel },
            operationId: "operation-1",
            emit: jest.fn(),
        });

        expect(existing.session.close).not.toHaveBeenCalled();
        expect(harness.runtimeState.deleteActiveSession).toHaveBeenCalledWith("session-closed-runtime", {
            preserveOperation: true,
            preserveRuntimeOverrides: true,
        });
        expect(harness.runtimeState.recordCloseMetric).toHaveBeenCalledWith("closed_runtime_recovery");
        expect(replacement?.runtimeOverrides.model).toBe(fixedModel);
        expect(replacement?.resolvedModel).toBe(fixedModel);
        expect(harness.capturedOptions?.model).toBe(fixedModel);
        expect(harness.runtimeState.setActiveSession).toHaveBeenCalled();
    });

    it("refuses a model-driven runtime replacement owned by another operation", async () => {
        const existing = makeExistingActiveSession({ model: "boyue/gpt-5" });
        const harness = createHarness({
            existingSession: existing,
            activeOperation: { operationId: "operation-1", phase: "running", startedAt: 1_000 },
        });

        await expect(
            harness.factory.getOrCreateSession({
                sessionId: "session-model-switch",
                overrides: { model: "zhipu/glm-5.2" },
                operationId: "operation-2",
                emit: jest.fn(),
            }),
        ).rejects.toThrow("another operation is active");
        expect(existing.session.close).not.toHaveBeenCalled();
    });

    it("passes the query-lane confirmation policy to the SDK in default mode", async () => {
        const harness = createHarness();

        await harness.factory.getOrCreateSession({
            sessionId: "session-default",
            emit: jest.fn(),
        });

        expect(harness.capturedOptions?.confirmationPolicy).toEqual({
            enabled: true,
            defaultTimeoutMs: 60_000,
            timeoutAction: "reject",
            yoloLanes: ["query"],
        });
        expect(harness.capturedOptions?.permissionPolicy).toEqual(
            expect.objectContaining({
                defaultDecision: "ask",
            }),
        );
        expect(harness.activeSession?.nativeConfirmationEnabled).toBe(true);
    });

    it.each(["auto", "plan"] as const)("does not enable SDK HITL confirmation in %s mode", async (permissionMode) => {
        const harness = createHarness();

        await harness.factory.getOrCreateSession({
            sessionId: `session-${permissionMode}`,
            overrides: { permissionMode },
            emit: jest.fn(),
        });

        expect(harness.capturedOptions?.confirmationPolicy).toBeUndefined();
        expect(harness.capturedOptions?.permissionPolicy).toEqual({ defaultDecision: "allow" });
        expect(harness.activeSession?.nativeConfirmationEnabled).toBe(false);
    });

    it("uses the coding-friendly tool round default while preserving explicit overrides", async () => {
        const defaultHarness = createHarness();

        await defaultHarness.factory.getOrCreateSession({
            sessionId: "session-default-rounds",
            emit: jest.fn(),
        });

        expect(defaultHarness.capturedOptions?.maxToolRounds).toBe(DEFAULT_MAX_TOOL_ROUNDS);

        const overrideHarness = createHarness();

        await overrideHarness.factory.getOrCreateSession({
            sessionId: "session-custom-rounds",
            overrides: { maxToolRounds: 24 },
            emit: jest.fn(),
        });

        expect(overrideHarness.capturedOptions?.maxToolRounds).toBe(24);
    });

    it("fails fast on a terminal provider error while preserving an explicit retry threshold", async () => {
        const defaultHarness = createHarness();

        await defaultHarness.factory.getOrCreateSession({
            sessionId: "session-default-circuit-breaker",
            emit: jest.fn(),
        });

        expect(defaultHarness.capturedOptions?.circuitBreakerThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_THRESHOLD);
        expect(DEFAULT_CIRCUIT_BREAKER_THRESHOLD).toBe(1);

        const overrideHarness = createHarness();

        await overrideHarness.factory.getOrCreateSession({
            sessionId: "session-custom-circuit-breaker",
            overrides: { circuitBreakerThreshold: 3 },
            emit: jest.fn(),
        });

        expect(overrideHarness.capturedOptions?.circuitBreakerThreshold).toBe(3);
    });

    it("enables the SDK compactor with safe defaults", async () => {
        const harness = createHarness();

        await harness.factory.getOrCreateSession({
            sessionId: "session-compact-defaults",
            emit: jest.fn(),
        });

        expect(harness.capturedOptions?.autoCompact).toBe(true);
        expect(harness.capturedOptions?.autoCompactThreshold).toBe(DEFAULT_AUTO_COMPACT_THRESHOLD);
        expect(harness.capturedOptions?.maxContextTokens).toBe(258000);
        expect(harness.capturedOptions?.llmApiTimeoutMs).toBe(DEFAULT_LLM_API_TIMEOUT_MS);
        expect(harness.activeSession?.maxContextTokens).toBe(258000);
    });

    it("preserves an explicit opt-out and a valid compact threshold", async () => {
        const harness = createHarness();

        await harness.factory.getOrCreateSession({
            sessionId: "session-compact-overrides",
            overrides: { autoCompact: false, autoCompactThreshold: 0.6 },
            emit: jest.fn(),
        });

        expect(harness.capturedOptions?.autoCompact).toBe(false);
        expect(harness.capturedOptions?.autoCompactThreshold).toBe(0.6);
    });

    it.each([
        0,
        1,
        -0.1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
    ])("normalizes unsafe compact threshold %s to the default", async (threshold) => {
        const harness = createHarness();

        await harness.factory.getOrCreateSession({
            sessionId: `session-compact-threshold-${String(threshold)}`,
            overrides: { autoCompactThreshold: threshold },
            emit: jest.fn(),
        });

        expect(harness.capturedOptions?.autoCompactThreshold).toBe(DEFAULT_AUTO_COMPACT_THRESHOLD);
    });
});

describe("KernelSessionRuntimeFactory capabilities MCP registration", () => {
    it("registers the internal capabilities server for opted-in assistants", async () => {
        const factory = createRuntimeWorkspaceFactory();
        const server = (
            factory as unknown as {
                capabilitiesMcpServer: () => { name: string; transport: { type: string; url: string } };
            }
        ).capabilitiesMcpServer();

        expect(server).toEqual({
            name: "internshannon",
            enabled: true,
            transport: {
                type: "streamable-http",
                url: `http://127.0.0.1:${process.env.APP_PORT || "29653"}/api/v1/kernel/mcp`,
            },
        });
        expect(
            (
                factory as unknown as { shouldEnableCapabilities: (value: SessionRuntimeOverrides) => boolean }
            ).shouldEnableCapabilities({ allowCapabilities: true }),
        ).toBe(true);
        expect(
            (
                factory as unknown as { shouldEnableCapabilities: (value: SessionRuntimeOverrides) => boolean }
            ).shouldEnableCapabilities({ skills: ["capabilities"] }),
        ).toBe(true);
    });
});

function createRuntimeWorkspaceFactory(): KernelSessionRuntimeFactory {
    return new KernelSessionRuntimeFactory(
        {} as IKernelService,
        {} as KernelSessionRuntimeStateService,
        {} as AgentRegistry,
    );
}

function createHarness(
    options: {
        existingSession?: ActiveSession;
        activeOperation?: {
            operationId: string;
            phase: "preparing" | "running";
            startedAt: number;
        };
    } = {},
): {
    factory: KernelSessionRuntimeFactory;
    capturedOptions?: SessionOptions;
    activeSession?: { nativeConfirmationEnabled: boolean; maxContextTokens?: number };
    runtimeState: jest.Mocked<KernelSessionRuntimeStateService>;
} {
    let runtimeOverrides: SessionRuntimeOverrides | undefined;
    let capturedOptions: SessionOptions | undefined;
    let activeSession: { nativeConfirmationEnabled: boolean; maxContextTokens?: number } | undefined;

    const runtimeConfig = {
        assistantDefaultOverrides: jest.fn().mockReturnValue({}),
        buildAgentConfig: jest.fn().mockReturnValue("agent-config"),
        composeExtraSlot: jest.fn().mockReturnValue(undefined),
        mergeRuntimeOverrides: jest.fn((...items: Array<SessionRuntimeOverrides | undefined>) =>
            Object.assign({}, ...items.filter(Boolean)),
        ),
        resolvedModelApiKeyMissing: jest.fn().mockReturnValue(false),
        resolveDefaultModel: jest.fn((overrides: SessionRuntimeOverrides) => overrides.model ?? "provider/model"),
        resolveModelContextLimit: jest.fn().mockReturnValue(258000),
        resolveRuntimeModel: jest.fn((overrides: SessionRuntimeOverrides) => overrides.model ?? "provider/model"),
        runtimeKey: jest.fn((overrides: SessionRuntimeOverrides) => JSON.stringify(overrides)),
        sessionMetadataOverrides: jest.fn().mockReturnValue({}),
        systemRuntimeDefaults: jest.fn().mockReturnValue({}),
    };

    const kernelService = {
        awaitWorkspaceReady: jest.fn().mockResolvedValue(undefined),
        getSession: jest.fn().mockResolvedValue({
            sessionId: "session-default",
            agentId: "default",
            cwd: "/tmp/internshannon-runtime-factory-test",
            userId: "user-a",
            metadata: {},
        }),
    } as unknown as IKernelService;

    const runtimeState = {
        activeOperation: jest.fn().mockReturnValue(options.activeOperation ?? null),
        deleteActiveSession: jest.fn(),
        getActiveSession: jest.fn().mockReturnValue(options.existingSession),
        patchRuntimeOverrides: jest.fn((_sessionId: string, patch?: SessionRuntimeOverrides) => {
            runtimeOverrides = patch;
        }),
        recordCloseMetric: jest.fn(),
        refreshModelsConfig: jest.fn().mockResolvedValue(undefined),
        runtimeConfigBuilder: jest.fn().mockReturnValue(runtimeConfig),
        runtimeOverrides: jest.fn().mockImplementation(() => runtimeOverrides ?? {}),
        setActiveSession: jest.fn(
            (_sessionId: string, session: { nativeConfirmationEnabled: boolean; maxContextTokens?: number }) => {
                activeSession = session;
            },
        ),
        touchActivity: jest.fn(),
    } as unknown as KernelSessionRuntimeStateService;

    const agentRegistry = {
        resolve: jest.fn().mockReturnValue({ id: "default" }),
        resolveMcpServers: jest.fn().mockReturnValue([]),
        resolveOverrides: jest.fn((_agentId: string, overrides: SessionRuntimeOverrides) => overrides),
    } as unknown as AgentRegistry;

    const factory = new KernelSessionRuntimeFactory(kernelService, runtimeState, agentRegistry);
    jest.spyOn(factory, "resolveRuntimeWorkspace").mockResolvedValue("/tmp/internshannon-runtime-factory-test");
    jest.spyOn(factory as unknown as { createAgent: () => Promise<unknown> }, "createAgent").mockResolvedValue({});
    jest.spyOn(
        factory as unknown as {
            createOrResumeSdkSession: (
                agent: unknown,
                workspace: string,
                sessionId: string,
                sessionOptions: SessionOptions,
            ) => Session;
        },
        "createOrResumeSdkSession",
    ).mockImplementation((_agent, _workspace, _sessionId, sessionOptions) => {
        capturedOptions = sessionOptions;
        return {
            close: jest.fn(),
            registerHook: jest.fn(),
            registerWorkerAgents: jest.fn(),
            addMcpServer: jest.fn(),
        } as unknown as Session;
    });
    jest.spyOn(
        factory as unknown as { applyMcpServers: () => Promise<unknown[]> },
        "applyMcpServers",
    ).mockResolvedValue([]);
    jest.spyOn(factory as unknown as { registerWorkers: () => void }, "registerWorkers").mockImplementation(() => {});

    return {
        factory,
        get capturedOptions() {
            return capturedOptions;
        },
        get activeSession() {
            return activeSession;
        },
        runtimeState: runtimeState as unknown as jest.Mocked<KernelSessionRuntimeStateService>,
    };
}

function makeExistingActiveSession(overrides: SessionRuntimeOverrides, closed = false): ActiveSession {
    return {
        session: { close: jest.fn(), isClosed: jest.fn().mockReturnValue(closed) } as unknown as Session,
        workspace: "/tmp/internshannon-runtime-factory-test",
        agentId: "default",
        userId: "user-a",
        runtimeKey: JSON.stringify(overrides),
        runtimeOverrides: overrides,
        nativeConfirmationEnabled: false,
        nativeConfirmedToolKeys: new Set(),
        createdAt: 1_000,
        lastActivityAt: 1_000,
    };
}
