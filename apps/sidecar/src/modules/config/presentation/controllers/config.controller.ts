import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Patch, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigSecretRedactionInterceptor } from '../interceptors/config-secret-redaction.interceptor';
import { restoreSecrets } from '@/shared/common/security/secret-redaction';
import {
    ConfigManagementApi,
    ConfigMutation,
    MANAGEMENT_ACTION,
    MANAGEMENT_RESOURCE,
} from '@/shared/security/desktop-access';
import { ApiOkResponse } from '@/shared/api/openapi';
import { ConfigServiceImpl } from '../../application/config.service';
import { ProviderModelListService } from '../../application/provider-model-list.service';
import {
    DESKTOP_MODEL_CONFIG_SYNC,
    IDesktopModelConfigSync,
} from '../../domain/services/desktop-model-config-sync.interface';
import {
    AppSettings,
    AssistantSettings,
    EmailSettings,
    NetworkSettings,
    NotificationSettings,
    OAuthSettings,
    SecuritySettings,
    StorageSettings,
} from '../../domain/services/settings-schema';
import {
    AppSettingsRequestDto,
    EmailSettingsRequestDto,
    NetworkSettingsRequestDto,
    NotificationSettingsRequestDto,
    OAuthSettingsRequestDto,
    AssistantSettingsRequestDto,
    PatchAppSettingsRequestDto,
    FetchProviderModelsRequestDto,
    ProviderModelListResponseDto,
    SecuritySettingsRequestDto,
    StorageSettingsRequestDto,
    SystemInfoResponseDto,
} from '../dto';

@ApiTags('系统 - 配置')
@ConfigManagementApi()
@Controller('config')
@UseInterceptors(ConfigSecretRedactionInterceptor)
export class ConfigController {
    constructor(
        private readonly configService: ConfigServiceImpl,
        private readonly providerModelListService: ProviderModelListService,
        @Inject(DESKTOP_MODEL_CONFIG_SYNC)
        private readonly desktopModelConfigSync: IDesktopModelConfigSync,
    ) {}

    /**
     * 获取系统信息
     */
    @Get('system-info')
    @ApiOkResponse({
        summary: '获取系统信息',
        description: '获取应用名称、版本等系统信息',
        type: SystemInfoResponseDto,
    })
    async getSystemInfo(): Promise<SystemInfoResponseDto> {
        const settings = await this.configService.getPlatformSettings();
        return {
            appName: settings.appName,
            logoUrl: settings.logoUrl,
            version: process.env.APP_VERSION || '1.0.0',
        };
    }

    /**
     * 获取完整配置
     */
    @Get()
    @ApiOkResponse({ summary: '获取完整配置', description: '获取所有配置项' })
    async getSettings(): Promise<AppSettings> {
        return this.configService.getSettings();
    }

