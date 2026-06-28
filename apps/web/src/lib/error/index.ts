/**
 * Error Handling Module
 * Unified error types and utilities
 */

export { ErrorCode, ErrorSeverity, getErrorSeverity, shouldRetry } from "./errors";
export { AppError, type AppErrorOptions } from "./app-error";
