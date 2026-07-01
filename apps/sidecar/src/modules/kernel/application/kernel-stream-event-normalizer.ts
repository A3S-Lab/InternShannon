import type { AgentEvent } from '@a3s-lab/code';
import { terminalOrCompleted } from '@a3s-lab/agent-planning';

// Top-level AgentEvent.type values that carry assistant text content.
const TEXT_EVENT_TYPES = new Set(['text', 'text_delta']);

// Reasoning/thinking deltas. Never forwarded to clients.
const INTERNAL_EVENT_TYPES = new Set(['thinking_delta', 'reasoning_delta']);

// Structured agent runtime events surfaced as `stream_event` frames.
//
// `tool_input_delta` is new in v3: incremental tool-input JSON deltas the
// SDK now emits separately from the existing `input_json_delta`
// content-block deltas. Without it here the message runner would log
// "unhandled event type" warnings for every tool call and clients
// wouldn't see streaming input chunks.
const STRUCTURED_EVENT_TYPES = new Set([
    'message_start',
    'message_end',
    'tool_start',
    'tool_use',
    'tool_end',
    'tool_error',
    'tool_output_delta',
    'tool_input_delta',
    'tool_progress',
    'content_block_start',
    'content_block_delta',
    'input_json_delta',
    'turn_end',
    'context_compacted',
    'memory_stored',
    'memory_recalled',
    'memory_cleared',
    'subagent_start',
    'subagent_progress',
    'subagent_end',
]);

// SDK planning-mode events: surface them so clients can render the plan as it
// is produced and updated.
//   - planning_start  : initial planning kicks off
//   - planning_end    : initial plan finalized (full task list)
//   - task_updated    : authoritative task-list snapshot (the headline event)
//   - step_start/end  : fine-grained per-step progress
const PLANNING_EVENT_TYPES = new Set(['planning_start', 'planning_end', 'task_updated', 'step_start', 'step_end']);

const KNOWN_STREAM_EVENT_TYPES = new Set([
    ...TEXT_EVENT_TYPES,
    ...INTERNAL_EVENT_TYPES,
    ...STRUCTURED_EVENT_TYPES,
    ...PLANNING_EVENT_TYPES,
]);

// SDK runtime bookkeeping events with no user-facing payload. Silently dropped.
const LIFECYCLE_EVENT_TYPES = new Set([
    'start',
    'turn_start',
    'agent_mode_changed',
    'context_resolving',
    'context_resolved',
]);

// SDK hook and observability events have no chat UI payload. Silently dropped.
const HOOK_EVENT_TYPES = new Set([
    'pre_tool_use',
    'post_tool_use',
    'generate_start',
    'generate_end',
    'session_start',
    'session_end',
    'skill_load',
    'skill_unload',
    'pre_prompt',
    'post_response',
    'pre_context_perception',
    'post_context_perception',
    'pre_memory_recall',
    'post_memory_recall',
    'pre_planning',
    'post_planning',
    'pre_reasoning',
    'post_reasoning',
    'on_success',
    'on_error',
    'on_rate_limit',
    'on_confirmation',
    'list_changed',
]);

const MAX_RECURSION_DEPTH = 5;

/**
 * SDK event types we intentionally recognise — either to surface as a typed
 * stream_event frame or to silently drop. The runner uses this to distinguish
 * "intentionally dropped" from "truly unknown" events when logging.
 */
const RECOGNIZED_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
    ...TEXT_EVENT_TYPES,
    ...INTERNAL_EVENT_TYPES,
    ...STRUCTURED_EVENT_TYPES,
    ...PLANNING_EVENT_TYPES,
    ...LIFECYCLE_EVENT_TYPES,
    ...HOOK_EVENT_TYPES,
    // Top-level event types handled by the runner outside the normalizer:
    'confirmation_required',
    'error',
    'done',
]);

export function isKnownEventType(eventType: string): boolean {
    return RECOGNIZED_EVENT_TYPES.has(eventType);
}

