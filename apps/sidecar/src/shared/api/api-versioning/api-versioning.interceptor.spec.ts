import {
    API_SUPPORTED_VERSIONS_HEADER,
    API_VERSION_HEADER,
    ApiVersioningInterceptor,
    assertSupportedApiVersion,
    extractRequestedApiVersion,
    extractRequestedApiVersionCandidates,
    extractVersionFromCustomHeader,
    extractVersionFromHeader,
    extractVersionFromUrl,
    normalizeApiVersion,
    shouldBypassApiVersioning,
} from './api-versioning.interceptor';
import { Reflector } from '@nestjs/core';
import { Deprecated } from './api-versioning.decorator';

describe('api versioning helpers', () => {
    it('normalizes common API version formats', () => {
        expect(normalizeApiVersion('1')).toBe('1');
        expect(normalizeApiVersion('v1')).toBe('1');
        expect(normalizeApiVersion('1.0')).toBe('1');
        expect(normalizeApiVersion('beta')).toBeNull();
    });

    it('extracts versions from URL, Accept header, and X-API-Version', () => {
        expect(extractVersionFromUrl('/api/v1/runtimes')).toBe('1');
        expect(extractVersionFromHeader('application/vnd.internshannon.v1+json')).toBe('1');
        expect(extractVersionFromCustomHeader('v1')).toBe('1');
    });

    it('captures all declared API version sources for conflict detection', () => {
        const request = {
            url: '/api/v1/runtimes',
            originalUrl: '/api/v1/runtimes',
            headers: {
                'x-api-version': '1',
                accept: 'application/vnd.internshannon.v1+json',
            },
        };

        expect(extractRequestedApiVersionCandidates(request as any)).toEqual([
            { source: 'url', version: '1' },
            { source: 'x-api-version', version: '1' },
            { source: 'accept', version: '1' },
        ]);
    });

    it('bypasses non-REST protocol routes', () => {
        const request = {
            url: '/v2/_catalog',
            originalUrl: '/v2/_catalog',
            headers: {
                accept: 'application/vnd.oci.image.manifest.v2+json',
            },
        };

        expect(shouldBypassApiVersioning(request as any)).toBe(true);
        expect(extractRequestedApiVersionCandidates(request as any)).toEqual([]);
        expect(extractRequestedApiVersion(request as any)).toBe('1');
    });

    it('rejects conflicting API version declarations', () => {
        const request = {
            url: '/api/v1/health',
            originalUrl: '/api/v1/health',
            headers: {
                'x-api-version': '2',
            },
        };

        expect(() => extractRequestedApiVersion(request as any)).toThrow('API 版本声明冲突');
    });

    it('rejects unsupported versions before controller handling', () => {
        expect(() => assertSupportedApiVersion('2')).toThrow('不支持的 API 版本');
    });
});

describe('ApiVersioningInterceptor', () => {
    it('adds version headers before rejecting unsupported versions', () => {
        const request = {
            url: '/api/runtimes',
            originalUrl: '/api/runtimes',
            headers: { 'x-api-version': '2' },
        };
        const response = responseMock();
        const interceptor = new ApiVersioningInterceptor(new Reflector());

        expect(() => interceptor.intercept(contextFor(request, response), { handle: jest.fn() } as any))
            .toThrow('不支持的 API 版本');

        expect((request as any).apiVersion).toBe('2');
        expect(response.setHeader).toHaveBeenCalledWith(API_VERSION_HEADER, '2');
        expect(response.setHeader).toHaveBeenCalledWith(API_SUPPORTED_VERSIONS_HEADER, '1');
    });

    it('adds supported versions header before rejecting conflicting declarations', () => {
        const request = {
            url: '/api/v1/runtimes',
            originalUrl: '/api/v1/runtimes',
            headers: { 'x-api-version': '2' },
        };
        const response = responseMock();
        const interceptor = new ApiVersioningInterceptor(new Reflector());

        expect(() => interceptor.intercept(contextFor(request, response), { handle: jest.fn() } as any))
            .toThrow('API 版本声明冲突');

        expect(response.setHeader).toHaveBeenCalledWith(API_VERSION_HEADER, '1');
        expect(response.setHeader).toHaveBeenCalledWith(API_SUPPORTED_VERSIONS_HEADER, '1');
    });

    it('does not add API version metadata to OCI routes', () => {
        const request = {
            url: '/v2/packages/example/manifests/1.0.0',
            originalUrl: '/v2/packages/example/manifests/1.0.0',
            headers: {
                accept: 'application/vnd.oci.image.manifest.v2+json',
            },
        };
        const response = responseMock();
        const interceptor = new ApiVersioningInterceptor(new Reflector());
        const next = { handle: jest.fn(() => 'next-response') };

        expect(interceptor.intercept(contextFor(request, response), next as any)).toBe('next-response');
        expect(next.handle).toHaveBeenCalledTimes(1);
        expect((request as any).apiVersion).toBeUndefined();
        expect(response.setHeader).not.toHaveBeenCalled();
    });

    it('adds the standard deprecation header for deprecated handlers', () => {
        class DeprecatedController {
            @Deprecated()
            handler() {}
        }
        const request = {
            url: '/api/v1/task-workbench/home/init',
            originalUrl: '/api/v1/task-workbench/home/init',
            headers: {},
        };
        const response = responseMock();
        const interceptor = new ApiVersioningInterceptor(new Reflector());
        const next = { handle: jest.fn(() => 'next-response') };

        expect(interceptor.intercept(
            contextFor(
                request,
                response,
                DeprecatedController.prototype.handler,
                DeprecatedController,
            ),
            next as any,
        )).toBe('next-response');

        expect(response.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    });

    function responseMock() {
        return {
            headersSent: false,
            setHeader: jest.fn(),
        };
    }

    function contextFor(
        request: Record<string, unknown>,
        response: ReturnType<typeof responseMock>,
        handler: Function = function handler() {},
        controllerClass: Function = class TestController {},
    ) {
        return {
            getHandler: () => handler,
            getClass: () => controllerClass,
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        } as any;
    }
});
