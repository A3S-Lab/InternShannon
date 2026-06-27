import { DesktopKernelService } from './desktop-kernel.service';
import { DesktopMessageRepository } from './desktop-message.repository';

// Importing these classes type-checks their `implements IKernelService` /
// `implements IMessageRepository` clauses — i.e. it fails to compile if the
// interface methods are missing (the concurrent main break this guards against).
describe('desktop kernel interface implementations', () => {
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
        // Constructor only derives a json path; loadMessages tolerates a missing
        // file (→ empty cache), so these run without touching real desktop state.
        const repo = () => new DesktopMessageRepository();

        it('deleteBySessionId returns 0 for an unknown session', async () => {
            expect(await repo().deleteBySessionId('no-such-session')).toBe(0);
        });
    });
});
