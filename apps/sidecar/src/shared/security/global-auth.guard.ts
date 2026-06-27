import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Desktop sidecar has no login flow. Keep this guard as a compatibility shell
 * for modules that still register APP_GUARD, but do not perform authentication.
 */
@Injectable()
export class GlobalAuthGuard implements CanActivate {
    canActivate(_context: ExecutionContext): boolean {
        return true;
    }
}
