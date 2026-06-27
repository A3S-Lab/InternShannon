// ============================================================================
// Environment Variable Validation
// ============================================================================

/**
 * Validates that all required environment variables are set
 * Throws an error if any required variables are missing
 */
export function validateRequiredEnvVars(): void {
    const required = ['NODE_ENV'];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}\n` +
                'Please check your .env files or set these variables in your environment.',
        );
    }
}

/**
 * Validates environment-specific requirements
 */
export function validateEnvironmentConfig(): void {
    const nodeEnv = process.env.NODE_ENV;

    if (!nodeEnv) {
        throw new Error('NODE_ENV must be set (development, production, test)');
    }

    if (!['development', 'production', 'test'].includes(nodeEnv)) {
        throw new Error(`Invalid NODE_ENV: ${nodeEnv}. Must be one of: development, production, test`);
    }

    // Desktop sidecar intentionally has no external service environment
    // requirements.
}
