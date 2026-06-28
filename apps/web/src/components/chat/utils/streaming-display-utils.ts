import type { StreamingSegment } from "../types/agent";

export function orderStreamingSegments(
	segments: StreamingSegment[],
): StreamingSegment[] {
	return [...segments].sort((a, b) => a.seq - b.seq);
}

export function getVisibleStreamingSegments(
	segments: StreamingSegment[],
	{
		streamActive,
		latestAssistantToolIds,
	}: {
		streamActive: boolean;
		latestAssistantToolIds: Set<string>;
	},
): StreamingSegment[] {
	const orderedSegments = orderStreamingSegments(segments);
	const completedToolSegmentIds = new Set(
		orderedSegments
			.filter((seg) => seg.type === "tool")
			.map((seg) => seg.call.toolUseId),
	);

	return orderedSegments.filter((seg) => {
		if (seg.type === "tool_progress") {
			if (completedToolSegmentIds.has(seg.progress.toolUseId)) {
				return false;
			}
			return streamActive
				? true
				: !latestAssistantToolIds.has(seg.progress.toolUseId);
		}
		if (streamActive) {
			return true;
		}
		if (seg.type === "tool") {
			return !latestAssistantToolIds.has(seg.call.toolUseId);
		}
		return true;
	});
}

export function hasProducedVisibleStreamingContent(
	segments: StreamingSegment[],
): boolean {
	return segments.some(
		(seg) =>
			(seg.type === "text" && seg.content.trim().length > 0) ||
			seg.type === "tool_progress" ||
			seg.type === "tool",
	);
}
