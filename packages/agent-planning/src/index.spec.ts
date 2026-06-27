import {
	PLANNING_EVENT_TYPES,
	TASK_ID_FIELDS,
	TASK_TITLE_FIELDS,
	TERMINAL_TASK_STATUSES,
	isPlanningEventType,
	mergeTasksByEvent,
	normalizePlanningStatus,
	planningEventTypeOf,
	stringField,
	terminalOrCompleted,
	upsertTaskByIdOrTitle,
} from './index';

describe('normalizePlanningStatus', () => {
	it('passes through canonical statuses verbatim', () => {
		for (const status of ['pending', 'running', 'completed', 'failed', 'cancelled', 'skipped']) {
			expect(normalizePlanningStatus(status)).toBe(status);
		}
	});

	it('maps common synonyms to canonical statuses', () => {
		expect(normalizePlanningStatus('todo')).toBe('pending');
		expect(normalizePlanningStatus('in_progress')).toBe('running');
		expect(normalizePlanningStatus('started')).toBe('running');
		expect(normalizePlanningStatus('done')).toBe('completed');
		expect(normalizePlanningStatus('error')).toBe('failed');
		expect(normalizePlanningStatus('canceled')).toBe('cancelled');
	});

	it('lower-cases and trims', () => {
		expect(normalizePlanningStatus('  IN_PROGRESS  ')).toBe('running');
		expect(normalizePlanningStatus('CANCELED')).toBe('cancelled');
	});

	it('returns fallback for null/undefined/empty', () => {
		expect(normalizePlanningStatus(null)).toBe('pending');
		expect(normalizePlanningStatus(undefined)).toBe('pending');
		expect(normalizePlanningStatus('')).toBe('pending');
		expect(normalizePlanningStatus('   ')).toBe('pending');
	});

	it('honors the provided fallback', () => {
		expect(normalizePlanningStatus(undefined, 'running')).toBe('running');
		expect(normalizePlanningStatus(null, 'completed')).toBe('completed');
	});

	it('returns "unknown" for unrecognized non-empty strings', () => {
		expect(normalizePlanningStatus('frobnicated')).toBe('unknown');
		expect(normalizePlanningStatus('mystery')).toBe('unknown');
	});
});

describe('TERMINAL_TASK_STATUSES', () => {
	it('contains exactly the four terminal statuses', () => {
		expect(TERMINAL_TASK_STATUSES.size).toBe(4);
		expect(TERMINAL_TASK_STATUSES.has('completed')).toBe(true);
		expect(TERMINAL_TASK_STATUSES.has('failed')).toBe(true);
		expect(TERMINAL_TASK_STATUSES.has('cancelled')).toBe(true);
		expect(TERMINAL_TASK_STATUSES.has('skipped')).toBe(true);
		expect(TERMINAL_TASK_STATUSES.has('running')).toBe(false);
	});
});

describe('terminalOrCompleted', () => {
	it('returns the terminal status when input is already terminal', () => {
		expect(terminalOrCompleted('failed')).toBe('failed');
		expect(terminalOrCompleted('cancelled')).toBe('cancelled');
		expect(terminalOrCompleted('skipped')).toBe('skipped');
	});

	it('defaults to "completed" for non-terminal inputs', () => {
		expect(terminalOrCompleted('running')).toBe('completed');
		expect(terminalOrCompleted('pending')).toBe('completed');
		expect(terminalOrCompleted(undefined)).toBe('completed');
		expect(terminalOrCompleted('mystery')).toBe('completed');
	});
});

describe('PLANNING_EVENT_TYPES + isPlanningEventType + planningEventTypeOf', () => {
	it('exposes the five SDK planning events in stable order', () => {
		expect(PLANNING_EVENT_TYPES).toEqual([
			'planning_start',
			'planning_end',
			'task_updated',
			'step_start',
			'step_end',
		]);
	});

	it('recognizes valid planning event types', () => {
		expect(isPlanningEventType('task_updated')).toBe(true);
		expect(isPlanningEventType('planning_start')).toBe(true);
	});

	it('rejects non-planning types', () => {
		expect(isPlanningEventType('text_delta')).toBe(false);
		expect(isPlanningEventType('')).toBe(false);
		expect(isPlanningEventType(null)).toBe(false);
		expect(isPlanningEventType(undefined)).toBe(false);
	});

	it('planningEventTypeOf extracts type from an event-like object', () => {
		expect(planningEventTypeOf({ type: 'task_updated' })).toBe('task_updated');
		expect(planningEventTypeOf({ type: 'unrelated' })).toBeNull();
		expect(planningEventTypeOf(null)).toBeNull();
		expect(planningEventTypeOf({})).toBeNull();
	});
});

