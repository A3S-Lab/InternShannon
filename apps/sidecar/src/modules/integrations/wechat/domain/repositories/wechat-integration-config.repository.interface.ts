import type { WechatIntegrationConfig } from '../wechat-integration.types';

export const WECHAT_INTEGRATION_CONFIG_REPOSITORY = Symbol('WECHAT_INTEGRATION_CONFIG_REPOSITORY');

export interface WechatIntegrationConfigRepository {
    getConfig(): Promise<WechatIntegrationConfig>;
    setConfig(config: WechatIntegrationConfig): Promise<void>;
}
