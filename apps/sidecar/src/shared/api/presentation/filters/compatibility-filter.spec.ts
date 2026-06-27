import { ArgumentsHost, BadRequestException as NestBadRequestException, Logger } from '@nestjs/common';
import { StatusCode } from '../../../common/errors';
import { DomainException, DomainExceptionFilter } from './domain-exception.filter';
import { HttpExceptionFilter } from './http-exception.filter';

describe('presentation filter compatibility exports', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('routes legacy HttpExceptionFilter imports through the standard error envelope', () => {
        const response = responseMock();
        const filter = new HttpExceptionFilter();

        filter.catch(
            new NestBadRequestException({ message: ['name must be provided'] }),
            hostFor(requestMock('req-http'), response),
        );

        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({
            code: 400,
            status: StatusCode.BAD_REQUEST,
            message: '请求参数有误，请检查输入',
            details: { messages: ['name must be provided'] },
            requestId: 'req-http',
            timestamp: expect.any(String),
        });
        expect(response.json.mock.calls[0][0]).not.toHaveProperty('statusCode');
        expect(response.json.mock.calls[0][0]).not.toHaveProperty('path');
    });

    it('routes domain exceptions through the standard error envelope', () => {
        const response = responseMock();
        const filter = new DomainExceptionFilter();

        filter.catch(new DomainException('领域规则不满足'), hostFor(requestMock('req-domain'), response));

        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({
            code: 400,
            status: StatusCode.BAD_REQUEST,
            message: '请求参数有误，请检查输入',
            details: {
                type: 'DomainException',
                message: '领域规则不满足',
            },
            requestId: 'req-domain',
            timestamp: expect.any(String),
        });
    });

    function requestMock(requestId: string) {
        return {
            headers: { 'x-request-id': requestId },
            method: 'GET',
            url: '/api/legacy',
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

    function hostFor(request: ReturnType<typeof requestMock>, response: ReturnType<typeof responseMock>): ArgumentsHost {
        return {
            switchToHttp: () => ({
                getRequest: () => request,
                getResponse: () => response,
            }),
        } as unknown as ArgumentsHost;
    }
});
