import { StatusCode } from '../../common/errors/error-codes';
import { API_SUCCESS_STATUS } from './api-response.constants';
import { ApiResponseService } from './api-response.service';

describe('ApiResponseService', () => {
    const service = new ApiResponseService();

    it('uses one business status for all success envelopes', () => {
        expect(service.success({ ok: true })).toEqual(expect.objectContaining({
            code: 200,
            status: API_SUCCESS_STATUS,
            message: '成功',
            data: { ok: true },
        }));
        expect(service.created({ id: '1' })).toEqual(expect.objectContaining({
            code: 201,
            status: API_SUCCESS_STATUS,
            message: '创建成功',
        }));
        expect(service.accepted({ jobId: 'job-1' })).toEqual(expect.objectContaining({
            code: 202,
            status: API_SUCCESS_STATUS,
            message: '已接受',
        }));
        expect(service.noContent()).toEqual(expect.objectContaining({
            code: 204,
            status: API_SUCCESS_STATUS,
            message: '无内容',
        }));
    });

    it('maps business errors to HTTP code and status', () => {
        expect(service.error(StatusCode.RESOURCE_NOT_FOUND, '资源不存在')).toEqual(expect.objectContaining({
            code: 404,
            status: StatusCode.RESOURCE_NOT_FOUND,
            message: '资源不存在',
        }));
    });
});
