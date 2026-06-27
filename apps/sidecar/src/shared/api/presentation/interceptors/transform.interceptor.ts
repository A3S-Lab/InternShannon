// ============================================================================
// Transform Interceptor - Global request/response transformation
// ============================================================================

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { ApiResponseInterceptor } from '../../api-response';

export interface TransformOptions {
    /** Retained for compatibility; request key transforms are handled by KeyTransformInterceptor. */
    transformRequest?: boolean;
    /** When true, delegates to the canonical ApiResponseInterceptor. */
    transformResponse?: boolean;
    /** Retained for compatibility; custom wrappers are not used by the public API contract. */
    wrapperKey?: string;
    /** Retained for compatibility; public responses do not expose metadata blocks. */
    includeMetadata?: boolean;
}

/**
 * Legacy metadata shape retained for older imports.
 */
export interface ResponseMetadata {
    timestamp: string;
    duration?: number;
    requestId?: string;
}

/**
 * Transform Interceptor - Wraps responses and optionally transforms requests
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
    private readonly defaultOptions: Required<TransformOptions>;
    private readonly standardResponseInterceptor: ApiResponseInterceptor;

    constructor(options: TransformOptions = {}, reflector = new Reflector()) {
        this.defaultOptions = {
            transformRequest: options.transformRequest ?? true,
            transformResponse: options.transformResponse ?? true,
            wrapperKey: options.wrapperKey ?? 'data',
            includeMetadata: options.includeMetadata ?? true,
        };
        this.standardResponseInterceptor = new ApiResponseInterceptor(reflector);
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        if (!this.defaultOptions.transformResponse) {
            return next.handle();
        }

        return this.standardResponseInterceptor.intercept(context, next);
    }
}

/**
 * Snake case to camel case converter for keys
 */
export function transformKeysToCamelCase<T>(obj: any): T {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => transformKeysToCamelCase(item)) as T;
    }

    if (typeof obj === 'object') {
        return Object.keys(obj).reduce((acc, key) => {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            acc[camelKey] = transformKeysToCamelCase(obj[key]);
            return acc;
        }, {} as any) as T;
    }

    return obj;
}

/**
 * Camel case to snake case converter for keys
 */
export function transformKeysToSnakeCase<T>(obj: any): T {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => transformKeysToSnakeCase(item)) as T;
    }

    if (typeof obj === 'object') {
        return Object.keys(obj).reduce((acc, key) => {
            const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            acc[snakeKey] = transformKeysToSnakeCase(obj[key]);
            return acc;
        }, {} as any) as T;
    }

    return obj;
}

/**
 * Request key transformer interceptor
 */
@Injectable()
export class KeyTransformInterceptor implements NestInterceptor {
    constructor(private readonly toCamelCase: boolean = true) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();

        // Transform query params
        if (request.query) {
            request.query = this.toCamelCase
                ? transformKeysToCamelCase(request.query)
                : transformKeysToSnakeCase(request.query);
        }

        // Transform body
        if (request.body && typeof request.body === 'object') {
            request.body = this.toCamelCase
                ? transformKeysToCamelCase(request.body)
                : transformKeysToSnakeCase(request.body);
        }

        return next.handle();
    }
}
