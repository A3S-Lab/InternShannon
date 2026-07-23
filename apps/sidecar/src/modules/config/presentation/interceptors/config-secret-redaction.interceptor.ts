import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { redactSecrets } from '@/shared/common/security/secret-redaction';

/**
 * Single redaction seam for every config read. Even loopback responses must not
 * expose credentials to the WebView DOM. Write paths restore the `[configured]`
 * sentinel from stored values (see restoreSecrets), so safe round-trips preserve
 * an existing key without returning it to the frontend.
 */
export function redactConfigResponseSecrets(body: unknown): unknown {
    return redactSecrets(body);
}

@Injectable()
export class ConfigSecretRedactionInterceptor implements NestInterceptor {
    intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
        return next.handle().pipe(map(body => redactConfigResponseSecrets(body)));
    }
}
