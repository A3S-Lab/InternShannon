import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { URL } from 'node:url';
import { isDesktop } from '@/shared/constants';
import type { RuntimeClawSentryConfig } from './session-runtime.types';

export type ClawSentrySupervisorState = 'disabled' | 'starting' | 'healthy' | 'unhealthy' | 'stopped';

export interface ClawSentryPublicStatus {
    enabled: boolean;
    mode: string;
    state: ClawSentrySupervisorState;
    failClosed: boolean;
    permissionPolicy: string;
    gatewayUrl?: string;
    ahpUrl?: string;
    pid?: number;
    startedAt?: string;
    lastHealthyAt?: string;
    lastError?: string;
}

export interface ClawSentryConnection {
    ahpUrl: string;
    authToken: string;
}

interface ResolvedClawSentryConfig {
    enabled: boolean;
    mode: string;
    failClosed: boolean;
    permissionPolicy: string;
    gatewayUrl?: string;
    token?: string;
}

interface ManagedClawSentryCommand {
    command: string;
    argsPrefix: string[];
    env?: Record<string, string>;
}

const HEALTH_PATHS = ['/health', '/api/health', '/ready'];
const DEFAULT_MODE = 'managed-gateway';
const DEFAULT_PERMISSION_POLICY = 'allow';

