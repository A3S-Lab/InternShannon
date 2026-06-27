import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { desktopJsonFilePath } from '../desktop-paths';

/**
 * File-backed app config repository for the desktop sidecar.
 * Stores desktop sidecar key/value config in a local JSON file.
 */
@Injectable()
export class AppConfigRepository {
  private readonly logger = new Logger(AppConfigRepository.name);
  private readonly configPath: string;
  private configCache: Record<string, string> = {};
  private cacheLoaded = false;

  constructor() {
    this.configPath = desktopJsonFilePath('app-config.json', this.logger);
  }

  private async loadConfig(): Promise<Record<string, string>> {
    if (this.cacheLoaded) {
      return this.configCache;
    }

    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        this.configCache = JSON.parse(content) as Record<string, string>;
      }
    } catch (error) {
      this.logger.warn(`Failed to load app config: ${error}`);
      this.configCache = {};
    }

    this.cacheLoaded = true;
    return this.configCache;
  }

  private async saveConfig(): Promise<void> {
    fs.writeFileSync(this.configPath, JSON.stringify(this.configCache, null, 2), 'utf-8');
  }

  async getValue(key: string): Promise<string | null> {
    const config = await this.loadConfig();
    return config[key] ?? null;
  }

  async setValue(key: string, value: string): Promise<void> {
    const config = await this.loadConfig();
    config[key] = value;
    this.configCache = config;
    await this.saveConfig();
  }
}
