import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { APP_CONFIG_SERVICE } from '@/modules/config/infrastructure/desktop/app-config/app-config.module';
import type { AppConfigService } from '@/modules/config/infrastructure/desktop/app-config/app-config.service';
import type {
    DesktopModelConfigInvalidator,
    IDesktopModelConfigSync,
} from '../../domain/services/desktop-model-config-sync.interface';
import type { AppSettings } from '../../domain/services/settings-schema';

@Injectable()
export class DesktopModelConfigSyncService implements IDesktopModelConfigSync {
    private readonly logger = new Logger(DesktopModelConfigSyncService.name);
    private static readonly invalidators = new Set<DesktopModelConfigInvalidator>();

    constructor(
        @Optional()
        @Inject(APP_CONFIG_SERVICE)
        private readonly appConfigService?: AppConfigService,
    ) {}

    registerInvalidator(callback: DesktopModelConfigInvalidator): void {
        DesktopModelConfigSyncService.invalidators.add(callback);
        this.logger.log(
            `Registered desktop model config invalidator (count=${DesktopModelConfigSyncService.invalidators.size})`,
        );
    }

    async sync(settings: AppSettings): Promise<void> {
        if (this.appConfigService) {
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
            });
        }
        await this.notifyInvalidators('llm-settings-sync');
    }

    private async notifyInvalidators(reason: string): Promise<void> {
        this.logger.log(
            `Notifying desktop model config invalidators (reason=${reason}, count=${DesktopModelConfigSyncService.invalidators.size})`,
        );
        for (const invalidator of DesktopModelConfigSyncService.invalidators) {
            try {
                await invalidator(reason);
            } catch (error) {
                this.logger.warn(
                    `Desktop model config invalidator failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
    }

    /** @internal test-only hook to keep the shared invalidator registry isolated. */
    static clearInvalidatorsForTest(): void {
        DesktopModelConfigSyncService.invalidators.clear();
    }
}