    /**
     * 保存完整配置
     */
    @Put()
    @ConfigMutation({ description: '覆盖保存系统配置' })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ summary: '保存完整配置', description: '覆盖保存所有配置项' })
    async setSettings(@Body() settings: AppSettingsRequestDto): Promise<void> {
        const current = await this.configService.getSettings();
        // Restore masked secrets ([configured] sentinels) from the stored config so a
        // redacted read round-tripped through save can't overwrite a real credential.
        const merged = restoreSecrets(
            {
                ...current,
                ...settings,
                storage: { ...current.storage, ...settings.storage },
            },
            current,
        ) as typeof current;
        await this.configService.setSettings(merged);
        await this.desktopModelConfigSync.sync(await this.configService.getSettings());
    }

    /**
     * 部分更新配置
     */
    @Patch()
    @ConfigMutation({ description: '部分更新系统配置' })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ summary: '部分更新配置', description: '仅更新传入的配置项' })
    async patchSettings(@Body() patch: PatchAppSettingsRequestDto): Promise<AppSettings> {
        const settings = await this.configService.patchSettings(patch);
        if (patch.llm) {
            await this.desktopModelConfigSync.sync(settings);
        }
        return settings;
    }

    @Post('llm/providers/models\\:fetch')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({
        summary: '拉取 Provider 模型列表',
        description: '使用 OpenAI-compatible /models 接口读取远端模型列表；不会修改系统配置。',
        type: ProviderModelListResponseDto,
    })
    async fetchProviderModels(
        @Body() body: FetchProviderModelsRequestDto,
    ): Promise<ProviderModelListResponseDto> {
        return this.providerModelListService.fetchModels(body);
    }

    @Post('llm/providers/models/fetch')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({
        summary: '拉取 Provider 模型列表',
        description: '使用 OpenAI-compatible /models 接口读取远端模型列表；不会修改系统配置。',
        type: ProviderModelListResponseDto,
    })
    async fetchProviderModelsAlias(
        @Body() body: FetchProviderModelsRequestDto,
    ): Promise<ProviderModelListResponseDto> {
        return this.fetchProviderModels(body);
    }

    /**
     * 重置配置为默认值
     */
    @Post('reset')
    @ConfigMutation({
        action: MANAGEMENT_ACTION.RESET,
        description: '重置系统配置',
        requireReauth: true,
    })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ summary: '重置配置', description: '将所有配置项重置为默认值' })
    async resetSettings(): Promise<AppSettings> {
        const settings = await this.configService.resetSettings();
        await this.desktopModelConfigSync.sync(settings);
        return settings;
    }

    // ========== OAuth ==========

    /**
     * 获取 OAuth 配置
     */
    @Get('oauth')
    @ApiOkResponse({ summary: '获取 OAuth 配置', description: '获取第三方服务 OAuth 授权配置' })
    async getOAuthSettings(): Promise<OAuthSettings> {
        return this.configService.getOAuthSettings();
    }

    /**
     * 保存 OAuth 配置
     */
    @Put('oauth')
    @ConfigMutation({
        resource: MANAGEMENT_RESOURCE.CONFIG_OAUTH,
        description: '更新 OAuth 配置',
        requireReauth: true,
    })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ summary: '保存 OAuth 配置', description: '保存第三方服务 OAuth 授权配置' })
    async setOAuthSettings(@Body() oauth: OAuthSettingsRequestDto): Promise<void> {
        await this.configService.setOAuthSettings(oauth);
    }

    // ========== Email ==========

    /**
     * 获取邮件配置
     */
    @Get('email')
    @ApiOkResponse({ summary: '获取邮件配置', description: '获取邮件服务器配置' })
    async getEmailSettings(): Promise<EmailSettings> {
        return this.configService.getEmailSettings();
    }

    /**
     * 保存邮件配置
     */
    @Put('email')
    @ConfigMutation({
        resource: MANAGEMENT_RESOURCE.CONFIG_EMAIL,
        description: '更新邮件配置',
        requireReauth: true,
    })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ summary: '保存邮件配置', description: '保存邮件服务器配置' })
    async setEmailSettings(@Body() email: EmailSettingsRequestDto): Promise<void> {
        await this.configService.setEmailSettings(email);
    }

    // ========== Notifications ==========

    /**
     * 获取通知配置
     */
    @Get('notifications')
    @ApiOkResponse({ summary: '获取通知配置', description: '获取通知渠道、分类、级别配置' })
    async getNotificationSettings(): Promise<NotificationSettings> {
        return this.configService.getNotificationSettings();
    }

    /**
     * 保存通知配置
     */
    @Put('notifications')
    @ConfigMutation({
        resource: MANAGEMENT_RESOURCE.CONFIG_NOTIFICATIONS,
        description: '更新通知配置',
    })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ summary: '保存通知配置', description: '保存通知渠道、分类、级别配置' })
    async setNotificationSettings(@Body() notifications: NotificationSettingsRequestDto): Promise<void> {
        await this.configService.setNotificationSettings(notifications);
    }

    // ========== Security ==========

    /**
     * 获取安全配置
     */
    @Get('security')
    @ApiOkResponse({ summary: '获取安全配置', description: '获取密码、会话、审计等安全配置' })
    async getSecuritySettings(): Promise<SecuritySettings> {
        return this.configService.getSecuritySettings();
    }

    /**
     * 保存安全配置
     */
    @Put('security')
    @ConfigMutation({
        resource: MANAGEMENT_RESOURCE.CONFIG_SECURITY,
        description: '更新安全配置',
        requireReauth: true,
    })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ summary: '保存安全配置', description: '保存密码、会话、审计等安全配置' })
    async setSecuritySettings(@Body() security: SecuritySettingsRequestDto): Promise<void> {
        await this.configService.setSecuritySettings(security);
    }

    // ========== Assistant (默认内核助手 / 默认智能助手) ==========

    /**
     * 获取默认智能助手全局配置
     */
    @Get('assistant')
    @ApiOkResponse({
        summary: '获取默认智能助手全局配置',
        description:
            '获取默认内核助手(agentId=default)的显示名称 / 头像 / 描述 / 系统提示词 / 模型 / 技能 / 工具 / 参数等平台级配置',
    })
    async getAssistantSettings(): Promise<AssistantSettings> {
        return this.configService.getAssistantSettings();
    }

    /**
     * 保存默认智能助手全局配置
     */
    @Put('assistant')
    @ConfigMutation({
        resource: MANAGEMENT_RESOURCE.CONFIG_ASSISTANT,
        description: '更新默认智能助手全局配置',
    })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({
        summary: '保存默认智能助手全局配置',
        description:
            '保存默认内核助手的显示名称 / 头像 / 描述 / 系统提示词 / 模型 / 技能 / 工具 / 参数等平台级配置',
    })
    async setAssistantSettings(@Body() assistant: AssistantSettingsRequestDto): Promise<void> {
        await this.configService.setAssistantSettings(assistant);
    }

    // ========== Network ==========

    /**
     * 获取网络配置
     */
    @Get('network')
    @ApiOkResponse({ summary: '获取网络配置', description: '获取代理、网络连接配置' })
    async getNetworkSettings(): Promise<NetworkSettings> {
        return this.configService.getNetworkSettings();
    }

    /**
     * 保存网络配置
     */
    @Put('network')
    @ConfigMutation({
        resource: MANAGEMENT_RESOURCE.CONFIG_NETWORK,
        description: '更新网络配置',
        requireReauth: true,
    })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ summary: '保存网络配置', description: '保存代理、网络连接配置' })
    async setNetworkSettings(@Body() network: NetworkSettingsRequestDto): Promise<void> {
        await this.configService.setNetworkSettings(network);
    }

    // ========== Storage ==========

    /**
     * 获取存储配置
     */
    @Get('storage')
    @ApiOkResponse({ summary: '获取存储配置', description: '获取本地存储配置' })
    async getStorageSettings(): Promise<StorageSettings> {
        return this.configService.getStorageSettings();
    }

    /**
     * 读取以环境变量为优先来源的存储配置（不写库）
     */
    @Get('storage/from-env')
    @ApiOkResponse({
        summary: '从环境变量预览存储配置',
        description:
            '返回以 LOCAL_STORAGE_PATH 环境变量为优先来源的存储配置，用于界面回填，不会写入持久化存储',
    })
    async getStorageSettingsFromEnv(): Promise<StorageSettings> {
        return this.configService.getStorageSettingsFromEnv();
    }

    /**
     * 保存存储配置
     */
    @Put('storage')
    @ConfigMutation({
        resource: MANAGEMENT_RESOURCE.CONFIG_STORAGE,
        description: '更新存储配置',
        requireReauth: true,
    })
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ summary: '保存存储配置', description: '保存本地存储配置' })
    async setStorageSettings(@Body() storage: StorageSettingsRequestDto): Promise<void> {
        const current = await this.configService.getStorageSettings();
        await this.configService.setStorageSettings({ ...current, ...storage });
    }
}
