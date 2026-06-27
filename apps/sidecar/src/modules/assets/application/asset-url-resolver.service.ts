import { Inject, Injectable, Optional } from '@nestjs/common';
import { CONFIG_SERVICE, ConfigService } from '@/modules/config/domain/services/config-service.interface';

const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:29653';
const DEFAULT_PUBLIC_SCHEME = 'https://';
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:\d+)?$/i;

export type AssetGitUrlInput = {
    ownerType: 'user' | 'organization';
    ownerId: string;
    name: string;
    cloneUrl?: string | null;
};

@Injectable()
export class AssetUrlResolverService {
    private settingsCache?: {
        loadedAt: number;
        gitBaseUrl?: string;
        apiBaseUrl?: string;
    };
    private settingsInflight?: Promise<{ gitBaseUrl?: string; apiBaseUrl?: string }>;

    constructor(
        @Optional()
        @Inject(CONFIG_SERVICE)
        private readonly configService?: ConfigService,
    ) {}

    async buildGitCloneUrl(ownerType: 'user' | 'organization', ownerId: string, name: string): Promise<string> {
        const baseUrl = await this.resolveGitHttpBaseUrl();
        return buildAssetGitCloneUrlWithBase(baseUrl, ownerType, ownerId, name);
    }

    async resolveGitCloneUrl(asset: AssetGitUrlInput): Promise<string> {
        const cloneUrl = asset.cloneUrl?.trim();
        if (!cloneUrl || cloneUrl.startsWith('asset://') || isGeneratedLocalAssetGitCloneUrl(cloneUrl) || !isParseableUrl(cloneUrl)) {
            return this.buildGitCloneUrl(asset.ownerType, asset.ownerId, asset.name);
        }
        return cloneUrl;
    }

    async resolveGitSshUrl(ownerType: 'user' | 'organization', ownerId: string, name: string): Promise<string> {
        const configured = firstValue([process.env.GIT_SSH_PUBLIC_BASE_URL])?.replace(/\/+$/, '');
        const path = `${ownerType}/${encodeURIComponent(ownerId)}/${encodeURIComponent(name.trim())}.git`;
        if (configured) {
            return `${configured}/${path}`;
        }

        const settings = await this.loadSettings();
        const host = firstValue([
            process.env.GIT_SSH_PUBLIC_HOST,
            process.env.APP_PUBLIC_HOST,
            hostFromUrl(settings.gitBaseUrl),
            hostFromUrl(settings.apiBaseUrl),
            hostFromUrl(resolveEnvGitHttpBaseUrl()),
        ]) || 'localhost';
        const port = process.env.GIT_SSH_PUBLIC_PORT || process.env.GIT_SSH_PORT || '2222';
        const portPart = port && port !== '22' ? `:${port}` : '';
        return `ssh://git@${host}${portPart}/${path}`;
    }

    async resolveGitHttpBaseUrl(): Promise<string> {
        const settings = await this.loadSettings();
        return normalizeGitBaseUrl(settings.gitBaseUrl)
            ?? normalizeGitBaseUrl(settings.apiBaseUrl)
            ?? resolveEnvGitHttpBaseUrl();
    }

    async resolveApiBaseUrl(): Promise<string> {
        const settings = await this.loadSettings();
        return normalizePublicBaseUrl(settings.apiBaseUrl)
            ?? normalizePublicBaseUrl(settings.gitBaseUrl)
            ?? resolveEnvApiBaseUrl();
    }

    private async loadSettings(): Promise<{ gitBaseUrl?: string; apiBaseUrl?: string }> {
        const now = Date.now();
        if (this.settingsCache && now - this.settingsCache.loadedAt < 5000) {
            return this.settingsCache;
        }

        if (this.settingsInflight) {
            return this.settingsInflight;
        }

        this.settingsInflight = this.fetchSettings();
        try {
            const result = await this.settingsInflight;
            return result;
        } finally {
            this.settingsInflight = undefined;
        }
    }

    private async fetchSettings(): Promise<{ gitBaseUrl?: string; apiBaseUrl?: string }> {
        let values: { gitBaseUrl?: string; apiBaseUrl?: string } = {};
        try {
            const settings = await this.configService?.getSettings();
            values = {
                gitBaseUrl: normalizeGitBaseUrl(settings?.platform?.gitPublicBaseUrl),
                apiBaseUrl: normalizePublicBaseUrl(settings?.platform?.publicApiBaseUrl || settings?.platform?.publicBaseUrl),
            };
        } catch {
            values = {};
        }

        this.settingsCache = { loadedAt: Date.now(), ...values };
        return this.settingsCache;
    }
}

export function buildAssetGitCloneUrlWithBase(
    baseUrl: string,
    ownerType: 'user' | 'organization',
    ownerId: string,
    name: string,
): string {
    const base = normalizeGitBaseUrl(baseUrl) ?? defaultLocalApiBaseUrl();
    return `${base}/git/${ownerType}/${encodeURIComponent(ownerId)}/${encodeURIComponent(name.trim())}.git`;
}

export function buildAssetGitCloneUrl(ownerType: 'user' | 'organization', ownerId: string, name: string): string {
    return buildAssetGitCloneUrlWithBase(resolveEnvGitHttpBaseUrl(), ownerType, ownerId, name);
}

