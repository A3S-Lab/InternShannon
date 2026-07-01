import type { ConfigService } from '@/modules/config/domain/services/config-service.interface';
import type { AppSettings } from '@/modules/config/domain/services/settings-schema';
import { DesktopKernelRuntimeConfigService } from './desktop-kernel-runtime-config.service';

describe('DesktopKernelRuntimeConfigService', () => {
  it('normalizes legacy model limits before exposing runtime config', async () => {
    const configService = {
      getSettings: jest.fn().mockResolvedValue({
        llm: {
          defaultModel: 'openai/gpt-5.5',
          providers: [
            {
              name: 'openai',
              apiKey: 'openai-key',
              baseUrl: 'https://api.openai.com/v1',
              headers: {},
              models: [
                {
                  id: 'gpt-5.5',
                  name: 'GPT-5.5',
                  family: 'openai',
                  limit: { context: 128000, output: 4096 },
                },
              ],
            },
          ],
          mcpServers: [],
        },
      } as AppSettings),
    } as unknown as jest.Mocked<ConfigService>;
    const service = new DesktopKernelRuntimeConfigService(configService);

    const runtimeConfig = await service.getModelsConfig();

    expect(runtimeConfig?.providers?.[0]?.models?.[0]?.limit).toEqual({ context: 258000, output: 128000 });
  });
});
