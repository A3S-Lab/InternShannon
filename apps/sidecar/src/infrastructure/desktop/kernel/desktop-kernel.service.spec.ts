import { DesktopKernelService } from './desktop-kernel.service';

describe('DesktopKernelService', () => {
    function service() {
        const sessionRepo = {
            findById: jest.fn(),
            findAll: jest.fn(async () => []),
            save: jest.fn(),
            delete: jest.fn(),
            findByUserId: jest.fn(async () => []),
            findByUserIdPaginated: jest.fn(async () => []),
            countByUserId: jest.fn(async () => 3),
            findAllPaginated: jest.fn(async () => []),
            countAll: jest.fn(async () => 7),
            findByCreationRequest: jest.fn(),
            findActiveByUserId: jest.fn(),
        };
        const messageRepo = {
            findBySessionId: jest.fn(async () => []),
            findLatestBySessionIdAndRole: jest.fn(),
        };
        return {
            instance: new DesktopKernelService(sessionRepo as any, messageRepo as any),
            sessionRepo,
        };
    }

    it('counts local desktop sessions through the repository', async () => {
        const { instance, sessionRepo } = service();

        await expect(instance.countUserSessions('desktop-user', false, true)).resolves.toBe(3);

        expect(sessionRepo.countByUserId).toHaveBeenCalledWith('desktop-user', true);
    });

    it('supports all-user counts for desktop management views', async () => {
        const { instance, sessionRepo } = service();

        await expect(instance.countUserSessions('desktop-user', true, false)).resolves.toBe(7);

        expect(sessionRepo.countAll).toHaveBeenCalledWith(false);
    });

    it('pushes paginated session listing to the desktop repository', async () => {
        const { instance, sessionRepo } = service();

        await instance.getUserSessions('desktop-user', 20, 40, false, true);

        expect(sessionRepo.findByUserIdPaginated).toHaveBeenCalledWith('desktop-user', 20, 40, true);
    });
});
