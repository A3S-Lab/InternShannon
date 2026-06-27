/** Field names commonly used for task identifiers across SDK versions and shapes. */
export const TASK_ID_FIELDS = ['id', 'taskId', 'stepId', 'key'] as const;

/** Field names commonly used for task titles. */
export const TASK_TITLE_FIELDS = [
	'title',
	'label',
	'name',
	'summary',
	'description',
	'text',
	'content',
] as const;

/** Reads the first non-empty string-valued field from `record` among `keys`. */
export function stringField(
	record: Record<string, unknown>,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return undefined;
}
