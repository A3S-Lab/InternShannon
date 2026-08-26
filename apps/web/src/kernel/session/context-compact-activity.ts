import type { AgentRuntimeTimelineEvent } from "@/lib/types";

export function normalizeContextCompactActivity(
	_event: Record<string, unknown>,
	options: { baseId?: string; timestamp: number },
): AgentRuntimeTimelineEvent {
	return {
		id: options.baseId || `context_compacted:${options.timestamp}`,
		kind: "main_agent",
		status: "completed",
		phase: "context_compact",
		label: "已成功压缩上下文",
		detail: undefined,
		source: "上下文管理",
		timestamp: options.timestamp,
	};
}
