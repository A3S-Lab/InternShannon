import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DesktopKernelService } from './desktop-kernel.service';
import { DesktopMessageRepository } from '../repositories/desktop-message.repository';

// Importing these classes type-checks their `implements IKernelService` /
// `implements IMessageRepository` clauses — i.e. it fails to compile if the
// interface methods are missing (the concurrent main break this guards against).
describe('desktop kernel interface implementations', () => {
    const mockDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-kernel-interface-'));
    const originalDataDir = process.env.INTERNSHANNON_DATA_DIR;

    beforeAll(() => {
        process.env.INTERNSHANNON_DATA_DIR = mockDataDir;
    });

    afterAll(() => {
        if (originalDataDir === undefined) {
            delete process.env.INTERNSHANNON_DATA_DIR;
        } else {
            process.env.INTERNSHANNON_DATA_DIR = originalDataDir;
        }
        fs.rmSync(mockDataDir, { recursive: true, force: true });
    });

    describe('DesktopKernelService.countUserSessions', () => {
        const make = () => {
            const sessionRepo = {
                countByUserId: jest.fn().mockResolvedValue(3),
                countAll: jest.fn().mockResolvedValue(7),
            };
            const svc = new DesktopKernelService(sessionRepo as never, {} as never);
            return { svc, sessionRepo };
        };

        it('counts the user scope by default (passes conversationalOnly through)', async () => {
            const { svc, sessionRepo } = make();
            expect(await svc.countUserSessions('u1', false, true)).toBe(3);
            expect(sessionRepo.countByUserId).toHaveBeenCalledWith('u1', true);
            expect(sessionRepo.countAll).not.toHaveBeenCalled();
        });

        it('counts all sessions when includeAllUsers is set', async () => {
            const { svc, sessionRepo } = make();
            expect(await svc.countUserSessions('u1', true, false)).toBe(7);
            expect(sessionRepo.countAll).toHaveBeenCalledWith(false);
        });

        it('falls back to the desktop user id when none given', async () => {
            const { svc, sessionRepo } = make();
            await svc.countUserSessions('');
            expect(sessionRepo.countByUserId).toHaveBeenCalledWith('desktop-user', undefined);
        });
    });

    describe('DesktopMessageRepository (file-backed, empty store)', () => {
        // Point desktop storage at a temp dir so the repository does not read
        // or mutate a developer's real local sidecar state.
        const repo = () => new DesktopMessageRepository();

        it('deleteBySessionId returns 0 for an unknown session', async () => {
            expect(await repo().deleteBySessionId('no-such-session')).toBe(0);
        });
    });
});
