import { Injectable } from '@nestjs/common';
import { REDACTED_SECRET } from '@/shared/common/security/secret-redaction';
import { BadRequestException } from '@/shared/common/errors';
import { ConfigServiceImpl } from './config.service';

export interface FetchProviderModelsInput {
    providerName: string;
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
}

export interface ProviderModelCandidate {
    id: string;
    name: string;
}

export interface ProviderModelListResult {
    providerName: string;
    baseUrl: string;
    models: ProviderModelCandidate[];
}

interface ResolvedProviderConnection {
    providerName: string;
    modelsUrl: string;
    apiKey: string;
    headers: Record<string, string>;
}

type FetchLike = typeof fetch;

const OPENAI_COMPATIBLE_OPERATION_SUFFIXES = [
    ['chat', 'completions'],
    ['responses'],
    ['completions'],
    ['embeddings'],
] as const;

export function normalizeOpenAICompatibleModelsUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (!trimmed) {
        throw new BadRequestException('请先填写 Provider Base URL');
    }

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        throw new BadRequestException('Provider Base URL 不是有效的 URL');
    }

    const segments = stripOpenAICompatibleOperationSuffix(url.pathname.replace(/\/+$/, '').split('/').filter(Boolean));
    const pathname = segments.length > 0 ? `/${segments.join('/')}` : '';
    const lastSegment = segments[segments.length - 1] ?? '';
    if (lastSegment === 'models') {
        url.pathname = pathname || '/models';
        return url.toString();
    }

    if (/^v\d+$/i.test(lastSegment)) {
        url.pathname = `${pathname}/models`;
        return url.toString();
    }

    if (segments.includes('v1')) {
        url.pathname = `${pathname}/models`;
        return url.toString();
    }

    url.pathname = `${pathname}/v1/models`;
    return url.toString();
}

@Injectable()
export class ProviderModelListService {
    private readonly timeoutMs = 15_000;

    constructor(private readonly configService: ConfigServiceImpl) {}

    async fetchModels(input: FetchProviderModelsInput): Promise<ProviderModelListResult> {
        const connection = await this.resolveConnection(input);
        const payload = await this.fetchOpenAICompatibleModels(connection);
        return {
            providerName: connection.providerName,
            baseUrl: connection.modelsUrl,
            models: this.parseModelsPayload(payload),
        };
    }

    private async resolveConnection(input: FetchProviderModelsInput): Promise<ResolvedProviderConnection> {
        const providerName = input.providerName.trim();
        if (!providerName) {
            throw new BadRequestException('Provider 标识不能为空');
        }

        const storedProvider = (await this.configService.getLlmSettings()).providers.find(
            provider => provider.name === providerName,
        );
        const apiKeyInput = input.apiKey?.trim();
        const apiKey =
            apiKeyInput && apiKeyInput !== REDACTED_SECRET
                ? apiKeyInput
                : (storedProvider?.apiKey ?? '').trim() || this.envProviderApiKey(providerName);
        const baseUrl =
            input.baseUrl?.trim() ||
            storedProvider?.baseUrl?.trim() ||
            this.defaultOpenAICompatibleBaseUrl(providerName);
        const headers = this.sanitizeHeaders({ ...(storedProvider?.headers ?? {}), ...(input.headers ?? {}) });

        return {
            providerName,
            modelsUrl: normalizeOpenAICompatibleModelsUrl(this.normalizeProviderBaseUrl(providerName, baseUrl)),
            apiKey,
            headers,
        };
    }

