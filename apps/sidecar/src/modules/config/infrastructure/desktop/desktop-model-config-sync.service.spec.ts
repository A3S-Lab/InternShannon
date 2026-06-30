import type { AppConfigService } from './app-config/app-config.service';
import { DesktopModelConfigSyncService } from './desktop-model-config-sync.service';
import type { AppSettings } from '../../domain/services/settings-schema';

describe('DesktopModelConfigSyncService', () => {
    afterEach(() => {
        DesktopModelConfigSyncService.clearInvalidatorsForTest();
    });

    it('syncs LLM settings into app config', async () => {
        const appConfigService = appConfigServiceMock();
        const service = new DesktopModelConfigSyncService(appConfigService);

        await service.sync(makeSettings());

        expect(appConfigService.updateModelsConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                defaultModel: 'boyue/gpt-5',
                providers: [expect.objectContaining({ name: 'boyue' })],
                mcpServers: [],
            }),
        );
    });

    it('notifies registered invalidators after sync', async () => {
        const appConfigService = appConfigServiceMock();
        const service = new DesktopModelConfigSyncService(appConfigService);
        const invalidator = jest.fn();

        service.registerInvalidator(invalidator);
        await service.sync(makeSettings());

        expect(invalidator).toHaveBeenCalledWith('llm-settings-sync');
    });

    it('notifies all registered invalidators', async () => {
        const service = new DesktopModelConfigSyncService(appConfigServiceMock());
        const first = jest.fn();
        const second = jest.fn();

        service.registerInvalidator(first);
        service.registerInvalidator(second);
        await service.sync(makeSettings());

        expect(first).toHaveBeenCalledWith('llm-settings-sync');
        expect(second).toHaveBeenCalledWith('llm-settings-sync');
    });

    it('shares registered invalidators across service instances', async () => {
        const registrationService = new DesktopModelConfigSyncService(appConfigServiceMock());
        const syncingService = new DesktopModelConfigSyncService(appConfigServiceMock());
        const invalidator = jest.fn();

        registrationService.registerInvalidator(invalidator);
        await syncingService.sync(makeSettings());

        expect(invalidator).toHaveBeenCalledWith('llm-settings-sync');
    });

    it('notifies invalidators even when app config service is unavailable', async () => {
        const service = new DesktopModelConfigSyncService();
        const invalidator = jest.fn();

        service.registerInvalidator(invalidator);
        await expect(service.sync(makeSettings())).resolves.toBeUndefined();

        expect(invalidator).toHaveBeenCalledWith('llm-settings-sync');
    });
});

function appConfigServiceMock(): jest.Mocked<AppConfigService> {
    return {
        updateModelsConfig: jest.fn(),
    } as unknown as jest.Mocked<AppConfigService>;
}

function makeSettings(): AppSettings {
    return {
        llm: {
            defaultModel: 'boyue/gpt-5',
            providers: [
                {
                    name: 'boyue',
                    apiKey: 'boyue-key',
                    baseUrl: 'https://boyue.example/v1',
                    headers: {},
                    models: [
                        {
                            id: 'gpt-5',
                            name: 'gpt-5',
                            attachment: false,
                            reasoning: false,
                            toolCall: true,
                            temperature: true,
                        },
                    ],
                },
            ],
            mcpServers: [],
        },
    } as unknown as AppSettings;
}
