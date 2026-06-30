import type { IKernelRuntimeConfigService, KernelRuntimeModelsConfig } from '../domain/services/kernel-runtime-config.service.interface';
import { KernelSessionRuntimeStateService } from './kernel-session-runtime-state.service';
import type { ActiveSession } from './session-runtime.types';

describe('KernelSessionRuntimeStateService', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('reuses the fetched models config inside the TTL window', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1_000);
        const runtimeConfigService = runtimeConfigServiceMock([
            modelConfig('boyue/gpt-5', 'boyue', 'gpt-5', 'boyue-key'),
            modelConfig('zhipu/glm-5.2', 'zhipu', 'glm-5.2', 'zhipu-key'),
        ]);
        const service = new KernelSessionRuntimeStateService(runtimeConfigService);

        await service.refreshModelsConfig();
        await service.refreshModelsConfig();

        expect(runtimeConfigService.getModelsConfig).toHaveBeenCalledTimes(1);
        expect(service.runtimeConfigBuilder().resolveDefaultModel({})).toBe('boyue/gpt-5');
    });

    it('refetches models config after invalidation even inside the TTL window', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1_000);
        const runtimeConfigService = runtimeConfigServiceMock([
            modelConfig('boyue/gpt-5', 'boyue', 'gpt-5', 'boyue-key'),
            modelConfig('zhipu/glm-5.2', 'zhipu', 'glm-5.2', 'zhipu-key'),
        ]);
        const service = new KernelSessionRuntimeStateService(runtimeConfigService);

        await service.refreshModelsConfig();
        service.invalidateModelsConfig('test');
        await service.refreshModelsConfig();

        expect(runtimeConfigService.getModelsConfig).toHaveBeenCalledTimes(2);
        expect(service.runtimeConfigBuilder().resolveDefaultModel({})).toBe('zhipu/glm-5.2');
    });

    it('does not remove active sessions when invalidating models config', () => {
        const service = new KernelSessionRuntimeStateService(runtimeConfigServiceMock([]));
        const activeSession = makeActiveSession();

        service.setActiveSession('session-1', activeSession);
        service.invalidateModelsConfig('test');

        expect(service.getActiveSession('session-1')).toBe(activeSession);
        expect(service.activeSessionIds()).toEqual(['session-1']);
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
        session: { close: jest.fn() } as unknown as ActiveSession['session'],
        workspace: '/workspace',
        agentId: 'default',
        userId: 'desktop-user',
        runtimeKey: 'runtime-key',
        runtimeOverrides: {},
        nativeConfirmationEnabled: false,
        nativeConfirmedToolKeys: new Set(),
        createdAt: 1_000,
        lastActivityAt: 1_000,
    };
}
