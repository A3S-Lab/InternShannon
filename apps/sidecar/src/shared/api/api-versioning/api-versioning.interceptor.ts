// ============================================================================
// API Versioning - URL and Header based versioning
// ============================================================================

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { BadRequestException } from '../../common/errors';
import { API_DEPRECATED_KEY, API_SUNSET_DATE_KEY, API_VERSION_KEY } from './api-versioning.decorator';

export interface ApiVersionOptions {
    /** Current API version */
    version: string;
    /** Deprecation info */
    deprecated?: boolean;
    /** Sunset date */
    sunsetDate?: Date;
}

/**
 * Default API version
 */
export const DEFAULT_API_VERSION = '1';
export const SUPPORTED_API_VERSIONS = ['1'] as const;
export const API_VERSION_HEADER = 'x-api-version';
export const API_SUPPORTED_VERSIONS_HEADER = 'x-api-supported-versions';

export interface ApiVersionedRequest extends Request {
    apiVersion?: string;
}

export type SupportedApiVersion = typeof SUPPORTED_API_VERSIONS[number];
export type ApiVersionSource = 'url' | 'x-api-version' | 'accept';

export interface RequestedApiVersion {
    source: ApiVersionSource;
    version: string;
}

interface ApiVersionHeaderResponse {
    headersSent?: boolean;
    setHeader(name: string, value: string): unknown;
}

export function normalizeApiVersion(version: string | null | undefined): string | null {
    if (!version) return null;
    const normalized = version.trim();
    const match = normalized.match(/^v?(\d+)(?:\.0)?$/i);
    return match ? match[1] : null;
}

/**
 * Extract API version from URL path
 * Supports /api/v1, /api/v2 patterns
 */
export function extractVersionFromUrl(url: string): string | null {
    const match = url.match(/^\/api\/v(\d+)(?=\/|$|\?)/);
    return normalizeApiVersion(match?.[1]);
}

/**
 * Extract API version from Accept-Header
 * Supports: application/vnd.shuan-os.v1+json
 */
export function extractVersionFromHeader(header: string | string[] | undefined): string | null {
    if (!header) return null;

    const headerValue = Array.isArray(header) ? header[0] : header;
    const match = headerValue.match(/(?:^|[.\s])v(\d+)(?:[+;,\s]|$)/i);
    return normalizeApiVersion(match?.[1]);
}

/**
 * Extract API version from custom header
 * Supports: X-API-Version: 1
 */
export function extractVersionFromCustomHeader(header: string | string[] | undefined): string | null {
    if (!header) return null;
    const value = Array.isArray(header) ? header[0] : header;
    return normalizeApiVersion(value);
}

export function extractRequestedApiVersionCandidates(request: Request): RequestedApiVersion[] {
    if (shouldBypassApiVersioning(request)) return [];
    const requestUrl = request.originalUrl || request.url;
    const urlVersion = extractVersionFromUrl(requestUrl);
    const customHeaderVersion = extractVersionFromCustomHeader(
        request.headers[API_VERSION_HEADER] || request.headers['X-API-Version'],
    );
    const acceptHeaderVersion = extractVersionFromHeader(request.headers.accept);
    const candidates: RequestedApiVersion[] = [];

    if (urlVersion) {
        candidates.push({ source: 'url', version: urlVersion });
    }
    if (customHeaderVersion) {
        candidates.push({ source: 'x-api-version', version: customHeaderVersion });
    }
    if (acceptHeaderVersion) {
        candidates.push({ source: 'accept', version: acceptHeaderVersion });
    }
    return candidates;
}

export function shouldBypassApiVersioning(request: Pick<Request, 'originalUrl' | 'url'>): boolean {
    const requestUrl = request.originalUrl || request.url || '';
    return /^\/(?:v2|git)(?:\/|$|\?)/.test(requestUrl);
}

export function assertConsistentApiVersion(candidates: RequestedApiVersion[]): void {
    const versions = [...new Set(candidates.map(candidate => candidate.version))];
    if (versions.length <= 1) {
        return;
    }

    throw new BadRequestException('API 版本声明冲突', {
        requestedVersions: candidates,
        supportedVersions: [...SUPPORTED_API_VERSIONS],
    });
}

export function resolveRequestedApiVersion(candidates: RequestedApiVersion[]): string {
    assertConsistentApiVersion(candidates);
    return candidates[0]?.version || DEFAULT_API_VERSION;
}

export function extractRequestedApiVersion(request: Request): string {
    return resolveRequestedApiVersion(extractRequestedApiVersionCandidates(request));
}

export function isSupportedApiVersion(version: string): version is SupportedApiVersion {
    return SUPPORTED_API_VERSIONS.includes(version as SupportedApiVersion);
}

export function assertSupportedApiVersion(version: string): void {
    if (isSupportedApiVersion(version)) {
        return;
    }

    throw new BadRequestException('不支持的 API 版本', {
        requestedVersion: version,
        supportedVersions: [...SUPPORTED_API_VERSIONS],
    });
}

export function applyApiVersionHeaders(
    response: ApiVersionHeaderResponse,
    version: string,
    options: { deprecated?: boolean; sunsetDate?: Date } = {},
): void {
    if (response.headersSent) {
        return;
    }

    response.setHeader(API_VERSION_HEADER, version);
    response.setHeader(API_SUPPORTED_VERSIONS_HEADER, SUPPORTED_API_VERSIONS.join(','));

    if (options.deprecated) {
        response.setHeader('Deprecation', 'true');
    }

    if (options.sunsetDate) {
        response.setHeader('Sunset', options.sunsetDate.toUTCString());
    }
}

@Injectable()
export class ApiVersioningInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const http = context.switchToHttp();
        const request = http.getRequest<ApiVersionedRequest>();
        const response = http.getResponse();
        if (shouldBypassApiVersioning(request)) {
            return next.handle();
        }
        const versionCandidates = extractRequestedApiVersionCandidates(request);
        const requestedVersion = versionCandidates[0]?.version || DEFAULT_API_VERSION;
        request.apiVersion = requestedVersion;

        applyApiVersionHeaders(response, requestedVersion);
        assertConsistentApiVersion(versionCandidates);
        assertSupportedApiVersion(requestedVersion);

        const routeVersions = this.reflector.getAllAndOverride<string | string[] | undefined>(API_VERSION_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (routeVersions) {
            const allowedVersions = Array.isArray(routeVersions) ? routeVersions : [routeVersions];
            if (!allowedVersions.map(item => normalizeApiVersion(item)).includes(requestedVersion)) {
                throw new BadRequestException('当前接口不支持请求的 API 版本', {
                    requestedVersion,
                    endpointVersions: allowedVersions,
                });
            }
        }

        const isDeprecated = this.reflector.getAllAndOverride<boolean>(API_DEPRECATED_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        const sunsetDate = this.reflector.getAllAndOverride<Date | undefined>(API_SUNSET_DATE_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        applyApiVersionHeaders(response, requestedVersion, { deprecated: isDeprecated, sunsetDate });

        return next.handle();
    }
}
