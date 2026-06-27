import { ArgumentsHost, BadRequestException as NestBadRequestException, ExecutionContext, Logger } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { API_SUCCESS_STATUS } from '../api/api-response';
import { StatusCode } from '../common/errors';
import { StatusCode as DesktopEnumStatusCode } from './enums/error-code.enum';
import { StatusCode as DesktopStatusCode } from './errors/error-codes';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { ApiResponseInterceptor } from './interceptors/api-response.interceptor';

describe('desktop response compatibility exports', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('uses the standard success envelope through the desktop interceptor export', async () => {
        const request = { headers: { 'x-request-id': 'req-desktop-success' } };
        const response = responseMock({ statusCode: 201 });
        const interceptor = new ApiResponseInterceptor();

        const payload = await firstValueFrom(
            interceptor.intercept(contextFor(request, response), {
                handle: () => of({ id: 'desktop-resource' }),
            }),
        );

        expect(payload).toEqual({
            code: 201,
            status: API_SUCCESS_STATUS,
            message: '成功',
            data: { id: 'desktop-resource' },
            requestId: 'req-desktop-success',
            timestamp: expect.any(String),
        });
    });

    it('uses the standard error envelope through the desktop filter export', () => {
        const request = { headers: { 'x-request-id': 'req-desktop-error' }, method: 'GET', url: '/api/desktop' };
        const response = responseMock();
        const filter = new HttpExceptionFilter();

        filter.catch(new NestBadRequestException('无效请求'), hostFor(request, response));

        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({
            code: 400,
            status: StatusCode.BAD_REQUEST,
            message: '无效请求',
            requestId: 'req-desktop-error',
            timestamp: expect.any(String),
        });
        expect(response.json.mock.calls[0][0]).not.toHaveProperty('statusCode');
    });

    it('reuses canonical error codes for desktop compatibility exports', () => {
        expect(DesktopStatusCode.VALIDATION_ERROR).toBe(StatusCode.VALIDATION_ERROR);
        expect(DesktopEnumStatusCode.RESOURCE_NOT_FOUND).toBe(StatusCode.RESOURCE_NOT_FOUND);
    });

    function responseMock(overrides: Partial<{ statusCode: number; headersSent: boolean }> = {}) {
        const response = {
            statusCode: 200,
            headersSent: false,
            setHeader: jest.fn(),
            status: jest.fn(),
            json: jest.fn(),
            ...overrides,
        };
        response.status.mockReturnValue(response);
        return response;
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

    function hostFor(request: Record<string, unknown>, response: ReturnType<typeof responseMock>): ArgumentsHost {
        return {
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        } as unknown as ArgumentsHost;
    }
});
