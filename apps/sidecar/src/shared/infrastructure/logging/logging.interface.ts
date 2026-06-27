// ============================================================================
// Logging Infrastructure Interface
// ============================================================================

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface LogContext {
    requestId?: string;
    userId?: string;
    organizationId?: string;
    correlationId?: string;
    userAgent?: string;
    ip?: string;
    method?: string;
    url?: string;
    statusCode?: number;
    responseTime?: number;
    [key: string]: unknown;
}

export interface ILogger {
    fatal(message: string, context?: Partial<LogContext>): void;
    error(message: string, context?: Partial<LogContext>): void;
    error(error: Error, context?: Partial<LogContext>): void;
    warn(message: string, context?: Partial<LogContext>): void;
    info(message: string, context?: Partial<LogContext>): void;
    debug(message: string, context?: Partial<LogContext>): void;
    trace(message: string, context?: Partial<LogContext>): void;

    log(level: LogLevel, message: string, context?: Partial<LogContext>): void;
    child(context: Partial<LogContext>): ILogger;
}
