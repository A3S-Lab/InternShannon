// ============================================================================
// OpenAPI Common Decorators - Reusable API documentation decorators
// ============================================================================

import { applyDecorators, HttpStatus } from '@nestjs/common';
import {
    ApiExtraModels,
    ApiInternalServerErrorResponse,
    ApiOperation,
    ApiResponse,
    getSchemaPath,
} from '@nestjs/swagger';
import { StatusCode } from '../../common/errors/error-codes';
import {
    ApiErrorEnvelopeDto,
    ApiPaginatedDataDto,
    ApiSuccessEnvelopeDto,
} from './openapi-common.dto';

type OpenApiModelType = Function | [Function];
type ErrorResponseOptions = string | { description?: string };

function resolveModelType(type?: OpenApiModelType): { model?: Function; isArray: boolean } {
    if (!type) return { isArray: false };
    if (Array.isArray(type)) {
        return { model: type[0], isArray: true };
    }
    return { model: type, isArray: false };
}

function errorDescription(options: ErrorResponseOptions | undefined, fallback: string): string {
    if (typeof options === 'string') return options;
    return options?.description ?? fallback;
}

function successSchema(model: Function | undefined, isArray: boolean, code: number) {
    const dataSchema = model
        ? (isArray ? { type: 'array', items: { $ref: getSchemaPath(model) } } : { $ref: getSchemaPath(model) })
        : undefined;
    return {
        allOf: [
            { $ref: getSchemaPath(ApiSuccessEnvelopeDto) },
            {
                type: 'object',
                properties: {
                    code: { type: 'number', example: code },
                    ...(dataSchema ? { data: dataSchema } : {}),
                },
            },
        ],
    };
}

function oneOfSuccessSchema(models: Function[], code: number) {
    return {
        allOf: [
            { $ref: getSchemaPath(ApiSuccessEnvelopeDto) },
            {
                type: 'object',
                properties: {
                    code: { type: 'number', example: code },
                    data: {
                        oneOf: models.map(model => ({ $ref: getSchemaPath(model) })),
                    },
                },
            },
        ],
    };
}

function errorSchema(code: number, statusEnum: string, exampleMessage: string) {
    return {
        allOf: [
            { $ref: getSchemaPath(ApiErrorEnvelopeDto) },
            {
                type: 'object',
                properties: {
                    code: { type: 'number', example: code },
                    status: { type: 'string', example: statusEnum },
                    message: { type: 'string', example: exampleMessage },
                },
            },
        ],
    };
}

// ============================================================================
// Standard Response Decorators
// ============================================================================

export function ApiStandardResponse<T>(options: {
    status?: HttpStatus;
    summary?: string;
    description?: string;
    responseDescription?: string;
    type?: T;
    isArray?: boolean;
    deprecated?: boolean;
}) {
    const { status = 200, summary, description, responseDescription, type, deprecated } = options;
    const code = status;
    const { model, isArray } = resolveModelType(type as OpenApiModelType);
    const responseIsArray = options.isArray || isArray;

    const decorators: any[] = [
        ApiOperation({ summary, description, deprecated }),
        ApiExtraModels(ApiSuccessEnvelopeDto),
    ];
    if (model) {
        decorators.push(ApiExtraModels(model as any));
    }

    decorators.push(
        ApiResponse({
            status: code,
            description: responseDescription || description || (code === 200 ? '成功' : '响应'),
            schema: successSchema(model, responseIsArray, code),
        }),
    );

    return applyDecorators(...decorators);
}

export function ApiStandardOneOfResponse(options: {
    status?: HttpStatus;
    summary?: string;
    description?: string;
    responseDescription?: string;
    types: Function[];
    deprecated?: boolean;
}) {
    const { status = 200, summary, description, responseDescription, types, deprecated } = options;
    const code = status;
    return applyDecorators(
        ApiOperation({ summary, description, deprecated }),
        ApiExtraModels(ApiSuccessEnvelopeDto, ...types),
        ApiResponse({
            status: code,
            description: responseDescription || description || (code === 200 ? '成功' : '响应'),
            schema: oneOfSuccessSchema(types, code),
        }),
    );
}

