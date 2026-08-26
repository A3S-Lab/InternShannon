export interface SessionRuntimeBusyInput {
	runtimeStatus?: string | null;
	runtimeBusy?: boolean;
	isCompacting?: boolean;
	activeToolCount?: number;
	hasLiveRuntimeEvent?: boolean;
}

export function resolveSessionRuntimeBusy(
	input: SessionRuntimeBusyInput,
): boolean {
	return (
		input.runtimeBusy === true ||
		input.isCompacting === true ||
		input.runtimeStatus === "running" ||
		input.runtimeStatus === "processing" ||
		input.runtimeStatus === "compacting" ||
		(input.activeToolCount ?? 0) > 0 ||
		input.hasLiveRuntimeEvent === true
	);
}

export function runtimeTerminalMatches(
	activeRunId?: string,
	eventRunId?: string,
): boolean {
	return !activeRunId || !eventRunId || activeRunId === eventRunId;
}

/**
 * Cancellation acknowledgements mutate all live streaming state, so an
 * uncorrelated legacy acknowledgement must never clear a newer active run.
 * Correlated acknowledgements remain usable after the active run has already
 * settled, which keeps duplicate delivery idempotent.
 */
export function runtimeCancellationMatches(
	activeRunId?: string,
	eventRunId?: string,
): boolean {
	if (!activeRunId) return true;
	return Boolean(eventRunId && activeRunId === eventRunId);
}
