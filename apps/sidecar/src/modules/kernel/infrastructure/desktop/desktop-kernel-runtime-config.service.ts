import { Inject, Injectable, Optional } from '@nestjs/common';
import { CONFIG_SERVICE, ConfigService } from '@/modules/config/domain/services/config-service.interface';
import { resolveModelLimit } from '@/shared/llm/model-limit-normalization';
import {
  IKernelRuntimeConfigService,
  KernelRuntimeModelProvider,
  KernelRuntimeModelsConfig,
} from '../../domain/services/kernel-runtime-config.service.interface';

export const DESKTOP_DEFAULT_STREAM_STALL_WARNING_MS = 30_000;
export const DESKTOP_DEFAULT_STREAM_STALL_HARD_MS = 300_000;
export const DESKTOP_DEFAULT_STREAM_STALL_ACTIVE_TOOL_HARD_MS = 600_000;
export const DESKTOP_DEFAULT_TOOL_TIMEOUT_MS = 300_000;
export const DESKTOP_DEFAULT_QUEUE_TIMEOUT_MS = 300_000;
export const DESKTOP_DEFAULT_MAX_EXECUTION_TIME_MS = 1_500_000;
export const DESKTOP_DEFAULT_MAX_STREAM_RETRIES = 0;

@Injectable()
export class DesktopKernelRuntimeConfigService
  implements IKernelRuntimeConfigService
{
  constructor(
    @Optional()
    @Inject(CONFIG_SERVICE)
    private readonly configService?: ConfigService,
  ) {}

  async getModelsConfig(): Promise<KernelRuntimeModelsConfig | null> {
    const settings = await this.configService?.getSettings();
    const llm = settings?.llm;
    const config: KernelRuntimeModelsConfig | null = llm
      ? {
          defaultModel: llm.defaultModel,
          providers: llm.providers.map(provider => ({
            name: provider.name,
            apiKey: provider.apiKey ?? null,
            baseUrl: provider.baseUrl ?? null,
            headers: provider.headers ?? null,
            sessionIdHeader: provider.sessionIdHeader ?? null,
            models: provider.models.map(model => ({
              id: model.id,
              name: model.name ?? model.id,
              family: model.family ?? '',
              apiKey: model.apiKey ?? null,
              baseUrl: model.baseUrl ?? null,
              headers: model.headers ?? null,
              sessionIdHeader: model.sessionIdHeader ?? null,
              attachment: model.attachment ?? null,
              reasoning: model.reasoning ?? null,
              toolCall: model.toolCall ?? null,
              temperature: model.temperature ?? null,
              limit: resolveModelLimit(model.id, model.limit),
            })),
          })) satisfies KernelRuntimeModelProvider[],
          mcpServers: llm.mcpServers,
          maxToolRounds: llm.maxToolRounds ?? null,
          thinkingBudget: llm.thinkingBudget ?? null,
          toolTimeoutMs: llm.toolTimeoutMs ?? null,
          queueTimeoutMs: llm.queueTimeoutMs ?? null,
          maxExecutionTimeMs: llm.maxExecutionTimeMs ?? null,
          streamStallWarningMs: llm.streamStallWarningMs ?? null,
          streamStallHardMs: llm.streamStallHardMs ?? null,
          streamStallActiveToolHardMs: llm.streamStallActiveToolHardMs ?? null,
          maxConsecutiveToolErrors: llm.maxConsecutiveToolErrors ?? null,
          maxStreamRetries: llm.maxStreamRetries ?? null,
        }
      : null;
    return this.withDesktopRuntimeDefaults(config);
  }

  private withDesktopRuntimeDefaults(
    config: KernelRuntimeModelsConfig | null,
  ): KernelRuntimeModelsConfig {
    return {
      ...(config ?? {}),
      defaultModel: config?.defaultModel ?? null,
      providers: config?.providers ?? [],
      mcpServers: config?.mcpServers ?? [],
      toolTimeoutMs:
        config?.toolTimeoutMs ?? DESKTOP_DEFAULT_TOOL_TIMEOUT_MS,
      queueTimeoutMs:
        config?.queueTimeoutMs ?? DESKTOP_DEFAULT_QUEUE_TIMEOUT_MS,
      maxExecutionTimeMs:
        config?.maxExecutionTimeMs ?? DESKTOP_DEFAULT_MAX_EXECUTION_TIME_MS,
      streamStallWarningMs:
        config?.streamStallWarningMs ?? DESKTOP_DEFAULT_STREAM_STALL_WARNING_MS,
      streamStallHardMs:
        config?.streamStallHardMs ?? DESKTOP_DEFAULT_STREAM_STALL_HARD_MS,
      streamStallActiveToolHardMs:
        config?.streamStallActiveToolHardMs ??
        DESKTOP_DEFAULT_STREAM_STALL_ACTIVE_TOOL_HARD_MS,
      maxStreamRetries:
        config?.maxStreamRetries ?? DESKTOP_DEFAULT_MAX_STREAM_RETRIES,
    };
  }
}