export function ApiCreatedResponse<T>(options: { summary?: string; description?: string; responseDescription?: string; type?: T; deprecated?: boolean }) {
    return ApiStandardResponse<T>({
        status: HttpStatus.CREATED,
        ...options,
    });
}

export function ApiCreatedOneOfResponse(options: { summary?: string; description?: string; responseDescription?: string; types: Function[]; deprecated?: boolean }) {
    return ApiStandardOneOfResponse({
        status: HttpStatus.CREATED,
        ...options,
    });
}

export function ApiOkResponse<T>(options: { summary?: string; description?: string; responseDescription?: string; type?: T; isArray?: boolean; deprecated?: boolean }) {
    return ApiStandardResponse<T>({
        status: HttpStatus.OK,
        ...options,
    });
}

export function ApiNoContentResponse(
    options?: string | { summary?: string; description?: string; responseDescription?: string; deprecated?: boolean },
) {
    const summary = typeof options === 'string' ? options : options?.summary;
    const description = typeof options === 'string' ? undefined : options?.description;
    const deprecated = typeof options === 'string' ? undefined : options?.deprecated;
    const responseDescription = typeof options === 'string'
        ? options
        : options?.responseDescription ?? options?.description ?? '无内容';
    return applyDecorators(
        ApiOperation({ summary, description, deprecated }),
        ApiResponse({
            status: 204,
            description: responseDescription,
        }),
    );
}

export function ApiRawResponse(options: {
    status?: HttpStatus;
    summary: string;
    description: string;
    responseDescription?: string;
    contentType?: string;
}) {
    const { status = HttpStatus.OK, summary, description, responseDescription, contentType } = options;
    return applyDecorators(
        ApiOperation({ summary, description }),
        ApiResponse({
            status,
            description: responseDescription || description,
            ...(contentType
                ? {
                    content: {
                        [contentType]: {
                            schema: { type: contentType.includes('json') ? 'object' : 'string' },
                        },
                    },
                }
                : {}),
        }),
    );
}

// ============================================================================
// Paginated Response Decorators
// ============================================================================

