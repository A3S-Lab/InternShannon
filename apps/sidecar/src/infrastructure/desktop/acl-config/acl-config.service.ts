import { Injectable, OnModuleInit, Logger, Inject, Optional } from '@nestjs/common';
import { parse } from '@a3s-lab/acl';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_SERVICE } from '../../../modules/config/domain/services/config-service.interface';
import { ConfigService } from '../../../modules/config/domain/services/config-service.interface';
import { APP_CONFIG_SERVICE } from '../app-config/app-config.module';
import { AppConfigService, ModelProvider, ModelConfig } from '../app-config/app-config.service';

@Injectable()
export class AclConfigService implements OnModuleInit {
  private readonly logger = new Logger(AclConfigService.name);

  constructor(
    @Inject(CONFIG_SERVICE) private readonly configService: ConfigService,
    @Optional()
    @Inject(APP_CONFIG_SERVICE)
    private readonly appConfigService?: AppConfigService,
  ) {}

  async onModuleInit() {
    // Only sync ACL config in development mode
    if (!this.isDevelopment()) {
      return;
    }
    await this.syncFromAclConfig();
  }

  private isDevelopment(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  async syncFromAclConfig() {
    const configPath = this.findConfigAcl();
    if (!configPath) {
      this.logger.warn('config.acl not found, skipping ACL config sync');
      return;
    }

    this.logger.log(`Loading ACL config from ${configPath}`);

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const doc = parse(content);

      const { providers, defaultModel } = this.extractProvidersAndDefault(doc);

      if (providers.length === 0) {
        this.logger.warn('No providers found in config.acl');
        return;
      }

      // Get existing settings via ConfigService to ensure proper format
      const existingSettings = await this.configService.getSettings();

      const hasLocalProviders = (existingSettings.llm.providers ?? []).length > 0;
      const aclSyncMode = process.env.A3S_FORCE_CONFIG_ACL_SYNC?.trim().toLowerCase();
      const shouldForceSyncFromAcl = this.isDevelopment() && aclSyncMode === 'true';
      const shouldSkipAclSync =
        aclSyncMode === 'false' || (!shouldForceSyncFromAcl && hasLocalProviders);

      if (shouldSkipAclSync) {
        await this.appConfigService?.updateModelsConfig({
          defaultModel: existingSettings.llm.defaultModel,
          providers: existingSettings.llm.providers,
          storageBackend: undefined,
          sessionsDir: '',
          skillDirs: [],
          agentDirs: [],
          maxToolRounds: existingSettings.llm.maxToolRounds ?? null,
          thinkingBudget: existingSettings.llm.thinkingBudget ?? null,
          mcpServers: existingSettings.llm.mcpServers || [],
        });
        this.logger.log('Skipping config.acl sync and keeping current local AI settings');
        return;
      }

      // Merge AI settings
      const aiSettings = {
        defaultModel: defaultModel || existingSettings?.llm?.defaultModel || '',
        providers,
        mcpServers: existingSettings?.llm?.mcpServers || [],
        maxToolRounds: existingSettings?.llm?.maxToolRounds || undefined,
        thinkingBudget: existingSettings?.llm?.thinkingBudget || undefined,
      };

      // Use patchSettings to properly persist through FileConfigRepository
      await this.configService.patchSettings({ llm: aiSettings as any });
      await this.appConfigService?.updateModelsConfig({
        defaultModel: aiSettings.defaultModel,
        providers,
      });
      this.logger.log(
        shouldForceSyncFromAcl
          ? `Synced ${providers.length} providers from config.acl`
          : `Bootstrapped ${providers.length} providers from config.acl`,
      );
    } catch (error) {
      this.logger.error(`Failed to sync ACL config: ${error}`);
    }
  }

