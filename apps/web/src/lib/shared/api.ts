import type { ApiResponse } from "./types";

export function unwrapApiResponse<T>(response: unknown): T {
	if (
		response !== null &&
		typeof response === "object" &&
		!Array.isArray(response) &&
		"data" in response &&
		(("code" in response && "message" in response) || "_meta" in response)
	) {
		return (response as ApiResponse<T>).data;
	}
	return response as T;
}

export function jsonBody(method: string, body: unknown): RequestInit {
	return {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
}

export function toQueryString(
	params?: Record<string, string | number | boolean | null | undefined>,
): string {
	if (!params) return "";
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== "") {
			search.set(key, String(value));
		}
	}
	const query = search.toString();
	return query ? `?${query}` : "";
}
