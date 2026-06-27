import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { desktopJsonFilePath } from '@/infrastructure/desktop/desktop-paths';
import { ConfigEntryRecord, IConfigRepository } from '../../domain/repositories/config-repository.interface';

/**
 * VSCode-style JSON file config repository for desktop.
 * Config is stored in ~/.internshannon/config.json
 */
@Injectable()
export class FileConfigRepository implements IConfigRepository {
  private readonly logger = new Logger(FileConfigRepository.name);
  private readonly configPath: string;
  private configCache: Record<string, string> = {};
  private cacheLoaded = false;

  constructor() {
    this.configPath = desktopJsonFilePath('config.json', this.logger);
  }

  private storageKey(key: string): string {
    const normalized = key.trim().replace(/^\/+/, '');
    return normalized.startsWith('config/') ? normalized : `config/app/${normalized}`;
  }

  private legacyStorageKey(key: string): string {
    return key.trim().replace(/^\/+/, '');
  }

  private async loadConfig(): Promise<Record<string, string>> {
    if (this.cacheLoaded) {
      return this.configCache;
    }

    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        this.configCache = JSON.parse(content);
        this.logger.debug(`Loaded config from: ${this.configPath}`);
      }
    } catch (e) {
      this.logger.warn(`Failed to load config: ${e}`);
      this.configCache = {};
    }

    this.cacheLoaded = true;
    return this.configCache;
  }

  private async saveConfig(): Promise<void> {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.configCache, null, 2), 'utf-8');
      this.logger.debug(`Saved config to: ${this.configPath}`);
    } catch (e) {
      this.logger.error(`Failed to save config: ${e}`);
      throw e;
    }
  }

  async getValue(key: string): Promise<string | null> {
    const config = await this.loadConfig();
    const storageKey = this.storageKey(key);
    const value = config[storageKey];
    if (value !== undefined) return value;

    const legacyKey = this.legacyStorageKey(key);
    return legacyKey === storageKey ? null : (config[legacyKey] ?? null);
  }

  async setValue(key: string, value: string): Promise<void> {
    const config = await this.loadConfig();
    const storageKey = this.storageKey(key);
    config[storageKey] = value;
    const legacyKey = this.legacyStorageKey(key);
    if (legacyKey !== storageKey) {
      delete config[legacyKey];
    }
    this.configCache = config;
    await this.saveConfig();
  }

  async deleteValue(key: string): Promise<void> {
    const config = await this.loadConfig();
    delete config[this.storageKey(key)];
    delete config[this.legacyStorageKey(key)];
    this.configCache = config;
    await this.saveConfig();
  }

  async getAllValues(): Promise<Record<string, string>> {
    return this.loadConfig();
  }

  async getEntries(prefix = ''): Promise<ConfigEntryRecord[]> {
    const config = await this.loadConfig();
    return Object.entries(config)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value }));
  }

  async getRawValue(key: string): Promise<string | null> {
    return this.getValue(key);
  }

  async setRawValue(key: string, value: string): Promise<void> {
    await this.setValue(key, value);
  }

  async deleteRawValue(key: string): Promise<void> {
    await this.deleteValue(key);
  }
}
