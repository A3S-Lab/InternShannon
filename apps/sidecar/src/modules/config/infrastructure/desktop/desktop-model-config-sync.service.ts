import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_CONFIG_SERVICE } from '@/infrastructure/desktop/app-config/app-config.module';
import { AppConfigService } from '@/infrastructure/desktop/app-config/app-config.service';
import { IDesktopModelConfigSync } from '../../domain/services/desktop-model-config-sync.interface';
import { AppSettings } from '../../domain/services/settings-schema';

@Injectable()
export class DesktopModelConfigSyncService implements IDesktopModelConfigSync {
    constructor(
        @Optional()
        @Inject(APP_CONFIG_SERVICE)
        private readonly appConfigService?: AppConfigService,
    ) {}

    async sync(settings: AppSettings): Promise<void> {
        if (!this.appConfigService) return;

        await this.appConfigService.updateModelsConfig({
            defaultModel: settings.llm.defaultModel,
            providers: settings.llm.providers,
            maxToolRounds: settings.llm.maxToolRounds ?? null,
            thinkingBudget: settings.llm.thinkingBudget ?? null,
            toolTimeoutMs: settings.llm.toolTimeoutMs ?? null,
            queueTimeoutMs: settings.llm.queueTimeoutMs ?? null,
            maxExecutionTimeMs: settings.llm.maxExecutionTimeMs ?? null,
            streamStallWarningMs: settings.llm.streamStallWarningMs ?? null,
            streamStallHardMs: settings.llm.streamStallHardMs ?? null,
            streamStallActiveToolHardMs: settings.llm.streamStallActiveToolHardMs ?? null,
            maxConsecutiveToolErrors: settings.llm.maxConsecutiveToolErrors ?? null,
            maxStreamRetries: settings.llm.maxStreamRetries ?? null,
            mcpServers: settings.llm.mcpServers || [],
            clawSentry: settings.llm.clawSentry ?? null,
        });
    }
}
