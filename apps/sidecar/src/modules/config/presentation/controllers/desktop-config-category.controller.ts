import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import {
    ConfigManagementApi,
    ConfigMutation,
    MANAGEMENT_ACTION,
    MANAGEMENT_RESOURCE,
} from '@/shared/security/desktop-access';
import { ApiOkResponse } from '@/shared/api/openapi';
import { BadRequestException, NotFoundException } from '@/shared/common/errors';
import { restoreSecrets } from '@/shared/common/security/secret-redaction';
import { ConfigServiceImpl } from '@/modules/config/application/config.service';
import {
    DESKTOP_MODEL_CONFIG_SYNC,
    type IDesktopModelConfigSync,
} from '@/modules/config/domain/services/desktop-model-config-sync.interface';
import type {
    AppearanceSettings,
    AssetSettings,
    EditorSettings,
    EmailSettings,
    GeneralSettings,
    LlmSettings,
    MarketplaceSettings,
    NetworkSettings,
    NotificationSettings,
    OAuthSettings,
    OcrSettings,
    PackageSettings,
    PlatformSettings,
    RuntimeSettings,
    SearchSettings,
    SecurityMonitorSettings,
    SecuritySettings,
    StorageSettings,
} from '@/modules/config/domain/services/settings-schema';
import { redactConfigResponseSecrets } from '@/modules/config/presentation/interceptors/config-secret-redaction.interceptor';
import type { ConfigCategoryName } from '@/modules/config/presentation/dto';
import { CategoryInfoResponseDto, CategoryListResponseDto } from '@/modules/config/presentation/dto/response';
import { ConfigSettingsValidationService } from '@/modules/config/presentation/validators/config-settings-validation.service';

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    platform: '平台配置',
    assets: '数字资产配置',
    packages: '包管理配置',
    marketplace: '市场配置',
    runtime: '运行时配置',
    general: '通用配置',
    appearance: '外观配置',
    editor: '编辑器配置',
    llm: 'LLM 配置',
    ocr: 'OCR 配置',
    search: '搜索配置',
    oauth: '第三方授权配置',
    email: '邮件服务器配置',
    notifications: '通知配置',
    security: '安全配置',
    network: '网络配置',
    'security-monitor': '安全监控配置',
    storage: '存储配置',
};

const VALID_CATEGORIES = Object.keys(CATEGORY_DESCRIPTIONS) as ConfigCategoryName[];

@ApiTags('系统 - 配置分类')
@ConfigManagementApi()
@Controller('config/categories')
export class DesktopConfigCategoryController {
    constructor(
        private readonly configService: ConfigServiceImpl,
        private readonly configSettingsValidationService: ConfigSettingsValidationService,
        @Inject(DESKTOP_MODEL_CONFIG_SYNC)
        private readonly desktopModelConfigSync: IDesktopModelConfigSync,
    ) {}

    @Get()
    @ApiOkResponse({
        summary: '列出所有配置分类',
        description: '返回所有可用的配置分类及其中文描述',
        type: CategoryListResponseDto,
    })
    listCategories(): CategoryListResponseDto {
        const items: CategoryInfoResponseDto[] = VALID_CATEGORIES.map(name => ({
            name,
            description: CATEGORY_DESCRIPTIONS[name] || name,
        }));
        return { items };
    }

    @Get(':name')
    @ApiOkResponse({
        summary: '获取分类配置',
        description: '根据分类名称返回当前分类的完整配置',
    })
    @ApiParam({ name: 'name', enum: VALID_CATEGORIES })
    async getCategorySettings(@Param('name') name: string): Promise<Record<string, unknown>> {
        const categoryName = this.parseCategoryName(name);
        const settings = await this.getCategorySettingsByName(categoryName);
        return redactConfigResponseSecrets(settings) as Record<string, unknown>;
    }

