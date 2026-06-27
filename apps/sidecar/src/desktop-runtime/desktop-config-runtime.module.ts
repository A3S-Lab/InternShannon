import { Module } from '@nestjs/common';
import { AclConfigService } from '@/infrastructure/desktop/acl-config/acl-config.service';
import { AppConfigModule } from '@/infrastructure/desktop/app-config/app-config.module';
import { ConfigServiceImpl } from '@/modules/config/application/config.service';
import { ProviderModelListService } from '@/modules/config/application/provider-model-list.service';
import { CONFIG_REPOSITORY } from '@/modules/config/domain/repositories/config-repository.interface';
import { CONFIG_SERVICE } from '@/modules/config/domain/services/config-service.interface';
import { DESKTOP_MODEL_CONFIG_SYNC } from '@/modules/config/domain/services/desktop-model-config-sync.interface';
import { DesktopModelConfigSyncService } from '@/modules/config/infrastructure/desktop/desktop-model-config-sync.service';
import { FileConfigRepository } from '@/modules/config/infrastructure/persistence/file-config.repository';
import { ConfigController } from '@/modules/config/presentation/config.controller';
import { ConfigEntryController } from '@/modules/config/presentation/config-entry.controller';
import { ConfigPublicController } from '@/modules/config/presentation/config-public.controller';
import { PluginsController } from '@/modules/config/presentation/plugins.controller';
import { ConfigSettingsValidationService } from '@/modules/config/presentation/validators/config-settings-validation.service';
import { DesktopConfigCategoryController } from './desktop-config-category.controller';

@Module({
    imports: [AppConfigModule],
    controllers: [
        ConfigController,
        DesktopConfigCategoryController,
        ConfigEntryController,
        ConfigPublicController,
        PluginsController,
    ],
    providers: [
        {
            provide: CONFIG_REPOSITORY,
            useClass: FileConfigRepository,
        },
        {
            provide: CONFIG_SERVICE,
            useClass: ConfigServiceImpl,
        },
        ConfigServiceImpl,
        ProviderModelListService,
        DesktopModelConfigSyncService,
        AclConfigService,
        {
            provide: DESKTOP_MODEL_CONFIG_SYNC,
            useExisting: DesktopModelConfigSyncService,
        },
        ConfigSettingsValidationService,
    ],
    exports: [ConfigServiceImpl, CONFIG_REPOSITORY, CONFIG_SERVICE, DESKTOP_MODEL_CONFIG_SYNC, AclConfigService],
})
export class DesktopConfigRuntimeModule {}
