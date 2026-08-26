export interface NativeLoopbackHttpRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
	timeoutMs?: number;
}

export interface NativeLoopbackHttpResponse {
	status: number;
	headers: Record<string, string>;
	body: number[];
}

function normalizeHeaders(init?: RequestInit): Record<string, string> {
	return init?.headers
		? Object.fromEntries(new Headers(init.headers).entries())
		: {};
}

export function nativeLoopbackInvokeArgs(
	url: string,
	init?: RequestInit,
	timeoutMs?: number,
): { request: NativeLoopbackHttpRequest } {
	return {
		request: {
			url,
			method: init?.method || "GET",
			headers: normalizeHeaders(init),
			body:
				typeof init?.body === "string"
					? init.body
					: init?.body == null
						? null
						: String(init.body),
			...(timeoutMs !== undefined ? { timeoutMs } : {}),
		},
	};
}

export function responseFromNativeLoopback(
	result: NativeLoopbackHttpResponse,
): Response {
	const body = [204, 205, 304].includes(result.status)
		? null
		: new Uint8Array(result.body);
	return new Response(body, {
		status: result.status,
		headers: result.headers,
	});
}