export function parseAgentEventData(event: AgentEvent): Record<string, unknown> {
    if (!event.data) {
        return {};
    }
    try {
        const data = JSON.parse(event.data) as unknown;
        return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

export function normalizeStreamEvent(
    eventType: string,
    event: AgentEvent,
    data: Record<string, unknown>,
    depth = 0,
): Record<string, unknown> | null {
    if (!eventType || depth > MAX_RECURSION_DEPTH) return null;

    const innerType = typeof data.type === 'string' ? data.type : '';
    if (innerType && innerType !== eventType && KNOWN_STREAM_EVENT_TYPES.has(innerType)) {
        return normalizeStreamEvent(innerType, event, data, depth + 1);
    }

    if (TEXT_EVENT_TYPES.has(eventType)) {
        const text = extractExplicitText(event, data);
        return text ? { type: 'text_delta', text } : null;
    }
    if (INTERNAL_EVENT_TYPES.has(eventType)) {
        return null;
    }
    if (eventType === 'message_start') return { type: 'message_start' };
    if (eventType === 'message_end') return { type: 'message_end' };
    if (eventType === 'tool_start') {
        return {
            type: 'tool_use_start',
            toolName: extractToolName(event, data),
            toolId: extractToolId(event, data),
            input: extractToolInput(data),
        };
    }
    if (eventType === 'tool_use') {
        return {
            type: 'tool_use',
            toolName: extractToolName(event, data),
            toolId: extractToolId(event, data),
            input: extractToolInput(data),
        };
    }
    if (eventType === 'tool_end') {
        const exitCode = extractToolExitCode(event, data);
        const failed = typeof exitCode === 'number' && exitCode !== 0;
        const result: Record<string, unknown> = {
            type: 'tool_end',
            toolName: extractToolName(event, data),
            toolId: extractToolId(event, data),
            output: extractToolOutput(event, data),
            exitCode,
        };
        const durationMs = pickNumber(data, 'durationMs', 'duration_ms');
        if (durationMs !== undefined) result.durationMs = durationMs;
        // Surface a stable `error` field on failed completions so clients
        // don't have to re-derive failure from the exit code. The reason text
        // comes from either the SDK's explicit `error` field or the tool's
        // captured output, capped to keep stream frames small.
        if (failed) {
            result.error = extractToolErrorReason(event, data);
        }
        const errorKind = extractToolErrorKind(event);
        if (errorKind) result.errorKind = errorKind;
        return result;
    }
    if (eventType === 'tool_error') {
        // Explicit tool failure event from the SDK (e.g. tool timeout, abort,
        // or pre-execution rejection). Carries the same shape as a failed
        // `tool_end` so reducers can treat them uniformly.
        const result: Record<string, unknown> = {
            type: 'tool_error',
            toolName: extractToolName(event, data),
            toolId: extractToolId(event, data),
            reason: extractToolErrorReason(event, data),
            exitCode: extractToolExitCode(event, data),
        };
        const durationMs = pickNumber(data, 'durationMs', 'duration_ms');
        const consecutiveFailures = pickNumber(data, 'consecutiveFailures', 'consecutive_failures');
        if (durationMs !== undefined) result.durationMs = durationMs;
        if (consecutiveFailures !== undefined) result.consecutiveFailures = consecutiveFailures;
        const errorKind = extractToolErrorKind(event);
        if (errorKind) result.errorKind = errorKind;
        return result;
    }
    if (eventType === 'tool_output_delta') {
        return {
            type: 'tool_output_delta',
            toolName: extractToolName(event, data),
            toolUseId: extractToolId(event, data),
            delta: extractToolOutputDelta(event, data),
        };
    }
    if (eventType === 'tool_progress') {
        const result: Record<string, unknown> = {
            type: 'tool_progress',
            toolName: extractToolName(event, data),
            toolUseId: extractToolId(event, data),
        };
        const elapsedMs = pickNumber(data, 'elapsedMs', 'elapsed_ms');
        const elapsedTimeSeconds = pickNumber(data, 'elapsedTimeSeconds', 'elapsed_time_seconds');
        const input = extractToolInput(data);
        const output = extractToolOutput(event, data);
        if (elapsedMs !== undefined) result.elapsedMs = elapsedMs;
        if (elapsedTimeSeconds !== undefined) result.elapsedTimeSeconds = elapsedTimeSeconds;
        if (input !== undefined) result.input = input;
        if (output !== undefined) result.output = output;
        return result;
    }
    if (eventType === 'tool_input_delta') {
        // v3 emits the tool's input JSON in chunks before tool execution
        // starts. Surface it as `input_json_delta` so the existing client
        // reducer (which already handles content_block input streaming via
        // that same type) renders the partial JSON without a separate code
        // path. `partial_json` comes from a few possible field names depending
        // on what the Rust core decided to populate.
        const partialJson = extractInputPartialJson(event, data);
        return partialJson ? { type: 'input_json_delta', partial_json: partialJson } : null;
    }
    if (eventType === 'content_block_start') {
        return {
            type: 'content_block_start',
            content_block: data.content_block,
        };
    }
    if (eventType === 'content_block_delta') {
        return normalizeContentBlockDelta(data.delta);
    }
    if (eventType === 'input_json_delta') {
        const partialJson = extractInputPartialJson(event, data);
        return {
            type: 'input_json_delta',
            partial_json: partialJson,
        };
    }
    if (eventType === 'turn_end') {
        return {
            type: 'turn_end',
            turn: event.turn,
            totalTokens: event.totalTokens,
        };
    }
    if (eventType === 'context_compacted') {
        return {
            type: 'context_compacted',
            beforeMessages: pickNumber(data, 'beforeMessages', 'before_messages', 'before'),
            afterMessages: pickNumber(data, 'afterMessages', 'after_messages', 'after'),
            percentBefore: pickNumber(data, 'percentBefore', 'percent_before'),
            operation: pickString(data, 'operation'),
        };
    }
    if (eventType === 'memory_stored' || eventType === 'memory_recalled' || eventType === 'memory_cleared') {
        const memory = pickRecord(data, 'memory') ?? {};
        const resultCount =
            pickNumber(data, 'resultCount', 'result_count') ??
            pickNumber(memory, 'resultCount', 'result_count') ??
            (eventType === 'memory_recalled'
                ? (pickArrayLength(data, 'memories') ?? pickArrayLength(memory, 'memories'))
                : undefined);
        const content =
            pickString(data, 'content', 'summary', 'text', 'detail', 'message', 'memory', 'value') ??
            pickString(memory, 'content', 'summary', 'text', 'detail', 'message', 'value', 'label', 'title', 'name') ??
            (eventType === 'memory_stored'
                ? (pickString(data, 'key', 'memoryKey', 'memory_key') ??
                  pickString(memory, 'key', 'memoryKey', 'memory_key'))
                : undefined);
        return {
            type: eventType,
            memoryId:
                pickString(data, 'memoryId', 'memory_id', 'memoryKey', 'memory_key', 'key') ??
                pickString(memory, 'memoryId', 'memory_id', 'memoryKey', 'memory_key', 'key', 'id'),
            memoryType:
                pickString(data, 'memoryType', 'memory_type', 'typeLabel', 'type_label', 'layer') ??
                pickString(memory, 'memoryType', 'memory_type', 'typeLabel', 'type_label', 'type', 'kind', 'layer'),
            importance: pickNumber(data, 'importance') ?? pickNumber(memory, 'importance'),
            content,
            relevance: pickNumber(data, 'relevance') ?? pickNumber(memory, 'relevance'),
            resultCount,
        };
    }
    if (eventType === 'subagent_start' || eventType === 'subagent_progress' || eventType === 'subagent_end') {
        const result: Record<string, unknown> = {
            type: eventType,
            parentSessionId: pickString(data, 'parentSessionId', 'parent_session_id'),
            status: pickString(data, 'status'),
            output: pickString(data, 'output', 'message', 'text', 'detail', 'summary'),
        };
        const label = pickString(data, 'label', 'title', 'name');
        if (label) result.label = label;
        return result;
    }
    if (PLANNING_EVENT_TYPES.has(eventType)) {
        return normalizePlanningEvent(eventType, event, data);
    }
    if (LIFECYCLE_EVENT_TYPES.has(eventType)) {
        return null;
    }
    if (HOOK_EVENT_TYPES.has(eventType)) {
        return null;
    }
    return null;
}

/**
 * Normalise the SDK's planning events into a stable client-facing shape.
 *
 * SDK and raw integration events emit planning events with a flat field layout:
 *   - task_updated: { tasks: Task[] }                  (authoritative snapshot)
 *   - step_start:   { step_id/stepId, task_id/taskId, step_number/stepNumber, total_steps/totalSteps }
 *   - step_end:     { step_id/stepId, task_id/taskId, step_number/stepNumber, total_steps/totalSteps, success }
 *   - planning_start/end: payload may contain { estimated_steps/estimatedSteps, reason }
 *
 * Output shape:
 *   {
 *     type: 'planning_start' | 'planning_end' | 'task_updated' | 'step_start' | 'step_end',
 *     tasks?: PlanTask[],
 *     step?: PlanTask,            // synthesized for step_start/step_end so reducers can upsert by id
 *     stepNumber?, totalSteps?,   // surfaced for progress indicators
 *     reason?: string,
 *     timestamp?: number,
 *   }
 */
function normalizePlanningEvent(
    eventType: string,
    event: AgentEvent,
    data: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = { type: eventType };

    const tasks = pickTaskList(data) ?? pickSingleTaskList(data);
    if (tasks) out.tasks = tasks;

    const step = pickStep(data, eventType, event);
    if (step) out.step = step;
    if (!tasks && step && eventType === 'task_updated') out.tasks = [step];

    const stepRecord = pickRecord(data, 'step', 'currentStep') ?? {};
    const stepNumber = pickNumber(data, 'stepNumber', 'step_number') ?? pickNumber(stepRecord, 'stepNumber', 'step_number');
    if (stepNumber !== undefined) out.stepNumber = stepNumber;

    const totalSteps =
        pickNumber(data, 'totalSteps', 'total_steps') ??
        pickNumber(stepRecord, 'totalSteps', 'total_steps') ??
        pickNumber(data, 'estimatedSteps', 'estimated_steps');
    if (totalSteps !== undefined) out.totalSteps = totalSteps;

    const reason = pickString(data, 'reason') ?? pickString(data, 'message') ?? pickString(data, 'error');
    if (reason) out.reason = reason;

    const timestamp =
        typeof data.timestamp === 'number' && Number.isFinite(data.timestamp) ? data.timestamp : undefined;
    if (timestamp !== undefined) out.timestamp = timestamp;

    if (typeof event.turn === 'number') out.turn = event.turn;

    return out;
}

function pickTaskList(data: Record<string, unknown>): unknown[] | undefined {
    if (!Array.isArray(data.tasks)) return undefined;
    return (data.tasks as unknown[]).map(item => normalizeTaskRecord(item));
}

function pickSingleTaskList(data: Record<string, unknown>): unknown[] | undefined {
    const task = pickRecord(data, 'task', 'currentTask');
    return task ? [normalizeTaskRecord(task)] : undefined;
}

function pickStep(
    data: Record<string, unknown>,
    eventType: string,
    event: AgentEvent,
): Record<string, unknown> | undefined {
    // SDK 2.5.0: step_start / step_end events emit step identifiers and
    // progress numbers at the top level of `data`. A step id is required.
    if (eventType !== 'step_start' && eventType !== 'step_end') {
        return undefined;
    }
    const source = pickRecord(data, 'step', 'currentStep') ?? data;
    const stepId = pickString(source, 'stepId', 'step_id') ?? pickString(source, 'id');
    if (!stepId) return undefined;

    const record: Record<string, unknown> = { id: stepId };
    const parentId =
        pickString(source, 'taskId', 'task_id', 'parentId', 'parent_task_id') ??
        pickString(data, 'taskId', 'task_id', 'parentId', 'parent_task_id');
    if (parentId) record.parentId = parentId;
    const title =
        pickString(source, 'title') ??
        pickString(source, 'summary') ??
        pickString(source, 'description') ??
        pickString(data, 'title') ??
        pickString(data, 'summary') ??
        pickString(data, 'description');
    if (title) record.title = title;
    const note = pickString(source, 'note') ?? pickString(data, 'note');
    if (note) record.note = note;
    const stepNumber = pickNumber(source, 'stepNumber', 'step_number') ?? pickNumber(data, 'stepNumber', 'step_number');
    if (stepNumber !== undefined) record.stepNumber = stepNumber;

    if (eventType === 'step_start') {
        record.status = 'running';
        return record;
    }

    // step_end
    if (source.success === false || data.success === false) {
        record.status = 'failed';
        const error = pickString(source, 'error') ?? pickString(source, 'message') ?? pickString(data, 'error', 'message');
        if (error) record.error = error;
    } else if (source.cancelled === true || data.cancelled === true) {
        record.status = 'cancelled';
    } else {
        record.status = terminalOrCompleted(
            pickString(source, 'status', 'state', 'phase') ?? pickString(data, 'status', 'state', 'phase'),
        );
    }
    if (typeof event.exitCode === 'number' && event.exitCode !== 0 && record.status === 'completed') {
        record.status = 'failed';
    }
    return record;
}

function normalizeTaskRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { title: String(value ?? '') };
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // Translate SDK snake_case task identifiers to the camelCase contract
    // downstream consumers (tracker, frontend reducer) read.
    if (typeof record.task_id === 'string') out.id = record.task_id;
    else if (record.id !== undefined) out.id = record.id;
    if (typeof record.parent_task_id === 'string') out.parentId = record.parent_task_id;
    else if (record.parentId !== undefined) out.parentId = record.parentId;
    // Preserve any other fields verbatim so SDK additions surface to clients.
    for (const [key, val] of Object.entries(record)) {
        if (key === 'task_id' || key === 'parent_task_id') continue;
        if (!(key in out)) out[key] = val;
    }
    return out;
}

function pickString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = data[key];
        if (typeof value === 'string' && value.trim()) return value;
    }
    return undefined;
}

