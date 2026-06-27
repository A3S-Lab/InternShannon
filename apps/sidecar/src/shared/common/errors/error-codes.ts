// ============================================================================
// Status Codes - Standardized status codes for the application
// ============================================================================

export enum StatusCode {
    // 4xx Client Errors
    BAD_REQUEST = 'BAD_REQUEST',
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    NOT_FOUND = 'NOT_FOUND',
    CONFLICT = 'CONFLICT',
    GONE = 'GONE',
    PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
    UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
    TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',

    // 5xx Server Errors
    INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
    NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
    GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',

    // Business Errors
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
    RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
    INVALID_OPERATION = 'INVALID_OPERATION',
    OPERATION_FAILED = 'OPERATION_FAILED',
    BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',

    // Auth Errors
    TOKEN_EXPIRED = 'TOKEN_EXPIRED',
    TOKEN_INVALID = 'TOKEN_INVALID',
    TOKEN_MISSING = 'TOKEN_MISSING',
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
    DEV_MODE_ONLY = 'DEV_MODE_ONLY',

    // Domain Errors
    ENTITY_NOT_FOUND = 'ENTITY_NOT_FOUND',
    ENTITY_ALREADY_EXISTS = 'ENTITY_ALREADY_EXISTS',
    ENTITY_CONFLICT = 'ENTITY_CONFLICT',

    // External Service Errors
    EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
    EXTERNAL_SERVICE_TIMEOUT = 'EXTERNAL_SERVICE_TIMEOUT',
    EXTERNAL_SERVICE_UNAVAILABLE = 'EXTERNAL_SERVICE_UNAVAILABLE',
}

/**
 * Chinese messages mapped by StatusCode
 */
export const StatusMessages: Record<StatusCode, string> = {
    // 4xx Client Errors
    [StatusCode.BAD_REQUEST]: '请求参数有误，请检查输入',
    [StatusCode.UNAUTHORIZED]: '请先登录后再继续操作',
    [StatusCode.FORBIDDEN]: '您没有权限执行此操作',
    [StatusCode.NOT_FOUND]: '请求的资源不存在或已被删除',
    [StatusCode.CONFLICT]: '该资源已存在，请勿重复创建',
    [StatusCode.GONE]: '请求的资源已永久删除',
    [StatusCode.PAYLOAD_TOO_LARGE]: '请求体过大，请减小后重试',
    [StatusCode.UNPROCESSABLE_ENTITY]: '请求格式正确但无法处理',
    [StatusCode.TOO_MANY_REQUESTS]: '请求过于频繁，请稍后再试',

    // 5xx Server Errors
    [StatusCode.INTERNAL_SERVER_ERROR]: '服务器遇到了问题，请稍后再试',
    [StatusCode.NOT_IMPLEMENTED]: '该功能正在开发中',
    [StatusCode.SERVICE_UNAVAILABLE]: '服务暂时不可用，请稍后再试',
    [StatusCode.GATEWAY_TIMEOUT]: '请求超时，请稍后重试',

    // Business Errors
    [StatusCode.VALIDATION_ERROR]: '输入数据验证失败，请检查格式',
    [StatusCode.DUPLICATE_ENTRY]: '该数据已存在，请勿重复创建',
    [StatusCode.RESOURCE_NOT_FOUND]: '请求的资源不存在',
    [StatusCode.INVALID_OPERATION]: '当前状态不允许此操作',
    [StatusCode.OPERATION_FAILED]: '操作执行失败，请稍后重试',
    [StatusCode.BUSINESS_RULE_VIOLATION]: '违反业务规则，请检查输入',

    // Auth Errors
    [StatusCode.TOKEN_EXPIRED]: '登录已过期，请重新登录',
    [StatusCode.TOKEN_INVALID]: '登录状态已失效，请重新登录',
    [StatusCode.TOKEN_MISSING]: '请先登录获取访问令牌',
    [StatusCode.PERMISSION_DENIED]: '您的权限不足，无法执行此操作',
    [StatusCode.ACCOUNT_DISABLED]: '您的账户已被禁用，请联系管理员',
    [StatusCode.DEV_MODE_ONLY]: '该接口仅在开发模式下可用',

    // Domain Errors
    [StatusCode.ENTITY_NOT_FOUND]: '请求的数据不存在',
    [StatusCode.ENTITY_ALREADY_EXISTS]: '该数据已存在',
    [StatusCode.ENTITY_CONFLICT]: '数据存在冲突',

    // External Service Errors
    [StatusCode.EXTERNAL_SERVICE_ERROR]: '依赖的外部服务出错，请稍后重试',
    [StatusCode.EXTERNAL_SERVICE_TIMEOUT]: '外部服务响应超时，请稍后重试',
    [StatusCode.EXTERNAL_SERVICE_UNAVAILABLE]: '依赖的外部服务暂时不可用',
};

/**
 * Get Chinese message by status code
 */
export function getStatusMessage(statusCode: string): string {
    return StatusMessages[statusCode as StatusCode] || '发生了错误';
}

const CHINESE_TEXT_PATTERN = /[\u3400-\u9fff]/;

export function containsChineseText(value: unknown): value is string {
    return typeof value === 'string' && CHINESE_TEXT_PATTERN.test(value);
}

export function normalizePublicErrorMessage(message: unknown, statusCode: StatusCode): string {
    if (containsChineseText(message)) {
        return message;
    }

    return getStatusMessage(statusCode);
}

export const StatusCodeHttpStatus: Record<StatusCode, number> = {
    [StatusCode.BAD_REQUEST]: 400,
    [StatusCode.UNAUTHORIZED]: 401,
    [StatusCode.FORBIDDEN]: 403,
    [StatusCode.NOT_FOUND]: 404,
    [StatusCode.CONFLICT]: 409,
    [StatusCode.GONE]: 410,
    [StatusCode.PAYLOAD_TOO_LARGE]: 413,
    [StatusCode.UNPROCESSABLE_ENTITY]: 422,
    [StatusCode.TOO_MANY_REQUESTS]: 429,
    [StatusCode.INTERNAL_SERVER_ERROR]: 500,
    [StatusCode.NOT_IMPLEMENTED]: 501,
    [StatusCode.SERVICE_UNAVAILABLE]: 503,
    [StatusCode.GATEWAY_TIMEOUT]: 504,
    [StatusCode.VALIDATION_ERROR]: 400,
    [StatusCode.DUPLICATE_ENTRY]: 409,
    [StatusCode.RESOURCE_NOT_FOUND]: 404,
    [StatusCode.INVALID_OPERATION]: 400,
    [StatusCode.OPERATION_FAILED]: 400,
    [StatusCode.BUSINESS_RULE_VIOLATION]: 400,
    [StatusCode.TOKEN_EXPIRED]: 401,
    [StatusCode.TOKEN_INVALID]: 401,
    [StatusCode.TOKEN_MISSING]: 401,
    [StatusCode.PERMISSION_DENIED]: 403,
    [StatusCode.ACCOUNT_DISABLED]: 403,
    [StatusCode.DEV_MODE_ONLY]: 403,
    [StatusCode.ENTITY_NOT_FOUND]: 404,
    [StatusCode.ENTITY_ALREADY_EXISTS]: 409,
    [StatusCode.ENTITY_CONFLICT]: 409,
    [StatusCode.EXTERNAL_SERVICE_ERROR]: 502,
    [StatusCode.EXTERNAL_SERVICE_TIMEOUT]: 504,
    [StatusCode.EXTERNAL_SERVICE_UNAVAILABLE]: 503,
};
