/**
 * Per-node error handling strategy (Dify parity). When a node throws, the engine
 * consults `node.data.errorStrategy`:
 *
 *   - 'fail'     (default): the node fails and the whole execution fails — the
 *                historical behavior, kept for back-compat.
 *   - 'default'  : swallow the error, emit `node.data.errorDefaultValue` as the
 *                node's output, and continue downstream (resilient fallback).
 *   - 'continue' : swallow the error, emit an empty output, and continue
 *                downstream (best-effort skip).
 *
 * Kept as pure functions so both execution engines (the core engine and the agent
 * definition walker) can share one interpretation and stay unit-testable.
 */
export type NodeErrorStrategy = 'fail' | 'default' | 'continue';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function resolveNodeErrorStrategy(data: unknown): NodeErrorStrategy {
    const value = isRecord(data) ? data.errorStrategy : undefined;
    return value === 'default' || value === 'continue' ? value : 'fail';
}

export function resolveNodeErrorDefaultOutput(data: unknown): Record<string, unknown> {
    if (!isRecord(data)) {
        return {};
    }
    const candidate = data.errorDefaultValue ?? data.defaultOutput;
    return isRecord(candidate) ? candidate : {};
}
