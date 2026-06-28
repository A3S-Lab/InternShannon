/**
 * Base API Client
 * Provides unified fetch wrapper with error handling
 */

import { reportRequestError } from "@/lib/client-error";
import { AppError } from "@/lib/error";
import { type ApiResponse, unwrapApiResponse } from "@/lib/shared";
import { getAgentRuntimeOptional } from "@/runtime";

const configuredApiBaseUrl = (() => {
  const importMetaEnv = (typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {}) as Record<
    string,
    unknown
  >;

  const publicApiBaseUrl = importMetaEnv.PUBLIC_API_BASE_URL as string | undefined;
  const viteApiUrl = importMetaEnv.VITE_API_URL as string | undefined;
  return [publicApiBaseUrl, viteApiUrl].find((value) => typeof value === "string" && value.trim()) as
    | string
    | undefined;
})();

const resolveConfiguredApiBaseUrl = () => {
  // In the browser the REST base URL always follows the access origin: whichever
  // address (internal vs external) the user loaded the SPA from is the one its
  // API calls target. This is unconditional by design — a build-time
  // PUBLIC_API_BASE_URL / VITE_API_URL must NOT pin the shipped bundle to a
  // single host, otherwise an intranet user would be routed to the public
  // address (and vice versa). It also mirrors the gateway/WebSocket chain
  // (settings.model.ts getGatewayUrl), which already prefers same-origin.
  // Desktop's sidecar gateway is resolved earlier in getApiBaseUrl(); only
  // non-browser (Node / tooling / SSR) contexts honour the configured value.
  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/$/, "");
  }
  const candidate = typeof configuredApiBaseUrl === "string" ? configuredApiBaseUrl.trim() : "";
  if (candidate) {
    return normalizeApiBase(candidate);
  }
  return "http://localhost:29653";
};

export const getApiBaseUrl = () => {
  const runtime = getAgentRuntimeOptional();
  const runtimeGatewayUrl = normalizeApiBase(runtime?.gatewayUrl || "");
  if (runtime?.isDesktop && runtimeGatewayUrl) {
    return runtimeGatewayUrl;
  }
  return resolveConfiguredApiBaseUrl();
};

const API_PREFIX = "/api/v1";
const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

function isAbsoluteHttpUrl(url: string): boolean {
  return ABSOLUTE_HTTP_URL.test(url);
}

function normalizeApiBase(url: string) {
  const trimmed = url.trim().replace(/\/$/, "");
  if (trimmed.endsWith("/api/v1/docs-json")) {
    return trimmed.replace(/\/api\/v1\/docs-json$/, "");
  }
  if (trimmed.endsWith("/api/v1/docs")) {
    return trimmed.replace(/\/api\/v1\/docs$/, "");
  }
  if (trimmed.endsWith("/openapi.json") || trimmed.endsWith("/docs")) {
    return trimmed.replace(/\/(?:openapi\.json|docs)$/, "");
  }
  if (trimmed.endsWith("/api/v1")) {
    return trimmed.replace(/\/api\/v1$/, "");
  }
  if (trimmed.endsWith("/api")) {
    return trimmed.replace(/\/api$/, "");
  }
  return trimmed;
}

function normalizeApiEndpoint(endpoint: string): string {
  if (isAbsoluteHttpUrl(endpoint)) {
    return endpoint;
  }
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (path === "/api") {
    return API_PREFIX;
  }
  if (path.startsWith(`${API_PREFIX}/`)) {
    return path;
  }
  if (path.startsWith("/api/")) {
    return `${API_PREFIX}${path.slice("/api".length)}`;
  }
  return `${API_PREFIX}${path}`;
}

export const API_BASE_URL = getApiBaseUrl();

export function apiUrl(endpoint: string, baseUrl = getApiBaseUrl()): string {
  if (isAbsoluteHttpUrl(endpoint)) {
    return endpoint;
  }
  return `${normalizeApiBase(baseUrl)}${normalizeApiEndpoint(endpoint)}`;
}

const REQUEST_TIMEOUT = 30000; // 30 seconds

export type { ApiResponse };

interface NetworkError {
  message: string;
  name: string;
}

export interface ApiRequestInit extends RequestInit {
  timeoutMs?: number;
  /**
   * Opt out of the global error toast for this request. Use for background /
   * polling reads where a failure is non-actionable and a toast would be noise
   * (the caller still gets the thrown error to handle as it sees fit).
   */
  suppressErrorToast?: boolean;
}

type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface PrepareApiRequestOptions {
  defaultContentType?: string;
}

interface PreparedApiRequest {
  url: string;
  init: ApiRequestInit;
  headers: Headers;
  fetcher: ApiFetch;
}

function isForbiddenReadError(error: unknown, options: ApiRequestInit): boolean {
  return error instanceof AppError && error.code === 403 && (options.method ?? "GET").toUpperCase() === "GET";
}

export async function apiRawFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  return apiClient.rawFetch(endpoint, init);
}

export interface ApiRawUploadInit {
  method?: string;
  body: XMLHttpRequestBodyInit;
  headers?: HeadersInit;
  onUploadProgress?: (loaded: number, total: number) => void;
}

function parseXhrHeaders(value: string) {
  const headers = new Headers();
  value
    .trim()
    .split(/[\r\n]+/)
    .filter(Boolean)
    .forEach((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) return;
      headers.append(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
    });
  return headers;
}

export async function apiRawUpload(endpoint: string, init: ApiRawUploadInit): Promise<Response> {
  return apiClient.rawUpload(endpoint, init);
}

class ApiClient {
  private baseUrl?: string;
  private timeout: number;

