import { AlertCircle, Clock, ShieldAlert, WifiOff } from "lucide-react";

import { cn } from "./lib/cn";
import { Button } from "./button";

export interface ErrorDisplayError {
  code?: string | number;
  errorCode?: string;
  message?: string;
  requestId?: string;
}

export interface ErrorDisplayProps {
  error: ErrorDisplayError | Error | null;
  onRetry?: () => void;
  className?: string;
  retryableCodes?: string[];
}

const DEFAULT_RETRYABLE_CODES = [
  "NETWORK_ERROR",
  "TIMEOUT_ERROR",
  "GATEWAY_TIMEOUT",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_SERVER_ERROR",
  "EXTERNAL_SERVICE_ERROR",
  "EXTERNAL_SERVICE_TIMEOUT",
  "EXTERNAL_SERVICE_UNAVAILABLE",
  "OPERATION_FAILED",
];

function normalizeError(error: ErrorDisplayError | Error): Required<ErrorDisplayError> {
  if (error instanceof Error) {
    const maybeCode =
      "errorCode" in error
        ? (error as { errorCode?: string }).errorCode
        : "code" in error
          ? (error as { code?: string | number }).code
          : "UNKNOWN_ERROR";

    return {
      code: maybeCode ?? "UNKNOWN_ERROR",
      errorCode: String(maybeCode ?? "UNKNOWN_ERROR"),
      message: error.message || "发生了错误",
      requestId: "requestId" in error ? String((error as { requestId?: string }).requestId ?? "") : "",
    };
  }

  const code = error.errorCode ?? error.code ?? "UNKNOWN_ERROR";

  return {
    code,
    errorCode: String(code),
    message: error.message || "发生了错误",
    requestId: error.requestId ?? "",
  };
}

function iconForCode(code: string) {
  if (code === "NETWORK_ERROR") return <WifiOff className="h-5 w-5" />;
  if (code === "TIMEOUT_ERROR" || code === "GATEWAY_TIMEOUT") {
    return <Clock className="h-5 w-5" />;
  }
  if (code === "UNAUTHORIZED" || code === "TOKEN_EXPIRED" || code === "TOKEN_INVALID" || code === "TOKEN_MISSING") {
    return <ShieldAlert className="h-5 w-5" />;
  }
  return <AlertCircle className="h-5 w-5" />;
}

function toneForCode(code: string) {
  if (code === "TIMEOUT_ERROR" || code === "GATEWAY_TIMEOUT") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (code === "UNAUTHORIZED" || code === "TOKEN_EXPIRED" || code === "TOKEN_INVALID" || code === "TOKEN_MISSING") {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  if (code === "FORBIDDEN" || code === "PERMISSION_DENIED") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }
  if (code === "NOT_FOUND" || code === "RESOURCE_NOT_FOUND") {
    return "border-border bg-[#f8fafc] text-muted-foreground";
  }
  return "border-red-200 bg-red-50 text-red-700";
}

function ErrorDisplay({
  error,
  onRetry,
  className,
  retryableCodes = DEFAULT_RETRYABLE_CODES,
}: ErrorDisplayProps) {
  if (!error) return null;

  const normalized = normalizeError(error);
  const isRetryable = retryableCodes.includes(normalized.errorCode);

  return (
    <div className={cn("rounded-[8px] border p-4", toneForCode(normalized.errorCode), className)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">{iconForCode(normalized.errorCode)}</div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{normalized.message}</div>
          {normalized.requestId && <div className="mt-1 text-xs opacity-75">请求ID: {normalized.requestId}</div>}
          {isRetryable && onRetry && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onRetry}
                className="h-8 bg-white/60 text-xs hover:bg-white/90"
              >
                重试
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export interface FormErrorProps {
  error: ErrorDisplayError | Error | null;
  className?: string;
}

function FormError({ error, className }: FormErrorProps) {
  if (!error) return null;

  return <ErrorDisplay error={error} className={cn("text-sm", className)} />;
}

export { ErrorDisplay, FormError };
