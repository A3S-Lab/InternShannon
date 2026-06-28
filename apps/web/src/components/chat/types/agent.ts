// Core agent types for chat messages and streaming

export type ContentBlock =
	| { type: "text"; text: string }
	| {
			type: "tool_use";
			id: string;
			name: string;
			input: Record<string, unknown>;
	  }
	| {
			type: "tool_result";
			toolUseId: string;
			content: string | ContentBlock[];
			isError?: boolean;
			before?: string;
			after?: string;
			filePath?: string;
	  }
	| { type: "thinking"; thinking: string; budgetTokens?: number };

export interface AgentChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	contentBlocks?: ContentBlock[];
	images?: { mediaType: string; data: string }[];
	timestamp: number;
	parentToolUseId?: string | null;
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
	source?: string;
}

export interface ToolProgress {
	toolUseId: string;
	toolName: string;
	elapsedTimeSeconds: number;
	input?: string;
	output?: string;
}

export interface CompletedToolCall {
	toolUseId: string;
	toolName: string;
	input: string;
	output: string;
	is_error: boolean;
	before?: string;
	after?: string;
	filePath?: string;
	durationMs?: number;
}

export type StreamingSegment =
	| { type: "text"; content: string; seq: number }
	| { type: "tool_progress"; progress: ToolProgress; seq: number }
	| { type: "tool"; call: CompletedToolCall; seq: number };
