import type { Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ConfigServiceImpl } from '@/modules/config/application/config.service';
import { CONFIG_REPOSITORY } from '@/modules/config/domain/repositories/config-repository.interface';
import { CONFIG_SERVICE } from '@/modules/config/domain/services/config-service.interface';
import { DesktopConfigRuntimeModule } from './desktop-config-runtime.module';

describe('DesktopConfigRuntimeModule', () => {
    it('aliases CONFIG_SERVICE to the controller-facing ConfigServiceImpl singleton', async () => {
        const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DesktopConfigRuntimeModule) as Provider[];
        const configServiceProvider = providers.find(
            provider => typeof provider === 'object' && provider !== null && provider.provide === CONFIG_SERVICE,
        );
        expect(configServiceProvider).toBeDefined();
        if (!configServiceProvider) {
            throw new Error('CONFIG_SERVICE provider is not registered');
        }

        const moduleRef = await Test.createTestingModule({
            providers: [
                { provide: CONFIG_REPOSITORY, useValue: {} },
                ConfigServiceImpl,
                configServiceProvider,
            ],
        }).compile();

        expect(moduleRef.get(CONFIG_SERVICE)).toBe(moduleRef.get(ConfigServiceImpl));
        await moduleRef.close();
    });
});
