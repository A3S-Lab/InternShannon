import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { LocalOnlyGuard } from './local-only.guard';

function buildContext(remoteAddress: string | undefined): ExecutionContext {
    const request = {
        socket: remoteAddress ? { remoteAddress } : undefined,
        ip: remoteAddress,
    } as unknown as { socket?: { remoteAddress: string }; ip?: string };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
}

describe('LocalOnlyGuard', () => {
    const guard = new LocalOnlyGuard();

    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])('admits loopback address %s', remote => {
        expect(guard.canActivate(buildContext(remote))).toBe(true);
    });

    it.each(['192.168.0.5', '10.0.0.1', '8.8.8.8', '203.0.113.5'])('denies external address %s', remote => {
        expect(() => guard.canActivate(buildContext(remote))).toThrow(ForbiddenException);
    });

    it('denies request with no remote address at all', () => {
        expect(() => guard.canActivate(buildContext(undefined))).toThrow(ForbiddenException);
    });

    it('ignores any X-Forwarded-For header that might lie about origin', () => {
        // Even if `request.ip` (which can be parsed from X-Forwarded-For when
        // `trust proxy` is on) says 127.0.0.1, the socket remote address is
        // what matters. We provide a non-loopback socket; the guard must deny.
        const context = {
            switchToHttp: () => ({
                getRequest: () => ({
                    socket: { remoteAddress: '203.0.113.5' },
                    ip: '127.0.0.1',
                }),
            }),
        } as unknown as ExecutionContext;
        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
});
