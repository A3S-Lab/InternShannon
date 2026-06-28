import type { AgentChatMessage, ContentBlock } from "./agent";

// =============================================================================
// Rich message types
// =============================================================================

export interface ToolCallBlock {
	type: "tool_call";
	tool: string;
	input: string;
	output?: string;
	durationMs?: number;
	isError?: boolean;
	before?: string;
	after?: string;
	filePath?: string;
}

export interface TextBlock {
	type: "text";
	content: string;
}

export type RichBlock = ToolCallBlock | TextBlock;

export type MessageSource = "app" | "dingtalk" | "feishu" | "wecom";

export interface RichMessage {
	id: string;
	role: "user" | "assistant" | "system";
	blocks: RichBlock[];
	timestamp: number;
	source?: MessageSource;
	model?: string;
	stopReason?: string | null;
	durationMs?: number;
	meta?: {
		provider?: string;
		requestModel?: string;
		requestUrl?: string;
		responseId?: string;
		responseModel?: string;
		responseObject?: string;
		firstTokenMs?: number;
		durationMs?: number;
	};
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		total_tokens?: number;
	};
	images?: { mediaType: string; data: string }[];
}

function normalizeStructuredText(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

function dedupeStructuredBlocks(blocks: RichBlock[]): RichBlock[] {
	const result: RichBlock[] = [];

	for (const block of blocks) {
		const previous = result[result.length - 1];
		if (block.type === "text" && previous?.type === "text") {
			if (previous.content.trim() === block.content.trim()) {
				continue;
			}
			previous.content += block.content;
			continue;
		}

		result.push(block);
	}

	return result;
}

export function parseTextWithRichBlocks(text: string): RichBlock[] {
	const normalized = normalizeStructuredText(text);
	if (!normalized.trim()) return [];
	return dedupeStructuredBlocks([{ type: "text", content: normalized }]);
}

// =============================================================================
// Convert AgentChatMessage → RichMessage
// =============================================================================

function stripLeakedInternalReasoning(content: string): string {
	const INTERNAL_REASONING_MARKERS = [
		"根据我的指令",
		"系统指令",
		"用户用中文说",
		"用户问我",
		"我应该",
		"我需要",
		"让我回顾",
		"让我检查",
		"当前会话可见",
		"Runtime Tools",
		"Runtime Skills",
		"Configured Skills",
		"Built-in agents",
		"## Tools",
		"<context source=",
	];

	const USER_FACING_START_MARKERS = [
		"你好！",
		"您好！",
		"可以。",
		"当然。",
		"有问题",
		"我可以",
		"我有",
		"以下是",
		"这些回复",
	];

	const text = content ?? "";
	if (!INTERNAL_REASONING_MARKERS.some((marker) => text.includes(marker))) {
		return text;
	}

	const firstAnswerIndex = USER_FACING_START_MARKERS.map((marker) =>
		text.indexOf(marker),
	)
		.filter((index) => index > 0)
		.sort((a, b) => a - b)[0];
	if (typeof firstAnswerIndex === "number") {
		return text.slice(firstAnswerIndex).trimStart();
	}

	return text
		.split(/\n{2,}/)
		.filter(
			(paragraph) =>
				!INTERNAL_REASONING_MARKERS.some((marker) =>
					paragraph.includes(marker),
				),
		)
		.join("\n\n")
		.trimStart();
}

function contentBlocksToRichBlocks(blocks: ContentBlock[]): RichBlock[] {
	const result: RichBlock[] = [];
	const toolCallIndex: Record<string, number> = {};

	const stringifyToolInput = (input: unknown): string => {
		if (typeof input === "string") return input;
		if (
			input &&
			typeof input === "object" &&
			"__display" in (input as Record<string, unknown>) &&
			typeof (input as Record<string, unknown>).__display === "string"
		) {
			return (input as Record<string, unknown>).__display as string;
		}
		if (
			input &&
			typeof input === "object" &&
			"__raw" in (input as Record<string, unknown>)
		) {
			const raw = (input as Record<string, unknown>).__raw;
			if (typeof raw === "string" && raw.trim() !== "") {
				try {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === "object") {
						return JSON.stringify(parsed, null, 2);
					}
				} catch {
					const results: string[] = [];
					let remaining = raw.trim();
					let startIndex = remaining.indexOf("{");
					while (startIndex !== -1 && startIndex < remaining.length) {
						let depth = 0;
						let endIndex = startIndex;
						for (let i = startIndex; i < remaining.length; i++) {
							if (remaining[i] === "{") depth++;
							else if (remaining[i] === "}") {
								depth--;
								if (depth === 0) {
									endIndex = i;
									break;
								}
							}
						}
						const jsonStr = remaining.substring(startIndex, endIndex + 1);
						try {
							const parsed = JSON.parse(jsonStr);
							results.push(JSON.stringify(parsed, null, 2));
						} catch {
							// Not a valid JSON object, skip
						}
						remaining = remaining.substring(endIndex + 1);
						startIndex = remaining.indexOf("{");
					}
					if (results.length > 0) {
						return results.join("\n---\n");
					}
				}
				return raw;
			}
		}
		return JSON.stringify(input, null, 2);
	};

	for (const b of blocks) {
		if (b.type === "text") {
			result.push(
				...parseTextWithRichBlocks(stripLeakedInternalReasoning(b.text)),
			);
		} else if (b.type === "thinking") {
			// Skip thinking blocks
		} else if (b.type === "tool_use") {
			const idx = result.length;
			toolCallIndex[b.id] = idx;
			result.push({
				type: "tool_call",
				tool: b.name,
				input: stringifyToolInput(b.input),
				output: undefined,
				durationMs: undefined,
			});
		} else if (b.type === "tool_result") {
			const content =
				typeof b.content === "string"
					? b.content
					: JSON.stringify(b.content, null, 2);
			const idx = toolCallIndex[b.toolUseId];
			if (idx !== undefined && result[idx]?.type === "tool_call") {
				(result[idx] as ToolCallBlock).output = content;
				(result[idx] as ToolCallBlock).isError = b.isError;
				if (b.before != null) (result[idx] as ToolCallBlock).before = b.before;
				if (b.after != null) (result[idx] as ToolCallBlock).after = b.after;
				if (b.filePath != null)
					(result[idx] as ToolCallBlock).filePath = b.filePath;
			} else {
				result.push({
					type: "tool_call",
					tool: "result",
					input: "",
					output: content,
					isError: b.isError,
				});
			}
		}
	}
	return result;
}

export function chatMessageToRich(msg: AgentChatMessage): RichMessage {
	const blocks: RichBlock[] = msg.contentBlocks
		? contentBlocksToRichBlocks(msg.contentBlocks)
		: [{ type: "text", content: stripLeakedInternalReasoning(msg.content) }];

	return {
		id: msg.id,
		role:
			msg.role === "user"
				? "user"
				: msg.role === "system"
					? "system"
					: "assistant",
		timestamp: msg.timestamp,
		source: msg.source as MessageSource | undefined,
		model: msg.model,
		stopReason: msg.stopReason,
		durationMs: msg.durationMs,
		meta: msg.meta,
		usage: msg.usage,
		images: msg.images,
		blocks,
	};
}
