import type { AppConfigRepository } from './app-config.repository';
import { AppConfigService } from './app-config.service';
import type { ModelConfig, ModelsConfig } from './app-config.service';

describe('AppConfigService', () => {
  let stored: Record<string, string>;
  let repo: jest.Mocked<AppConfigRepository>;
  let service: AppConfigService;

  beforeEach(() => {
    stored = {};
    repo = {
      getValue: jest.fn(async key => stored[key] ?? null),
      setValue: jest.fn(async (key, value) => {
        stored[key] = value;
      }),
    } as unknown as jest.Mocked<AppConfigRepository>;
    service = new AppConfigService(repo);
  });

  it('normalizes legacy model limits when reading persisted models config', async () => {
    stored.models = JSON.stringify(
      makeModelsConfig([
        {
          id: 'gpt-5.5',
          name: 'GPT-5.5',
          limit: { context: 128000, output: 4096 },
        },
      ]),
    );

    const config = await service.getModelsConfig();

    expect(config?.providers[0].models[0].limit).toEqual({ context: 258000, output: 128000 });
  });

  it('normalizes model limits before writing models config', async () => {
    await service.setModelsConfig(
      makeModelsConfig([
        {
          id: 'custom-frontier',
          name: 'Custom Frontier',
          limit: { context: '200000', output: '4096' } as unknown as ModelConfig['limit'],
        },
        {
          id: 'gemini-2.5-pro',
          name: 'Gemini 2.5 Pro',
          limit: null as unknown as ModelConfig['limit'],
        },
      ]),
    );

    const written = JSON.parse(stored.models) as ModelsConfig;

    expect(written.providers[0].models[0].limit).toEqual({ context: 200000, output: 65536 });
    expect(written.providers[0].models[1].limit).toEqual({ context: 258000, output: 65536 });
  });
});

function makeModelsConfig(models: Array<Partial<ModelConfig> & Pick<ModelConfig, 'id' | 'name'>>): ModelsConfig {
  return {
    defaultModel: `openai/${models[0].id}`,
    providers: [
      {
        name: 'openai',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.com/v1',
        headers: {},
        sessionIdHeader: null,
        models: models.map(model => ({
          family: '',
          apiKey: '',
          baseUrl: '',
          headers: {},
          sessionIdHeader: null,
          attachment: false,
          reasoning: false,
          toolCall: true,
          temperature: true,
          releaseDate: null,
          modalities: { input: ['text'], output: ['text'] },
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          limit: { context: 128000, output: 65536 },
          ...model,
        })),
      },
    ],
    storageBackend: 'file',
    sessionsDir: '',
    skillDirs: [],
    agentDirs: [],
    maxToolRounds: null,
    thinkingBudget: null,
    mcpServers: [],
  };
}
