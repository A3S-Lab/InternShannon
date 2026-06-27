import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ApiOperation } from '../domain/services/api-explorer.interface';

@Injectable()
export class ApiOperationExecutor {
    constructor(private readonly httpService: HttpService) {}

    /**
     * 渐进式 API 经 HTTP 回环调用自身。kernel.service 的 OpenAPI 文档里 operation.path 已含全局前缀
     * (实测为 `/api/v1/assets/...`),故 baseURL 只能是 host:port、**不可再带 /api/v1**,否则双前缀 → 404。
     * 端口取 APP_PORT(默认 29653,与 main.ts 一致)。SELF_API_BASE_URL 可整体覆盖(同样只给 host:port)。
     */
    private get selfApiBaseUrl(): string {
        const override = process.env.SELF_API_BASE_URL?.trim();
        if (override) return override.replace(/\/+$/, '');
        const port = process.env.APP_PORT || '29653';
        return `http://127.0.0.1:${port}`;
    }

    async execute(
        operation: ApiOperation,
        params: Record<string, any>,
        authToken?: string,
    ): Promise<any> {
        const url = this.buildUrl(operation.path, params);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        try {
            const method = operation.method.toLowerCase();
            let response: any;

            switch (method) {
                case 'get':
                    response = await firstValueFrom(
                        this.httpService.get(url, { headers, params: this.extractQueryParams(params) }),
                    );
                    break;
                case 'post':
                    response = await firstValueFrom(
                        this.httpService.post(url, this.extractBodyParams(params), { headers }),
                    );
                    break;
                case 'put':
                    response = await firstValueFrom(
                        this.httpService.put(url, this.extractBodyParams(params), { headers }),
                    );
                    break;
                case 'patch':
                    response = await firstValueFrom(
                        this.httpService.patch(url, this.extractBodyParams(params), { headers }),
                    );
                    break;
                case 'delete':
                    response = await firstValueFrom(
                        this.httpService.delete(url, { headers }),
                    );
                    break;
                default:
                    throw new HttpException(
                        `Unsupported HTTP method: ${operation.method}`,
                        HttpStatus.BAD_REQUEST,
                    );
            }

            return response.data;
        } catch (error: any) {
            if (error.response) {
                throw new HttpException(
                    error.response.data || error.message,
                    error.response.status || HttpStatus.INTERNAL_SERVER_ERROR,
                );
            }
            throw new HttpException(
                error.message || 'Operation execution failed',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    private buildUrl(path: string, params: Record<string, any>): string {
        let url = path;

        // Replace path parameters (e.g., :id, :assetId)
        for (const [key, value] of Object.entries(params)) {
            const placeholder = `:${key}`;
            if (url.includes(placeholder)) {
                url = url.replace(placeholder, String(value));
            }
        }

        // OpenAPI 路径是相对的(无 host、无全局前缀);拼成对自身的绝对回环地址,否则 axios 无法解析。
        return `${this.selfApiBaseUrl}${url.startsWith('/') ? url : `/${url}`}`;
    }

    private extractQueryParams(params: Record<string, any>): Record<string, any> {
        // Extract parameters that should be sent as query params
        const queryParams: Record<string, any> = {};

        for (const [key, value] of Object.entries(params)) {
            // Skip path parameters and body parameters
            if (!key.startsWith('_') && value !== undefined) {
                queryParams[key] = value;
            }
        }

        return queryParams;
    }

    private extractBodyParams(params: Record<string, any>): Record<string, any> {
        // Extract parameters that should be sent in request body
        const bodyParams: Record<string, any> = {};

        for (const [key, value] of Object.entries(params)) {
            // Skip path parameters
            if (!key.startsWith(':') && value !== undefined) {
                bodyParams[key] = value;
            }
        }

        return bodyParams;
    }
}
