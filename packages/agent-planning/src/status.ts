export type PlanningTaskStatus =
	| 'pending'
	| 'running'
	| 'completed'
	| 'failed'
	| 'cancelled'
	| 'skipped'
	| 'unknown';

export const TERMINAL_TASK_STATUSES: ReadonlySet<PlanningTaskStatus> = new Set<PlanningTaskStatus>([
	'completed',
	'failed',
	'cancelled',
	'skipped',
]);

const STATUS_SYNONYMS: Readonly<Record<string, PlanningTaskStatus>> = {
	todo: 'pending',
	queued: 'pending',
	open: 'pending',
	not_started: 'pending',
	active: 'running',
	doing: 'running',
	in_progress: 'running',
	started: 'running',
	done: 'completed',
	success: 'completed',
	finished: 'completed',
	error: 'failed',
	canceled: 'cancelled',
};

const CANONICAL_STATUSES: ReadonlySet<PlanningTaskStatus> = new Set<PlanningTaskStatus>([
	'pending',
	'running',
	'completed',
	'failed',
	'cancelled',
	'skipped',
]);

export function normalizePlanningStatus(
	value: unknown,
	fallback: PlanningTaskStatus = 'pending',
): PlanningTaskStatus {
	const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if (!raw) return fallback;
	const synonym = STATUS_SYNONYMS[raw];
	if (synonym) return synonym;
	return CANONICAL_STATUSES.has(raw as PlanningTaskStatus) ? (raw as PlanningTaskStatus) : 'unknown';
}

/** Returns the input status if it is in TERMINAL_TASK_STATUSES, else `"completed"`. */
export function terminalOrCompleted(
	value: unknown,
): PlanningTaskStatus {
	const normalized = normalizePlanningStatus(value, 'completed');
	return TERMINAL_TASK_STATUSES.has(normalized) ? normalized : 'completed';
}