    private async fetchOpenAICompatibleModels(connection: ResolvedProviderConnection): Promise<unknown> {
        const headers: Record<string, string> = {
            Accept: 'application/json',
            ...connection.headers,
        };
        if (connection.apiKey && !hasHeader(headers, 'authorization')) {
            headers.Authorization = `Bearer ${connection.apiKey}`;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetcher()(connection.modelsUrl, {
                method: 'GET',
                headers,
                signal: controller.signal,
            });
            const text = await response.text();
            const payload = text ? this.parseJson(text) : {};
            if (!response.ok) {
                throw new BadRequestException(this.externalErrorMessage(response.status, payload));
            }
            return payload;
        } catch (error) {
            if (error instanceof BadRequestException) {
                throw error;
            }
            if (error instanceof Error && error.name === 'AbortError') {
                throw new BadRequestException('模型列表拉取超时，请检查 Provider 地址或网络');
            }
            throw new BadRequestException(
                `模型列表拉取失败：${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            clearTimeout(timer);
        }
    }

    private parseModelsPayload(payload: unknown): ProviderModelCandidate[] {
        const source = Array.isArray(payload)
            ? payload
            : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
              ? (payload as { data: unknown[] }).data
              : null;

        if (!source) {
            throw new BadRequestException('Provider 模型列表响应格式不支持');
        }

        const seen = new Set<string>();
        const models: ProviderModelCandidate[] = [];
        for (const item of source) {
            if (!item || typeof item !== 'object') continue;
            const record = item as Record<string, unknown>;
            const id = typeof record.id === 'string' ? record.id.trim() : '';
            if (!id || seen.has(id)) continue;
            const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id;
            models.push({ id, name });
            seen.add(id);
        }

        return models;
    }

    private parseJson(text: string): unknown {
        try {
            return JSON.parse(text);
        } catch {
            throw new BadRequestException('Provider 模型列表响应不是有效 JSON');
        }
    }

    private externalErrorMessage(status: number, payload: unknown): string {
        const message = this.extractProviderMessage(payload);
        if (message) {
            return `模型列表拉取失败：Provider 返回 ${status}，${message}`;
        }
        if (status === 401 || status === 403) {
            return `模型列表拉取失败：Provider 返回 ${status}，请检查 API Key`;
        }
        return `模型列表拉取失败：Provider 返回 ${status}`;
    }

    private extractProviderMessage(payload: unknown): string {
        if (!payload || typeof payload !== 'object') return '';
        const record = payload as Record<string, unknown>;
        if (typeof record.message === 'string') return record.message;
        if (record.error && typeof record.error === 'object') {
            const error = record.error as Record<string, unknown>;
            if (typeof error.message === 'string') return error.message;
            if (typeof error.type === 'string') return error.type;
        }
        if (typeof record.error === 'string') return record.error;
        return '';
    }

    private sanitizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
        const sanitized: Record<string, string> = {};
        for (const [key, value] of Object.entries(headers)) {
            const headerName = key.trim();
            const headerValue = typeof value === 'string' ? value.trim() : '';
            if (!headerName || !headerValue) continue;
            sanitized[headerName] = headerValue;
        }
        return sanitized;
    }

    private envProviderApiKey(providerName: string): string {
        switch (providerName.toLowerCase()) {
            case 'openai':
                return (process.env.OPENAI_API_KEY ?? '').trim();
            case 'anthropic':
                return (process.env.ANTHROPIC_API_KEY ?? '').trim();
            case 'zhipu':
                return (process.env.ZHIPU_API_KEY ?? '').trim();
            default:
                return '';
        }
    }

    private defaultOpenAICompatibleBaseUrl(providerName: string): string {
        switch (providerName.toLowerCase()) {
            case 'openai':
                return 'https://api.openai.com/v1';
            case 'anthropic':
                return 'https://api.anthropic.com';
            case 'zhipu':
                return 'https://open.bigmodel.cn/api/paas/v4';
            default:
                return '';
        }
    }

    private normalizeProviderBaseUrl(providerName: string, baseUrl: string): string {
        if (providerName.toLowerCase() !== 'zhipu') {
            return baseUrl;
        }

        try {
            const url = new URL(baseUrl.trim());
            const pathname = url.pathname.replace(/\/+$/, '');
            if (url.hostname === 'open.bigmodel.cn' && (!pathname || pathname === '/')) {
                url.pathname = '/api/paas/v4';
                return url.toString();
            }
        } catch {
            return baseUrl;
        }

        return baseUrl;
    }

    private fetcher(): FetchLike {
        return globalThis.fetch.bind(globalThis);
    }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
    const normalized = name.toLowerCase();
    return Object.keys(headers).some(key => key.toLowerCase() === normalized);
}

function stripOpenAICompatibleOperationSuffix(segments: string[]): string[] {
    for (const suffix of OPENAI_COMPATIBLE_OPERATION_SUFFIXES) {
        if (segments.length < suffix.length) continue;
        const tail = segments.slice(-suffix.length).map(segment => segment.toLowerCase());
        if (tail.every((segment, index) => segment === suffix[index])) {
            return segments.slice(0, -suffix.length);
        }
    }
    return segments;
}
