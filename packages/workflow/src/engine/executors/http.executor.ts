import { Logger } from '@nestjs/common';
import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType, HTTPNodeData } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

/**
 * HTTP Method type
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** HTTP node Authorization config (Dify parity): none / Basic / Bearer / custom header. */
export interface HttpAuthConfig {
    type?: 'none' | 'basic' | 'bearer' | 'custom';
    username?: string;
    password?: string;
    token?: string;
    headerName?: string;
    headerValue?: string;
}

/**
 * Build the request header for an HTTP Authorization config. Bearer → `Authorization:
 * Bearer <token>`; Basic → `Authorization: Basic <base64(user:pass)>`; custom → a
 * named header. Returns null for none / empty config. Pure + total → unit-testable.
 */
export function buildAuthorizationHeader(auth: HttpAuthConfig | undefined): { name: string; value: string } | null {
    if (!auth || !auth.type || auth.type === 'none') return null;
    if (auth.type === 'bearer') {
        const token = (auth.token ?? '').trim();
        return token ? { name: 'Authorization', value: `Bearer ${token}` } : null;
    }
    if (auth.type === 'basic') {
        const username = auth.username ?? '';
        const password = auth.password ?? '';
        if (!username && !password) return null;
        const encoded = Buffer.from(`${username}:${password}`, 'utf-8').toString('base64');
        return { name: 'Authorization', value: `Basic ${encoded}` };
    }
    if (auth.type === 'custom') {
        const name = (auth.headerName ?? '').trim();
        return name ? { name, value: auth.headerValue ?? '' } : null;
    }
    return null;
}

/**
 * HTTP Body type
 */
export enum HTTPBodyType {
    None = 'none',
    JSON = 'json',
    FormData = 'form-data',
    RawText = 'raw-text',
    Binary = 'binary',
    XWwwFormUrlencoded = 'x-www-form-urlencoded',
}

/**
 * HTTP Node Executor
 * Makes HTTP requests
 */