function pickTrimmedString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = data[key];
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return undefined;
}

function pickRecord(data: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | undefined {
    for (const key of keys) {
        const value = data[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }
    }
    return undefined;
}

function pickNumber(data: Record<string, unknown>, ...keys: string[]): number | undefined {
    for (const key of keys) {
        const value = data[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return undefined;
}

function pickArrayLength(data: Record<string, unknown>, ...keys: string[]): number | undefined {
    for (const key of keys) {
        const value = data[key];
        if (Array.isArray(value)) return value.length;
    }
    return undefined;
}

function normalizeContentBlockDelta(delta: unknown): Record<string, unknown> | null {
    if (!delta || typeof delta !== 'object') {
        return null;
    }

    const deltaRecord = delta as Record<string, unknown>;
    const deltaType = typeof deltaRecord.type === 'string' ? deltaRecord.type : '';
    if (deltaType === 'thinking_delta' || deltaType === 'reasoning_delta') {
        return null;
    }
    if (deltaType === 'text_delta') {
        const text =
            typeof deltaRecord.text === 'string'
                ? deltaRecord.text
                : typeof deltaRecord.content === 'string'
                  ? deltaRecord.content
                  : '';
        return text
            ? {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text },
              }
            : null;
    }
    if (deltaType === 'input_json_delta') {
        const partialJson = pickString(
            deltaRecord,
            'partial_json',
            'partialJson',
            'input_delta',
            'inputDelta',
            'delta',
            'input',
        );
        return partialJson
            ? {
                  type: 'content_block_delta',
                  delta: { type: 'input_json_delta', partial_json: partialJson },
              }
            : null;
    }
    return null;
}

function extractExplicitText(event: AgentEvent, data: Record<string, unknown>): string {
    if (typeof event.text === 'string') return event.text;
    if (typeof data.text === 'string') return data.text;
    return '';
}

function extractInputPartialJson(event: AgentEvent, data: Record<string, unknown>): string {
    if (typeof event.text === 'string') return event.text;
    return pickString(data, 'partial_json', 'partialJson', 'input_delta', 'inputDelta', 'delta', 'input') ?? '';
}

/**
 * Parse v3's `errorKindJson` discriminant into a typed object the runner and
 * frontend can branch on. The SDK encodes a `ToolErrorKind` union — currently
 * `timeout` / `version_conflict` / `remote_git_conflict` / `not_found` /
 * `invalid_argument` / `unsupported` — and may add new variants. We keep the
 * payload opaque after pulling the `type` field so unknown kinds round-trip
 * without losing data.
 */
function extractToolErrorKind(event: AgentEvent): Record<string, unknown> | undefined {
    const raw = event.errorKindJson;
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
        const record = parsed as Record<string, unknown>;
        return typeof record.type === 'string' && record.type.trim() ? record : undefined;
    } catch {
        return undefined;
    }
}

const TOOL_ERROR_REASON_MAX_LENGTH = 1_000;

function extractToolErrorReason(event: AgentEvent, data: Record<string, unknown>): string {
    const candidates: Array<unknown> = [
        event.error,
        data.error,
        data.reason,
        data.message,
        event.toolOutput,
        data.toolOutput,
        data.tool_output,
        data.output,
        data.result,
    ];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const trimmed = candidate.trim();
        if (!trimmed) continue;
        return trimmed.length > TOOL_ERROR_REASON_MAX_LENGTH
            ? `${trimmed.slice(0, TOOL_ERROR_REASON_MAX_LENGTH)}…`
            : trimmed;
    }
    return 'Tool execution failed';
}

