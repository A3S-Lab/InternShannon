/**
 * A passive reconnect may resend the value that the session already owns.
 * Treat that exact update as idempotent even while a run is active; different
 * values remain protected by the normal busy-session rejection.
 */
export function isNoopSystemPromptUpdate(incoming: unknown, current: string | undefined): boolean {
    const next = typeof incoming === "string" ? incoming : undefined;
    return next === current;
}
