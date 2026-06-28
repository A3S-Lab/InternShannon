import { toast } from "sonner";
import { AppError } from "@/lib/error";
import type { FieldError } from "@/lib/constants";

export type ClientErrorKind =
	| "api"
	| "backend-unavailable"
	| "network"
	| "timeout"
	| "render"
	| "validation"
	| "unknown";

export type ClientErrorSeverity = "error" | "warning" | "info";

/**
 * How a normalized error should be surfaced to the user.
 * - `toast`        — transient, auto-dismiss (default).
 * - `notification` — richer & persistent: longer duration, request id, action button.
 * - `inline`       — caller renders the returned ClientError itself (no global UI).
 * - `silent`       — normalize + log only, show nothing.
 */
export type ClientErrorDisplay = "toast" | "notification" | "inline" | "silent";

export interface ClientError {
	kind: ClientErrorKind;
	severity: ClientErrorSeverity;
	title: string;
	message: string;
	details?: string;
	code?: string;
	status?: number;
	requestId?: string;
	/** Per-field validation failures, when the error is a parameter-validation error. */
	fieldErrors?: FieldError[];
	source?: string;
	retryable: boolean;
	cause?: unknown;
}

export interface ClientErrorContext {
	title?: string;
	message?: string;
	source?: string;
	severity?: ClientErrorSeverity;
	kind?: ClientErrorKind;
	retryable?: boolean;
	details?: string;
	code?: string;
	status?: number;
	/** Presentation mode. Defaults to `toast`. */
	display?: ClientErrorDisplay;
	/** Optional retry handler — surfaced as an action button in `notification` mode. */
	retry?: () => void;
	/** Override the auto-dismiss duration (ms). */
	durationMs?: number;
}

const ERROR_TOAST_DEDUPE_MS = 2500;
const recentErrorToastAt = new Map<string, number>();

export function stringifyUnknown(value: unknown): string {
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function getClientErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (typeof error === "object" && error && "message" in error) {
		return String((error as { message?: unknown }).message ?? "未知错误");
	}
	return "未知错误";
}

function isTimeoutMessage(message: string): boolean {
	return /timed out|timeout|aborted/i.test(message);
}

function isBackendUnavailableMessage(message: string): boolean {
	return /backend|gateway|sidecar|api\/health|failed to fetch|networkerror|connection refused|ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(
		message,
	);
}

/** Render field-level validation failures as readable lines for a toast/body. */
function fieldErrorsToText(fieldErrors: FieldError[]): string {
	return fieldErrors
		.map((entry) => `· ${entry.field}：${entry.messages.join("；")}`)
		.join("\n");
}

/** Append per-field messages to a base message so the toast pinpoints the failure. */
function withFieldErrors(base: string, fieldErrors: FieldError[]): string {
	if (fieldErrors.length === 0) return base;
	return `${base}\n${fieldErrorsToText(fieldErrors)}`;
}

/**
 * Pull a human-readable reason out of the backend error contract's `details`
 * object. The backend captures the deep cause here (for example, a sidecar or
 * upstream runtime message), but until now it was dropped and only the one-line
 * `message` reached the user. Prefer common reason fields; otherwise compactly
 * stringify the remaining structure. `fieldErrors` are surfaced separately.
 */
