import { redactSecretValuesInText } from '@/shared/common/security/secret-redaction';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isKernelContentLoggingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return ENABLED_VALUES.has(String(env.INTERNSHANNON_DIAGNOSTIC_CONTENT_LOGS || '').trim().toLowerCase());
}
export function kernelContentLogValue(
    value: unknown,
    limit: number,
    env: NodeJS.ProcessEnv = process.env,
): string {
    const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
    if (!isKernelContentLoggingEnabled(env)) {
        return `[redacted length=${text.length}]`;
    }
    return redactSecretValuesInText(text).replace(/\s+/g, ' ').slice(0, limit);
}