function extractToolInput(data: Record<string, unknown>): unknown {
    if ('input' in data) return data.input;
    if ('toolInput' in data) return data.toolInput;
    if ('tool_input' in data) return data.tool_input;
    const contentBlock = data.content_block;
    if (contentBlock && typeof contentBlock === 'object') {
        const block = contentBlock as Record<string, unknown>;
        if ('input' in block) return block.input;
    }
    return undefined;
}

function extractToolName(event: AgentEvent, data: Record<string, unknown>): string | undefined {
    const eventRecord = event as unknown as Record<string, unknown>;
    return (
        pickString(eventRecord, 'toolName', 'tool_name', 'name', 'tool') ??
        pickString(data, 'toolName', 'tool_name', 'name', 'tool')
    );
}

function extractToolId(event: AgentEvent, data: Record<string, unknown>): string | undefined {
    const eventRecord = event as unknown as Record<string, unknown>;
    return (
        pickTrimmedString(
            eventRecord,
            'toolId',
            'tool_id',
            'toolUseId',
            'tool_use_id',
            'tool_call_id',
            'toolCallId',
            'id',
        ) ??
        pickTrimmedString(data, 'toolId', 'tool_id', 'toolUseId', 'tool_use_id', 'toolCallId', 'tool_call_id', 'id')
    );
}

function extractToolOutput(event: AgentEvent, data: Record<string, unknown>): unknown {
    if (event.toolOutput !== undefined) return event.toolOutput;
    if ('toolOutput' in data) return data.toolOutput;
    if ('tool_output' in data) return data.tool_output;
    if ('output' in data) return data.output;
    if ('result' in data) return data.result;
    return undefined;
}

function extractToolOutputDelta(event: AgentEvent, data: Record<string, unknown>): string {
    const candidates: unknown[] = [
        event.toolOutput,
        event.text,
        data.delta,
        data.outputDelta,
        data.output_delta,
        data.toolOutput,
        data.tool_output,
        data.output,
    ];
    for (const candidate of candidates) {
        const text = stringifyToolOutputDelta(candidate);
        if (text !== undefined) return text;
    }
    return '';
}

function stringifyToolOutputDelta(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
    if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    try {
        return JSON.stringify(value, null, 2) ?? '';
    } catch {
        return String(value);
    }
}

function extractToolExitCode(event: AgentEvent, data: Record<string, unknown>): number | undefined {
    return typeof event.exitCode === 'number' ? event.exitCode : pickNumber(data, 'exitCode', 'exit_code');
}