export function resolveAssetGitCloneUrl(asset: AssetGitUrlInput): string {
    const cloneUrl = asset.cloneUrl?.trim();
    if (!cloneUrl || cloneUrl.startsWith('asset://') || isGeneratedLocalAssetGitCloneUrl(cloneUrl) || !isParseableUrl(cloneUrl)) {
        return buildAssetGitCloneUrl(asset.ownerType, asset.ownerId, asset.name);
    }
    return cloneUrl;
}

export function resolveAssetGitHttpBaseUrl(): string {
    return resolveEnvGitHttpBaseUrl();
}

export function buildAssetGitSshUrl(ownerType: 'user' | 'organization', ownerId: string, name: string): string {
    const configured = process.env.GIT_SSH_PUBLIC_BASE_URL?.replace(/\/+$/, '');
    const path = `${ownerType}/${encodeURIComponent(ownerId)}/${encodeURIComponent(name.trim())}.git`;
    if (configured) {
        return `${configured}/${path}`;
    }

    const host = process.env.GIT_SSH_PUBLIC_HOST
        || process.env.APP_PUBLIC_HOST
        || hostFromUrl(resolveEnvGitHttpBaseUrl())
        || 'localhost';
    const port = process.env.GIT_SSH_PUBLIC_PORT || process.env.GIT_SSH_PORT || '2222';
    const portPart = port && port !== '22' ? `:${port}` : '';
    return `ssh://git@${host}${portPart}/${path}`;
}

export function isGeneratedLocalAssetGitCloneUrl(cloneUrl: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(cloneUrl);
    } catch {
        return false;
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
    if (!localHosts.has(hostname)) {
        return false;
    }

    return /(?:^|\/)git\/(?:user|organization)\/[^/]+\/[^/]+\.git$/i.test(parsed.pathname);
}

export function resolveEnvGitHttpBaseUrl(): string {
    return normalizeGitBaseUrl(firstValue([
        process.env.GIT_PUBLIC_BASE_URL,
        process.env.PUBLIC_API_BASE_URL,
        process.env.API_BASE_URL,
        process.env.APP_PUBLIC_BASE_URL,
    ])) ?? defaultLocalApiBaseUrl();
}

export function resolveEnvApiBaseUrl(): string {
    return normalizePublicBaseUrl(firstValue([
        process.env.PUBLIC_API_BASE_URL,
        process.env.API_BASE_URL,
        process.env.APP_PUBLIC_BASE_URL,
        process.env.GIT_PUBLIC_BASE_URL,
    ])) ?? defaultLocalApiBaseUrl();
}

/**
 * Normalize a base URL for public consumption: trim, ensure a protocol scheme,
 * and drop any trailing slash. Returns undefined for blank input so callers can
 * fall through to the next candidate.
 */
function normalizePublicBaseUrl(value?: string): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }
    const withScheme = ensureScheme(trimmed);
    if (!withScheme) {
        return undefined;
    }
    return withScheme.replace(/\/+$/, '');
}

/**
 * Normalize a base URL specifically for serving the bare `/git/...` smart-HTTP
 * routes. Strips known API prefixes (e.g. `/api/v1`) so that appending
 * `/git/<owner>/<name>.git` lands on the correct route, regardless of whether
 * the admin pasted the API URL or the bare host into platform settings.
 */
function normalizeGitBaseUrl(value?: string): string | undefined {
    const normalized = normalizePublicBaseUrl(value);
    if (!normalized) {
        return undefined;
    }
    try {
        const parsed = new URL(normalized);
        const cleanedPath = parsed.pathname
            .replace(/\/+$/, '')
            .replace(/\/api\/v\d+(?:\/|$)/i, '/');
        parsed.pathname = cleanedPath.replace(/\/+$/, '');
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return normalized;
    }
}

function ensureScheme(value: string): string | undefined {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        return value;
    }
    if (value.startsWith('//')) {
        return `${defaultPublicScheme(value.slice(2))}${value.slice(2)}`;
    }
    if (!/^[\w.-]+(?::\d+)?(?:\/|$)/.test(value)) {
        return undefined;
    }
    return `${defaultPublicScheme(value)}${value}`;
}

function defaultPublicScheme(hostAndRest: string): string {
    const host = hostAndRest.split('/')[0] ?? hostAndRest;
    return LOCAL_HOST_PATTERN.test(host) ? 'http://' : DEFAULT_PUBLIC_SCHEME;
}

function defaultLocalApiBaseUrl(): string {
    if (process.env.APP_PORT) {
        return `http://localhost:${process.env.APP_PORT}`;
    }
    return DEFAULT_LOCAL_API_BASE_URL;
}

function firstValue(values: Array<string | undefined>): string | undefined {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) {
            return trimmed;
        }
    }
    return undefined;
}

function hostFromUrl(value?: string): string | undefined {
    if (!value) {
        return undefined;
    }
    const candidate = ensureScheme(value.trim());
    if (!candidate) {
        return undefined;
    }
    try {
        return new URL(candidate).hostname.replace(/^\[|\]$/g, '');
    } catch {
        return undefined;
    }
}

/**
 * Treat a persisted clone URL as usable only when it parses cleanly. SSH-style
 * `git@host:path` strings and scheme-less hosts saved by older versions fail
 * here, prompting the resolver to regenerate from current platform settings.
 */
function isParseableUrl(value: string): boolean {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        return false;
    }
    try {
        const parsed = new URL(value);
        return Boolean(parsed.hostname);
    } catch {
        return false;
    }
}
