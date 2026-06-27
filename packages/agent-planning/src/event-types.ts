export const PLANNING_EVENT_TYPES = [
	'planning_start',
	'planning_end',
	'task_updated',
	'step_start',
	'step_end',
] as const;

export type PlanningEventType = (typeof PLANNING_EVENT_TYPES)[number];

const PLANNING_EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(PLANNING_EVENT_TYPES);

export function isPlanningEventType(value: unknown): value is PlanningEventType {
	return typeof value === 'string' && PLANNING_EVENT_TYPE_SET.has(value);
}

export function planningEventTypeOf(
	event: { type?: unknown } | null | undefined,
): PlanningEventType | null {
	const type = event?.type;
	return isPlanningEventType(type) ? type : null;
}
