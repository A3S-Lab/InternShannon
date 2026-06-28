import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG_SERVICE, ConfigService } from '@/modules/config/domain/services/config-service.interface';
import {
    WECHAT_INTEGRATION_CONFIG_KEY,
    type WechatIntegrationConfig,
    type WechatIntegrationConfigRepository,
} from '../domain';

@Injectable()
export class ConfigServiceWechatConfigRepository implements WechatIntegrationConfigRepository {
    private readonly logger = new Logger(ConfigServiceWechatConfigRepository.name);

    constructor(@Inject(CONFIG_SERVICE) private readonly configService: ConfigService) {}

    async getConfig(): Promise<WechatIntegrationConfig> {
        const entry = await this.configService.getConfigEntry(WECHAT_INTEGRATION_CONFIG_KEY);
        if (!entry?.value) {
            return this.emptyConfig();
        }

        try {
            const parsed = JSON.parse(entry.value) as Partial<WechatIntegrationConfig> & { appId?: string; appSecret?: string };
            return {
                enabled: Boolean(parsed.enabled),
                endpoint: this.normalizeString(parsed.endpoint || parsed.appSecret),
                token: this.normalizeString(parsed.token || parsed.appId),
            };
        } catch (error) {
            this.logger.warn(
                `Failed to parse WeChat integration config: ${error instanceof Error ? error.message : error}`,
            );
            return this.emptyConfig();
        }
    }

    async setConfig(config: WechatIntegrationConfig): Promise<void> {
        await this.configService.upsertConfigEntry(
            WECHAT_INTEGRATION_CONFIG_KEY,
            JSON.stringify({
                enabled: Boolean(config.enabled),
                endpoint: this.normalizeString(config.endpoint),
                token: this.normalizeString(config.token),
            }),
        );
    }

    private emptyConfig(): WechatIntegrationConfig {
        return {
            enabled: false,
            endpoint: '',
            token: '',
        };
    }

    private normalizeString(value: unknown): string {
        return typeof value === 'string' ? value.trim() : '';
    }
}
