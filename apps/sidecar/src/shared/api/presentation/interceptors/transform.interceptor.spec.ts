import { ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { API_SUCCESS_STATUS } from '../../api-response';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor compatibility', () => {
    it('delegates response wrapping to the standard API response interceptor', async () => {
        const request = { headers: { 'x-request-id': 'req-transform' } };
        const response = responseMock({ statusCode: 200 });
        const interceptor = new TransformInterceptor();

        const payload = await firstValueFrom(
            interceptor.intercept(contextFor(request, response), {
                handle: () => of({ ok: true }),
            }),
        );

        expect(payload).toEqual({
            code: 200,
            status: API_SUCCESS_STATUS,
            message: '成功',
            data: { ok: true },
            requestId: 'req-transform',
            timestamp: expect.any(String),
        });
        expect(payload).not.toHaveProperty('_meta');
        expect(payload).not.toHaveProperty('path');
    });

    it('can still opt out of response transformation for legacy callers', async () => {
        const request = { headers: {} };
        const response = responseMock();
        const interceptor = new TransformInterceptor({ transformResponse: false });

        const payload = await firstValueFrom(
            interceptor.intercept(contextFor(request, response), {
                handle: () => of({ raw: true }),
            }),
        );

        expect(payload).toEqual({ raw: true });
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
