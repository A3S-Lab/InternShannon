import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	acceptanceLifecycleDiagnostics,
	classifyAcceptanceTurnFrame,
	detectAcceptanceLifecycleFailure,
	isAcceptanceLifecycleErrorCode,
	sanitizeAcceptanceSidecarLog,
	selectPersistedTurnMessages,
} from "./acceptance-turn-terminal.mjs";

describe("acceptance websocket terminal contract", () => {
	it("records an SDK error frame but waits for the authoritative result", () => {
		assert.deepEqual(
			classifyAcceptanceTurnFrame({ type: "error", message: "opaque 400" }),
			{
				terminal: false,
				error: "opaque 400",
			},
		);
		assert.deepEqual(
			classifyAcceptanceTurnFrame({
				type: "result",
				data: { status: "failed", stopReason: "unknown" },
			}),
			{
				terminal: true,
				result: { status: "failed", stopReason: "unknown" },
			},
		);
	});

	it("ignores a late result from a different run", () => {
		assert.deepEqual(
			classifyAcceptanceTurnFrame(
				{ type: "result", data: { runId: "run-old", status: "succeeded" } },
				"run-current",
			),
			{ terminal: false, ignoredRunId: "run-old" },
		);
		assert.equal(
			classifyAcceptanceTurnFrame(
				{ type: "result", data: { runId: "run-current", status: "failed" } },
				"run-current",
			).terminal,
			true,
		);
	});

	it("waits for new user and assistant roles rather than an unrelated total", () => {
		const before = new Set(["old-user", "old-assistant"]);
		const incomplete = selectPersistedTurnMessages(
			[
				{ id: "old-user", role: "user" },
				{ id: "old-assistant", role: "assistant" },
				{ id: "new-user", role: "user" },
			],
			before,
			"new-assistant",
		);
		assert.equal(incomplete.complete, false);

		const complete = selectPersistedTurnMessages(
			[
				{ id: "old-user", role: "user" },
				{ id: "old-assistant", role: "assistant" },
				{ id: "new-user", role: "user" },
				{
					id: "new-assistant",
					role: "assistant",
					content: "failed turn persisted",
				},
			],
			before,
			"new-assistant",
		);
		assert.equal(complete.complete, true);
		assert.equal(complete.assistant?.content, "failed turn persisted");
	});

	it("pairs persisted messages only through the immutable parent run id", () => {
		const selected = selectPersistedTurnMessages(
			[
				{ id: "run-old", role: "user" },
				{
					id: "assistant-old",
					role: "assistant",
					metadata: { parentRunId: "run-old" },
				},
				{ id: "run-current", role: "user" },
				{
					id: "assistant-late",
					role: "assistant",
					metadata: { parentRunId: "run-old" },
				},
			],
			new Set(["run-old", "assistant-old"]),
			"assistant-late",
			"run-current",
		);
		assert.equal(selected.complete, false);
		assert.equal(selected.assistant, null);
	});

	it("summarizes only the correlated run without retaining model text", () => {
		const diagnostics = acceptanceLifecycleDiagnostics(
			[
				{
					type: "stream_event",
					event: {
						type: "main_agent_activity",
						runId: "run-current",
						phase: "tool_exec",
						status: "running",
						activeToolCount: 1,
						timestamp: 42,
					},
				},
				{
					type: "result",
					data: { runId: "run-old", status: "succeeded", text: "secret" },
				},
			],
			"run-current",
		);
		assert.equal(diagnostics.lastActivityPhase, "tool_exec");
		assert.equal(diagnostics.lastActiveToolCount, 1);
		assert.equal(diagnostics.ignoredForeignRunFrames, 1);
		assert.equal(JSON.stringify(diagnostics).includes("secret"), false);
	});

	it("retains the last pre-terminal activity, stall phase, and counted error fingerprints", () => {
		const diagnostics = acceptanceLifecycleDiagnostics(
			[
				{
					type: "stream_event",
					event: {
						type: "main_agent_activity",
						runId: "run-current",
						phase: "model_stream",
						status: "running",
						activeToolCount: 0,
						timestamp: 40,
					},
				},
				{
					type: "stream_event",
					event: {
						type: "stream_stalled",
						runId: "run-current",
						stalledMs: 90_001,
						thresholdMs: 300_000,
						activeToolCount: 0,
						timestamp: 41,
					},
				},
				{
					type: "error",
					runId: "run-current",
					code: "provider_error",
					message: "failed at https://provider.invalid/v1 with 400",
				},
				{
					type: "error",
					runId: "run-current",
					code: "provider_error",
					message: "failed at https://other.invalid/v2 with 503",
				},
				{
					type: "result",
					data: { runId: "run-current", status: "failed" },
				},
			],
			"run-current",
		);
		assert.deepEqual(diagnostics.lastPreTerminalActivity, {
			phase: "model_stream",
			status: "running",
			activeToolCount: 0,
			timestamp: 40,
		});
		assert.deepEqual(diagnostics.lastStall, {
			eventType: "stream_stalled",
			phase: "model_stream",
			activeTool: null,
			activeToolCount: 0,
			stalledMs: 90_001,
			thresholdMs: 300_000,
			timestamp: 41,
		});
		assert.deepEqual(Object.values(diagnostics.errorFingerprintCounts), [2]);
		assert.equal(
			JSON.stringify(diagnostics).includes("provider.invalid"),
			false,
		);
	});

	it("writes only a bounded, credential-free Sidecar diagnostic tail", () => {
		const sanitized = sanitizeAcceptanceSidecarLog(
			[
				"normal lifecycle line",
				"Authorization: Bearer secret-value",
				"auth=another-secret-value",
				"token=third-secret-value",
				"headers={cookie: secret-value}",
				'provider failed at https://provider.invalid/v1 {"error":"opaque body"}',
				"中文".repeat(10_000),
			].join("\n"),
			512,
		);
		assert.ok(Buffer.byteLength(sanitized, "utf8") <= 512);
		assert.equal(sanitized.includes("secret-value"), false);
		assert.equal(sanitized.includes("another-secret-value"), false);
		assert.equal(sanitized.includes("third-secret-value"), false);
		assert.equal(sanitized.includes("provider.invalid"), false);
		assert.equal(sanitized.includes("opaque body"), false);
	});

	it("classifies lifecycle collisions and closed sockets without treating provider errors as lifecycle failures", () => {
		assert.equal(
			detectAcceptanceLifecycleFailure({
				frames: [
					{ type: "error", code: "provider_error", message: "opaque 400" },
				],
			}),
			null,
		);
		assert.equal(
			detectAcceptanceLifecycleFailure({
				frames: [
					{
						type: "error",
						code: "session_busy",
						message: "already has an active operation",
					},
				],
			})?.code,
			"acceptance_session_busy",
		);
		assert.equal(
			detectAcceptanceLifecycleFailure({
				errorMessage: "Session 'session-123' is closed",
			})?.code,
			"acceptance_session_closed",
		);
		assert.equal(
			detectAcceptanceLifecycleFailure({ socketDisconnected: true })?.code,
			"acceptance_socket_disconnected",
		);
	});

	it("fuses only on the exact terminal event-stream stall result", () => {
		const terminal = detectAcceptanceLifecycleFailure({
			frames: [
				{
					type: "result",
					data: {
						runId: "run-current",
						status: "failed",
						stopReason: "event_stream_stalled",
					},
				},
			],
			expectedRunId: "run-current",
		});
		assert.equal(terminal?.code, "acceptance_event_stream_stalled");
		assert.equal(isAcceptanceLifecycleErrorCode(terminal?.code), true);

		for (const frames of [
			[
				{
					type: "stream_event",
					event: { type: "stream_stalled", reason: "event_stream_stalled" },
				},
			],
			[
				{
					type: "result",
					data: { status: "failed", stopReason: "provider_error" },
				},
			],
			[
				{
					type: "result",
					data: { status: "succeeded", stopReason: "event_stream_stalled" },
				},
			],
		]) {
			assert.equal(detectAcceptanceLifecycleFailure({ frames }), null);
		}
	});

	it("fails closed on run correlation, persistence, and runtime ownership mismatches", () => {
		assert.equal(
			detectAcceptanceLifecycleFailure({
				expectedRunId: "run-current",
				frames: [
					{ type: "result", data: { runId: "run-old", status: "succeeded" } },
				],
			})?.code,
			"acceptance_run_id_mismatch",
		);
		assert.equal(
			detectAcceptanceLifecycleFailure({ requireRunId: true })?.code,
			"acceptance_missing_run_id",
		);
		assert.equal(
			detectAcceptanceLifecycleFailure({
				expectedRunId: "run-current",
				persistedPair: {
					userId: "run-current",
					assistantId: "assistant-current",
					parentRunId: "run-old",
					matched: false,
				},
			})?.code,
			"acceptance_persistence_mismatch",
		);
		assert.equal(
			detectAcceptanceLifecycleFailure({
				runtimeIdle: { runtimeBusy: false, activeRunId: "run-current" },
			})?.code,
			"acceptance_runtime_not_idle",
		);
	});

	it("recognizes agent-ui parse/degradation failures as lifecycle failures", () => {
		for (const answer of [
			"无法解析 agent-ui 指令。",
			"快捷操作暂不可用，请参考正文继续操作。",
			"failed to parse agent-ui directive",
		]) {
			const failure = detectAcceptanceLifecycleFailure({ answer });
			assert.equal(failure?.code, "acceptance_agent_ui_parse_error");
			assert.equal(isAcceptanceLifecycleErrorCode(failure?.code), true);
		}
		assert.equal(
			detectAcceptanceLifecycleFailure({
				answer:
					'正文\n```agent-ui\n{"component":"quick-actions","props":{"title":"继续"}}\n```',
			}),
			null,
		);
	});
});