  private findConfigAcl(): string | null {
    const candidates = this.configAclCandidates();
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private configAclCandidates(): string[] {
    const candidates: string[] = [];
    const add = (candidate?: string | null) => {
      if (!candidate) return;
      const resolved = path.resolve(candidate);
      if (!candidates.includes(resolved)) {
        candidates.push(resolved);
      }
    };

    add(process.env.A3S_CONFIG_ACL);
    add(process.env.CONFIG_ACL_PATH);
    add(path.join(process.cwd(), 'config.acl'));
    add(path.join(process.cwd(), 'apps/api/config.acl'));

    let current = __dirname;
    while (true) {
      add(path.join(current, 'config.acl'));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    try {
      const packageRoot = path.dirname(require.resolve('../../../../package.json'));
      add(path.join(packageRoot, 'config.acl'));
    } catch {
      // In ts-node development mode the relative package.json path may not exist.
    }

    return candidates;
  }

  private extractProvidersAndDefault(doc: any): { providers: ModelProvider[]; defaultModel: string | null } {
    const providers: ModelProvider[] = [];
    let defaultModel: string | null = null;

    for (const block of doc.blocks) {
      if (block.name === 'default_model') {
        const attr = block.attributes.get('default_model');
        if (attr && attr.kind === 'String') {
          defaultModel = attr.value;
        }
      } else if (block.name === 'providers') {
        // This is a labeled provider block
        for (const label of block.labels) {
          const provider = this.parseProviderBlock(label, block);
          providers.push(provider);
        }
      }
    }

    return { providers, defaultModel: this.normalizeDefaultModel(defaultModel, providers) };
  }

  private normalizeDefaultModel(rawDefaultModel: string | null, providers: ModelProvider[]): string | null {
    if (!rawDefaultModel) {
      return null;
    }

    const trimmed = rawDefaultModel.trim();
    if (!trimmed) return null;

    if (trimmed.includes('/')) {
      const slashIndex = trimmed.indexOf('/');
      const providerName = trimmed.slice(0, slashIndex);
      const modelId = trimmed.slice(slashIndex + 1);
      const hasProvider = providers.some((provider) => provider.name === providerName);
      const hasModel = providers.some(
        (provider) =>
          provider.name === providerName &&
          provider.models.some((model) => model.id === modelId),
      );
      if (hasProvider && hasModel) {
        return `${providerName}/${modelId}`;
      }
      if (!hasProvider) {
        const provider = providers.find((item) =>
          item.models.some((model) => model.id === trimmed),
        );
        if (provider) {
          return `${provider.name}/${trimmed}`;
        }
      }
      const slashSuffixIndex = trimmed.lastIndexOf('/');
      if (slashSuffixIndex >= 0 && slashSuffixIndex + 1 < trimmed.length) {
        const fallbackModelId = trimmed.slice(slashSuffixIndex + 1);
        const provider = providers.find((item) =>
          item.models.some((model) => model.id === fallbackModelId),
        );
        if (provider) {
          return `${provider.name}/${fallbackModelId}`;
        }
      }
      return trimmed;
    }

    const provider = providers.find((item) =>
      item.models.some((model) => model.id === trimmed),
    );
    if (provider) {
      return `${provider.name}/${trimmed}`;
    }

    return null;
  }

  private parseProviderBlock(name: string, block: any): ModelProvider {
    const attrs = block.attributes;

    const provider: ModelProvider = {
      name,
      apiKey: this.extractString(attrs.get('apiKey')),
      baseUrl: this.extractString(attrs.get('baseUrl')) ?? '',
      headers: this.extractObject(attrs.get('headers')) ?? {},
      sessionIdHeader: this.extractString(attrs.get('sessionIdHeader')),
      models: [],
    };

    // Parse nested models blocks
    for (const nested of block.blocks) {
      if (nested.name === 'models') {
        for (const modelLabel of nested.labels) {
          const model = this.parseModelBlock(modelLabel, nested);
          provider.models.push(model);
        }
      }
    }

    return provider;
  }

  private parseModelBlock(id: string, block: any): ModelConfig {
    const attrs = block.attributes;

    return {
      id,
      name: this.extractString(attrs.get('name')) ?? id,
      family: this.extractString(attrs.get('family')) ?? '',
      apiKey: this.extractString(attrs.get('apiKey')) ?? '',
      baseUrl: this.extractString(attrs.get('baseUrl')) ?? '',
      headers: this.extractObject(attrs.get('headers')) ?? {},
      sessionIdHeader: this.extractString(attrs.get('sessionIdHeader')),
      attachment: this.extractBoolean(attrs.get('attachment')) ?? false,
      reasoning: this.extractBoolean(attrs.get('reasoning')) ?? false,
      toolCall: this.extractBoolean(attrs.get('toolCall')) ?? true,
      temperature: this.extractBoolean(attrs.get('temperature')) ?? true,
      releaseDate: this.extractString(attrs.get('releaseDate')),
      modalities: this.extractObject(attrs.get('modalities')) ?? { input: ['text'], output: ['text'] },
      cost: this.extractObject(attrs.get('cost')) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      limit: this.extractObject(attrs.get('limit')) ?? { context: 128000, output: 4096 },
    };
  }

  private extractString(attr: any): string | null {
    if (!attr) return null;
    if (attr.kind === 'String') return attr.value;
    return null;
  }

  private extractBoolean(attr: any): boolean | null {
    if (!attr) return null;
    if (attr.kind === 'Bool') return attr.value;
    return null;
  }

  private extractObject(attr: any): any | null {
    if (!attr) return null;
    if (attr.kind === 'Object') {
      const obj: any = {};
      for (const [k, v] of attr.pairs) {
        obj[k] = this.extractValue(v);
      }
      return obj;
    }
    return null;
  }

  private extractValue(attr: any): any {
    if (!attr) return null;
    switch (attr.kind) {
      case 'String':
        return attr.value;
      case 'Number':
        return attr.value;
      case 'Bool':
        return attr.value;
      case 'Null':
        return null;
      case 'List':
        return attr.items.map((item: any) => this.extractValue(item));
      case 'Object':
        return this.extractObject(attr);
      default:
        return null;
    }
  }
}
