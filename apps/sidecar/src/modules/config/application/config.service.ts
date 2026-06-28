import { Inject, Injectable, Logger } from '@nestjs/common';
import { BadRequestException } from '@/shared/common/errors';
import { restoreSecrets } from '@/shared/common/security/secret-redaction';
import {
    firstEnv,
    firstNonBlank as firstNonBlankValue,
    OAUTH_PROVIDER_DEFAULTS,
    OAUTH_PROVIDER_IDS,
    type OAuthProviderId,
    oauthProviderCallbackUrl,
} from '@/shared/config/oauth-provider.config';
import { isDesktop } from '@/shared/constants';
import {
    CONFIG_REPOSITORY,
    ConfigEntryRecord,
    IConfigRepository,
} from '../domain/repositories/config-repository.interface';
import type { ConfigService, DeepPartial } from '../domain/services/config-service.interface';
import {
    AppearanceSettings,
    AppSettings,
    AssetSettings,
    AssistantSettings,
    DEFAULT_SETTINGS,
    EditorSettings,
    EmailSettings,
    GeneralSettings,
    LlmSettings,
    MarketplaceSettings,
    NetworkSettings,
    NotificationSettings,
    OcrSettings,
    OAuthProviderSettings,
    OAuthSettings,
    PackageSettings,
    PlatformSettings,
    RuntimeSettings,
    SearchSettings,
    SecurityMonitorSettings,
    SecuritySettings,
    StorageSettings,
} from '../domain/services/settings-schema';

/**
 * Hierarchical configuration keys for AppSettings categories.
 * Each category is stored as a separate key in the desktop config repository.
 */
const CATEGORY_KEYS = {
    platform: 'platform',
    assets: 'assets',
    packages: 'packages',
    marketplace: 'marketplace',
    runtime: 'runtime',
    general: 'general',
    appearance: 'appearance',
    editor: 'editor',
    llm: 'llm',
    ocr: 'ocr',
    search: 'search',
    oauth: 'oauth',
    email: 'email',
    notifications: 'notifications',
    security: 'security',
    network: 'network',
    securityMonitor: 'security-monitor',
    storage: 'storage',
    assistant: 'assistant',
} as const;

type CategoryKey = keyof typeof CATEGORY_KEYS;

const LEGACY_SETTINGS_KEY = 'settings';
const RAW_CONFIG_ROOT = 'config';
const RAW_CONFIG_PREFIX = `${RAW_CONFIG_ROOT}/`;
const MANAGED_APP_CONFIG_PREFIX = 'config/app';
const MANAGED_APP_CONFIG_MUTATION_MESSAGE =
    'Managed application settings must be changed through typed config APIs such as /config or /config/categories/:name';

@Injectable()
export class ConfigServiceImpl implements ConfigService {
    private readonly logger = new Logger(ConfigServiceImpl.name);
    private settingsCache: AppSettings | null = null;

    constructor(@Inject(CONFIG_REPOSITORY) private readonly repo: IConfigRepository) {}

    /**
     * 获取完整配置
     * Loads settings from individual category keys. If no settings exist,
     * creates defaults. Supports migration from legacy single-blob format.
     */
    async getSettings(): Promise<AppSettings> {
        if (this.settingsCache) {
            return this.settingsCache;
        }

        // Try to load from new hierarchical keys
        const categories = await this.loadAllCategories();

        // Check if we have any settings (migration or fresh start)
        const hasAnySetting = Object.keys(categories).length > 0;

        if (!hasAnySetting) {
            // Try legacy format
            const legacy = await this.repo.getValue(LEGACY_SETTINGS_KEY);
            if (legacy) {
                try {
                    const settings = JSON.parse(legacy) as DeepPartial<AppSettings>;
                    this.logger.log('Migrating legacy settings to hierarchical format');
                    // Migrate to new format
                    await this.setSettings(this.normalizeSettings(settings));
                    return this.settingsCache!;
                } catch (e) {
                    this.logger.error(`Failed to parse legacy settings: ${e}`);
                }
            }
            // Fresh start with defaults (seeded from env vars if set)
            const defaults = this.buildInitialSettings();
            await this.setSettings(defaults);
            return this.settingsCache!;
        }

        // Merge loaded categories with defaults using normalizeSettings. Persist newly
        // introduced default fields so desktop config stays explicit.
        const normalized = this.normalizeSettings(categories);
        await this.persistMissingCategoryDefaults(categories, normalized);
        await this.pruneUnmanagedAppCategories();
        this.settingsCache = normalized;
        return this.settingsCache;
    }

