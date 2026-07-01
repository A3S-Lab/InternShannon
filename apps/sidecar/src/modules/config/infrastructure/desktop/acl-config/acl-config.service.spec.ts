import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AclConfigService } from './acl-config.service';
import { AppConfigService } from '../app-config/app-config.service';
import { ConfigService } from '@/modules/config/domain/services/config-service.interface';
import { AppSettings } from '@/modules/config/domain/services/settings-schema';

describe('AclConfigService', () => {
  let tempDir: string;
  const originalAclPath = process.env.A3S_CONFIG_ACL;
  const originalForceSync = process.env.A3S_FORCE_CONFIG_ACL_SYNC;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acl-config-service-'));
    process.env.A3S_CONFIG_ACL = path.join(tempDir, 'config.acl');
    process.env.NODE_ENV = 'development';
    delete process.env.A3S_FORCE_CONFIG_ACL_SYNC;
    fs.writeFileSync(
      process.env.A3S_CONFIG_ACL,
      `
default_model = "remote/remote-model"

providers "remote" {
  apiKey = "remote-key"
  baseUrl = "https://remote.example/v1"

  models "remote-model" {
    name = "Remote Model"
  }
}
`,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    restoreEnv('A3S_CONFIG_ACL', originalAclPath);
    restoreEnv('A3S_FORCE_CONFIG_ACL_SYNC', originalForceSync);
    restoreEnv('NODE_ENV', originalNodeEnv);
  });

  it('keeps existing local AI settings instead of overwriting them from config.acl', async () => {
    const existingSettings = makeSettings({
      defaultModel: 'local/local-model',
      providers: [
        {
          name: 'local',
          apiKey: 'local-key',
          baseUrl: 'https://local.example/v1',
          models: [
            {
              id: 'local-model',
              name: 'Local Model',
              attachment: false,
              reasoning: false,
              toolCall: true,
              temperature: true,
            },
          ],
        },
      ],
    });
    const { service, configService, appConfigService } = makeService(existingSettings);

    await service.syncFromAclConfig();

    expect(configService.patchSettings).not.toHaveBeenCalled();
    expect(appConfigService.updateModelsConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: 'local/local-model',
        providers: existingSettings.llm.providers,
      }),
    );
  });

  it('bootstraps from config.acl when no local providers exist yet', async () => {
    const { service, configService, appConfigService } = makeService(
      makeSettings({ defaultModel: '', providers: [] }),
    );

    await service.syncFromAclConfig();

    expect(configService.patchSettings).toHaveBeenCalledWith({
      llm: expect.objectContaining({
        defaultModel: 'remote/remote-model',
        providers: [
          expect.objectContaining({
            name: 'remote',
            apiKey: 'remote-key',
            baseUrl: 'https://remote.example/v1',
            models: [
              expect.objectContaining({
                id: 'remote-model',
                name: 'Remote Model',
                limit: { context: 128000, output: 65536 },
              }),
            ],
          }),
        ],
      }),
    });
    expect(appConfigService.updateModelsConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: 'remote/remote-model',
        providers: expect.arrayContaining([expect.objectContaining({ name: 'remote' })]),
      }),
    );
  });

  it('overwrites local settings only when ACL sync is explicitly forced', async () => {
    process.env.A3S_FORCE_CONFIG_ACL_SYNC = 'true';
    const { service, configService } = makeService(
      makeSettings({
        defaultModel: 'local/local-model',
        providers: [
          {
            name: 'local',
            apiKey: 'local-key',
            baseUrl: 'https://local.example/v1',
            models: [
              {
                id: 'local-model',
                name: 'Local Model',
                attachment: false,
                reasoning: false,
                toolCall: true,
                temperature: true,
              },
            ],
          },
        ],
      }),
    );

    await service.syncFromAclConfig();

    expect(configService.patchSettings).toHaveBeenCalledWith({
      llm: expect.objectContaining({
        defaultModel: 'remote/remote-model',
        providers: [expect.objectContaining({ name: 'remote' })],
      }),
    });
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function makeService(existingSettings: AppSettings) {
  const configService = {
    getSettings: jest.fn().mockResolvedValue(existingSettings),
    patchSettings: jest.fn(async (patch) => ({ ...existingSettings, ...patch })),
  } as unknown as jest.Mocked<ConfigService>;
  const appConfigService = {
    updateModelsConfig: jest.fn(),
  } as unknown as jest.Mocked<AppConfigService>;
  return {
    service: new AclConfigService(configService, appConfigService),
    configService,
    appConfigService,
  };
}

function makeSettings(input: AppSettings['llm']): AppSettings {
  return ({
    llm: {
      defaultModel: input.defaultModel,
      providers: input.providers,
      mcpServers: [],
    },
  } as unknown) as AppSettings;
}
