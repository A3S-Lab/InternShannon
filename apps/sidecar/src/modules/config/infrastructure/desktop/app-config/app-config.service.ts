import { Injectable } from '@nestjs/common';
import { resolveModelLimit } from '@/shared/llm/model-limit-normalization';
import { AppConfigRepository } from './app-config.repository';

export interface ModelProvider {
  name: string;
  apiKey: string | null;
  baseUrl: string;
  headers: Record<string, string>;
  sessionIdHeader: string | null;
  models: ModelConfig[];
}

export interface ModelConfig {
  id: string;
  name: string;
  family: string;
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
  sessionIdHeader: string | null;
  attachment: boolean;
  reasoning: boolean;
  toolCall: boolean;
  temperature: boolean;
  releaseDate: string | null;
  modalities: { input: string[]; output: string[] };
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  limit: { context: number; output: number };
}

export interface ModelsConfig {
  defaultModel: string | null;
  providers: ModelProvider[];
  storageBackend: string;
  sessionsDir: string;
  skillDirs: string[];
  agentDirs: string[];
  maxToolRounds: number | null;
  thinkingBudget: number | null;
  toolTimeoutMs?: number | null;
  queueTimeoutMs?: number | null;
  maxExecutionTimeMs?: number | null;
  streamStallWarningMs?: number | null;
  streamStallHardMs?: number | null;
  streamStallActiveToolHardMs?: number | null;
  maxConsecutiveToolErrors?: number | null;
  maxStreamRetries?: number | null;
  mcpServers: unknown[];
}

@Injectable()
export class AppConfigService {
  constructor(private readonly repo: AppConfigRepository) {}

  async getModelsConfig(): Promise<ModelsConfig | null> {
    const value = await this.repo.getValue('models');
    if (!value) return null;
    try {
      return this.normalizeModelsConfig(JSON.parse(value) as ModelsConfig);
    } catch {
      return null;
    }
  }

  async setModelsConfig(config: ModelsConfig): Promise<void> {
    await this.repo.setValue('models', JSON.stringify(this.normalizeModelsConfig(config)));
  }

  async updateModelsConfig(patch: {
    defaultModel?: string;
    providers?: unknown[];
    storageBackend?: string;
    sessionsDir?: string;
    skillDirs?: string[];
    agentDirs?: string[];
    maxToolRounds?: number | null;
    thinkingBudget?: number | null;
    toolTimeoutMs?: number | null;
    queueTimeoutMs?: number | null;
    maxExecutionTimeMs?: number | null;
    streamStallWarningMs?: number | null;
    streamStallHardMs?: number | null;
    streamStallActiveToolHardMs?: number | null;
    maxConsecutiveToolErrors?: number | null;
    maxStreamRetries?: number | null;
    mcpServers?: unknown[];
  }): Promise<void> {
    const current = await this.getModelsConfig();
    const updated: ModelsConfig = {
      defaultModel: patch.defaultModel ?? current?.defaultModel ?? null,
      providers: (patch.providers ?? current?.providers ?? []) as ModelProvider[],
      storageBackend: patch.storageBackend ?? current?.storageBackend ?? 'file',
      sessionsDir: patch.sessionsDir ?? current?.sessionsDir ?? '',
      skillDirs: patch.skillDirs ?? current?.skillDirs ?? [],
      agentDirs: patch.agentDirs ?? current?.agentDirs ?? [],
      maxToolRounds: patch.maxToolRounds ?? current?.maxToolRounds ?? null,
      thinkingBudget: patch.thinkingBudget ?? current?.thinkingBudget ?? null,
      toolTimeoutMs: patch.toolTimeoutMs ?? current?.toolTimeoutMs ?? null,
      queueTimeoutMs: patch.queueTimeoutMs ?? current?.queueTimeoutMs ?? null,
      maxExecutionTimeMs: patch.maxExecutionTimeMs ?? current?.maxExecutionTimeMs ?? null,
      streamStallWarningMs: patch.streamStallWarningMs ?? current?.streamStallWarningMs ?? null,
      streamStallHardMs: patch.streamStallHardMs ?? current?.streamStallHardMs ?? null,
      streamStallActiveToolHardMs: patch.streamStallActiveToolHardMs ?? current?.streamStallActiveToolHardMs ?? null,
      maxConsecutiveToolErrors: patch.maxConsecutiveToolErrors ?? current?.maxConsecutiveToolErrors ?? null,
      maxStreamRetries: patch.maxStreamRetries ?? current?.maxStreamRetries ?? null,
      mcpServers: patch.mcpServers ?? current?.mcpServers ?? [],
    };
    await this.setModelsConfig(updated);
  }

  private normalizeModelsConfig(config: ModelsConfig): ModelsConfig {
    return {
      ...config,
      providers: (config.providers ?? []).map(provider => ({
        ...provider,
        models: (provider.models ?? []).map(model => ({
          ...model,
          limit: resolveModelLimit(model.id, model.limit),
        })),
      })),
    };
  }
}