    @Put(':name')
    @ConfigMutation({
        action: MANAGEMENT_ACTION.UPDATE,
        resource: MANAGEMENT_RESOURCE.CONFIG_CATEGORY,
        description: '更新分类配置',
    })
    @ApiParam({ name: 'name', enum: VALID_CATEGORIES })
    @ApiOkResponse({
        summary: '更新分类配置',
        description: '校验并更新指定配置分类的设置',
    })
    async updateCategorySettings(@Param('name') name: string, @Body() body: unknown): Promise<void> {
        const categoryName = this.parseCategoryName(name);
        const existing = await this.getCategorySettingsByName(categoryName);
        const merged = restoreSecrets(body, existing);
        const settings = await this.configSettingsValidationService.validateCategorySettings(categoryName, merged);
        await this.setCategorySettingsByName(categoryName, settings);
        if (categoryName === 'llm') {
            await this.desktopModelConfigSync.sync(await this.configService.getSettings());
        }
    }

    private parseCategoryName(name: string): ConfigCategoryName {
        if (!VALID_CATEGORIES.includes(name as ConfigCategoryName)) {
            throw new BadRequestException(`无效的分类名称: ${name}。可选值: ${VALID_CATEGORIES.join(', ')}`);
        }
        return name as ConfigCategoryName;
    }

    private async getCategorySettingsByName(name: ConfigCategoryName): Promise<unknown> {
        switch (name) {
            case 'platform':
                return this.configService.getPlatformSettings();
            case 'assets':
                return this.configService.getAssetSettings();
            case 'packages':
                return this.configService.getPackageSettings();
            case 'marketplace':
                return this.configService.getMarketplaceSettings();
            case 'runtime':
                return this.configService.getRuntimeSettings();
            case 'general':
                return this.configService.getGeneralSettings();
            case 'appearance':
                return this.configService.getAppearanceSettings();
            case 'editor':
                return this.configService.getEditorSettings();
            case 'llm':
                return this.configService.getLlmSettings();
            case 'ocr':
                return this.configService.getOcrSettings();
            case 'search':
                return this.configService.getSearchSettings();
            case 'oauth':
                return this.configService.getOAuthSettings();
            case 'email':
                return this.configService.getEmailSettings();
            case 'notifications':
                return this.configService.getNotificationSettings();
            case 'security':
                return this.configService.getSecuritySettings();
            case 'network':
                return this.configService.getNetworkSettings();
            case 'security-monitor':
                return this.configService.getSecurityMonitorSettings();
            case 'storage':
                return this.configService.getStorageSettings();
            default:
                throw new NotFoundException(`分类 ${name} 未找到`);
        }
    }

    private async setCategorySettingsByName(name: ConfigCategoryName, settings: unknown): Promise<void> {
        switch (name) {
            case 'platform':
                await this.configService.setPlatformSettings(settings as PlatformSettings);
                break;
            case 'assets':
                await this.configService.setAssetSettings(settings as AssetSettings);
                break;
            case 'packages':
                await this.configService.setPackageSettings(settings as PackageSettings);
                break;
            case 'marketplace':
                await this.configService.setMarketplaceSettings(settings as MarketplaceSettings);
                break;
            case 'runtime':
                await this.configService.setRuntimeSettings(settings as RuntimeSettings);
                break;
            case 'general':
                await this.configService.setGeneralSettings(settings as GeneralSettings);
                break;
            case 'appearance':
                await this.configService.setAppearanceSettings(settings as AppearanceSettings);
                break;
            case 'editor':
                await this.configService.setEditorSettings(settings as EditorSettings);
                break;
            case 'llm':
                await this.configService.setLlmSettings(settings as LlmSettings);
                break;
            case 'ocr':
                await this.configService.setOcrSettings(settings as OcrSettings);
                break;
            case 'search':
                await this.configService.setSearchSettings(settings as SearchSettings);
                break;
            case 'oauth':
                await this.configService.setOAuthSettings(settings as OAuthSettings);
                break;
            case 'email':
                await this.configService.setEmailSettings(settings as EmailSettings);
                break;
            case 'notifications':
                await this.configService.setNotificationSettings(settings as NotificationSettings);
                break;
            case 'security':
                await this.configService.setSecuritySettings(settings as SecuritySettings);
                break;
            case 'network':
                await this.configService.setNetworkSettings(settings as NetworkSettings);
                break;
            case 'security-monitor':
                await this.configService.setSecurityMonitorSettings(settings as SecurityMonitorSettings);
                break;
            case 'storage':
                await this.configService.setStorageSettings(settings as StorageSettings);
                break;
            default:
                throw new NotFoundException(`分类 ${name} 未找到`);
        }
    }
}
