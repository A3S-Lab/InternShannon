/**
 * Minimal contract the kernel uses to ask whether a tool call is allowed.
 *
 * The interactive WebSocket implementation lives in
 * `presentation/gateways/websocket-confirmation-manager.ts` and implements this
 * contract structurally. Non-interactive channels (e.g. the Lark bot) can plug
 * in their own policy gate without dragging in the socket.io dependency.
 */
export interface ToolConfirmationGate {
    requestConfirmation(sessionId: string, toolName: string, toolInput: Record<string, unknown>): Promise<boolean>;
    clearTaskApprovals?(sessionId: string): void;
}
