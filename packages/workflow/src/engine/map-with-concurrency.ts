/**
 * Default fan-out concurrency for parallel node scheduling.
 *
 * Mirrors `DEFAULT_AGENT_DAG_CONCURRENCY` in
 * the historical runtime DAG executor.
 * The engine package is standalone and cannot import from application runtimes, so the
 * value is duplicated here on purpose — keep the two in lockstep.
 *
 * Why 8: a single external orchestrator namespace ResourceQuota typically allows ~10-20 concurrent
 * Pods; capping a single workflow's fan-out at 8 leaves headroom for other
 * workflows sharing the cluster. Raise throughput by adding nodes / quota at the
 * cluster layer, not by enlarging this number.
 */
export const DEFAULT_NODE_FANOUT_CONCURRENCY = 8;

/**
 * Run `fn` over `items` with at most `limit` in flight at once, preserving input
 * order in the result. A standalone copy of the agent-DAG scheduler's helper
 * (see file note above).
 *
 * - `limit <= 0` or `limit >= items.length` falls back to `Promise.all` (zero overhead).
 * - The first rejection bubbles up, matching `Promise.all` semantics.
 *
 * Deliberately tiny and dependency-free — the semantics needed are minimal, so a
 * ~15-line hand-roll is more controllable than pulling in p-limit / p-queue.
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (limit <= 0 || items.length <= limit) {
        return Promise.all(items.map(fn));
    }
    const results = new Array<R>(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: limit }, async () => {
            while (true) {
                const i = next++;
                if (i >= items.length) return;
                results[i] = await fn(items[i], i);
            }
        }),
    );
    return results;
}
