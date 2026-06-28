import { getAgentRuntimeOptional } from "@/runtime";
import constants from "./constants";
import { hasTauriCore } from "./runtime-environment";

const FIXED_GATEWAY_URL = "http://127.0.0.1:29653";

let sidecarGatewayBaseUrl = normalizeGatewayUrl(constants.gatewayUrl || "");

export type SidecarHealthProbeResult = {
  ok: boolean;
  url?: string;
  error?: string;
  attempts: string[];
};

export type SidecarFetchOptions = {
  init?: RequestInit;
  timeoutMs?: number;
  gatewayCandidates?: boolean;
};

type SidecarFetchInput = RequestInit | SidecarFetchOptions;

function normalizeGatewayUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function isLoopbackUrl(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const resolved = new URL(url, window.location.href);
    return resolved.protocol === "http:" && isLoopbackHostname(resolved.hostname);
  } catch {
    return false;
  }
}

function normalizeHeaders(init?: RequestInit): Record<string, string> {
  const normalized: Record<string, string> = {};
  const headers = init?.headers;
  if (!headers) return normalized;

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
    return normalized;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      normalized[key] = value;
    }
    return normalized;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[key] = value.join(", ");
    } else if (value != null) {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}

function withTimeoutSignal(
  init: RequestInit | undefined,
  timeoutMs: number | undefined,
): { init: RequestInit | undefined; cleanup: () => void } {
  if (!timeoutMs || timeoutMs <= 0 || typeof AbortController !== "function") {
    return { init, cleanup: () => {} };
  }

  let timedOut = false;
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const relayAbort = () => controller.abort();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      relayAbort();
    } else {
      upstreamSignal.addEventListener("abort", relayAbort, { once: true });
    }
  }

  return {
    init: {
      ...init,
      signal: controller.signal,
    },
    cleanup: () => {
      clearTimeout(timeoutId);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener("abort", relayAbort);
      }
      if (timedOut) {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
    },
  };
}

async function tauriLoopbackFetch(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<{
    status: number;
    headers: Record<string, string>;
    body: number[];
  }>("loopback_http_request", {
    request: {
      url,
      method: init?.method ?? "GET",
      headers: normalizeHeaders(init),
      body: typeof init?.body === "string" ? init.body : init?.body == null ? null : String(init.body),
      timeoutMs,
    },
  });

  return new Response(new Uint8Array(result.body), {
    status: result.status,
    headers: result.headers,
  });
}

async function transportFetch(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  const runtime = getAgentRuntimeOptional();
  if (runtime && !runtime.isDesktop) {
    const timed = withTimeoutSignal(init, timeoutMs);
    try {
      return await runtime.fetch(url, timed.init);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError" && timeoutMs && timeoutMs > 0) {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      try {
        timed.cleanup();
      } catch {
        // Timeout is already surfaced through fetch abort above.
      }
    }
  }

  if (hasTauriCore()) {
    if (isLoopbackUrl(url)) {
      return tauriLoopbackFetch(url, init, timeoutMs);
    }
    try {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      return tauriFetch(url, init);
    } catch {
      // Fall through to browser fetch for dev/web environments.
    }
  }

  const timed = withTimeoutSignal(init, timeoutMs);
  try {
    return await fetch(url, timed.init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && timeoutMs && timeoutMs > 0) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    try {
      timed.cleanup();
    } catch {
      // Timeout is already surfaced through fetch abort above.
    }
  }
}

export function setSidecarGatewayBaseUrl(url: string): void {
  const normalized = normalizeGatewayUrl(url);
  if (normalized) {
    sidecarGatewayBaseUrl = normalized;
  }
}

export function getSidecarGatewayUrl(): string {
  const runtime = getAgentRuntimeOptional();
  const runtimeGatewayUrl = normalizeGatewayUrl(runtime?.gatewayUrl || "");
  if (runtimeGatewayUrl) {
    return runtimeGatewayUrl;
  }

  // In browser context without explicit gateway URL, use relative URLs (goes through rsbuild proxy)
  if (typeof window !== "undefined" && !sidecarGatewayBaseUrl && !constants.gatewayUrl) {
    return "";
  }
  return sidecarGatewayBaseUrl || constants.gatewayUrl || FIXED_GATEWAY_URL;
}

export function getSidecarGatewayUrls(): string[] {
  const runtime = getAgentRuntimeOptional();
  const runtimeGatewayUrl = normalizeGatewayUrl(runtime?.gatewayUrl || "");
  if (runtimeGatewayUrl) {
    return [runtimeGatewayUrl];
  }

  return Array.from(
    new Set(
      [sidecarGatewayBaseUrl, constants.gatewayUrl, FIXED_GATEWAY_URL]
        .map((item) => normalizeGatewayUrl(item || ""))
        .filter(Boolean),
    ),
  );
}

export function sidecarUrl(pathOrUrl: string, gateway = getSidecarGatewayUrl()) {
  if (isAbsoluteHttpUrl(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${gateway}${path}`;
}

export function sidecarApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/api/v1" || normalized.startsWith("/api/v1/")) {
    return sidecarUrl(normalized);
  }
  if (normalized === "/api" || normalized.startsWith("/api/")) {
    return sidecarUrl(`/api/v1${normalized.slice("/api".length)}`);
  }
  return sidecarUrl(`/api/v1${normalized}`);
}

export async function sidecarFetch(pathOrUrl: string, input: SidecarFetchInput = {}): Promise<Response> {
  const options =
    "init" in input || "timeoutMs" in input || "gatewayCandidates" in input
      ? (input as SidecarFetchOptions)
      : ({ init: input as RequestInit } satisfies SidecarFetchOptions);
  const urls =
    options.gatewayCandidates && !isAbsoluteHttpUrl(pathOrUrl)
      ? getSidecarGatewayUrls().map((gateway) => sidecarUrl(pathOrUrl, gateway))
      : [sidecarUrl(pathOrUrl)];

  let lastError: unknown;
  for (const url of urls) {
    try {
      return await transportFetch(url, options.init, options.timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Sidecar request failed: ${pathOrUrl}`);
}

export async function probeSidecarHealth(options?: { timeoutMs?: number }): Promise<SidecarHealthProbeResult> {
  let lastError = "Local gateway health check failed";
  const attempts: string[] = [];

  for (const gateway of getSidecarGatewayUrls()) {
    const url = `${gateway}/api/v1/health`;
    try {
      const response = await sidecarFetch(url, {
        timeoutMs: options?.timeoutMs ?? 2500,
        init: { cache: "no-store" },
      });
      attempts.push(`GET ${url} -> ${response.status}`);
      if (response.ok) {
        return { ok: true, url: gateway, attempts };
      }
      lastError = `GET ${url} -> ${response.status}`;
    } catch (error) {
      const message = formatUnknownError(error);
      attempts.push(`GET ${url} -> ${message}`);
      lastError = `GET ${url} -> ${message}`;
    }
  }

  return { ok: false, error: lastError, attempts };
}
