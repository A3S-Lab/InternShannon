export function resolveSelfApiBaseUrl(): string {
    const override = process.env.SELF_API_BASE_URL?.trim();
    if (override) return override.replace(/\/+$/, '');
    const port = process.env.APP_PORT?.trim() || '29653';
    return `http://127.0.0.1:${port}`;
}
