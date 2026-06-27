export type OAuthProviderId = 'github';

export type OAuthProviderConfig = {
    enabled?: boolean;
    clientId?: string;
    clientSecret?: string;
    callbackUrl?: string;
    scopes?: string[];
};

export type OAuthConfigCache = Partial<Record<OAuthProviderId, OAuthProviderConfig>>;

export type OAuthProviderDefaults = {
    name: string;
    callbackPath: string;
    callbackEnvKeys: readonly string[];
    defaultScopes: readonly string[];
    assetScopes: readonly string[];
    clientIdEnvKeys: readonly string[];
    clientSecretEnvKeys: readonly string[];
    authorizeUrl: string;
    tokenUrl: string;
    apiBaseUrl: string;
};

export const OAUTH_PROVIDER_IDS = ['github'] as const satisfies readonly OAuthProviderId[];

export const OAUTH_PROVIDER_DEFAULTS: Record<OAuthProviderId, OAuthProviderDefaults> = {
    github: {
        name: 'GitHub',
        callbackPath: '/api/v1/integrations/github/oauth/callback',
        callbackEnvKeys: ['GITHUB_CALLBACK_URL', 'GITHUB_OAUTH_CALLBACK_URL'],
        defaultScopes: ['read:user', 'user:email'],
        assetScopes: ['repo', 'read:user'],
        clientIdEnvKeys: ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_CLIENT_ID', 'GITHUB_AUTH_CLIENT_ID', 'GITHUB_LOGIN_CLIENT_ID'],
        clientSecretEnvKeys: ['GITHUB_OAUTH_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET', 'GITHUB_AUTH_CLIENT_SECRET', 'GITHUB_LOGIN_CLIENT_SECRET'],
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        apiBaseUrl: 'https://api.github.com',
    },
};

export function oauthProviderName(provider: OAuthProviderId): string {
    return OAUTH_PROVIDER_DEFAULTS[provider].name;
}

export function oauthProviderDefaultScope(provider: OAuthProviderId): string {
    return OAUTH_PROVIDER_DEFAULTS[provider].defaultScopes.join(' ');
}

export function oauthProviderAssetScope(provider: OAuthProviderId): string {
    return OAUTH_PROVIDER_DEFAULTS[provider].assetScopes.join(' ');
}

export function oauthProviderCallbackUrl(provider: OAuthProviderId, baseUrl?: string): string {
    const normalizedBaseUrl = (baseUrl?.trim() || `http://localhost:${process.env.APP_PORT || 3000}`).replace(/\/+$/, '');
    return `${normalizedBaseUrl}${OAUTH_PROVIDER_DEFAULTS[provider].callbackPath}`;
}

export function firstNonBlank(values: Iterable<string | undefined | null>): string | undefined {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) return trimmed;
    }
    return undefined;
}

export function firstEnv(keys: readonly string[]): string | undefined {
    return firstNonBlank(keys.map(key => process.env[key]));
}
