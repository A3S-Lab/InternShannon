/** Agent UI runtime — render untrusted, agent-generated frontends safely. */
export { AgentUI } from "./AgentUI";
export type {
	AgentCallAudit,
	AgentUIProps,
	AgentUIStatus,
} from "./AgentUI";
export { composeReactDocument } from "./react-document";
export type { ReactDocumentOptions } from "./react-document";
export type {
	CapabilityMap,
	CapabilityResult,
	InboundMessage,
} from "./sandbox-bridge";
