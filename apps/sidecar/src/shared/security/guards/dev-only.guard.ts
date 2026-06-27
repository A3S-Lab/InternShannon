import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DevModeOnlyException } from '../../common/errors/business.exception';

/**
 * Development Mode Guard
 *
 * AOP-style guard that blocks access to endpoints in production.
 * Use @DevOnly() decorator on controller methods that should only
 * be accessible during development.
 *
 * @example
 * @Post('dev-diagnostics')
 * @DevOnly()
 * async getDevDiagnostics() { ... }
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
    canActivate(_context: ExecutionContext): boolean {
        if (process.env.NODE_ENV === 'production') {
            throw new DevModeOnlyException();
        }
        return true;
    }
}
