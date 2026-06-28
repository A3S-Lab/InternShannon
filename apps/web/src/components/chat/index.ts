// Types - agent core
export type {
	ContentBlock,
	AgentChatMessage,
	ToolProgress,
	CompletedToolCall,
	StreamingSegment,
} from "./types/agent";

// Types - rich messages
export type {
	RichBlock,
	ToolCallBlock,
	TextBlock,
	MessageSource,
	RichMessage,
} from "./types/message";
export { chatMessageToRich, parseTextWithRichBlocks } from "./types/message";

// Utils - chat rendering helpers
export {
	ansiToHtml,
	langFromPath,
	blockHash,
	detectBashBoxEndpointMismatch,
} from "./utils/chat-utils";

// Utils - tool call display
export type { ToolKind, ToolDisplayMeta } from "./utils/tool-call-display-utils";
export {
	normalizeToolName,
	getToolKind,
	parseToolInput,
	stringifyShort,
	extractToolPath,
	summarizeToolInput,
	getTerminalVerb,
	getCanonicalToolName,
	formatToolInvocation,
	getToolInvocationParts,
	summarizeToolResult,
	shouldShowToolPreviewByDefault,
} from "./utils/tool-call-display-utils";

// Utils - streaming display
export {
	orderStreamingSegments,
	getVisibleStreamingSegments,
	hasProducedVisibleStreamingContent,
} from "./utils/streaming-display-utils";

// Components
export type { ToolCallDisplayData, ToolCallDisplayRenderProps } from "./components/tool-call-display";
export { ToolCallDisplay } from "./components/tool-call-display";
export { default as MessageItem } from "./components/message-item";
export type { MessageItemProps } from "./components/message-item";
export { MessageList } from "./components/message-list";
export { ChatInput } from "./components/chat-input";

// AI Configuration Components
export type { AiProviderSettingsProps } from "./components/ai-provider-settings";
export { AiProviderSettings, PROVIDER_OPTIONS } from "./components/ai-provider-settings";
export { PROVIDER_COLORS, pColor } from "@/lib/constants";

// Legacy simple types (kept for backward compatibility)
export type { ChatMessage, ChatSession } from "./types";
