import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Message } from '@/modules/kernel/domain/entities/message.entity';

const mockDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-message-repo-'));

jest.mock('@/shared/infrastructure/desktop/desktop-paths', () => ({
    desktopJsonFilePath: (filename: string) => path.join(mockDataDir, filename),
}));

import { DesktopMessageRepository } from './desktop-message.repository';

describe('DesktopMessageRepository', () => {
    afterAll(() => {
        fs.rmSync(mockDataDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        fs.rmSync(path.join(mockDataDir, 'messages.json'), { force: true });
    });

    it('deletes all messages for one desktop session', async () => {
        const repo = new DesktopMessageRepository();
        await repo.save(message('m1', 's1'));
        await repo.save(message('m2', 's1'));
        await repo.save(message('m3', 's2'));

        await expect(repo.deleteBySessionId('s1')).resolves.toBe(2);

        await expect(repo.findBySessionId('s1')).resolves.toEqual([]);
        await expect(repo.findBySessionId('s2')).resolves.toHaveLength(1);
    });

    it('skips malformed persisted buckets without discarding valid session messages', async () => {
        fs.writeFileSync(
            path.join(mockDataDir, 'messages.json'),
            JSON.stringify(
                {
                    broken: { id: 'not-an-array' },
                    s1: [
                        {
                            id: 'm1',
                            sessionId: 's1',
                            role: 'user',
                            content: 'remember me',
                            createdAt: '2026-01-01T00:00:00.000Z',
                        },
                    ],
                },
                null,
                2,
            ),
            'utf-8',
        );
        const repo = new DesktopMessageRepository();

        await expect(repo.findBySessionId('s1')).resolves.toHaveLength(1);
        await expect(repo.findBySessionId('s1')).resolves.toEqual([
            expect.objectContaining({ id: 'm1', content: 'remember me' }),
        ]);
        await expect(repo.findBySessionId('broken')).resolves.toEqual([]);
    });

    it('repairs invalid persisted timestamps so future saves keep working', async () => {
        fs.writeFileSync(
            path.join(mockDataDir, 'messages.json'),
            JSON.stringify(
                {
                    s1: [
                        {
                            id: 'legacy-invalid-date',
                            sessionId: 's1',
                            role: 'assistant',
                            content: 'old message',
                            createdAt: 'not-a-date',
                        },
                    ],
                },
                null,
                2,
            ),
            'utf-8',
        );
        const repo = new DesktopMessageRepository();

        const [loaded] = await repo.findBySessionId('s1');

        expect(Number.isFinite(loaded?.createdAt.getTime())).toBe(true);
        await expect(repo.save(message('new-message', 's1', 'user', 'new message'))).resolves.toBeUndefined();
        await expect(repo.findBySessionId('s1')).resolves.toHaveLength(2);
    });
});

function message(
    id: string,
    sessionId: string,
    role: 'user' | 'assistant' | 'system' = 'user',
    content = 'content',
    source?: string,
    createdAt = new Date('2026-01-01T00:00:00Z'),
): Message {
    return new Message(id, sessionId, role, content, source ? { source } : {}, createdAt);
}