describe('stringField', () => {
	it('returns first non-empty trimmed string match', () => {
		const record = { name: '', title: '  hello  ', label: 'world' };
		expect(stringField(record, ['name', 'title', 'label'])).toBe('hello');
	});

	it('returns undefined when no match', () => {
		expect(stringField({ name: '' }, ['name', 'title'])).toBeUndefined();
		expect(stringField({ name: 123 }, ['name'])).toBeUndefined();
	});

	it('exposes canonical ID and title field lookup lists', () => {
		expect(TASK_ID_FIELDS).toEqual(['id', 'taskId', 'stepId', 'key']);
		expect(TASK_TITLE_FIELDS).toContain('title');
		expect(TASK_TITLE_FIELDS).toContain('summary');
	});
});

describe('upsertTaskByIdOrTitle', () => {
	it('appends when no match exists', () => {
		const result = upsertTaskByIdOrTitle(
			[{ id: 'a', title: 'A' }],
			{ id: 'b', title: 'B' },
		);
		expect(result).toEqual([
			{ id: 'a', title: 'A' },
			{ id: 'b', title: 'B' },
		]);
	});

	it('merges fields when id matches', () => {
		const result = upsertTaskByIdOrTitle(
			[{ id: 'a', title: 'A', status: 'pending' }],
			{ id: 'a', status: 'completed' },
		);
		expect(result).toEqual([{ id: 'a', title: 'A', status: 'completed' }]);
	});

	it('merges fields when title matches and id is undefined', () => {
		const result = upsertTaskByIdOrTitle(
			[{ title: 'shared', status: 'pending' }],
			{ title: 'shared', status: 'running' },
		);
		expect(result).toEqual([{ title: 'shared', status: 'running' }]);
	});

	it('does not mutate the input array', () => {
		const input = [{ id: 'a', status: 'pending' }];
		upsertTaskByIdOrTitle(input, { id: 'a', status: 'completed' });
		expect(input).toEqual([{ id: 'a', status: 'pending' }]);
	});
});

describe('mergeTasksByEvent', () => {
	it('replaces the list on multi-item task_updated', () => {
		const current = [
			{ id: 'a', status: 'pending' },
			{ id: 'b', status: 'pending' },
		];
		const incoming = [
			{ id: 'a', status: 'completed' },
			{ id: 'b', status: 'running' },
		];
		expect(mergeTasksByEvent('task_updated', current, incoming)).toEqual(incoming);
	});

	it('upserts a single-item task_updated into an existing multi-item list', () => {
		const current = [
			{ id: 'a', status: 'pending' },
			{ id: 'b', status: 'pending' },
		];
		const incoming = [{ id: 'b', status: 'running' }];
		expect(mergeTasksByEvent('task_updated', current, incoming)).toEqual([
			{ id: 'a', status: 'pending' },
			{ id: 'b', status: 'running' },
		]);
	});

	it('replaces on single-item task_updated when current is empty or one task', () => {
		expect(mergeTasksByEvent('task_updated', [], [{ id: 'b', status: 'running' }])).toEqual([
			{ id: 'b', status: 'running' },
		]);
		expect(
			mergeTasksByEvent('task_updated', [{ id: 'a', status: 'pending' }], [
				{ id: 'b', status: 'running' },
			]),
		).toEqual([{ id: 'b', status: 'running' }]);
	});

	it('always replaces for non-task_updated events', () => {
		const current = [
			{ id: 'a', status: 'pending' },
			{ id: 'b', status: 'pending' },
		];
		expect(mergeTasksByEvent('planning_end', current, [{ id: 'c', status: 'pending' }])).toEqual([
			{ id: 'c', status: 'pending' },
		]);
	});
});