function backendDetailText(details: Record<string, unknown> | undefined): string | null {
	if (!details || typeof details !== "object") return null;
	for (const key of ["reason", "cause", "error", "detail", "description", "hint"]) {
		const value = (details as Record<string, unknown>)[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	const { fieldErrors: _omitFieldErrors, ...rest } = details as Record<string, unknown>;
	if (Object.keys(rest).length === 0) return null;
	try {
		const json = JSON.stringify(rest);
		if (json === "{}" || json === "null" || json === "undefined") return null;
		return json.length > 500 ? `${json.slice(0, 500)}…` : json;
	} catch {
		return null;
	}
}

/** Fold a backend detail line into the message so every display surfaces it. */
function appendBackendDetail(message: string, detail: string | null): string {
	if (!detail || message.includes(detail)) return message;
	return `${message}\n${detail}`;
}

export function formatClientErrorDetails(error: ClientError): string {
	return [
		error.source ? `source=${error.source}` : null,
		`kind=${error.kind}`,
		error.status != null ? `status=${error.status}` : null,
		error.code ? `code=${error.code}` : null,
		error.details,
	]
		.filter(Boolean)
		.join("\n");
}

export function normalizeClientError(
	error: unknown,
	context: ClientErrorContext = {},
): ClientError {
	if (error instanceof AppError) {
		const fieldErrors = error.fieldErrors;
		const backendDetail = backendDetailText(error.details);
		const isValidation =
			error.errorCode === "VALIDATION_ERROR" || fieldErrors.length > 0;
		const backendUnavailable =
			error.isNetworkError || error.errorCode === "BACKEND_NOT_READY";
		return {
			kind:
				context.kind ??
				(backendUnavailable
					? "backend-unavailable"
					: isValidation
						? "validation"
						: "api"),
			severity:
				context.severity ?? (backendUnavailable ? "warning" : "error"),
			title:
				context.title ??
				(backendUnavailable
					? "本地 API 暂不可用"
					: isValidation
						? "请检查输入内容"
						: "请求失败"),
			message:
				context.message ??
				withFieldErrors(appendBackendDetail(error.message, backendDetail), fieldErrors),
			details:
				context.details ??
				[
					`status=${error.code}`,
					error.errorCode ? `code=${error.errorCode}` : null,
					error.requestId ? `requestId=${error.requestId}` : null,
					backendDetail ? `detail=${backendDetail}` : null,
					fieldErrors.length > 0 ? fieldErrorsToText(fieldErrors) : null,
				]
					.filter(Boolean)
					.join("\n"),
			code: error.errorCode,
			status: error.code,
			requestId: error.requestId,
			fieldErrors: fieldErrors.length > 0 ? fieldErrors : undefined,
			source: context.source,
			retryable: context.retryable ?? backendUnavailable,
			cause: error,
		};
	}

	const message = context.message ?? getClientErrorMessage(error);
	const timedOut = isTimeoutMessage(message);
	const backendUnavailable = isBackendUnavailableMessage(message);
	const kind =
		context.kind ??
		(timedOut
			? "timeout"
			: backendUnavailable
				? "backend-unavailable"
				: "unknown");

	return {
		kind,
		severity:
			context.severity ??
			(kind === "backend-unavailable" ? "warning" : "error"),
		title:
			context.title ??
			(kind === "timeout"
				? "请求超时"
				: kind === "backend-unavailable"
					? "本地 API 暂不可用"
					: "操作失败"),
		message,
		details: context.details ?? stringifyUnknown(error),
		code: context.code,
		status: context.status,
		source: context.source,
		retryable: context.retryable ?? kind !== "validation",
		cause: error,
	};
}

export function clientErrorToDetails(error: ClientError): string {
	return formatClientErrorDetails(error);
}

function getErrorToastKey(error: ClientError): string {
	return [
		error.severity,
		error.message,
		error.code ?? "",
		error.status ?? "",
	].join("|");
}

function shouldShowErrorToast(error: ClientError): boolean {
	const now = Date.now();
	const key = getErrorToastKey(error);
	const previous = recentErrorToastAt.get(key) ?? 0;
	if (now - previous < ERROR_TOAST_DEDUPE_MS) {
		return false;
	}
	recentErrorToastAt.set(key, now);
	for (const [itemKey, timestamp] of recentErrorToastAt) {
		if (now - timestamp > ERROR_TOAST_DEDUPE_MS * 4) {
			recentErrorToastAt.delete(itemKey);
		}
	}
	return true;
}

function buildErrorDescription(normalized: ClientError): string {
	const base =
		normalized.kind === "backend-unavailable"
			? `${normalized.message}。你可以继续浏览界面，依赖 API 的操作会在服务恢复后可用。`
			: normalized.message;
	// Trace id makes "接口报错的详细信息" actually reportable; only when present.
	return normalized.requestId ? `${base}\n请求 ID：${normalized.requestId}` : base;
}

function toastFnForSeverity(severity: ClientErrorSeverity) {
	return severity === "warning"
		? toast.warning
		: severity === "info"
			? toast.info
			: toast.error;
}

/**
 * The single entry point for surfacing an error to the user.
 *
 * Normalizes any thrown value into a {@link ClientError} and presents it
 * according to `context.display`:
 *  - `toast` (default): transient toast, deduped within a short window.
 *  - `notification`: persistent, richer toast carrying the request id and an
 *    optional retry action — use for failures the user likely needs to act on.
 *  - `inline`: presents nothing; the caller renders the returned ClientError
 *    (e.g. with <UnifiedError variant="inline" />).
 *  - `silent`: normalize + log only.
 *
 * Always returns the normalized error so inline/silent callers can render it.
 */
export function presentClientError(
	error: unknown,
	context: ClientErrorContext = {},
): ClientError {
	const normalized = normalizeClientError(error, context);
	const display = context.display ?? "toast";

	if (display !== "silent" && display !== "inline") {
		const isNotification = display === "notification";
		// requestId is folded into buildErrorDescription for every mode now.
		const description = buildErrorDescription(normalized);
		const toastFn = toastFnForSeverity(normalized.severity);

		if (shouldShowErrorToast(normalized)) {
			toastFn(normalized.title, {
				description,
				duration:
					context.durationMs ?? (isNotification ? 10000 : undefined),
				action: context.retry
					? { label: "重试", onClick: context.retry }
					: undefined,
			});
		}
	}

	if (context.source || normalized.kind !== "validation") {
		console.error("[client-error]", normalized, normalized.cause);
	}

	return normalized;
}

/**
 * Backwards-compatible toast helper. Equivalent to
 * `presentClientError(error, { display: "toast", ...context })`.
 */
export function notifyClientError(
	error: unknown,
	context: ClientErrorContext = {},
): ClientError {
	return presentClientError(error, { ...context, display: context.display ?? "toast" });
}

/**
 * App-wide error toast for failed API requests, called from the `apiClient`
 * interceptor (see lib/api/client.ts) for every request. It surfaces the
 * backend's specific reason (contract `message`) as a deduped toast so no
 * request fails silently.
 *
 * Skipped cases:
 *  - field-level validation errors: those belong inline on the form via
 *    {@link applyFieldErrorsToForm}, not in a global toast.
 *
 * Callers that want silence for a specific request (background / polling reads)
 * pass `suppressErrorToast` to the apiClient instead. Deduped within
 * {@link presentClientError}, so a call site that also surfaces the same error
 * via presentClientError/notifyClientError won't double-toast.
 */
export function reportRequestError(error: unknown): void {
	if (error instanceof AppError) {
		if (error.fieldErrors.length > 0) return;
	}
	presentClientError(error, { display: "toast", durationMs: 6000 });
}

/**
 * Map a normalized error's field validation failures back onto a form.
 *
 * Pass a setter like react-hook-form's `setError`. Returns the number of
 * fields that were mapped, so callers can decide whether to also toast.
 *
 * @example
 *   const err = presentClientError(e, { display: "silent" });
 *   const mapped = applyFieldErrorsToForm(err, (field, message) =>
 *     form.setError(field, { message }),
 *   );
 *   if (mapped === 0) notifyClientError(e);
 */
export function applyFieldErrorsToForm(
	error: ClientError,
	setError: (field: string, message: string) => void,
	options?: { knownFields?: readonly string[] },
): number {
	const fieldErrors = error.fieldErrors ?? [];
	let mapped = 0;
	for (const entry of fieldErrors) {
		// Skip fields the form doesn't own, so a server-only field never
		// produces a phantom error that silently swallows the fallback banner.
		if (options?.knownFields && !options.knownFields.includes(entry.field)) {
			continue;
		}
		setError(entry.field, entry.messages.join("；"));
		mapped += 1;
	}
	return mapped;
}