    /**
     * Load all settings categories from individual repository keys.
     */
    private async loadAllCategories(): Promise<DeepPartial<AppSettings>> {
        const results: DeepPartial<AppSettings> = {};

        await Promise.all(
            (Object.keys(CATEGORY_KEYS) as CategoryKey[]).map(async key => {
                try {
                    const value = await this.repo.getValue(CATEGORY_KEYS[key]);
                    if (value) {
                        (results as unknown as Record<string, unknown>)[key] = JSON.parse(value);
                    }
                } catch (e) {
                    this.logger.warn(`Failed to load category ${key}: ${e}`);
                }
            }),
        );

        return results;
    }

    /**
     * Persist categories that were absent or only stored a partial shape while
     * preserving user values.
     */
    private async persistMissingCategoryDefaults(
        loaded: DeepPartial<AppSettings>,
        normalized: AppSettings,
    ): Promise<void> {
        const normalizedRecord = normalized as unknown as Record<string, unknown>;
        const loadedRecord = loaded as unknown as Record<string, unknown>;
        const writes: Promise<void>[] = [];

        for (const key of Object.keys(CATEGORY_KEYS) as CategoryKey[]) {
            const loadedCategory = loadedRecord[key];
            const normalizedCategory = normalizedRecord[key];
            if (this.hasMissingDefaults(loadedCategory, normalizedCategory)) {
                writes.push(this.repo.setValue(CATEGORY_KEYS[key], JSON.stringify(normalizedCategory)));
            }
        }

        if (writes.length === 0) return;
        await Promise.all(writes);
        this.logger.log(`Persisted default values for ${writes.length} settings categories`);
    }

