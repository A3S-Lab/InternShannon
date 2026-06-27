import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1', 'localhost']);

/**
 * Guard that only admits requests coming from the loopback interface.
 *
 * Use for **internal-only** endpoints that a co-located process needs to
 * call but no external client should ever reach (e.g. the credential
 * resolver hit by the Feishu skill wrapper running inside the agent
 * sandbox).
 *
 * The check intentionally ignores `X-Forwarded-For` / `X-Real-IP` — those
 * are caller-controlled and trivially forgeable. We use only the raw
 * socket remote address. If the API runs behind a reverse proxy that
 * terminates loopback for you (e.g. nginx → :29653), the proxy's outbound
 * IP must itself be loopback for the call to pass; otherwise it's
 * rejected as external.
 */
@Injectable()
export class LocalOnlyGuard implements CanActivate {
    private readonly logger = new Logger(LocalOnlyGuard.name);

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        const remote = this.resolveRemoteAddress(request);
        if (!remote) {
            this.logger.warn('[local-only] denied: no remote address on request');
            throw new ForbiddenException('local-only endpoint');
        }
        if (!LOOPBACK_HOSTS.has(remote)) {
            this.logger.warn(`[local-only] denied: remote=${remote}`);
            throw new ForbiddenException('local-only endpoint');
        }
        return true;
    }

    private resolveRemoteAddress(request: Request): string | undefined {
        // Express may have parsed `req.ip` already, but it honours
        // `trust proxy` settings which could let a forwarded header lie.
        // The socket remote address is the only field we can fully trust.
        const socketRemote = request.socket?.remoteAddress;
        if (socketRemote) return socketRemote;
        return request.ip;
    }
}
