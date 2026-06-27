// ============================================================================
// API Response Interceptor - Wrap all responses in ApiResponseDto
// ============================================================================

import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { attachRequestIdHeader, getOrCreateRequestId } from '../../common/http';
import { API_SUCCESS_MESSAGE, API_SUCCESS_STATUS } from './api-response.constants';
import { ApiResponseDto } from './api-response.dto';

export const SKIP_API_RESPONSE = 'skipApiResponse';

export function SkipApiResponse() {
    return SetMetadata(SKIP_API_RESPONSE, true);
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const request = context.switchToHttp().getRequest<Request>();
        const response = context.switchToHttp().getResponse();
        const skipResponseWrap = this.reflector.getAllAndOverride<boolean>(SKIP_API_RESPONSE, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (skipResponseWrap) {
            return next.handle();
        }

        const requestId = getOrCreateRequestId(request);
        attachRequestIdHeader(response, requestId);

        return next.handle().pipe(
            map(data => {
                if (response.headersSent) {
                    return data;
                }

                // If already wrapped in ApiResponseDto, return as is
                if (data instanceof ApiResponseDto) {
                    return data;
                }

                const code = response.statusCode || 200;
                if (code === 204) {
                    return undefined;
                }

                return {
                    code,
                    status: API_SUCCESS_STATUS,
                    message: API_SUCCESS_MESSAGE,
                    data,
                    requestId,
                    timestamp: new Date().toISOString(),
                };
            }),
        );
    }
}
