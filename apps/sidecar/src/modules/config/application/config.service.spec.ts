import type {
    ConfigEntryRecord,
    IConfigRepository,
} from '../domain/repositories/config-repository.interface';
import { ConfigServiceImpl } from './config.service';

class MemoryConfigRepository implements IConfigRepository {
    private readonly values = new Map<string, string>();

    constructor(initial: Record<string, string>) {
        for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
    }

    async getValue(key: string): Promise<string | null> {
        return this.values.get(key) ?? null;
    }

    async setValue(key: string, value: string): Promise<void> {
        this.values.set(key, value);
    }

    async deleteValue(key: string): Promise<void> {
        this.values.delete(key);
    }

    async getAllValues(): Promise<Record<string, string>> {
        return Object.fromEntries(this.values);
    }

    async getEntries(prefix = ''): Promise<ConfigEntryRecord[]> {
        return Array.from(this.values)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({ key, value }));
    }
}

describe('ConfigServiceImpl legacy built-in plugin migration', () => {

    it.each(['dark', 'system'])('normalizes and persists legacy %s appearance as light', async theme => {
        const repository = new MemoryConfigRepository({
            appearance: JSON.stringify({
                theme,
                sideBarPosition: 'left',
                statusBar: true,
                activityBar: true,
                zoomLevel: 1,
            }),
        });
        const service = new ConfigServiceImpl(repository);

        const settings = await service.getSettings();
        const persisted = JSON.parse((await repository.getValue('appearance')) ?? '{}');

        expect(settings.appearance.theme).toBe('light');
        expect(persisted.theme).toBe('light');
    });

    it('replaces the old CDN-backed built-in plugin and persists the safe template', async () => {
        const legacyHtml = '<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>';
        const repository = new MemoryConfigRepository({
            platform: JSON.stringify({
                language: 'zh-CN',
                registrationMode: 'inviteOnly',
                maintenanceMode: false,
                menuPlugins: [
                    {
                        id: 'example-plugin',
                        name: '示例插件',
                        html: legacyHtml,
                        enabled: true,
                        builtin: true,
                    },
                    {
                        id: 'custom-plugin',
                        name: '自定义插件',
                        html: '<script src="https://unpkg.com/custom.js"></script>',
                        enabled: true,
                    },
                ],
            }),
        });
        const service = new ConfigServiceImpl(repository);

        const settings = await service.getSettings();
        const builtin = settings.platform.menuPlugins?.find(plugin => plugin.id === 'example-plugin');
        const custom = settings.platform.menuPlugins?.find(plugin => plugin.id === 'custom-plugin');
        const persisted = JSON.parse((await repository.getValue('platform')) ?? '{}');

        expect(builtin?.html).not.toMatch(/https:\/\/unpkg\.com/);
        expect(builtin?.html).toContain('不依赖公网 CDN');
        expect(custom?.html).toContain('https://unpkg.com/custom.js');
        expect(persisted.menuPlugins[0].html).toBe(builtin?.html);
    });
});
