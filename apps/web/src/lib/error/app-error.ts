/**
 * Application Error Class
 * Unified error handling with typed errors
 */

import { ErrorCode, type ErrorSeverity, getErrorSeverity } from "./errors";
import type { FieldError } from "../constants";

export interface AppErrorOptions {
  code: number;           // HTTP status code
  errorCode: string;      // Business code — carried by the contract field `status`
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
  timestamp?: string;
  isNetworkError?: boolean;
  isTimeoutError?: boolean;
}

export class AppError extends Error {
  public readonly code: number;           // HTTP status code
  public readonly errorCode: string;     // Business error code
  public readonly details?: Record<string, unknown>;
  public readonly requestId?: string;
  public readonly timestamp: string;
  public readonly severity: ErrorSeverity;
  public readonly isNetworkError: boolean;
  public readonly isTimeoutError: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.errorCode = options.errorCode;
    this.details = options.details;
    this.requestId = options.requestId;
    this.timestamp = options.timestamp ?? new Date().toISOString();
    this.severity = getErrorSeverity(options.errorCode as ErrorCode);
    this.isNetworkError = options.isNetworkError ?? false;
    this.isTimeoutError = options.isTimeoutError ?? false;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Create from network error
   */
  static fromNetworkError(_cause: Error): AppError {
    return new AppError({
      code: 0,
      errorCode: ErrorCode.NETWORK_ERROR,
      message: "网络连接失败，请检查您的网络设置",
      isNetworkError: true,
    });
  }

  /**
   * Create from timeout error
   */
  static fromTimeoutError(): AppError {
    return new AppError({
      code: 0,
      errorCode: ErrorCode.TIMEOUT_ERROR,
      message: "请求超时，请稍后重试",
      isTimeoutError: true,
    });
  }

  static fromCancelled(): AppError {
    return new AppError({
      code: 0,
      errorCode: ErrorCode.NETWORK_ERROR,
      message: "请求已取消",
    });
  }

  /**
   * Create from HTTP response.
   *
   * The unified error contract carries the business code in the `status` field
   * (mirroring the `status: 'SUCCESS'` of the success envelope); there is no
   * separate `errorCode`/`statusCode` on the wire.
   */
  static fromResponse(
    response: {
      status: number;
      data?: {
        status?: string;
        message?: string;
        details?: Record<string, unknown>;
        requestId?: string;
      };
    },
    fallbackMessage?: string
  ): AppError {
    const data = response.data;

    return new AppError({
      code: response.status,
      errorCode: data?.status || AppError.getErrorCodeFromHttpStatus(response.status),
      message: data?.message || fallbackMessage || "发生了错误",
      details: data?.details,
      requestId: data?.requestId,
    });
  }

  /**
   * Field-level validation failures, when present.
   * Populated for parameter-validation errors (`status === VALIDATION_ERROR`).
   */
  get fieldErrors(): FieldError[] {
    const raw = this.details?.fieldErrors;
    return Array.isArray(raw) ? (raw as FieldError[]) : [];
  }

  /**
   * Map HTTP status to ErrorCode
   */
  private static getErrorCodeFromHttpStatus(status: number): string {
    switch (status) {
      case 400: return ErrorCode.BAD_REQUEST;
      case 401: return ErrorCode.UNAUTHORIZED;
      case 403: return ErrorCode.FORBIDDEN;
      case 404: return ErrorCode.NOT_FOUND;
      case 409: return ErrorCode.CONFLICT;
      case 410: return ErrorCode.GONE;
      case 422: return ErrorCode.UNPROCESSABLE_ENTITY;
      case 429: return ErrorCode.TOO_MANY_REQUESTS;
      case 500: return ErrorCode.INTERNAL_SERVER_ERROR;
      case 501: return ErrorCode.NOT_IMPLEMENTED;
      case 502: return ErrorCode.EXTERNAL_SERVICE_ERROR;
      case 503: return ErrorCode.SERVICE_UNAVAILABLE;
      case 504: return ErrorCode.GATEWAY_TIMEOUT;
      default: return ErrorCode.UNKNOWN_ERROR;
    }
  }

  /**
   * Convert to plain object
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      errorCode: this.errorCode,
      message: this.message,
      details: this.details,
      requestId: this.requestId,
      timestamp: this.timestamp,
      severity: this.severity,
      isNetworkError: this.isNetworkError,
      isTimeoutError: this.isTimeoutError,
    };
  }
}