    private hasMissingDefaults(current: unknown, normalized: unknown): boolean {
        if (current == null) return true;
        if (Array.isArray(normalized)) return current == null;
        if (!this.isPlainObject(normalized)) {
            return (
                typeof normalized === 'string' &&
                normalized.trim().length > 0 &&
                typeof current === 'string' &&
                current.trim().length === 0
            );
        }
        if (!this.isPlainObject(current)) return true;

        for (const [key, value] of Object.entries(normalized)) {
            if (!Object.hasOwn(current, key)) {
                return true;
            }
            if (this.hasMissingDefaults(current[key], value)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 保存完整配置
     * Saves each category to its own hierarchical key under config/app/
     */
    async setSettings(settings: AppSettings): Promise<void> {
        this.settingsCache = this.normalizeSettings(settings);

        // Save each category to its own key
        const categories = this.settingsCache as unknown as Record<string, unknown>;
        await Promise.all(
            (Object.keys(CATEGORY_KEYS) as CategoryKey[]).map(key =>
                this.repo.setValue(CATEGORY_KEYS[key], JSON.stringify(categories[key])),
            ),
        );
        await this.pruneUnmanagedAppCategories();

        this.logger.log('Settings saved (hierarchical format)');
    }

    /**
     * 更新部分配置
     * Only saves categories that are included in the patch
     */
    async patchSettings(patch: DeepPartial<AppSettings>): Promise<AppSettings> {
        const current = await this.getSettings();
        const restoredPatch = restoreSecrets(patch, current) as DeepPartial<AppSettings>;
        const merged = this.mergeSettings(current, restoredPatch);
        this.settingsCache = this.normalizeSettings(merged);

        // Save only changed categories
        const promises: Promise<void>[] = [];
        const cache = this.settingsCache as unknown as Record<string, unknown>;
        const patchRecord = patch as unknown as Record<string, unknown>;
        for (const key of Object.keys(CATEGORY_KEYS) as CategoryKey[]) {
            if (Object.hasOwn(patchRecord, key)) {
                promises.push(this.repo.setValue(CATEGORY_KEYS[key], JSON.stringify(cache[key])));
            }
        }

        await Promise.all(promises);
        await this.pruneUnmanagedAppCategories();
        this.logger.log('Settings patched (hierarchical format)');
        return this.settingsCache;
    }

    private mergeSettings(current: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
        return this.deepMerge(current, patch);
    }

    private async pruneUnmanagedAppCategories(): Promise<void> {
        const allowedCategories = new Set<string>(Object.values(CATEGORY_KEYS));
        const entries = Object.keys(await this.repo.getAllValues());
        const staleCategories = new Set<string>();
        const staleRawKeys = new Set<string>();

        for (const key of entries) {
            const category = this.appCategoryFromStorageKey(key);
            if (!category || allowedCategories.has(category)) continue;
            staleCategories.add(category);
            const normalizedKey = key.trim().replace(/^\/+/, '');
            if (normalizedKey.startsWith(`${MANAGED_APP_CONFIG_PREFIX}/`)) {
                staleRawKeys.add(normalizedKey);
            }
        }

        if (staleCategories.size === 0 && staleRawKeys.size === 0) return;
        await Promise.all([
            ...Array.from(staleCategories).map(category => this.repo.deleteValue(category)),
            ...Array.from(staleRawKeys).map(key =>
                this.repo.deleteRawValue ? this.repo.deleteRawValue(key) : this.repo.deleteValue(key),
            ),
        ]);
        this.logger.log(`Pruned ${staleCategories.size} unmanaged app config category record(s)`);
    }

    private appCategoryFromStorageKey(key: string): string | null {
        const normalized = key.trim().replace(/^\/+/, '');
        if (!normalized) return null;
        if (normalized.startsWith(`${MANAGED_APP_CONFIG_PREFIX}/`)) {
            const category = normalized.slice(`${MANAGED_APP_CONFIG_PREFIX}/`.length);
            return category && !category.includes('/') ? category : null;
        }
        if (!normalized.startsWith(RAW_CONFIG_PREFIX) && !normalized.includes('/')) {
            return normalized;
        }
        return null;
    }

    /**
     * 获取平台配置
     */
    async getPlatformSettings(): Promise<PlatformSettings> {
        const settings = await this.getSettings();
        return settings.platform;
    }

    /**
     * 更新平台配置
     */
    async setPlatformSettings(platform: PlatformSettings): Promise<void> {
        await this.patchSettings({ platform });
    }

    /**
     * 获取数字资产配置
     */
    async getAssetSettings(): Promise<AssetSettings> {
        const settings = await this.getSettings();
        return settings.assets;
    }

    /**
     * 更新数字资产配置
     */
    async setAssetSettings(assets: AssetSettings): Promise<void> {
        await this.patchSettings({ assets });
    }

    /**
     * 获取包管理配置
     */
    async getPackageSettings(): Promise<PackageSettings> {
        const settings = await this.getSettings();
        return settings.packages;
    }

    /**
     * 更新包管理配置
     */
    async setPackageSettings(packages: PackageSettings): Promise<void> {
        await this.patchSettings({ packages });
    }

    /**
     * 获取市场配置
     */
    async getMarketplaceSettings(): Promise<MarketplaceSettings> {
        const settings = await this.getSettings();
        return settings.marketplace;
    }

    /**
     * 更新市场配置
     */
    async setMarketplaceSettings(marketplace: MarketplaceSettings): Promise<void> {
        await this.patchSettings({ marketplace });
    }

    /**
     * 获取运行时配置
     */
    async getRuntimeSettings(): Promise<RuntimeSettings> {
        const settings = await this.getSettings();
        return settings.runtime;
    }

    /**
     * 更新运行时配置
     */
    async setRuntimeSettings(runtime: RuntimeSettings): Promise<void> {
        await this.patchSettings({ runtime });
    }

    /**
     * 获取通用配置
     */
    async getGeneralSettings(): Promise<GeneralSettings> {
        const settings = await this.getSettings();
        // Migration: ensure appName has a default value
        if (!settings.general.appName) {
            settings.general.appName = DEFAULT_SETTINGS.general.appName;
        }
        return settings.general;
    }

    /**
     * 更新通用配置
     */
    async setGeneralSettings(general: GeneralSettings): Promise<void> {
        await this.patchSettings({ general });
    }

    /**
     * 获取外观配置
     */
    async getAppearanceSettings(): Promise<AppearanceSettings> {
        const settings = await this.getSettings();
        return settings.appearance;
    }

    /**
     * 更新外观配置
     */
    async setAppearanceSettings(appearance: AppearanceSettings): Promise<void> {
        await this.patchSettings({ appearance });
    }

    /**
     * 获取编辑器配置
     */
    async getEditorSettings(): Promise<EditorSettings> {
        const settings = await this.getSettings();
        return settings.editor;
    }

    /**
     * 更新编辑器配置
     */
    async setEditorSettings(editor: EditorSettings): Promise<void> {
        await this.patchSettings({ editor });
    }

    /**
     * 获取 LLM 配置
     */
    async getLlmSettings(): Promise<LlmSettings> {
        const settings = await this.getSettings();
        return settings.llm;
    }

    /**
     * 更新 LLM 配置
     */
    async setLlmSettings(llm: LlmSettings): Promise<void> {
        await this.patchSettings({ llm });
    }

    /**
     * 获取 OCR 配置
     */
    async getOcrSettings(): Promise<OcrSettings> {
        const settings = await this.getSettings();
        return settings.ocr;
    }

    /**
     * 更新 OCR 配置
     */
    async setOcrSettings(ocr: OcrSettings): Promise<void> {
        await this.patchSettings({ ocr });
    }

    /**
     * 获取搜索配置
     */
    async getSearchSettings(): Promise<SearchSettings> {
        const settings = await this.getSettings();
        return settings.search;
    }

    /**
     * 更新搜索配置
     */
    async setSearchSettings(search: SearchSettings): Promise<void> {
        await this.patchSettings({ search });
    }

    /**
     * 获取 OAuth 配置
     */
    async getOAuthSettings(): Promise<OAuthSettings> {
        const settings = await this.getSettings();
        return this.sanitizeOAuthSettingsForResponse(settings.oauth);
    }

    /**
     * 更新 OAuth 配置
     */
    async setOAuthSettings(oauth: OAuthSettings): Promise<void> {
        const current = (await this.getSettings()).oauth;
        await this.patchSettings({ oauth: this.normalizeOAuthSettingsForSave(oauth, current) });
    }

    /**
     * 获取邮件配置
     */
    async getEmailSettings(): Promise<EmailSettings> {
        const settings = await this.getSettings();
        return this.sanitizeEmailSettingsForResponse(settings.email);
    }

    /**
     * 更新邮件配置
     */
    async setEmailSettings(email: EmailSettings): Promise<void> {
        const current = (await this.getSettings()).email;
        await this.patchSettings({ email: this.normalizeEmailSettingsForSave(email, current) });
    }

    /**
     * 获取通知配置
     */
    async getNotificationSettings(): Promise<NotificationSettings> {
        const settings = await this.getSettings();
        return settings.notifications;
    }

    /**
     * 更新通知配置
     */
    async setNotificationSettings(notifications: NotificationSettings): Promise<void> {
        await this.patchSettings({ notifications });
    }

    /**
     * 获取安全配置
     */
    async getSecuritySettings(): Promise<SecuritySettings> {
        const settings = await this.getSettings();
        return settings.security;
    }

    /**
     * 更新安全配置
     */
    async setSecuritySettings(security: SecuritySettings): Promise<void> {
        await this.patchSettings({ security });
    }

    /**
     * 获取网络配置
     */
    async getNetworkSettings(): Promise<NetworkSettings> {
        const settings = await this.getSettings();
        return settings.network;
    }

    /**
     * 更新网络配置
     */
    async setNetworkSettings(network: NetworkSettings): Promise<void> {
        await this.patchSettings({ network });
    }

    /**
     * 获取安全监控配置
     */
    async getSecurityMonitorSettings(): Promise<SecurityMonitorSettings> {
        const settings = await this.getSettings();
        return settings.securityMonitor;
    }

    /**
     * 更新安全监控配置
     */
    async setSecurityMonitorSettings(securityMonitor: SecurityMonitorSettings): Promise<void> {
        await this.patchSettings({ securityMonitor });
    }

    /**
     * 获取默认智能助手（默认内核助手）全局配置
     */
    async getAssistantSettings(): Promise<AssistantSettings> {
        const settings = await this.getSettings();
        return settings.assistant ?? {};
    }

    /**
     * 更新默认智能助手（默认内核助手）全局配置
     */
    async setAssistantSettings(assistant: AssistantSettings): Promise<void> {
        const current = await this.getSettings();
        this.settingsCache = this.normalizeSettings({ ...current, assistant });
        await this.repo.setValue(CATEGORY_KEYS.assistant, JSON.stringify(this.settingsCache.assistant));
        await this.pruneUnmanagedAppCategories();
        this.logger.log('Assistant settings replaced (hierarchical format)');
    }

    /**
     * 获取存储配置
     */
    async getStorageSettings(): Promise<StorageSettings> {
        const settings = await this.getSettings();
        return settings.storage;
    }

    /**
     * 更新存储配置
     */
    async setStorageSettings(storage: StorageSettings): Promise<void> {
        await this.patchSettings({ storage });
    }

    /**
     * 读取以环境变量为优先来源的存储配置（不写库），用于界面"从环境变量重置"按钮回填表单。
     */
    async getStorageSettingsFromEnv(): Promise<StorageSettings> {
        const current = await this.getStorageSettings();
        return this.normalizeStorageSettingsFromEnv(current);
    }

    /**
     * 重置为默认配置
     */
    async resetSettings(): Promise<AppSettings> {
        this.settingsCache = this.cloneDefaultSettings();
        await this.setSettings(this.settingsCache);
        this.logger.log('Settings reset to defaults');
        return this.settingsCache;
    }

    /**
     * 清除缓存并从文件重新加载
     */
    async reloadSettings(): Promise<AppSettings> {
        this.settingsCache = null;
        return this.getSettings();
    }

    /**
     * 获取配置值（通用方法）
     */
    async getValue(key: string): Promise<string | null> {
        return this.repo.getValue(this.normalizeRepositoryKey(key));
    }

    /**
     * 设置配置值（通用方法）
     */
    async setValue(key: string, value: string): Promise<void> {
        return this.repo.setValue(this.normalizeRepositoryKey(key), value);
    }

    async listConfigEntries(options: {
        prefix?: string;
        search?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
        limit: number;
        offset: number;
    }): Promise<{ items: ConfigEntryRecord[]; total: number }> {
        const prefix = this.normalizeConfigPrefix(options.prefix || RAW_CONFIG_PREFIX);
        const entries = this.repo.getEntries
            ? await this.repo.getEntries(prefix)
            : Object.entries(await this.repo.getAllValues()).map(([key, value]) => ({ key, value }));
        const keyword = options.search?.trim().toLowerCase();
        const filtered = keyword
            ? entries.filter(entry => `${entry.key}\n${entry.value}`.toLowerCase().includes(keyword))
            : entries;
        const sortBy = options.sortBy || 'key';
        const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';
        const sorted = [...filtered].sort((left, right) => {
            const leftValue = this.configEntrySortValue(left, sortBy);
            const rightValue = this.configEntrySortValue(right, sortBy);
            const result = leftValue.localeCompare(rightValue, 'zh-CN', { numeric: true, sensitivity: 'base' });
            return sortOrder === 'asc' ? result : -result;
        });
        return {
            items: sorted.slice(options.offset, options.offset + options.limit),
            total: sorted.length,
        };
    }

    async getConfigEntry(key: string): Promise<ConfigEntryRecord | null> {
        const normalizedKey = this.normalizeConfigEntryKey(key);
        const value = normalizedKey.startsWith(`${MANAGED_APP_CONFIG_PREFIX}/`)
            ? await this.repo.getValue(this.toManagedCategoryKey(normalizedKey))
            : this.repo.getRawValue
              ? await this.repo.getRawValue(normalizedKey)
              : await this.repo.getValue(normalizedKey);
        return value === null ? null : { key: normalizedKey, value };
    }

    async upsertConfigEntry(key: string, value: string): Promise<ConfigEntryRecord> {
        const normalizedKey = this.normalizeConfigEntryKey(key);
        this.assertConfigEntryMutationAllowed(normalizedKey);
        if (this.repo.setRawValue) {
            await this.repo.setRawValue(normalizedKey, value);
        } else {
            await this.repo.setValue(normalizedKey, value);
        }
        // Invalidate cache if updating legacy settings key
        if (normalizedKey === `config/app/${LEGACY_SETTINGS_KEY}` || normalizedKey === LEGACY_SETTINGS_KEY) {
            this.settingsCache = null;
        }
        return { key: normalizedKey, value };
    }

    async deleteConfigEntry(key: string): Promise<void> {
        const normalizedKey = this.normalizeConfigEntryKey(key);
        this.assertConfigEntryMutationAllowed(normalizedKey);
        if (this.repo.deleteRawValue) {
            await this.repo.deleteRawValue(normalizedKey);
        } else {
            await this.repo.deleteValue(normalizedKey);
        }
        // Invalidate cache if deleting legacy settings key
        if (normalizedKey === `config/app/${LEGACY_SETTINGS_KEY}` || normalizedKey === LEGACY_SETTINGS_KEY) {
            this.settingsCache = null;
        }
    }

    private cloneDefaultSettings(): AppSettings {
        const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as AppSettings;
        if (isDesktop()) {
            settings.platform.appName = 'internShannon';
            settings.general.appName = 'internShannon';
        }
        return settings;
    }

    /**
     * Build initial settings from environment variables.
     * Used on first startup when the desktop config file has no config yet.
     * Env vars take precedence over DEFAULT_SETTINGS.
     */
    private buildInitialSettings(): AppSettings {
        const settings = this.cloneDefaultSettings();

        // ---- OAuth (GitHub) ----
        settings.oauth = this.seedOAuthSettingsFromEnv(settings.oauth);

        // ---- Email (SMTP) ----
        const smtpHost = process.env.MAIL_SMTP_HOST?.trim();
        if (smtpHost) {
            settings.email = {
                host: smtpHost,
                port: process.env.MAIL_SMTP_PORT?.trim() || '587',
                secure: this.envBool('MAIL_SMTP_SECURE'),
                username: process.env.MAIL_SMTP_USER?.trim() || '',
                password: process.env.MAIL_SMTP_PASS?.trim() || '',
                fromAddress: process.env.MAIL_FROM?.trim() || '',
                fromName: process.env.MAIL_FROM_NAME?.trim() || '',
            };
        }

        // ---- Storage (local desktop path) ----
        settings.storage = this.normalizeStorageSettings(settings.storage);

        // ---- Platform ----
        const platformAppName = process.env.PLATFORM_APP_NAME?.trim();
        if (platformAppName) {
            settings.platform.appName = platformAppName;
        }
        settings.platform = this.normalizePlatformUrlSettings(settings.platform);

        return settings;
    }

    private seedOAuthSettingsFromEnv(oauth: OAuthSettings): OAuthSettings {
        const seeded = { ...oauth };
        for (const provider of OAUTH_PROVIDER_IDS) {
            const defaults = OAUTH_PROVIDER_DEFAULTS[provider];
            const clientId = firstEnv(defaults.clientIdEnvKeys);
            const clientSecret = firstEnv(defaults.clientSecretEnvKeys);
            if (!clientId && !clientSecret) continue;
            seeded[provider] = {
                enabled: Boolean(clientId && clientSecret),
                clientId: clientId || '',
                clientSecret: clientSecret || '',
                callbackUrl: firstEnv(defaults.callbackEnvKeys) || this.buildOAuthCallbackUrl(provider),
                scopes: [...defaults.defaultScopes],
            };
        }
        return seeded;
    }

    private buildOAuthCallbackUrl(provider: OAuthProviderId): string {
        const baseUrl =
            process.env.PUBLIC_API_BASE_URL?.trim() ||
            process.env.API_BASE_URL?.trim() ||
            process.env.APP_PUBLIC_BASE_URL?.trim() ||
            this.localApiBaseUrl();
        return oauthProviderCallbackUrl(provider, baseUrl);
    }

    private normalizeOAuthSettingsForSave(input: OAuthSettings, current: OAuthSettings): OAuthSettings {
        const normalized = {} as Record<OAuthProviderId, OAuthProviderSettings>;
        for (const provider of OAUTH_PROVIDER_IDS) {
            normalized[provider] = this.normalizeOAuthProviderForSave(
                input[provider],
                current[provider],
                this.oauthProviderFallback(provider),
            );
        }
        return {
            github: normalized.github,
        };
    }

    private normalizeOAuthProviderForSave(
        input: OAuthSettings['github'] | undefined,
        current: OAuthSettings['github'] | undefined,
        fallback: OAuthProviderSettings,
    ): OAuthSettings['github'] {
        const clientSecret = input?.clientSecret?.trim() || current?.clientSecret || '';
        return {
            enabled: Boolean(input?.enabled),
            clientId: input?.clientId?.trim() ?? current?.clientId ?? '',
            clientSecret,
            callbackUrl: input?.callbackUrl?.trim() || current?.callbackUrl || fallback.callbackUrl,
            scopes: input?.scopes?.length ? input.scopes : (current?.scopes ?? fallback.scopes),
        };
    }

    private sanitizeOAuthSettingsForResponse(input: OAuthSettings): OAuthSettings {
        const sanitized = {} as Record<OAuthProviderId, OAuthProviderSettings>;
        for (const provider of OAUTH_PROVIDER_IDS) {
            sanitized[provider] = this.sanitizeOAuthProviderForResponse(
                input[provider],
                this.oauthProviderFallback(provider),
            );
        }
        return {
            github: sanitized.github,
        };
    }

    private sanitizeOAuthProviderForResponse(
        input: OAuthSettings['github'] | undefined,
        fallback: OAuthProviderSettings,
    ): OAuthSettings['github'] {
        return {
            enabled: Boolean(input?.enabled),
            clientId: input?.clientId || '',
            clientSecret: '',
            clientSecretConfigured: Boolean(input?.clientSecret),
            callbackUrl: input?.callbackUrl || fallback.callbackUrl,
            scopes: input?.scopes?.length ? input.scopes : fallback.scopes,
        };
    }

    private normalizeEmailSettingsForSave(input: EmailSettings, current: EmailSettings): EmailSettings {
        return {
            host: input.host?.trim() || '',
            port: input.port?.trim() || '587',
            secure: Boolean(input.secure),
            username: input.username?.trim() || '',
            password: input.password || current.password || '',
            fromAddress: input.fromAddress?.trim() || '',
            fromName: input.fromName?.trim() || '',
        };
    }

    private sanitizeEmailSettingsForResponse(input: EmailSettings): EmailSettings {
        return {
            ...input,
            password: '',
            passwordConfigured: Boolean(input.password),
        };
    }

    private normalizePlatformUrlSettings(platform: PlatformSettings): PlatformSettings {
        const publicBaseUrl =
            this.firstNonBlank(
                platform.publicBaseUrl,
                process.env.APP_PUBLIC_BASE_URL,
                process.env.PUBLIC_WEB_BASE_URL,
                process.env.PUBLIC_API_BASE_URL,
                process.env.API_BASE_URL,
                this.localApiBaseUrl(),
            ) ?? '';
        const publicApiBaseUrl =
            this.firstNonBlank(
                platform.publicApiBaseUrl,
                process.env.PUBLIC_API_BASE_URL,
                process.env.API_BASE_URL,
                publicBaseUrl,
            ) ?? '';
        const gitPublicBaseUrl =
            this.firstNonBlank(
                platform.gitPublicBaseUrl,
                process.env.GIT_PUBLIC_BASE_URL,
                publicApiBaseUrl,
                publicBaseUrl,
            ) ?? '';

        return {
            ...platform,
            publicBaseUrl,
            publicApiBaseUrl,
            gitPublicBaseUrl,
        };
    }

    private normalizeStorageSettings(storage: StorageSettings): StorageSettings {
        return {
            ...storage,
            defaultProvider: 'local',
            localStoragePath: this.firstNonBlank(storage.localStoragePath, process.env.LOCAL_STORAGE_PATH) ?? '',
        };
    }

    /**
     * Build a StorageSettings where environment variables take precedence over the
     * existing stored values. Used by the "reset from env" admin action so the user
     * can preview the env-based values in the form before saving.
     */
    private normalizeStorageSettingsFromEnv(current: StorageSettings): StorageSettings {
        return {
            ...current,
            defaultProvider: 'local',
            localStoragePath: this.firstNonBlank(process.env.LOCAL_STORAGE_PATH, current.localStoragePath) ?? '',
        };
    }

    private envBool(key: string): boolean {
        const val = process.env[key]?.trim().toLowerCase();
        return val === 'true' || val === '1' || val === 'yes';
    }

    private normalizeConfigEntryKey(key: string): string {
        const normalized = key.trim().replace(/^\/+/, '');
        if (!normalized) {
            throw new BadRequestException('Config key cannot be empty');
        }
        if (!normalized.startsWith(RAW_CONFIG_PREFIX)) {
            throw new BadRequestException('Config key must use a fully qualified path starting with "config/"');
        }
        return normalized;
    }

    private normalizeRepositoryKey(key: string): string {
        const normalized = key.trim().replace(/^\/+/, '');
        if (normalized.startsWith(`${MANAGED_APP_CONFIG_PREFIX}/`)) {
            return this.toManagedCategoryKey(normalized);
        }
        return normalized;
    }

    private toManagedCategoryKey(key: string): string {
        return key.slice(`${MANAGED_APP_CONFIG_PREFIX}/`.length);
    }

    private normalizeConfigPrefix(prefix: string): string {
        const normalized = prefix.trim().replace(/^\/+/, '');
        if (!normalized) {
            throw new BadRequestException('Config prefix cannot be empty');
        }
        if (normalized === RAW_CONFIG_ROOT) {
            return RAW_CONFIG_PREFIX;
        }
        if (!normalized.startsWith(RAW_CONFIG_PREFIX)) {
            throw new BadRequestException('Config prefix must start with "config"');
        }
        return normalized;
    }

    private assertConfigEntryMutationAllowed(key: string): void {
        if (key === MANAGED_APP_CONFIG_PREFIX || key.startsWith(`${MANAGED_APP_CONFIG_PREFIX}/`)) {
            throw new BadRequestException(MANAGED_APP_CONFIG_MUTATION_MESSAGE);
        }
    }

    private configEntrySortValue(entry: ConfigEntryRecord, sortBy: string): string {
        if (sortBy === 'value') return entry.value;
        if (sortBy === 'version') return String(entry.version ?? 0).padStart(20, '0');
        if (sortBy === 'revision') return String(entry.revision ?? 0).padStart(20, '0');
        return entry.key;
    }

    private normalizeSettings(input: DeepPartial<AppSettings>): AppSettings {
        const defaults = this.cloneDefaultSettings();
        const merged = this.deepMerge(defaults, input);
        const general = {
            ...merged.general,
            appName: this.normalizeAppName(merged.general.appName, defaults.general.appName),
        };
        const platform = this.normalizePlatformUrlSettings({
            ...merged.platform,
            appName: this.normalizeAppName(merged.platform.appName, general.appName ?? defaults.platform.appName),
            language: merged.platform.language ?? general.language ?? defaults.platform.language,
        });

        const assets = { ...merged.assets };
        const oauth = this.normalizeOAuthSettingsForStorage(merged.oauth);
        const storage = this.normalizeStorageSettings(merged.storage);
        return {
            platform,
            assets: {
                defaultVisibility: assets.defaultVisibility,
                maxUploadSizeMb: assets.maxUploadSizeMb,
                allowedKinds: assets.allowedKinds,
                requireActionsValidation: assets.requireActionsValidation,
                buildPackageOnActionsValidation: assets.buildPackageOnActionsValidation,
                keepSourceSnapshots: assets.keepSourceSnapshots,
            },
            packages: merged.packages,
            marketplace: merged.marketplace,
            runtime: merged.runtime,
            general,
            appearance: merged.appearance,
            editor: merged.editor,
            llm: merged.llm,
            ocr: this.normalizeOcrSettings(merged.ocr),
            search: merged.search,
            oauth,
            email: merged.email,
            notifications: merged.notifications,
            security: merged.security,
            network: merged.network,
            securityMonitor: merged.securityMonitor,
            storage,
            assistant: merged.assistant ?? {},
        };
    }

    private normalizeOcrSettings(input: OcrSettings | undefined): OcrSettings {
        const defaults = this.cloneValue(DEFAULT_SETTINGS.ocr);
        const source = input ?? defaults;
        const sourceBackends = Array.isArray(source.backends) && source.backends.length > 0 ? source.backends : defaults.backends;
        const backends = sourceBackends.map(backend => {
            const template =
                defaults.backends.find(item => item.name === backend.name && item.type === backend.type) ??
                defaults.backends.find(item => item.type === backend.type);
            return {
                ...(template ?? {}),
                ...backend,
                name: backend.name?.trim() || template?.name || 'custom-ocr',
                type: backend.type || template?.type || 'custom',
                enabled: Boolean(backend.enabled),
                baseUrl: backend.baseUrl?.trim() ?? template?.baseUrl ?? '',
                endpoint: backend.endpoint?.trim() ?? template?.endpoint ?? '',
                headers: this.isPlainObject(backend.headers) ? backend.headers : (template?.headers ?? {}),
                timeoutMs: backend.timeoutMs ?? template?.timeoutMs,
                model: backend.model?.trim() ?? template?.model ?? '',
                outputFormat: backend.outputFormat ?? template?.outputFormat ?? 'json',
                requestFormat: backend.requestFormat ?? template?.requestFormat ?? 'json-base64',
                options: this.isPlainObject(backend.options) ? backend.options : (template?.options ?? {}),
            };
        });
        const defaultBackend = backends.some(backend => backend.name === source.defaultBackend)
            ? source.defaultBackend
            : (backends.find(backend => backend.enabled)?.name ?? backends[0]?.name ?? '');
        return { defaultBackend, backends };
    }

    private normalizeOAuthSettingsForStorage(input: OAuthSettings): OAuthSettings {
        const normalized = {} as Record<OAuthProviderId, OAuthProviderSettings>;
        for (const provider of OAUTH_PROVIDER_IDS) {
            normalized[provider] = this.normalizeOAuthProviderForStorage(
                input[provider],
                this.oauthProviderFallback(provider),
            );
        }
        return {
            github: normalized.github,
        };
    }

    private oauthProviderFallback(provider: OAuthProviderId): OAuthProviderSettings {
        const defaults = OAUTH_PROVIDER_DEFAULTS[provider];
        return {
            enabled: false,
            clientId: '',
            clientSecret: '',
            callbackUrl: this.buildOAuthCallbackUrl(provider),
            scopes: [...defaults.defaultScopes],
        };
    }

    private normalizeOAuthProviderForStorage(
        input: OAuthSettings['github'] | undefined,
        fallback: Pick<OAuthProviderSettings, 'callbackUrl' | 'scopes'>,
    ): OAuthSettings['github'] {
        return {
            enabled: Boolean(input?.enabled),
            clientId: input?.clientId?.trim() || '',
            clientSecret: input?.clientSecret || '',
            callbackUrl: input?.callbackUrl?.trim() || fallback.callbackUrl,
            scopes: input?.scopes?.length ? input.scopes : fallback.scopes,
        };
    }

    private deepMerge<T>(target: T, source: DeepPartial<T>): T {
        if (!this.isPlainObject(target) || !this.isPlainObject(source)) {
            return this.cloneValue((source === undefined ? target : source) as T);
        }

        const merged: Record<string, unknown> = { ...(target as Record<string, unknown>) };
        for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
            if (value === undefined) continue;

            const currentValue = merged[key];
            merged[key] =
                this.isPlainObject(currentValue) && this.isPlainObject(value)
                    ? this.deepMerge(currentValue, value)
                    : this.cloneValue(value);
        }

        return merged as T;
    }

    private cloneValue<T>(value: T): T {
        if (Array.isArray(value)) {
            return value.map(item => this.cloneValue(item)) as T;
        }

        if (this.isPlainObject(value)) {
            const cloned: Record<string, unknown> = {};
            for (const [key, nestedValue] of Object.entries(value)) {
                cloned[key] = this.cloneValue(nestedValue);
            }
            return cloned as T;
        }

        return value;
    }

    private isPlainObject(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    private normalizeAppName(value: string | undefined, fallback: string | undefined): string | undefined {
        const candidate = value?.trim() || fallback;
        if (!candidate) return candidate;
        if (isDesktop() && /^internShannon(?:\s*OS)?$/i.test(candidate)) {
            return 'internShannon';
        }
        return candidate;
    }

    private localApiBaseUrl(): string {
        return `http://localhost:${process.env.APP_PORT || 29653}`;
    }

    private firstNonBlank(...values: Array<string | undefined>): string | undefined {
        return firstNonBlankValue(values);
    }
}
