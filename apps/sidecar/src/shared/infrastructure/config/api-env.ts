import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { expand } from 'dotenv-expand';

const ENV_LOADED_SYMBOL = Symbol.for('a3s.api.env.loaded');

interface LoadState {
    [ENV_LOADED_SYMBOL]?: boolean;
}

export interface LoadApiEnvFilesOptions {
    envDir?: string;
    nodeEnv?: string;
    force?: boolean;
}

export function resolveApiEnvDir(): string {
    return path.resolve(__dirname, '../../../../env');
}

export function loadApiEnvFiles(options: LoadApiEnvFilesOptions = {}): void {
    const state = globalThis as LoadState;
    if (state[ENV_LOADED_SYMBOL] && !options.force) {
        return;
    }

    const envDir = options.envDir ?? resolveApiEnvDir();
    const localEnvPath = path.join(envDir, '.env.local');
    const localEnv = readEnvFile(localEnvPath);
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? localEnv.NODE_ENV ?? 'development';

    applyEnvValues({
        ...readEnvFile(path.join(envDir, '.env')),
        ...readEnvFile(path.join(envDir, `.env.${nodeEnv}`)),
    }, false);
    applyEnvValues(localEnv, true);

    if (!process.env.NODE_ENV) {
        process.env.NODE_ENV = nodeEnv;
    }

    state[ENV_LOADED_SYMBOL] = true;
}

function readEnvFile(filePath: string): Record<string, string> {
    if (!existsSync(filePath)) {
        return {};
    }

    return parseDotenv(readFileSync(filePath));
}

function applyEnvValues(values: Record<string, string>, override: boolean): void {
    if (!Object.keys(values).length) {
        return;
    }

    const currentEnv = toStringEnv(process.env);
    const processEnv = override
        ? { ...currentEnv, ...values }
        : { ...values, ...currentEnv };
    const expanded = expand({ parsed: { ...values }, processEnv }).parsed ?? values;

    for (const [key, value] of Object.entries(expanded)) {
        if (override || process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function toStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}
