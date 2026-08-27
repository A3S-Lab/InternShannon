import type { ContentBlock } from "../../lib/types";
import {
	normalizeKnowledgeSourceReferences,
	type KnowledgeSourceReference,
} from "../../lib/knowledge-citation.ts";
import {
	normalizeHistoryAssistantMessageContentBlocks,
	normalizeHistoryFiniteNumber,
	normalizeHistoryId,
	normalizeHistoryOptionalString,
	normalizeHistoryRecord,
} from "./history-message-normalization.ts";

export interface NormalizedAssistantSocketMessage {
	id: string;
	contentBlocks: ContentBlock[];
	model?: string;
	stopReason: string | null;
	durationMs?: number;
	meta?: Record<string, unknown>;
	usage?: Record<string, unknown>;
	knowledgeSources?: KnowledgeSourceReference[];
	knowledgeSourceProtocolVersion?: 1;
}

export function normalizeAssistantSocketMessage(
	value: unknown,
	fallbackId: string,
): NormalizedAssistantSocketMessage | null {
	const message = normalizeHistoryRecord(value);
	if (!message) return null;

	const contentBlocks = normalizeHistoryAssistantMessageContentBlocks(message);
	const knowledgeSources = normalizeKnowledgeSourceReferences(
		message.knowledgeSources ?? message.knowledge_sources,
	);
	const knowledgeSourceProtocolVersion =
		message.knowledgeSourceProtocolVersion === 1 ||
		message.knowledge_source_protocol_version === 1
			? 1
			: undefined;

	return {
		id: normalizeHistoryId(message.id, fallbackId),
		contentBlocks,
		model: normalizeHistoryOptionalString(message.model),
		stopReason:
			normalizeHistoryOptionalString(
				message.stopReason ?? message.stop_reason,
			) ?? null,
		durationMs: normalizeHistoryFiniteNumber(
			message.durationMs ?? message.duration_ms,
		),
		meta: normalizeHistoryRecord(message.meta) ?? undefined,
		usage: normalizeHistoryRecord(message.usage) ?? undefined,
		...(knowledgeSources ? { knowledgeSources } : {}),
		...(knowledgeSourceProtocolVersion
			? { knowledgeSourceProtocolVersion }
			: {}),
	};
}