  constructor(baseUrl?: string, timeout: number = REQUEST_TIMEOUT) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  private getBaseUrl(): string {
    return this.baseUrl ? normalizeApiBase(this.baseUrl) : getApiBaseUrl();
  }

  private resolveUrl(endpoint: string): string {
    return apiUrl(endpoint, this.getBaseUrl());
  }

  private async prepareRequest(
    endpoint: string,
    options: ApiRequestInit = {},
    prepareOptions: PrepareApiRequestOptions = {},
  ): Promise<PreparedApiRequest> {
    const url = this.resolveUrl(endpoint);
    const headers = new Headers(options.headers as HeadersInit | undefined);
    if (prepareOptions.defaultContentType && !headers.has("Content-Type")) {
      headers.set("Content-Type", prepareOptions.defaultContentType);
    }

    const runtime = getAgentRuntimeOptional();
    const fetcher: ApiFetch = (requestUrl, init) => (runtime?.fetch ?? fetch)(requestUrl, init);

    return {
      url,
      headers,
      init: { ...options, headers },
      fetcher,
    };
  }

  async rawFetch(endpoint: string, init?: RequestInit): Promise<Response> {
    const prepare = () => this.prepareRequest(endpoint, init);
    const send = async (request: PreparedApiRequest) => request.fetcher(request.url, request.init);

    const request = await prepare();
    return send(request);
  }

  async rawUpload(endpoint: string, init: ApiRawUploadInit): Promise<Response> {
    const request = await this.prepareRequest(endpoint, { method: init.method ?? "POST", headers: init.headers });

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(request.init.method ?? "POST", request.url);
      request.headers.forEach((value, key) => {
        xhr.setRequestHeader(key, value);
      });
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        init.onUploadProgress?.(event.loaded, event.total);
      };
      xhr.onload = () => {
        resolve(
          new Response(xhr.responseText, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: parseXhrHeaders(xhr.getAllResponseHeaders()),
          }),
        );
      };
      xhr.onerror = () => reject(new Error("上传失败：网络连接异常"));
      xhr.onabort = () => reject(new Error("上传已取消"));
      xhr.send(init.body);
    });
  }

  private async fetchWithTimeout(request: PreparedApiRequest): Promise<Response> {
    const timeoutMs = request.init.timeoutMs;
    const fetchOptions: RequestInit = { ...request.init };
    delete (fetchOptions as ApiRequestInit).timeoutMs;
    delete (fetchOptions as ApiRequestInit).suppressErrorToast;
    const upstreamSignal = fetchOptions.signal;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs ?? this.timeout);
    const abortFromUpstream = () => controller.abort();

    if (upstreamSignal?.aborted) {
      clearTimeout(timeoutId);
      throw AppError.fromCancelled();
    }
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

    try {
      const response = await request.fetcher(request.url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === "AbortError") {
        throw timedOut ? AppError.fromTimeoutError() : AppError.fromCancelled();
      }
      throw AppError.fromNetworkError(error as NetworkError);
    } finally {
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  }

  async request<T>(endpoint: string, options: ApiRequestInit = {}): Promise<T> {
    try {
      return await this.sendRequest<T>(endpoint, options);
    } catch (error) {
      // Unified global error toast: every failed request surfaces the backend's
      // specific reason so nothing fails silently. reportRequestError skips 401
      // 401 / field validation are owned by specialized flows in
      // reportRequestError(). Read-only 403s are usually page-level gates or
      // background widgets; keep action failures visible while avoiding toast
      // storms during page load.
      if (!options.suppressErrorToast && !isForbiddenReadError(error, options)) {
        reportRequestError(error);
      }
      throw error;
    }
  }

  private async sendRequest<T>(endpoint: string, options: ApiRequestInit = {}): Promise<T> {
    const prepared = await this.prepareRequest(endpoint, options, {
      defaultContentType: "application/json",
    });
    const method = (prepared.init.method ?? "GET").toUpperCase();

    let response: Response;
    try {
      response = await this.fetchWithTimeout(prepared);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      console.error("[api] network error", method, prepared.url, error);
      throw AppError.fromNetworkError(error as NetworkError);
    }

    const { data, hasBody } = await this.parseResponse(response);

    if (!response.ok) {
      console.error(
        "[api] non-ok",
        method,
        prepared.url,
        response.status,
        data && typeof data === "object" && Object.keys(data).length > 0 ? data : undefined,
      );
      throw AppError.fromResponse(
        {
          status: response.status,
          data,
        },
        data?.message as string | undefined,
      );
    }

    if (!hasBody) {
      return undefined as T;
    }

    return unwrapApiResponse<T>(data);
  }

  get<T>(endpoint: string, options?: ApiRequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  }

  post<T>(endpoint: string, body?: unknown, options?: ApiRequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(endpoint: string, body?: unknown, options?: ApiRequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(endpoint: string, options?: ApiRequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  }

  patch<T>(endpoint: string, body?: unknown, options?: ApiRequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async parseResponse(response: Response): Promise<{ data: Record<string, unknown>; hasBody: boolean }> {
    if (response.status === 204) {
      return { data: {}, hasBody: false };
    }

    const text = await response.text();
    if (!text) {
      if (!response.ok) {
        throw AppError.fromResponse({ status: response.status }, "服务器响应为空");
      }
      return { data: {}, hasBody: false };
    }

    try {
      return {
        data: JSON.parse(text) as Record<string, unknown>,
        hasBody: true,
      };
    } catch {
      if (!response.ok) {
        throw AppError.fromResponse({ status: response.status }, "服务器响应格式错误");
      }
      throw AppError.fromResponse({ status: response.status }, "解析响应失败");
    }
  }

}

export const apiClient = new ApiClient();