@Injectable()
export class ClawSentrySupervisorService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ClawSentrySupervisorService.name);
    private state: ClawSentrySupervisorState = 'disabled';
    private process: ChildProcess | null = null;
    private baseUrl: string | undefined;
    private ahpUrl: string | undefined;
    private authToken: string | undefined;
    private startedAt: Date | undefined;
    private lastHealthyAt: Date | undefined;
    private lastError: string | undefined;
    private startPromise: Promise<ClawSentryPublicStatus> | null = null;
    private resolvedConfig: ResolvedClawSentryConfig = this.resolveConfig();

    async onModuleInit(): Promise<void> {
        this.resolvedConfig = this.resolveConfig();
        if (!this.resolvedConfig.enabled) {
            this.state = 'disabled';
            return;
        }
        if (process.env.CLAWSENTRY_START_ON_BOOT === 'true') {
            await this.ensureReady().catch(error => {
                this.logger.error(`ClawSentry gateway failed during boot: ${this.errorMessage(error)}`);
            });
        }
    }

    async onModuleDestroy(): Promise<void> {
        await this.stop();
    }

    status(): ClawSentryPublicStatus {
        return this.publicStatus();
    }

    internalConnection(): ClawSentryConnection | null {
        if (this.state !== 'healthy' || !this.ahpUrl || !this.authToken) return null;
        return {
            ahpUrl: this.ahpUrl,
            authToken: this.authToken,
        };
    }

    async ensureReady(config?: RuntimeClawSentryConfig): Promise<ClawSentryPublicStatus> {
        this.resolvedConfig = this.resolveConfig(config);
        if (!this.resolvedConfig.enabled) {
            this.state = 'disabled';
            this.clearConnection();
            return this.publicStatus();
        }

        if (this.resolvedConfig.mode === 'external-gateway') {
            return this.ensureExternalReady(this.resolvedConfig);
        }

        if (this.startPromise) return this.startPromise;
        this.startPromise = this.ensureManagedReady(this.resolvedConfig).finally(() => {
            this.startPromise = null;
        });
        return this.startPromise;
    }

    isHealthy(): boolean {
        return this.state === 'healthy';
    }

    async stop(): Promise<void> {
        const child = this.process;
        this.process = null;
        if (child && !child.killed) {
            child.kill('SIGTERM');
            await new Promise<void>(resolve => {
                const timeout = setTimeout(resolve, 2_000);
                child.once('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }
        if (this.state !== 'disabled') {
            this.state = 'stopped';
        }
    }

    private async ensureExternalReady(config: ResolvedClawSentryConfig): Promise<ClawSentryPublicStatus> {
        const gatewayUrl = trimTrailingSlash(config.gatewayUrl || process.env.CLAWSENTRY_GATEWAY_URL || '');
        if (!gatewayUrl) {
            this.markUnhealthy('CLAWSENTRY_GATEWAY_URL is required when ClawSentry mode is external-gateway');
            return this.publicStatus();
        }

        this.baseUrl = gatewayUrl;
        this.ahpUrl = `${gatewayUrl}/ahp/a3s`;
        this.authToken = config.token || process.env.CLAWSENTRY_AUTH_TOKEN || process.env.CS_AUTH_TOKEN || '';
        this.state = 'starting';
        const healthy = await this.probeGateway(gatewayUrl);
        if (!healthy) {
            this.markUnhealthy(this.lastError || `ClawSentry gateway is not healthy at ${gatewayUrl}`);
            return this.publicStatus();
        }
        this.markHealthy();
        return this.publicStatus();
    }

    private async ensureManagedReady(config: ResolvedClawSentryConfig): Promise<ClawSentryPublicStatus> {
        if (this.state === 'healthy' && this.baseUrl && (await this.probeGateway(this.baseUrl))) {
            this.markHealthy();
            return this.publicStatus();
        }

        if (!this.process || this.process.exitCode !== null) {
            await this.startManagedGateway(config);
        }
        if (this.state === 'unhealthy' && !this.baseUrl) {
            return this.publicStatus();
        }

        const gatewayUrl = this.baseUrl;
        if (!gatewayUrl) {
            this.markUnhealthy('ClawSentry managed gateway URL was not initialized');
            return this.publicStatus();
        }

        const deadline = Date.now() + this.startTimeoutMs();
        while (Date.now() < deadline) {
            if (await this.probeGateway(gatewayUrl)) {
                this.markHealthy();
                return this.publicStatus();
            }
            await sleep(250);
        }

        this.markUnhealthy(this.lastError || `ClawSentry gateway did not become healthy at ${gatewayUrl}`);
        return this.publicStatus();
    }

    protected async startManagedGateway(config: ResolvedClawSentryConfig): Promise<void> {
        const launch = this.resolveManagedCommand();
        if (!launch) {
            this.markUnhealthy(
                'Bundled ClawSentry launcher was not found. Set CLAWSENTRY_COMMAND, bundle resources/clawsentry/bin/clawsentry, or bundle resources/python with resources/clawsentry/site-packages and resources/clawsentry/entrypoints/clawsentry.py.',
            );
            return;
        }

        const host = process.env.CLAWSENTRY_HOST?.trim() || process.env.CS_HTTP_HOST?.trim() || '127.0.0.1';
        const port = await this.resolvePort();
        const token =
            config.token ||
            process.env.CLAWSENTRY_AUTH_TOKEN ||
            process.env.CS_AUTH_TOKEN ||
            randomBytes(24).toString('hex');
        const gatewayUrl = `http://${host}:${port}`;
        const args = [...launch.argsPrefix, ...this.resolveManagedArgs(host, port, token)];

        this.state = 'starting';
        this.baseUrl = gatewayUrl;
        this.ahpUrl = `${gatewayUrl}/ahp/a3s`;
        this.authToken = token;
        this.startedAt = new Date();
        this.lastError = undefined;

        const child = spawn(launch.command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                ...launch.env,
                CS_AUTH_TOKEN: token,
                CS_HTTP_HOST: host,
                CS_HTTP_PORT: String(port),
                CS_FRAMEWORK: process.env.CS_FRAMEWORK || 'a3s-code',
                CS_ENABLED_FRAMEWORKS: process.env.CS_ENABLED_FRAMEWORKS || 'a3s-code',
                CLAWSENTRY_AUTH_TOKEN: token,
                CLAWSENTRY_HOST: host,
                CLAWSENTRY_PORT: String(port),
            },
        });
        this.process = child;

        child.stdout?.on('data', chunk => {
            this.logger.debug(`[clawsentry] ${String(chunk).trim()}`);
        });
        child.stderr?.on('data', chunk => {
            this.logger.warn(`[clawsentry] ${String(chunk).trim()}`);
        });
        child.on('error', error => {
            this.markUnhealthy(`Failed to start ClawSentry gateway: ${this.errorMessage(error)}`);
        });
        child.on('exit', (code, signal) => {
            if (this.process !== child) return;
            this.process = null;
            if (this.state !== 'stopped' && this.state !== 'disabled') {
                this.markUnhealthy(`ClawSentry gateway exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
            }
        });
    }

    protected resolveManagedCommand(): ManagedClawSentryCommand | null {
        const explicit = process.env.CLAWSENTRY_COMMAND?.trim();
        if (explicit) return { command: explicit, argsPrefix: [] };

        const launcher = this.findBundledLauncher();
        if (launcher) return { command: launcher, argsPrefix: [] };

        const pythonLaunch = this.findBundledPythonLaunch();
        if (pythonLaunch) return pythonLaunch;

        if (process.env.CLAWSENTRY_ALLOW_PATH_LOOKUP === 'true') {
            return { command: 'clawsentry', argsPrefix: [] };
        }
        return null;
    }

    protected managedResourceRoots(): string[] {
        const cwd = process.cwd();
        return uniquePaths([
            path.resolve(cwd, 'resources'),
            path.resolve(cwd),
            path.resolve(cwd, '..'),
            path.resolve(cwd, '../resources'),
            path.resolve(cwd, '../desktop/src-tauri/resources'),
            path.resolve(cwd, '../../apps/desktop/src-tauri/resources'),
            path.resolve(cwd, 'apps/desktop/src-tauri/resources'),
        ]);
    }

    private findBundledLauncher(): string | null {
        const launcherNames =
            process.platform === 'win32' ? ['clawsentry.cmd', 'clawsentry.exe', 'clawsentry'] : ['clawsentry'];
        for (const root of this.managedResourceRoots()) {
            const launcher = this.findExistingFile(
                launcherNames.map(name => path.join(root, 'clawsentry', 'bin', name)),
            );
            if (launcher) return launcher;
        }
        return null;
    }

    private findBundledPythonLaunch(): ManagedClawSentryCommand | null {
        for (const root of this.managedResourceRoots()) {
            const python = this.findExistingFile([
                path.join(root, 'python', 'bin', 'python3'),
                path.join(root, 'python', 'bin', 'python'),
                path.join(root, 'python', 'install', 'bin', 'python3'),
                path.join(root, 'python', 'install', 'bin', 'python'),
                path.join(root, 'python', 'python.exe'),
                path.join(root, 'python', 'install', 'python.exe'),
            ]);
            const entrypoint = this.existingFile(path.join(root, 'clawsentry', 'entrypoints', 'clawsentry.py'));
            const sitePackages = this.existingDirectory(path.join(root, 'clawsentry', 'site-packages'));
            if (!python || !entrypoint || !sitePackages) continue;

            return {
                command: python,
                argsPrefix: [entrypoint],
                env: {
                    PYTHONNOUSERSITE: '1',
                    PYTHONDONTWRITEBYTECODE: '1',
                    PYTHONPATH: process.env.PYTHONPATH
                        ? `${sitePackages}${path.delimiter}${process.env.PYTHONPATH}`
                        : sitePackages,
                },
            };
        }
        return null;
    }

    private findExistingFile(candidates: string[]): string | null {
        return candidates.find(candidate => this.existingFile(candidate)) ?? null;
    }

    private existingFile(candidate: string): string | null {
        try {
            return statSync(candidate).isFile() ? candidate : null;
        } catch {
            return null;
        }
    }

    private existingDirectory(candidate: string): string | null {
        try {
            return statSync(candidate).isDirectory() ? candidate : null;
        } catch {
            return null;
        }
    }

    protected resolveManagedArgs(host: string, port: number, token: string): string[] {
        const override = process.env.CLAWSENTRY_ARGS?.trim();
        if (override) {
            return override
                .split(/\s+/)
                .map(item =>
                    item
                        .replaceAll('{host}', host)
                        .replaceAll('{port}', String(port))
                        .replaceAll('{token}', token),
                );
        }
        const udsPath =
            process.env.CLAWSENTRY_UDS_PATH?.trim() ||
            path.join(os.tmpdir(), `clawsentry-gateway-${process.pid}-${port}.sock`);
        return ['gateway', '--gateway-host', host, '--gateway-port', String(port), '--uds-path', udsPath];
    }

    protected async resolvePort(): Promise<number> {
        const raw = process.env.CLAWSENTRY_PORT?.trim() || process.env.CS_HTTP_PORT?.trim();
        const parsed = raw ? Number.parseInt(raw, 10) : NaN;
        if (Number.isInteger(parsed) && parsed > 0 && parsed < 65_536) return parsed;
        return findFreePort('127.0.0.1');
    }

    protected async probeGateway(gatewayUrl: string): Promise<boolean> {
        for (const healthPath of HEALTH_PATHS) {
            try {
                const statusCode = await requestStatus(`${gatewayUrl}${healthPath}`, {
                    authToken: this.authToken,
                    timeoutMs: this.healthTimeoutMs(),
                });
                if (statusCode >= 200 && statusCode < 500) {
                    this.lastError = undefined;
                    return true;
                }
                this.lastError = `ClawSentry health check ${healthPath} returned ${statusCode}`;
            } catch (error) {
                this.lastError = this.errorMessage(error);
            }
        }
        return false;
    }

    private resolveConfig(config?: RuntimeClawSentryConfig): ResolvedClawSentryConfig {
        const envEnabled = process.env.CLAWSENTRY_ENABLED;
        const defaultEnabled = false;
        const enabled =
            typeof config?.enabled === 'boolean'
                ? config.enabled
                : envEnabled === 'true'
                  ? true
                  : envEnabled === 'false'
                    ? false
                    : defaultEnabled;
        return {
            enabled,
            mode: config?.mode?.trim() || process.env.CLAWSENTRY_MODE?.trim() || DEFAULT_MODE,
            failClosed:
                typeof config?.failClosed === 'boolean'
                    ? config.failClosed
                    : process.env.CLAWSENTRY_FAIL_CLOSED === 'false'
                      ? false
                      : true,
            permissionPolicy:
                config?.permissionPolicy?.trim() ||
                process.env.CLAWSENTRY_PERMISSION_POLICY?.trim() ||
                DEFAULT_PERMISSION_POLICY,
            gatewayUrl: config?.gatewayUrl?.trim() || process.env.CLAWSENTRY_GATEWAY_URL?.trim(),
            token:
                config?.token?.trim() ||
                process.env.CLAWSENTRY_AUTH_TOKEN?.trim() ||
                process.env.CS_AUTH_TOKEN?.trim(),
        };
    }

    private publicStatus(): ClawSentryPublicStatus {
        return {
            enabled: this.resolvedConfig.enabled,
            mode: this.resolvedConfig.mode,
            state: this.state,
            failClosed: this.resolvedConfig.failClosed,
            permissionPolicy: this.resolvedConfig.permissionPolicy,
            gatewayUrl: this.baseUrl,
            ahpUrl: this.ahpUrl,
            pid: this.process?.pid,
            startedAt: this.startedAt?.toISOString(),
            lastHealthyAt: this.lastHealthyAt?.toISOString(),
            lastError: this.lastError,
        };
    }

    private markHealthy(): void {
        this.state = 'healthy';
        this.lastHealthyAt = new Date();
        this.lastError = undefined;
    }

    private markUnhealthy(message: string): void {
        this.state = 'unhealthy';
        this.lastError = message;
    }

    private clearConnection(): void {
        this.baseUrl = undefined;
        this.ahpUrl = undefined;
        this.authToken = undefined;
    }

    private healthTimeoutMs(): number {
        const raw = process.env.CLAWSENTRY_HEALTH_TIMEOUT_MS?.trim();
        const parsed = raw ? Number.parseInt(raw, 10) : NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1_000;
    }

    private startTimeoutMs(): number {
        const raw = process.env.CLAWSENTRY_START_TIMEOUT_MS?.trim();
        const parsed = raw ? Number.parseInt(raw, 10) : NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 8_000;
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function uniquePaths(paths: string[]): string[] {
    return Array.from(new Set(paths));
}

function findFreePort(host: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, host, () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Could not allocate a ClawSentry port')));
                return;
            }
            const port = address.port;
            server.close(error => {
                if (error) reject(error);
                else resolve(port);
            });
        });
    });
}

function requestStatus(url: string, options: { authToken?: string; timeoutMs: number }): Promise<number> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = transport(
            parsed,
            {
                method: 'GET',
                timeout: options.timeoutMs,
                headers: options.authToken ? { Authorization: `Bearer ${options.authToken}` } : undefined,
            },
            response => {
                response.resume();
                response.on('end', () => resolve(response.statusCode ?? 0));
            },
        );
        request.on('timeout', () => {
            request.destroy(new Error(`ClawSentry health check timed out after ${options.timeoutMs}ms`));
        });
        request.on('error', reject);
        request.end();
    });
}
