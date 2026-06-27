import type { PlanningEventType } from './event-types';

/**
 * Minimal task shape the merge primitives understand. Both kernel and web
 * tasks carry an optional `id` and `title` — those are sufficient to identify
 * a task uniquely for upsert.
 */
export interface TaskRef {
	id?: string;
	title?: string;
}

/**
 * The SDK's `task_updated` event is supposed to be a full snapshot. However,
 * downstream code (normalizer / fallback synthesis) may also surface a
 * `task_updated` with a single task — treat that as an incremental upsert into
 * the existing list. Multi-item updates and all other event types replace.
 */
export function mergeTasksByEvent<T extends TaskRef>(
	eventType: PlanningEventType | string,
	currentTasks: readonly T[],
	incomingTasks: readonly T[],
): T[] {
	if (eventType === 'task_updated' && incomingTasks.length === 1 && currentTasks.length > 1) {
		return upsertTaskByIdOrTitle(currentTasks, incomingTasks[0]);
	}
	return [...incomingTasks];
}

/**
 * Find an existing task by `id` (preferred) or `title`, and merge fields from
 * `task` over it. Append when no match is found. Returns a new array; never
 * mutates the input.
 */
export function upsertTaskByIdOrTitle<T extends TaskRef>(
	tasks: readonly T[],
	task: T,
): T[] {
	const index = tasks.findIndex(
		(existing) =>
			(existing.id !== undefined && existing.id === task.id) ||
			(existing.title !== undefined && existing.title === task.title),
	);
	if (index < 0) return [...tasks, task];
	return tasks.map((existing, taskIndex) =>
		taskIndex === index ? { ...existing, ...task } : existing,
	);
}
