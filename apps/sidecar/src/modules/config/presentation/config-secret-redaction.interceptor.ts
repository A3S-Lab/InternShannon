import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { redactSecrets } from '@/shared/common/security/secret-redaction';
import { isDesktopLoopback } from '@/shared/constants';

/**
 * Single redaction seam for config reads. Cloud responses mask secret-named fields
 * (apiKey/password/clientSecret…) to a `[configured]` sentinel. Desktop loopback
 * returns local config as-is so the settings UI can show values the user entered.
 * Write paths still restore the sentinel from stored values (see restoreSecrets),
 * so cloud round-trips can't corrupt keys.
 */
export function redactConfigResponseSecrets(body: unknown, options?: { desktopLoopback?: boolean }): unknown {
    const desktopLoopback = options?.desktopLoopback ?? isDesktopLoopback();
    return desktopLoopback ? body : redactSecrets(body);
}

@Injectable()
export class ConfigSecretRedactionInterceptor implements NestInterceptor {
    intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
        return next.handle().pipe(map(body => redactConfigResponseSecrets(body)));
    }
}
