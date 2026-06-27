import { ArgumentsHost, BadRequestException as NestBadRequestException, Logger } from '@nestjs/common';
import { BadRequestException } from './business.exception';
import { GlobalErrorFilter } from './error.filter';
import { StatusCode } from './error-codes';

describe('GlobalErrorFilter', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('formats business exceptions with the public error contract only', () => {
        const response = responseMock();
        const request = requestMock({ headers: { 'x-request-id': 'req-business' } });
        const filter = new GlobalErrorFilter();

        filter.catch(
            new BadRequestException('配置无效', { field: 'llm.model' }),
            hostFor(request, response),
        );

        expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'req-business');
        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({
            code: 400,
            status: StatusCode.BAD_REQUEST,
            message: '配置无效',
            details: { field: 'llm.model' },
            requestId: 'req-business',
            timestamp: expect.any(String),
        });

        const payload = response.json.mock.calls[0][0];
        expect(payload).not.toHaveProperty('statusCode');
        expect(payload).not.toHaveProperty('path');
        expect(payload).not.toHaveProperty('method');
    });

    it('localizes non-Chinese business exception messages at the global boundary', () => {
        const response = responseMock();
        const request = requestMock({ headers: { 'x-request-id': 'req-localized-business' } });
        const filter = new GlobalErrorFilter();

        filter.catch(
            new BadRequestException('Invalid package format'),
            hostFor(request, response),
        );

        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({
            code: 400,
            status: StatusCode.BAD_REQUEST,
            message: '请求参数有误，请检查输入',
            details: undefined,
            requestId: 'req-localized-business',
            timestamp: expect.any(String),
        });
    });

    it('localizes non-Chinese Nest exception messages at the global boundary', () => {
        const response = responseMock();
        const request = requestMock({ headers: { 'x-request-id': 'req-localized-http' } });
        const filter = new GlobalErrorFilter();

        filter.catch(new NestBadRequestException('Invalid payload'), hostFor(request, response));

        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({
            code: 400,
            status: StatusCode.BAD_REQUEST,
            message: '请求参数有误，请检查输入',
            details: undefined,
            requestId: 'req-localized-http',
            timestamp: expect.any(String),
        });
    });

    it('normalizes Nest validation exceptions into code and status fields', () => {
        const response = responseMock();
        const request = requestMock({ headers: { 'x-correlation-id': 'req-validation' } });
        const filter = new GlobalErrorFilter();

        filter.catch(
            new NestBadRequestException({
                statusCode: 400,
                message: ['name should not be empty'],
                error: 'Bad Request',
            }),
            hostFor(request, response),
        );

        expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'req-validation');
        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({
            code: 400,
            status: StatusCode.BAD_REQUEST,
            message: '请求参数有误，请检查输入',
            details: { messages: ['name should not be empty'] },
            requestId: 'req-validation',
            timestamp: expect.any(String),
        });
        expect(response.json.mock.calls[0][0]).not.toHaveProperty('statusCode');
    });

    it('lifts pipe fieldErrors into the stable details.fieldErrors contract', () => {
        const response = responseMock();
        const request = requestMock({ headers: { 'x-request-id': 'req-field-errors' } });
        const filter = new GlobalErrorFilter();

        // Mirrors the payload produced by createValidationPipe's exceptionFactory.
        filter.catch(
            new NestBadRequestException({
                status: StatusCode.VALIDATION_ERROR,
                message: '输入数据验证失败，请检查格式',
                fieldErrors: [{ field: 'capacity', messages: ['capacity must be a number'] }],
            }),
            hostFor(request, response),
        );

        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({
            code: 400,
            status: StatusCode.VALIDATION_ERROR,
            message: '输入数据验证失败，请检查格式',
            details: {
                fieldErrors: [{ field: 'capacity', messages: ['capacity must be a number'] }],
            },
            requestId: 'req-field-errors',
            timestamp: expect.any(String),
        });
    });

    it('normalizes the legacy errors[] key into details.fieldErrors', () => {
        const response = responseMock();
        const request = requestMock({ headers: { 'x-request-id': 'req-legacy-errors' } });
        const filter = new GlobalErrorFilter();

        filter.catch(
            new NestBadRequestException({
                status: StatusCode.VALIDATION_ERROR,
                message: '输入数据验证失败，请检查格式',
                errors: [{ field: 'name', constraints: ['name should not be empty'] }],
            }),
            hostFor(request, response),
        );

        const payload = response.json.mock.calls[0][0];
        expect(payload.status).toBe(StatusCode.VALIDATION_ERROR);
        expect(payload.details).toEqual({
            fieldErrors: [{ field: 'name', constraints: ['name should not be empty'] }],
        });
    });

    it('hides internal error details for unexpected exceptions', () => {
        const response = responseMock();
        const request = requestMock({ id: 'req-internal' });
        const filter = new GlobalErrorFilter();

        filter.catch(new Error('database password leaked'), hostFor(request, response));

        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.json).toHaveBeenCalledWith({
            code: 500,
            status: StatusCode.INTERNAL_SERVER_ERROR,
            message: '服务器遇到了问题，请稍后再试',
            requestId: 'req-internal',
            timestamp: expect.any(String),
        });
    });

    function requestMock(overrides: Record<string, unknown> = {}) {
        return {
            headers: {},
            method: 'GET',
            url: '/api/config/categories',
            ...overrides,
        };
    }

    function responseMock() {
        const response = {
            headersSent: false,
            setHeader: jest.fn(),
            status: jest.fn(),
            json: jest.fn(),
        };
        response.status.mockReturnValue(response);
        return response;
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
