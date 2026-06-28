/**
 * Error Code Enum - Business error codes
 * Must match backend ErrorCode enum in apps/api/src/shared/errors/error-codes.ts
 */

export enum ErrorCode {
  // 4xx Client Errors
  BAD_REQUEST = "BAD_REQUEST",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  GONE = "GONE",
  UNPROCESSABLE_ENTITY = "UNPROCESSABLE_ENTITY",
  TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS",

  // 5xx Server Errors
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  GATEWAY_TIMEOUT = "GATEWAY_TIMEOUT",

  // Business Errors
  VALIDATION_ERROR = "VALIDATION_ERROR",
  DUPLICATE_ENTRY = "DUPLICATE_ENTRY",
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  INVALID_OPERATION = "INVALID_OPERATION",
  OPERATION_FAILED = "OPERATION_FAILED",
  BUSINESS_RULE_VIOLATION = "BUSINESS_RULE_VIOLATION",

  // Auth Errors
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  TOKEN_INVALID = "TOKEN_INVALID",
  TOKEN_MISSING = "TOKEN_MISSING",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  ACCOUNT_DISABLED = "ACCOUNT_DISABLED",

  // Domain Errors
  ENTITY_NOT_FOUND = "ENTITY_NOT_FOUND",
  ENTITY_ALREADY_EXISTS = "ENTITY_ALREADY_EXISTS",
  ENTITY_CONFLICT = "ENTITY_CONFLICT",

  // External Service Errors
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  EXTERNAL_SERVICE_TIMEOUT = "EXTERNAL_SERVICE_TIMEOUT",
  EXTERNAL_SERVICE_UNAVAILABLE = "EXTERNAL_SERVICE_UNAVAILABLE",

  // Network Errors
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  SERVER_ERROR = "SERVER_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

/**
 * Determine error severity from error code
 */
export function getErrorSeverity(errorCode: ErrorCode): ErrorSeverity {
  switch (errorCode) {
    case ErrorCode.TOO_MANY_REQUESTS:
    case ErrorCode.SERVICE_UNAVAILABLE:
    case ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE:
      return ErrorSeverity.WARNING;

    case ErrorCode.UNAUTHORIZED:
    case ErrorCode.TOKEN_EXPIRED:
    case ErrorCode.TOKEN_INVALID:
    case ErrorCode.TOKEN_MISSING:
      return ErrorSeverity.INFO;

    case ErrorCode.FORBIDDEN:
    case ErrorCode.PERMISSION_DENIED:
    case ErrorCode.ACCOUNT_DISABLED:
    case ErrorCode.NOT_FOUND:
    case ErrorCode.CONFLICT:
    case ErrorCode.DUPLICATE_ENTRY:
    case ErrorCode.BAD_REQUEST:
    case ErrorCode.VALIDATION_ERROR:
    case ErrorCode.ENTITY_ALREADY_EXISTS:
      return ErrorSeverity.ERROR;

    case ErrorCode.INTERNAL_SERVER_ERROR:
    case ErrorCode.GATEWAY_TIMEOUT:
    case ErrorCode.EXTERNAL_SERVICE_ERROR:
    case ErrorCode.UNKNOWN_ERROR:
    case ErrorCode.SERVER_ERROR:
      return ErrorSeverity.CRITICAL;

    default:
      return ErrorSeverity.ERROR;
  }
}

/**
 * Check if error should trigger retry
 */
export function shouldRetry(errorCode: ErrorCode): boolean {
  return [
    ErrorCode.NETWORK_ERROR,
    ErrorCode.TIMEOUT_ERROR,
    ErrorCode.GATEWAY_TIMEOUT,
    ErrorCode.SERVICE_UNAVAILABLE,
    ErrorCode.INTERNAL_SERVER_ERROR,
    ErrorCode.EXTERNAL_SERVICE_ERROR,
    ErrorCode.EXTERNAL_SERVICE_TIMEOUT,
    ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
    ErrorCode.OPERATION_FAILED,
  ].includes(errorCode);
}
