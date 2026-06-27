/**
 * Canonical JSON + sha256 helpers for hashing TaskView/TaskContract.
 * Mirrors `serial_agent_chain/hashing.py`.
 */
import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) {
            out[key] = canonicalize(source[key]);
        }
        return out;
    }
    return value;
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

export function sha256Json(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
