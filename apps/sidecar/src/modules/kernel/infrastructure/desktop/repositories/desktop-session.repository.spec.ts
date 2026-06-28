import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-session-repo-'));

jest.mock('@/shared/infrastructure/desktop/desktop-paths', () => ({
    desktopJsonFilePath: (filename: string) => path.join(mockDataDir, filename),
}));

import { DesktopSessionRepository } from './desktop-session.repository';

describe('DesktopSessionRepository', () => {
    afterAll(() => {
        fs.rmSync(mockDataDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        fs.rmSync(path.join(mockDataDir, 'sessions.json'), { force: true });
    });

    it('skips malformed persisted records without discarding valid sessions', async () => {
        fs.writeFileSync(
            path.join(mockDataDir, 'sessions.json'),
            JSON.stringify(
                [
                    null,
                    { id: '', title: 'missing id' },
                    {
                        id: 'session-1',
                        agentId: 'default',
                        userId: 'desktop-user',
                        title: 'Recovered session',
                        cwd: '/tmp/workspace',
                        status: 'active',
                        createdAt: '2026-01-01T00:00:00.000Z',
                        updatedAt: '2026-01-01T00:01:00.000Z',
                    },
                ],
                null,
                2,
            ),
            'utf-8',
        );
        const repo = new DesktopSessionRepository();

        await expect(repo.findById('session-1')).resolves.toEqual(
            expect.objectContaining({
                id: 'session-1',
                title: 'Recovered session',
                cwd: '/tmp/workspace',
            }),
        );
        await expect(repo.findAll()).resolves.toHaveLength(1);
    });
});
