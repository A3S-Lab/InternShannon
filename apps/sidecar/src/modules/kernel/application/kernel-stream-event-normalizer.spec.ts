import type { AgentEvent } from "@a3s-lab/code";
import { normalizeStreamEvent } from "./kernel-stream-event-normalizer";

describe("kernel stream event normalizer", () => {
	it("preserves tool_end duration metadata for completed tool rendering", () => {
		const event = {
			type: "tool_end",
			data: JSON.stringify({
				type: "tool_end",
				tool_name: "ls",
				tool_id: "tool-list",
				output: "ok",
				duration_ms: 7,
			}),
		} as AgentEvent;

		expect(
			normalizeStreamEvent("tool_end", event, JSON.parse(event.data ?? "{}")),
		).toEqual({
			type: "tool_end",
			toolName: "ls",
			toolId: "tool-list",
			output: "ok",
			exitCode: undefined,
			durationMs: 7,
		});
	});
});
