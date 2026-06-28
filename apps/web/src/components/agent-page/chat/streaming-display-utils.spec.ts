import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamingSegment } from "@/models/agent.model";
import {
	getVisibleStreamingSegments,
	hasProducedVisibleStreamingContent,
	orderStreamingSegments,
} from "./streaming-display-utils.ts";

const progressSegment: StreamingSegment = {
	type: "tool_progress",
	seq: 2,
	progress: {
		toolUseId: "tool-1",
		toolName: "bash",
		elapsedTimeSeconds: 1,
		input: "pnpm build",
	},
};

const completedSegment: StreamingSegment = {
	type: "tool",
	seq: 3,
	call: {
		toolUseId: "tool-1",
		toolName: "bash",
		input: "pnpm build",
		output: "ready",
		is_error: false,
	},
};

test("orders streaming segments by sequence", () => {
	const ordered = orderStreamingSegments([
		completedSegment,
		{ type: "text", seq: 1, content: "hello" },
		progressSegment,
	]);
	assert.deepEqual(
		ordered.map((seg) => seg.seq),
		[1, 2, 3],
	);
});

test("hides progress once the same tool has completed", () => {
	const visible = getVisibleStreamingSegments(
		[progressSegment, completedSegment],
		{
			streamActive: true,
			latestAssistantToolIds: new Set(),
		},
	);
	assert.deepEqual(
		visible.map((seg) => seg.type),
		["tool"],
	);
});

test("lets committed assistant messages take over completed tool segments", () => {
	const visible = getVisibleStreamingSegments([completedSegment], {
		streamActive: false,
		latestAssistantToolIds: new Set(["tool-1"]),
	});
	assert.deepEqual(visible, []);
});

test("treats active tool progress as visible streaming content", () => {
	assert.equal(hasProducedVisibleStreamingContent([progressSegment]), true);
	assert.equal(
		hasProducedVisibleStreamingContent([
			{ type: "text", seq: 1, content: "   " },
		]),
		false,
	);
});
