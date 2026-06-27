/**
 * Single source of truth for the asset-diagnose partial-pass threshold.
 *
 * `ASSET_DIAGNOSE_MAX_FAILED_SCOPES` controls how many worker scopes may fail
 * while the run is still acknowledged (tagged `partial`) and clears the publish
 * gate. Both the runner (enforcement: auto-ack + auto-PR) and the development
 * board (display: 部分通过 vs hard failure) read this value, so they MUST agree —
 * keep them on this one resolver to avoid display/enforcement drift.
 *
 * Default 1 (a single flaky worker shouldn't block publish). Set 0 for the
 * strict "every scope must pass" gate. Negatives / non-numbers fall back to 1.
 */
export function resolveMaxFailedScopes(): number {
    const raw = process.env.ASSET_DIAGNOSE_MAX_FAILED_SCOPES;
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 1;
}

/**
 * How many times the runner re-dispatches the agent attempt when a run comes
 * back INCOMPLETE (fewer worker outputs than scopes) or throws a transient
 * error. A worker that produces no structured output is an infra/transient
 * failure (a genuinely bad asset still produces findings), so a bounded retry
 * gets a complete report before falling back to the partial-success threshold.
 *
 * Default 1 (so at most 2 attempts). 0 disables in-run retry. Negatives /
 * non-numbers fall back to 1. Hard-capped at MAX_RETRIES_CEILING: each retry is
 * another full agent run, so an unbounded env flip would pin a worker slot for
 * hours/days on a crash.
 */
const MAX_RETRIES_CEILING = 5;

export function resolveMaxRetries(): number {
    const raw = process.env.ASSET_DIAGNOSE_MAX_RETRIES;
    const parsed = raw ? Number(raw) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed < 0) return 1;
    return Math.min(Math.floor(parsed), MAX_RETRIES_CEILING);
}
