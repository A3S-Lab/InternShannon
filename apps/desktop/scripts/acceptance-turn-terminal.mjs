import { createHash } from "node:crypto";

export function acceptanceFrameRunId(frame) {
	for (const value of [
		frame?.runId,
		frame?.data?.runId,
		frame?.event?.runId,
		frame?.message?.runId,
	]) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function finiteNumber(...values) {
	for (const value of values) {
		const number = typeof value === "number" ? value : Number(value);
		if (value !== "" && value !== null && Number.isFinite(number))
			return number;
	}
	return null;
}

function nonEmptyString(...values) {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function acceptanceActivitySnapshot(event) {
	return {
		phase: nonEmptyString(event?.phase),
		status: nonEmptyString(event?.status),
		activeToolCount: finiteNumber(
			event?.activeToolCount,
			event?.active_tool_count,
		),
		timestamp: finiteNumber(event?.timestamp),
	};
}

function acceptanceStallSnapshot(event) {
	const activeToolCount = finiteNumber(
		event?.activeToolCount,
		event?.active_tool_count,
	);
	const activeTool = nonEmptyString(
		event?.activeToolId,
		event?.active_tool_id,
		event?.activeTool,
		event?.active_tool,
	);
	return {
		eventType: nonEmptyString(event?.type),
		phase:
			nonEmptyString(event?.activeToolPhase, event?.active_tool_phase) ??
			(activeTool || (activeToolCount ?? 0) > 0 ? "tool_exec" : "model_stream"),
		activeTool,
		activeToolCount,
		stalledMs: finiteNumber(event?.stalledMs, event?.stalled_ms),
		thresholdMs: finiteNumber(event?.thresholdMs, event?.threshold_ms),
		timestamp: finiteNumber(event?.timestamp),
	};
}

function acceptanceErrorFingerprint(frame) {
	const code = nonEmptyString(frame?.code, frame?.error?.code) ?? "unknown";
	const message = nonEmptyString(
		frame?.message,
		frame?.error?.message,
		frame?.event?.message,
	);
	const normalized = `${code}|${message ?? "no-message"}`
		.replace(/https?:\/\/[^\s)]+/giu, "<url>")
		.replace(
			/\b(?:run|session|request|message)[-_ ]?id[=: ]+[^\s,;]+/giu,
			"id=<id>",
		)
		.replace(/\b\d+(?:\.\d+)?\b/gu, "<n>")
		.replace(/\s+/gu, " ")
		.slice(0, 2_048);
	return `sha256:${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

/**
 * Produce a bounded diagnostic tail without carrying provider credentials,
 * HTTP headers, cookies, or request/response bodies into acceptance artifacts.
 */
export function sanitizeAcceptanceSidecarLog(value, maxBytes = 262_144) {
	const safeLimit =
		Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : 262_144;
	const sensitiveLine =
		/\b(?:auth|authorization|proxy-authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|cookie|set-cookie|credential|secret|headers?|body|request[-_ ]?body|response[-_ ]?body)\b/iu;
	const sanitized = String(value ?? "")
		.split(/\r?\n/u)
		.map((line) => {
			if (sensitiveLine.test(line))
				return "[redacted sensitive diagnostic line]";
			let safe = line
				.replace(/\b(?:Bearer|Basic)\s+[^\s]+/giu, "<credential-redacted>")
				.replace(/https?:\/\/[^\s)]+/giu, "<url-redacted>");
			const structuredDataAt = safe.indexOf("{");
			if (structuredDataAt >= 0) {
				safe = `${safe.slice(0, structuredDataAt)}<structured-data-redacted>`;
			}
			return safe.slice(0, 4_096);
		})
		.join("\n");
	const bytes = Buffer.from(sanitized, "utf8");
	if (bytes.length <= safeLimit) return sanitized;
	const prefix = Buffer.from("[diagnostic tail truncated]\n", "utf8");
	const tailSize = Math.max(0, safeLimit - prefix.length);
	const safePrefix = prefix.subarray(0, safeLimit).toString("utf8");
	let tail = bytes.subarray(bytes.length - tailSize).toString("utf8");
	while (
		tail &&
		Buffer.byteLength(`${safePrefix}${tail}`, "utf8") > safeLimit
	) {
		tail = tail.slice(1);
	}
	return `${safePrefix}${tail}`;
}

export function acceptanceLifecycleDiagnostics(frames, expectedRunId = null) {
	const frameTypes = {};
	const eventTypes = {};
	let lastEventType = null;
	let lastEventAt = null;
	let lastActivityPhase = null;
	let lastActivityStatus = null;
	let lastActiveToolCount = null;
	let lastResultStatus = null;
	let latestActivity = null;
	let lastPreTerminalActivity = null;
	let lastStall = null;
	let ignoredForeignRunFrames = 0;
	let correlatedFrameCount = 0;
	const errorFingerprintCounts = {};
	for (const frame of Array.isArray(frames) ? frames : []) {
		const runId = acceptanceFrameRunId(frame);
		if (expectedRunId && runId && runId !== expectedRunId) {
			ignoredForeignRunFrames += 1;
			continue;
		}
		correlatedFrameCount += 1;
		const frameType = typeof frame?.type === "string" ? frame.type : "unknown";
		frameTypes[frameType] = (frameTypes[frameType] ?? 0) + 1;
		if (frameType === "error") {
			const fingerprint = acceptanceErrorFingerprint(frame);
			errorFingerprintCounts[fingerprint] =
				(errorFingerprintCounts[fingerprint] ?? 0) + 1;
		}
		const event = frame?.event;
		if (event && typeof event === "object") {
			const eventType = typeof event.type === "string" ? event.type : "unknown";
			eventTypes[eventType] = (eventTypes[eventType] ?? 0) + 1;
			lastEventType = eventType;
			if (Number.isFinite(event.timestamp)) lastEventAt = event.timestamp;
			if (eventType === "main_agent_activity") {
				latestActivity = acceptanceActivitySnapshot(event);
				if (typeof event.phase === "string") lastActivityPhase = event.phase;
				if (typeof event.status === "string") lastActivityStatus = event.status;
				if (Number.isFinite(event.activeToolCount))
					lastActiveToolCount = event.activeToolCount;
			}
			if (
				eventType === "stream_stalled" ||
				eventType === "tool_input_stream_waiting"
			) {
				lastStall = acceptanceStallSnapshot(event);
			}
		}
		if (frameType === "result" && typeof frame?.data?.status === "string") {
			lastPreTerminalActivity ??= latestActivity ? { ...latestActivity } : null;
			lastResultStatus = frame.data.status;
		}
	}
	lastPreTerminalActivity ??= latestActivity ? { ...latestActivity } : null;
	return {
		runId: expectedRunId,
		correlatedFrameCount,
		ignoredForeignRunFrames,
		frameTypes,
		eventTypes,
		lastEventType,
		lastEventAt,
		lastActivityPhase,
		lastActivityStatus,
		lastActiveToolCount,
		lastPreTerminalActivity,
		lastStall,
		errorFingerprintCounts,
		lastResultStatus,
	};
}

const ACCEPTANCE_LIFECYCLE_ERROR_CODES = new Set([
	"acceptance_agent_ui_parse_error",
	"acceptance_cancel_settlement_failed",
	"acceptance_event_stream_stalled",
	"acceptance_missing_run_id",
	"acceptance_persistence_mismatch",
	"acceptance_run_id_mismatch",
	"acceptance_runtime_not_idle",
	"acceptance_session_busy",
	"acceptance_session_closed",
	"acceptance_socket_disconnected",
	"acceptance_turn_timeout",
]);

const SESSION_BUSY_PATTERN =
	/(?:session[_ -]?busy|already has an active operation|active operation(?: is)? (?:already )?(?:running|active)|会话[^\n]{0,24}(?:正在运行|忙碌|正在压缩))/iu;
const SESSION_CLOSED_PATTERN =
	/(?:session[_ -]?(?:is )?closed|session[^\n]{0,64}(?:is|was|has been) closed|会话[^\n]{0,24}(?:已关闭|被关闭|不存在))/iu;
const AGENT_UI_PARSE_FAILURE_PATTERN =
	/(?:快捷操作暂不可用|无法解析\s*agent[-_ ]?ui\s*指令|(?:failed|unable)\s+to\s+parse[^\n]{0,32}agent[-_ ]?ui|agent[-_ ]?ui[^\n]{0,32}(?:parse|parsing|解析)[^\n]{0,24}(?:failed|failure|error|失败|错误))/iu;

function lifecycleText(...values) {
	return values
		.filter((value) => typeof value === "string" && value.trim())
		.map((value) => value.trim())
		.join(" | ")
		.slice(0, 4_096);
}

function lifecycleFailure(code, detail) {
	return { code, detail };
}

export function isAcceptanceLifecycleErrorCode(code) {
	return ACCEPTANCE_LIFECYCLE_ERROR_CODES.has(String(code ?? ""));
}

/**
 * Fail-closed classification for acceptance-harness lifecycle integrity.  It
 * deliberately ignores ordinary provider/model failures: those remain normal
 * failed rounds, while collisions, closed transports, correlation mistakes,
 * persistence mismatches, leaked runtime ownership and broken agent-ui output
 * stop the paid run before another prompt is submitted.
 */
export function detectAcceptanceLifecycleFailure(input = {}) {
	if (input.socketDisconnected === true) {
		return lifecycleFailure(
			"acceptance_socket_disconnected",
			"WebSocket disconnected before the current run settled",
		);
	}

	const expectedRunId = nonEmptyString(input.expectedRunId);
	for (const frame of Array.isArray(input.frames) ? input.frames : []) {
		const frameRunId = acceptanceFrameRunId(frame);
		if (expectedRunId && frameRunId && frameRunId !== expectedRunId) {
			return lifecycleFailure(
				"acceptance_run_id_mismatch",
				`Observed frame for ${frameRunId} while waiting for ${expectedRunId}`,
			);
		}
		if (
			frame?.type === "result" &&
			frame?.data?.status === "failed" &&
			frame?.data?.stopReason === "event_stream_stalled"
		) {
			return lifecycleFailure(
				"acceptance_event_stream_stalled",
				"The product model-stream watchdog terminated the current run",
			);
		}
		const text = lifecycleText(
			frame?.code,
			frame?.message,
			frame?.error?.code,
			frame?.error?.message,
			frame?.data?.code,
			frame?.data?.message,
			frame?.data?.stopReason,
			frame?.event?.code,
			frame?.event?.message,
		);
		if (SESSION_BUSY_PATTERN.test(text)) {
			return lifecycleFailure(
				"acceptance_session_busy",
				"Session rejected the current turn because another operation was active",
			);
		}
		if (SESSION_CLOSED_PATTERN.test(text)) {
			return lifecycleFailure(
				"acceptance_session_closed",
				"Session closed before the current run settled",
			);
		}
		if (AGENT_UI_PARSE_FAILURE_PATTERN.test(text)) {
			return lifecycleFailure(
				"acceptance_agent_ui_parse_error",
				"An agent-ui directive could not be parsed safely",
			);
		}
	}

	const externalText = lifecycleText(input.errorCode, input.errorMessage);
	if (SESSION_BUSY_PATTERN.test(externalText)) {
		return lifecycleFailure(
			"acceptance_session_busy",
			"Session rejected the current turn because another operation was active",
		);
	}
	if (SESSION_CLOSED_PATTERN.test(externalText)) {
		return lifecycleFailure(
			"acceptance_session_closed",
			"Session closed before the current run settled",
		);
	}
	if (AGENT_UI_PARSE_FAILURE_PATTERN.test(externalText)) {
		return lifecycleFailure(
			"acceptance_agent_ui_parse_error",
			"An agent-ui directive could not be parsed safely",
		);
	}

	if (input.requireRunId === true && !expectedRunId) {
		return lifecycleFailure(
			"acceptance_missing_run_id",
			"The terminal turn did not expose a correlated intake runId",
		);
	}

	if (input.persistedPair !== undefined) {
		const pair = input.persistedPair;
		if (
			!expectedRunId ||
			pair?.matched !== true ||
			pair?.userId !== expectedRunId ||
			pair?.parentRunId !== expectedRunId ||
			!nonEmptyString(pair?.assistantId)
		) {
			return lifecycleFailure(
				"acceptance_persistence_mismatch",
				"Persisted user/assistant messages did not match the immutable parentRunId",
			);
		}
	}

	if (input.runtimeIdle !== undefined) {
		if (
			input.runtimeIdle?.runtimeBusy !== false ||
			nonEmptyString(input.runtimeIdle?.activeRunId)
		) {
			return lifecycleFailure(
				"acceptance_runtime_not_idle",
				"Session runtime retained runtimeBusy or activeRunId after the terminal result",
			);
		}
	}

	if (AGENT_UI_PARSE_FAILURE_PATTERN.test(String(input.answer ?? ""))) {
		return lifecycleFailure(
			"acceptance_agent_ui_parse_error",
			"The terminal answer contains an agent-ui parse/degradation failure",
		);
	}

	return null;
}

export function classifyAcceptanceTurnFrame(frame, expectedRunId = null) {
	const runId = acceptanceFrameRunId(frame);
	if (frame?.type === "result") {
		if (expectedRunId && runId !== expectedRunId) {
			return { terminal: false, ignoredRunId: runId };
		}
		return {
			terminal: true,
			result: frame.data ?? {},
			...(runId ? { runId } : {}),
		};
	}
	if (frame?.type === "error") {
		return {
			terminal: false,
			error: String(frame.message ?? "WebSocket run error"),
		};
	}
	return { terminal: false };
}

export function selectPersistedTurnMessages(
	messages,
	beforeMessageIds,
	emittedAssistantId,
	expectedRunId = null,
) {
	const current = (Array.isArray(messages) ? messages : []).filter(
		(message) =>
			typeof message?.id === "string" && !beforeMessageIds.has(message.id),
	);
	const user = expectedRunId
		? (current.find(
				(message) => message?.role === "user" && message?.id === expectedRunId,
			) ?? null)
		: (current.find((message) => message?.role === "user") ?? null);
	const assistantForRun = expectedRunId
		? current.filter(
				(message) =>
					message?.role === "assistant" &&
					message?.metadata?.parentRunId === expectedRunId,
			)
		: current.filter((message) => message?.role === "assistant");
	const assistant =
		(emittedAssistantId
			? assistantForRun.find((message) => message?.id === emittedAssistantId)
			: null) ??
		(expectedRunId ? assistantForRun[0] : [...assistantForRun].reverse()[0]) ??
		null;
	return { complete: Boolean(user && assistant), current, user, assistant };
}
