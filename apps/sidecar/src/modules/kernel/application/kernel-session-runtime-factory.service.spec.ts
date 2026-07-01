import type { Session, SessionOptions } from '@a3s-lab/code';
import { KernelSessionRuntimeFactory } from './kernel-session-runtime-factory.service';
import type { AgentRegistry } from './agents/agent-registry';
import type { KernelSessionRuntimeStateService } from './kernel-session-runtime-state.service';
import type { IKernelService } from '../domain/services/kernel-service.interface';
import type { SessionRuntimeOverrides } from './session-runtime.types';

describe('KernelSessionRuntimeFactory HITL session options', () => {
    it('passes the query-lane confirmation policy to the SDK in default mode', async () => {
        const harness = createHarness();

        await harness.factory.getOrCreateSession({
            sessionId: 'session-default',
            emit: jest.fn(),
        });

        expect(harness.capturedOptions?.confirmationPolicy).toEqual({
            enabled: true,
            defaultTimeoutMs: 60_000,
            timeoutAction: 'reject',
            yoloLanes: ['query'],
        });
        expect(harness.capturedOptions?.permissionPolicy).toEqual(
            expect.objectContaining({
                defaultDecision: 'ask',
            }),
        );
        expect(harness.activeSession?.nativeConfirmationEnabled).toBe(true);
    });

    it.each(['auto', 'plan'] as const)('does not enable SDK HITL confirmation in %s mode', async permissionMode => {
        const harness = createHarness();

        await harness.factory.getOrCreateSession({
            sessionId: `session-${permissionMode}`,
            overrides: { permissionMode },
            emit: jest.fn(),
        });

        expect(harness.capturedOptions?.confirmationPolicy).toBeUndefined();
        expect(harness.capturedOptions?.permissionPolicy).toEqual({ defaultDecision: 'allow' });
        expect(harness.activeSession?.nativeConfirmationEnabled).toBe(false);
    });
});

function createHarness(): {
    factory: KernelSessionRuntimeFactory;
    capturedOptions?: SessionOptions;
    activeSession?: { nativeConfirmationEnabled: boolean };
} {
    let runtimeOverrides: SessionRuntimeOverrides | undefined;
    let capturedOptions: SessionOptions | undefined;
    let activeSession: { nativeConfirmationEnabled: boolean } | undefined;

    const runtimeConfig = {
        assistantDefaultOverrides: jest.fn().mockReturnValue({}),
        buildAgentConfig: jest.fn().mockReturnValue('agent-config'),
        composeExtraSlot: jest.fn().mockReturnValue(undefined),
        mergeRuntimeOverrides: jest.fn((...items: Array<SessionRuntimeOverrides | undefined>) =>
            Object.assign({}, ...items.filter(Boolean)),
        ),
        resolvedModelApiKeyMissing: jest.fn().mockReturnValue(false),
        resolveDefaultModel: jest.fn().mockReturnValue('provider/model'),
        runtimeKey: jest.fn((overrides: SessionRuntimeOverrides) => JSON.stringify(overrides)),
        sessionMetadataOverrides: jest.fn().mockReturnValue({}),
        systemRuntimeDefaults: jest.fn().mockReturnValue({}),
    };

    const kernelService = {
        awaitWorkspaceReady: jest.fn().mockResolvedValue(undefined),
        getSession: jest.fn().mockResolvedValue({
            sessionId: 'session-default',
            agentId: 'default',
            cwd: '/tmp/internshannon-runtime-factory-test',
            userId: 'user-a',
            metadata: {},
        }),
    } as unknown as IKernelService;

    const runtimeState = {
        deleteActiveSession: jest.fn(),
        getActiveSession: jest.fn().mockReturnValue(undefined),
        patchRuntimeOverrides: jest.fn((_sessionId: string, patch?: SessionRuntimeOverrides) => {
            runtimeOverrides = patch;
        }),
        recordCloseMetric: jest.fn(),
        refreshModelsConfig: jest.fn().mockResolvedValue(undefined),
        runtimeConfigBuilder: jest.fn().mockReturnValue(runtimeConfig),
        runtimeOverrides: jest.fn().mockImplementation(() => runtimeOverrides ?? {}),
        setActiveSession: jest.fn((_sessionId: string, session: { nativeConfirmationEnabled: boolean }) => {
            activeSession = session;
        }),
        touchActivity: jest.fn(),
    } as unknown as KernelSessionRuntimeStateService;

    const agentRegistry = {
        resolve: jest.fn().mockReturnValue({ id: 'default' }),
        resolveMcpServers: jest.fn().mockReturnValue([]),
        resolveOverrides: jest.fn((_agentId: string, overrides: SessionRuntimeOverrides) => overrides),
    } as unknown as AgentRegistry;

    const factory = new KernelSessionRuntimeFactory(kernelService, runtimeState, agentRegistry);
    jest.spyOn(factory, 'resolveRuntimeWorkspace').mockResolvedValue('/tmp/internshannon-runtime-factory-test');
    jest.spyOn(factory as unknown as { createAgent: () => Promise<unknown> }, 'createAgent').mockResolvedValue({});
    jest.spyOn(
        factory as unknown as {
            createOrResumeSdkSession: (
                agent: unknown,
                workspace: string,
                sessionId: string,
                sessionOptions: SessionOptions,
            ) => Session;
        },
        'createOrResumeSdkSession',
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
        'applyMcpServers',
    ).mockResolvedValue([]);
    jest.spyOn(factory as unknown as { registerWorkers: () => void }, 'registerWorkers').mockImplementation(() => {});

    return {
        factory,
        get capturedOptions() {
            return capturedOptions;
        },
        get activeSession() {
            return activeSession;
        },
    };
}
