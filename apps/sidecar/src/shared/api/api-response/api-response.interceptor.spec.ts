import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { API_SUCCESS_STATUS } from './api-response.constants';
import { ApiResponseDto } from './api-response.dto';
import { ApiResponseInterceptor } from './api-response.interceptor';

describe('ApiResponseInterceptor', () => {
    const interceptor = new ApiResponseInterceptor(new Reflector());

    it('wraps successful responses with code and status fields', async () => {
        const response = responseMock({ statusCode: 201 });
        const request = { headers: { 'x-request-id': 'req-created' } };

        const payload = await firstValueFrom(
            interceptor.intercept(contextFor(request, response), {
                handle: () => of({ id: 'resource-1' }),
            }),
        );

        expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'req-created');
        expect(payload).toEqual({
            code: 201,
            status: API_SUCCESS_STATUS,
            message: '成功',
            data: { id: 'resource-1' },
            requestId: 'req-created',
            timestamp: expect.any(String),
        });
        expect(payload).not.toHaveProperty('statusCode');
    });

    it('does not wrap 204 no-content responses', async () => {
        const response = responseMock({ statusCode: 204 });
        const request = { headers: {} };

        const payload = await firstValueFrom(
            interceptor.intercept(contextFor(request, response), {
                handle: () => of(undefined),
            }),
        );

        expect(payload).toBeUndefined();
        expect(request).toHaveProperty('id');
        expect(response.setHeader).toHaveBeenCalledWith('x-request-id', expect.any(String));
    });

    it('preserves explicit ApiResponseDto instances', async () => {
        const explicit = new ApiResponseDto({
            code: 202,
            status: API_SUCCESS_STATUS,
            message: '已接受',
            data: { jobId: 'job-1' },
            requestId: 'req-explicit',
        });
        const response = responseMock({ statusCode: 202 });
        const request = { headers: { 'x-request-id': 'req-explicit' } };

        const payload = await firstValueFrom(
            interceptor.intercept(contextFor(request, response), {
                handle: () => of(explicit),
            }),
        );

        expect(payload).toBe(explicit);
    });

    function responseMock(overrides: Partial<{ statusCode: number; headersSent: boolean }> = {}) {
        return {
            statusCode: 200,
            headersSent: false,
            setHeader: jest.fn(),
            ...overrides,
        };
    }

    function contextFor(request: Record<string, unknown>, response: ReturnType<typeof responseMock>): ExecutionContext {
        return {
            getHandler: () => function handler() {},
            getClass: () => class TestController {},
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        } as unknown as ExecutionContext;
    }
});
