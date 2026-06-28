/**
 * Compatibility API helpers. `apiFetch` is now a thin wrapper over the single
 * shared request mechanism `apiClient.request()` — it only adds the desktop
 * sidecar readiness gate. Everything else (envelope unwrap, the global
 * error-toast interceptor, the {@link AppError} contract) is inherited from
 * apiClient, so there is ONE request mechanism and ONE error contract across
 * the app.
 *
 * Streaming / binary go through the raw escape hatch (`apiRawFetch` /
 * `apiRawUpload` in ./api/client), which deliberately stays separate.
 */
import { jsonBody as coreJsonBody, type ApiErrorResponse } from "./shared";
import { waitForBackendReady } from "./backend-ready";
import { setSidecarGatewayBaseUrl } from "./sidecar-http";
import { AppError } from "./error";
import { apiClient, apiUrl as coreApiUrl } from "./api/client";

export function setGatewayBaseUrl(url: string): void {
	setSidecarGatewayBaseUrl(url);
}

function formatUnknownError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (typeof error === "object" && error && "message" in error) {
		return String((error as { message?: unknown }).message ?? "Unknown error");
	}
	return String(error || "Unknown error");
}

export type { ApiErrorResponse };

/** Build a gateway API URL from a resource path like "/users" -> "http://.../api/v1/users". */
export function apiUrl(path: string): string {
	return coreApiUrl(path);
}

/**
 * Fetch JSON from the gateway API. Delegates to the shared `apiClient.request()`
 * after gating on desktop sidecar readiness, so failures throw {@link AppError}
 * and are surfaced by the global error-toast interceptor like any other request.
 */
export async function apiFetch<T = unknown>(
	path: string,
	init?: RequestInit,
): Promise<T> {
	try {
		await waitForBackendReady({ timeoutMs: 15000 });
	} catch (error) {
		throw new AppError({
			code: 503,
			errorCode: "BACKEND_NOT_READY",
			message: `本地 API 尚未就绪：${formatUnknownError(error)}`,
			isNetworkError: true,
		});
	}

	return apiClient.request<T>(path, init);
}

/** Shorthand for JSON POST/PATCH/PUT body */
export function jsonBody(method: string, body: unknown): RequestInit {
	return coreJsonBody(method, body);
}
