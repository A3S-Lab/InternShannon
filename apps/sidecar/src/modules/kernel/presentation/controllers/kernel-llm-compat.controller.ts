import { All, Controller, Logger, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SkipApiResponse } from '@/shared/api/openapi';
import { LocalOnlyGuard } from '@/shared/security/local-only.guard';
import {
    KERNEL_SESSION_ID_HEADER,
    KernelUpstreamFailureSignalService,
} from '../../application/kernel-upstream-failure-signal.service';

const ZHIPU_CODING_CHAT_COMPLETIONS_URL =
    process.env.KERNEL_ZHIPU_CODING_UPSTREAM_URL?.trim() ||
    'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';

@ApiExcludeController()
@Controller('kernel/llm-compat')
@UseGuards(LocalOnlyGuard)
export class KernelLlmCompatController {
    private readonly logger = new Logger(KernelLlmCompatController.name);

    constructor(private readonly upstreamFailures: KernelUpstreamFailureSignalService) {}

    @All('zhipu-coding/*path')
    @SkipApiResponse()
    async proxyZhipuCoding(@Req() request: Request, @Res() response: Response): Promise<void> {
        if (request.method !== 'POST') {
            response.status(405).send('Method Not Allowed');
            return;
        }

        const authorization = request.headers.authorization;
        if (!authorization) {
            response.status(401).send('Missing Authorization header');
            return;
        }

        try {
            const upstream = await fetch(ZHIPU_CODING_CHAT_COMPLETIONS_URL, {
                method: 'POST',
                headers: {
                    authorization,
                    'content-type': request.headers['content-type'] || 'application/json',
                    accept: request.headers.accept || 'text/event-stream, application/json',
                },
                body: JSON.stringify(request.body ?? {}),
            });

            response.status(upstream.status);
            for (const header of ['content-type', 'cache-control', 'x-request-id']) {
                const value = upstream.headers.get(header);
                if (value) response.setHeader(header, value);
            }

            if (!upstream.ok) {
                const body = await upstream.text();
                const failure = this.errorDetails(body);
                let sessionId = this.headerValue(request, KERNEL_SESSION_ID_HEADER);
                if (upstream.status === 429 || failure.code === '1305') {
                    const signal = {
                        status: upstream.status,
                        code: failure.code,
                        message: failure.message,
                        occurredAt: Date.now(),
                    };
                    if (sessionId) {
                        this.upstreamFailures.record({ ...signal, sessionId });
                    } else {
                        sessionId = this.upstreamFailures.recordForUniqueWaitingSession(signal) ?? '';
                    }
                }
                this.logger.warn(
                    `[zhipu-coding-compat] upstream rejected request: sessionId=${sessionId || 'unknown'} status=${upstream.status} error=${failure.summary}`,
                );
                response.send(body);
                return;
            }

            if (!upstream.body) {
                response.end();
                return;
            }

            const reader = upstream.body.getReader();
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                response.write(Buffer.from(chunk.value));
            }
            response.end();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[zhipu-coding-compat] upstream request failed: ${message}`);
            response.status(502).json({ error: { message: 'Zhipu Coding Plan upstream request failed' } });
        }
    }

    private headerValue(request: Request, name: string): string {
        const value = request.headers[name];
        return (Array.isArray(value) ? value[0] : value || '').trim();
    }

    private errorDetails(body: string): { code?: string; message: string; summary: string } {
        try {
            const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } };
            const code = parsed.error?.code == null ? undefined : String(parsed.error.code);
            const message = parsed.error?.message == null ? 'unknown' : String(parsed.error.message);
            return { code, message, summary: `${code || 'unknown'}: ${message}`.slice(0, 500) };
        } catch {
            const message = body.slice(0, 500);
            return { message, summary: message };
        }
    }
}