export class HTTPNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.HTTP;
    private readonly logger = new Logger(HTTPNodeExecutor.name);

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = node.data as HTTPNodeData;
        const method = data.method || 'GET';
        const url = data.url;
        const headers = data.headers || {};
        const timeout = data.timeout || 30000;
        const retryTimes = data.retryTimes || 0;

        if (!url) {
            throw new Error(`HTTP node ${node.id}: url is required`);
        }

        // Resolve URL template with inputs
        const resolvedUrl = this.resolveTemplate(url, inputs);
        const resolvedHeaders = this.resolveHeaders(headers, inputs);

        // Dify Authorization parity: apply the node's auth config as a request
        // header (Basic / Bearer / custom), unless an explicit same-name header
        // already set it.
        const authHeader = buildAuthorizationHeader((data as HTTPNodeData & { auth?: HttpAuthConfig }).auth);
        if (authHeader && !Object.keys(resolvedHeaders).some(k => k.toLowerCase() === authHeader.name.toLowerCase())) {
            resolvedHeaders[authHeader.name] = authHeader.value;
        }

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= retryTimes; attempt++) {
            // Check cancellation before each attempt
            cancellationToken?.throwIfCancelled();

            try {
                const response = await this.executeRequest(
                    method as HTTPMethod,
                    resolvedUrl,
                    resolvedHeaders,
                    data,
                    inputs,
                    timeout,
                    cancellationToken,
                );
                return response;
            } catch (error) {
                lastError = error as Error;
                if (attempt < retryTimes) {
                    // Check cancellation before retry delay
                    cancellationToken?.throwIfCancelled();
                    // Exponential backoff
                    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
                }
            }
        }

        throw lastError || new Error(`HTTP request failed after ${retryTimes + 1} attempts`);
    }

    private async executeRequest(
        method: HTTPMethod,
        url: string,
        headers: Record<string, string>,
        data: HTTPNodeData,
        inputs: Record<string, unknown>,
        timeout: number,
        cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        // Build URL with params if present
        const urlWithParams = this.buildUrlWithParams(url, data.params as Record<string, string>);

        // Create abort controller for coordinated cancellation
        const controller = new AbortController();

        // Merge timeout signal with cancellation token
        const timeoutSignal = AbortSignal.timeout(timeout);
        const onAbort = () => controller.abort();
        timeoutSignal.addEventListener('abort', onAbort);
        if (cancellationToken) {
            cancellationToken.onCancelled(onAbort);
        }

        // Prepare request options
        const requestOptions: RequestInit = {
            method,
            headers,
            signal: controller.signal,
        };

        // Add body if method supports it
        if (!['GET', 'HEAD'].includes(method)) {
            const body = this.prepareBody(data, inputs);
            if (body) {
                requestOptions.body = body;
            }
        }

        let response: Response;
        try {
            response = await fetch(urlWithParams, requestOptions);
        } finally {
            // Clean up listeners
            timeoutSignal.removeEventListener('abort', onAbort);
            if (cancellationToken) {
                cancellationToken.unregister(onAbort);
            }
        }

        // Parse response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        // Parse response body
        let body: unknown;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            body = await response.json();
        } else {
            body = await response.text();
        }

        // A non-2xx response is a node failure by default — otherwise the engine
        // marks the node Succeeded (nothing threw) and the error body (e.g. an LLM
        // proxy "HTTP 403 insufficient_user_quota") silently lands in node.output,
        // showing up as a "completed" task with an error summary. Mirrors the LLM
        // executor, which already throws on !response.ok. Opt out with
        // data.failOnErrorStatus=false when a flow branches on statusCode itself.
        if (!response.ok && data.failOnErrorStatus !== false) {
            const detail = typeof body === 'string' ? body : JSON.stringify(body);
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${detail.slice(0, 500)}`);
        }

        return {
            outputs: {
                statusCode: response.status,
                headers: responseHeaders,
                body,
            },
        };
    }

    private resolveTemplate(template: string, inputs: Record<string, unknown>): string {
        // Simple local input interpolation: ${variable} -> value
        return template.replace(/\$\{\s*([\w.]+)\s*\}/g, (match, path: string) => {
            const value = this.resolveInputPath(inputs, path);
            return value !== undefined ? String(value) : match;
        });
    }

    private resolveInputPath(inputs: Record<string, unknown>, path: string): unknown {
        return path.split('.').filter(Boolean).reduce<unknown>((current, part) => {
            if (current === undefined || current === null || typeof current !== 'object') return undefined;
            return (current as Record<string, unknown>)[part];
        }, inputs);
    }

    private resolveHeaders(
        headers: Record<string, string> | undefined,
        inputs: Record<string, unknown>,
    ): Record<string, string> {
        const resolved: Record<string, string> = {};
        if (!headers) return resolved;

        for (const [key, value] of Object.entries(headers)) {
            resolved[key] = this.resolveTemplate(value, inputs);
        }
        return resolved;
    }

    private buildUrlWithParams(url: string, params?: Record<string, string>): string {
        if (!params || Object.keys(params).length === 0) {
            return url;
        }

        try {
            const urlObj = new URL(url);
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined && value !== null && value !== '') {
                    urlObj.searchParams.set(key, String(value));
                }
            }
            return urlObj.toString();
        } catch {
            // If URL parsing fails, append params directly
            const queryString = Object.entries(params)
                .filter(([, v]) => v !== undefined && v !== null && v !== '')
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
                .join('&');
            return queryString ? `${url}${url.includes('?') ? '&' : '?'}${queryString}` : url;
        }
    }

    private prepareBody(data: HTTPNodeData, inputs: Record<string, unknown>): string | FormData | URLSearchParams | undefined {
        const bodyType = data.bodyType as HTTPBodyType || HTTPBodyType.None;
        const body = data.body as unknown;

        if (bodyType === HTTPBodyType.None || !body) {
            return undefined;
        }

        const resolvedBody = typeof body === 'string' ? this.resolveTemplate(body, inputs) : body;

        switch (bodyType) {
            case HTTPBodyType.JSON:
                return typeof resolvedBody === 'string' ? resolvedBody : JSON.stringify(resolvedBody);

            case HTTPBodyType.RawText:
                return typeof resolvedBody === 'string' ? resolvedBody : JSON.stringify(resolvedBody);

            case HTTPBodyType.XWwwFormUrlencoded:
                try {
                    const obj = typeof resolvedBody === 'string' ? JSON.parse(resolvedBody) : resolvedBody;
                    const params = new URLSearchParams();
                    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
                        params.append(key, String(value));
                    }
                    return params.toString();
                } catch {
                    return String(resolvedBody);
                }

            case HTTPBodyType.FormData:
                try {
                    const obj = typeof resolvedBody === 'string' ? JSON.parse(resolvedBody) : resolvedBody;
                    const formData = new FormData();
                    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
                        formData.append(key, String(value));
                    }
                    return formData;
                } catch {
                    return String(resolvedBody);
                }

            default:
                return typeof resolvedBody === 'string' ? resolvedBody : JSON.stringify(resolvedBody);
        }
    }
}