export function ApiPaginatedResponse<T>(options: { summary?: string; type?: T; description?: string; responseDescription?: string; deprecated?: boolean }) {
    const { summary, type, description, responseDescription, deprecated } = options;
    const { model } = resolveModelType(type as OpenApiModelType);

    const decorators: any[] = [
        ApiOperation({ summary, description, deprecated }),
        ApiExtraModels(ApiSuccessEnvelopeDto, ApiPaginatedDataDto),
    ];
    if (model) {
        decorators.push(ApiExtraModels(model as any));
    }

    const itemsSchema = model ? { $ref: getSchemaPath(model) } : { type: 'object' };

    decorators.push(
        ApiResponse({
            status: 200,
            description: responseDescription || description || '分页响应',
            schema: {
                allOf: [
                    { $ref: getSchemaPath(ApiSuccessEnvelopeDto) },
                    {
                        type: 'object',
                        properties: {
                            code: { type: 'number', example: 200 },
                            data: {
                                allOf: [
                                    { $ref: getSchemaPath(ApiPaginatedDataDto) },
                                    {
                                        type: 'object',
                                        properties: {
                                            items: { type: 'array', items: itemsSchema },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        }),
    );

    return applyDecorators(...decorators);
}

// ============================================================================
// Error Response Decorators
// ============================================================================

export function ApiBadRequestResponse(options: ErrorResponseOptions = '请求数据无效 - 参数校验失败') {
    const description = errorDescription(options, '请求数据无效 - 参数校验失败');
    return applyDecorators(
        ApiExtraModels(ApiErrorEnvelopeDto),
        ApiResponse({
            status: 400,
            description,
            schema: errorSchema(400, StatusCode.BAD_REQUEST, description),
        }),
    );
}

export function ApiUnauthorizedResponse(options: ErrorResponseOptions = '未授权 - Token 无效或已过期') {
    const description = errorDescription(options, '未授权 - Token 无效或已过期');
    return applyDecorators(
        ApiExtraModels(ApiErrorEnvelopeDto),
        ApiResponse({
            status: 401,
            description,
            schema: errorSchema(401, StatusCode.UNAUTHORIZED, description),
        }),
    );
}

export function ApiForbiddenResponse(options: ErrorResponseOptions = '无权限 - 权限不足') {
    const description = errorDescription(options, '无权限 - 权限不足');
    return applyDecorators(
        ApiExtraModels(ApiErrorEnvelopeDto),
        ApiResponse({
            status: 403,
            description,
            schema: errorSchema(403, StatusCode.FORBIDDEN, description),
        }),
    );
}

export function ApiNotFoundResponse(options: ErrorResponseOptions = '资源不存在') {
    const description = errorDescription(options, '资源不存在');
    return applyDecorators(
        ApiExtraModels(ApiErrorEnvelopeDto),
        ApiResponse({
            status: 404,
            description,
            schema: errorSchema(404, StatusCode.NOT_FOUND, description),
        }),
    );
}

export function ApiConflictResponse(options: ErrorResponseOptions = '冲突 - 资源已存在') {
    const description = errorDescription(options, '冲突 - 资源已存在');
    return applyDecorators(
        ApiExtraModels(ApiErrorEnvelopeDto),
        ApiResponse({
            status: 409,
            description,
            schema: errorSchema(409, StatusCode.CONFLICT, description),
        }),
    );
}

export function ApiPayloadTooLargeResponse(options: ErrorResponseOptions = '请求体过大') {
    const description = errorDescription(options, '请求体过大');
    return applyDecorators(
        ApiExtraModels(ApiErrorEnvelopeDto),
        ApiResponse({
            status: 413,
            description,
            schema: errorSchema(413, StatusCode.PAYLOAD_TOO_LARGE, description),
        }),
    );
}

export function ApiServerErrorResponse() {
    return applyDecorators(
        ApiExtraModels(ApiErrorEnvelopeDto),
        ApiResponse({
            status: 500,
            description: '服务器内部错误',
            schema: errorSchema(500, StatusCode.INTERNAL_SERVER_ERROR, '服务器内部错误 - 请稍后重试'),
        }),
        ApiInternalServerErrorResponse({
            description: '服务器内部错误',
        }),
    );
}

// ============================================================================
// Compound Error Response Decorator
// ============================================================================

type ErrorOption = ErrorResponseOptions | boolean;

/**
 * 组合常用错误响应装饰器，每个端点一行即可声明 OpenAPI 错误形状。
 *
 * 默认包含 400 + 401 + 500——绝大多数业务端点（参数校验 + 认证 + 兜底服务错误）
 * 都要描述这三种。按需 opt-in 加 403 / 404 / 409，或 opt-out 默认项。
 *
 * 用法：
 * ```ts
 * @ApiStandardErrorResponses()                            // 400 + 401 + 500
 * @ApiStandardErrorResponses({ notFound: true })          // 加 404
 * @ApiStandardErrorResponses({                            // 全开 + 自定义描述
 *     notFound: { description: '资产不存在' },
 *     forbidden: true,
 *     conflict: true,
 * })
 * @ApiStandardErrorResponses({ unauthorized: false })     // 公开接口，不需要 401
 * ```
 */
export function ApiStandardErrorResponses(
    options: {
        badRequest?: ErrorOption;
        unauthorized?: ErrorOption;
        forbidden?: ErrorOption;
        notFound?: ErrorOption;
        conflict?: ErrorOption;
        serverError?: ErrorOption;
    } = {},
) {
    const decorators: any[] = [];

    if (options.badRequest !== false) {
        decorators.push(ApiBadRequestResponse(unwrapErrorOption(options.badRequest)));
    }
    if (options.unauthorized !== false) {
        decorators.push(ApiUnauthorizedResponse(unwrapErrorOption(options.unauthorized)));
    }
    if (options.forbidden) {
        decorators.push(ApiForbiddenResponse(unwrapErrorOption(options.forbidden)));
    }
    if (options.notFound) {
        decorators.push(ApiNotFoundResponse(unwrapErrorOption(options.notFound)));
    }
    if (options.conflict) {
        decorators.push(ApiConflictResponse(unwrapErrorOption(options.conflict)));
    }
    if (options.serverError !== false) {
        decorators.push(ApiServerErrorResponse());
    }

    return applyDecorators(...decorators);
}

function unwrapErrorOption(option: ErrorOption | undefined): ErrorResponseOptions | undefined {
    if (option === undefined || option === true || option === false) return undefined;
    return option;
}
