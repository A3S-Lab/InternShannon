import 'reflect-metadata';
import './shared/infrastructure/config/load-env';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { raw } from 'express';
import helmet from 'helmet';
import { ShuxiaoanSidecarModule } from './shuxiaoan-sidecar.module';
import { type IKernelService, KERNEL_SERVICE } from './modules/kernel/domain/services/kernel-service.interface';
import { createValidationPipe } from './shared/api/validation';
import { APP_MODE } from './shared/constants';
import { QuietBootLogger } from './shared/infrastructure/boot/quiet-boot-logger';
import { validateEnvironmentConfig, validateRequiredEnvVars } from './shared/infrastructure/config/env-validation';
import { formatStartupNetworkInfoLines } from './shared/infrastructure/network/startup-network-info';

process.env.APP_MODE = 'desktop';
process.env.KERNEL_WORKSPACE_STORAGE_PROVIDER ||= 'local';

validateRequiredEnvVars();
validateEnvironmentConfig();

async function bootstrap() {
    const bootStartedAt = Date.now();
    const phase = (label: string) => {
        const elapsed = Date.now() - bootStartedAt;
        console.log(`[boot] ${String(elapsed).padStart(6, ' ')}ms  ${label}`);
    };

    phase('NestFactory.create start');
    const app = await NestFactory.create<NestExpressApplication>(ShuxiaoanSidecarModule, {
        logger: new QuietBootLogger(['error', 'warn', 'log', 'fatal']),
        rawBody: true,
    });
    phase('NestFactory.create done');

    app.enableShutdownHooks();
    app.enableCors({
        origin: '*',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Organization-Id',
            'X-Request-Id',
            'Docker-Content-Digest',
            'Content-Range',
            'Git-Protocol',
            'Range',
            'X-Actions-Runner-Token',
            'X-API-Version',
            'X-Package-Name',
            'X-Package-Version',
        ],
        exposedHeaders: [
            'X-RateLimit-Limit',
            'X-RateLimit-Remaining',
            'X-RateLimit-Reset',
            'Accept-Ranges',
            'Content-Range',
            'Docker-Content-Digest',
            'Docker-Distribution-API-Version',
            'Docker-Upload-UUID',
            'Git-Protocol',
            'Link',
            'Location',
            'Range',
            'Deprecation',
            'Sunset',
            'X-API-Version',
            'X-API-Supported-Versions',
            'WWW-Authenticate',
        ],
        maxAge: 86400,
    });

    app.use('/git', raw({ type: '*/*', limit: process.env.GIT_HTTP_MAX_BODY || '512mb' }));
    app.use(
        '/api/v1/assets',
        raw({
            type: [
                'application/zip',
                'application/gzip',
                'application/x-gzip',
                'application/x-tar',
                'application/octet-stream',
            ],
            limit: process.env.PIPELINE_ARTIFACT_MAX_BODY || '512mb',
        }),
    );
    app.useBodyParser('json', {
        limit: process.env.GLOBAL_JSON_MAX_BODY || process.env.ASSET_JSON_MAX_BODY || '50mb',
    });

    app.useGlobalPipes(createValidationPipe({ whitelist: true, forbidNonWhitelisted: false }));
    app.setGlobalPrefix('api/v1', {
        exclude: [
            { path: 'git', method: RequestMethod.ALL },
            { path: 'git/(.*)', method: RequestMethod.ALL },
            { path: 'v1', method: RequestMethod.ALL },
            { path: 'v1/(.*)', method: RequestMethod.ALL },
            { path: 'v2', method: RequestMethod.ALL },
            { path: 'v2/(.*)', method: RequestMethod.ALL },
        ],
    });
    app.use(
        helmet({
            contentSecurityPolicy: {
                useDefaults: false,
                directives: {
                    'default-src': ["'self'"],
                    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                    'style-src': ["'self'", "'unsafe-inline'"],
                    'img-src': ["'self'", 'data:', 'https:'],
                    'font-src': ["'self'", 'data:', 'https:', 'blob:'],
                    'connect-src': ["'self'", 'https:', 'wss:'],
                    'frame-src': ["'self'"],
                    'worker-src': ["'self'", 'blob:'],
                },
            },
        }),
    );

    const swaggerConfig = new DocumentBuilder()
        .setTitle('书小安')
        .setDescription('书小安本地 sidecar API')
        .setVersion('0.1')
        .addServer('/', 'Current host')
        .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);

    const kernelService = app.get<IKernelService>(KERNEL_SERVICE) as IKernelService & {
        primeOpenApiDocument?: (document: unknown) => void;
    };
    kernelService.primeOpenApiDocument?.(document);

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.get('/openapi.json', (_req: unknown, res: { json: (data: unknown) => void }) => {
        res.json(document);
    });
    expressApp.get('/open/openapi.json', (_req: unknown, res: { json: (data: unknown) => void }) => {
        res.json(document);
    });

    const port = Number(process.env.APP_PORT || 29653);
    const host = process.env.APP_HOST || '127.0.0.1';

    phase('app.listen start');
    await app.listen(port, host);
    phase('app.listen done');

    const httpServer = app.getHttpServer() as import('node:http').Server;
    httpServer.keepAliveTimeout = Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 125_000);
    httpServer.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 130_000);

    for (const line of formatStartupNetworkInfoLines({
        host,
        mode: APP_MODE,
        port,
        services: [
            { label: 'Data dir', value: process.env.INTERNSHANNON_DATA_DIR || '~/.internshannon' },
            { label: 'Workspace storage', value: process.env.KERNEL_WORKSPACE_STORAGE_PROVIDER || 'local' },
        ],
    })) {
        console.log(line);
    }
    console.log(`[${APP_MODE}] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[boot] total ${Date.now() - bootStartedAt}ms from bootstrap() entry`);
}

bootstrap();
