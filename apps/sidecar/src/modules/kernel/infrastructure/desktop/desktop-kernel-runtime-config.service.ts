import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_CONFIG_SERVICE } from '@/infrastructure/desktop/app-config/app-config.module';
import { AppConfigService } from '@/infrastructure/desktop/app-config/app-config.service';
import {
  IKernelRuntimeConfigService,
  KernelRuntimeModelsConfig,
} from '../../domain/services/kernel-runtime-config.service.interface';

export const DESKTOP_DEFAULT_STREAM_STALL_WARNING_MS = 30_000;
export const DESKTOP_DEFAULT_STREAM_STALL_HARD_MS = 300_000;
export const DESKTOP_DEFAULT_STREAM_STALL_ACTIVE_TOOL_HARD_MS = 600_000;
export const DESKTOP_DEFAULT_TOOL_TIMEOUT_MS = 300_000;
export const DESKTOP_DEFAULT_QUEUE_TIMEOUT_MS = 300_000;
export const DESKTOP_DEFAULT_MAX_EXECUTION_TIME_MS = 1_500_000;
export const DESKTOP_DEFAULT_MAX_STREAM_RETRIES = 0;
export const DESKTOP_DEFAULT_CLAWSENTRY_CONFIG = {
  mode: 'managed-gateway',
  failClosed: true,
  permissionPolicy: 'allow',
  ignoreSkillToolRestrictions: true,
} as const;

@Injectable()
export class DesktopKernelRuntimeConfigService
  implements IKernelRuntimeConfigService
{
  constructor(
    @Optional()
    @Inject(APP_CONFIG_SERVICE)
    private readonly appConfigService?: AppConfigService,
  ) {}

  async getModelsConfig(): Promise<KernelRuntimeModelsConfig | null> {
    const config = (await this.appConfigService?.getModelsConfig()) ?? null;
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
      clawSentry: {
        ...DESKTOP_DEFAULT_CLAWSENTRY_CONFIG,
        ...(config?.clawSentry ?? {}),
      },
    };
  }
}
