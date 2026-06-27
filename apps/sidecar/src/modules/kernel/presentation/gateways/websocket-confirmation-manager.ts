import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';

export interface ToolConfirmationRequest {
  requestId: string;
  sessionId: string;
  toolId?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
}

export interface ToolConfirmationResponse {
  requestId: string;
  approved: boolean;
  scope?: 'once' | 'task' | 'session';
  toolName?: string;
}

interface ConfirmationRequestOptions {
  persistOnce?: boolean;
}

/**
 * WebSocket-based HITL Confirmation Manager
 *
 * Handles tool confirmation requests by sending them to the frontend
 * via WebSocket and waiting for user approval.
 */
export class WebSocketConfirmationManager {
  private readonly logger = new Logger(WebSocketConfirmationManager.name);
  private pendingRequests = new Map<string, {
    sessionId: string;
    toolName: string;
    scopeKey: string;
    persistOnce: boolean;
    resolve: (approved: boolean) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private pendingByTool = new Map<string, string>();

  // Track approved tools per session
  private onceApprovals = new Map<string, Set<string>>(); // sessionId -> Set<toolName>
  private taskApprovals = new Map<string, Set<string>>(); // sessionId -> Set<toolName>
  private sessionApprovals = new Map<string, Set<string>>(); // sessionId -> Set<toolName>

  constructor(
    private readonly server: Server,
    private readonly timeoutMs: number = 60000, // 60 seconds default
  ) {}

  /**
   * Request confirmation for a tool call
   * Returns true if approved, false if denied
   */
  async requestConfirmation(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    options: ConfirmationRequestOptions = {},
  ): Promise<boolean> {
    if (this.consumeApproval(sessionId, toolName)) {
      this.logger.log(`Tool ${toolName} already approved for session ${sessionId}`);
      return true;
    }

    const scopeKey = this.scopeKey(sessionId, toolName);
    const requestId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request: ToolConfirmationRequest = {
      requestId,
      sessionId,
      toolName,
      toolInput,
      timestamp: Date.now(),
    };

    // Wait for response with timeout
    return new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.pendingByTool.delete(scopeKey);
        this.logger.warn(`Confirmation request ${requestId} timed out`);
        reject(new Error(`Tool confirmation request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRequests.set(requestId, {
        sessionId,
        toolName,
        scopeKey,
        persistOnce: options.persistOnce === true,
        resolve,
        reject,
        timeout,
      });
      this.pendingByTool.set(scopeKey, requestId);

      this.logger.log(`Requesting confirmation for tool ${toolName} in session ${sessionId}`);

      // Send confirmation request to frontend after the pending slot exists.
      this.server.to(`session:${sessionId}`).emit('tool_confirmation_request', request);
    });
  }

  /**
   * Handle confirmation response from frontend
   */
  handleConfirmationResponse(response: ToolConfirmationResponse, sessionId?: string): void {
    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) {
      this.logger.warn(`No pending request found for ${response.requestId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.requestId);
    this.pendingByTool.delete(pending.scopeKey);

    this.logger.log(`Confirmation response for ${response.requestId}: ${response.approved ? 'approved' : 'denied'}`);

    // Handle scope-based approvals
    const approvalSessionId = sessionId || pending.sessionId;
    const approvalToolName = response.toolName || pending.toolName;
    if (response.approved && response.scope && approvalSessionId && approvalToolName) {
      if (response.scope === 'task') {
        this.approveForTask(approvalSessionId, approvalToolName);
      } else if (response.scope === 'session') {
        this.approveForSession(approvalSessionId, approvalToolName);
      } else if (response.scope === 'once' && pending.persistOnce) {
        this.approveOnce(approvalSessionId, approvalToolName);
      }
    }

    pending.resolve(response.approved);
  }

  /**
   * Approve tool for current task
   */
  approveForTask(sessionId: string, toolName: string): void {
    if (!this.taskApprovals.has(sessionId)) {
      this.taskApprovals.set(sessionId, new Set());
    }
    this.taskApprovals.get(sessionId)!.add(toolName);
    this.logger.log(`Tool ${toolName} approved for task in session ${sessionId}`);
  }

  approveOnce(sessionId: string, toolName: string): void {
    if (!this.onceApprovals.has(sessionId)) {
      this.onceApprovals.set(sessionId, new Set());
    }
    this.onceApprovals.get(sessionId)!.add(toolName);
    this.logger.log(`Tool ${toolName} approved once in session ${sessionId}`);
  }

  /**
   * Approve tool for entire session
   */
  approveForSession(sessionId: string, toolName: string): void {
    if (!this.sessionApprovals.has(sessionId)) {
      this.sessionApprovals.set(sessionId, new Set());
    }
    this.sessionApprovals.get(sessionId)!.add(toolName);
    this.logger.log(`Tool ${toolName} approved for session ${sessionId}`);
  }

  /**
   * Clear task approvals (called when task completes)
   */
  clearTaskApprovals(sessionId: string): void {
    this.taskApprovals.delete(sessionId);
    this.logger.log(`Cleared task approvals for session ${sessionId}`);
  }

  /**
   * Clear all approvals for a session
   */
  clearSessionApprovals(sessionId: string): void {
    this.onceApprovals.delete(sessionId);
    this.taskApprovals.delete(sessionId);
    this.sessionApprovals.delete(sessionId);
    this.logger.log(`Cleared all approvals for session ${sessionId}`);
  }

  hasPending(sessionId: string, toolName: string): boolean {
    return this.pendingByTool.has(this.scopeKey(sessionId, toolName));
  }

  consumeApproval(sessionId: string, toolName: string): boolean {
    if (this.isApprovedForSession(sessionId, toolName)) return true;
    if (this.isApprovedForTask(sessionId, toolName)) return true;
    const once = this.onceApprovals.get(sessionId);
    if (!once?.has(toolName)) return false;
    once.delete(toolName);
    if (once.size === 0) {
      this.onceApprovals.delete(sessionId);
    }
    return true;
  }

  /**
   * Check if tool is approved for current task
   */
  private isApprovedForTask(sessionId: string, toolName: string): boolean {
    return this.taskApprovals.get(sessionId)?.has(toolName) ?? false;
  }

  /**
   * Check if tool is approved for session
   */
  private isApprovedForSession(sessionId: string, toolName: string): boolean {
    return this.sessionApprovals.get(sessionId)?.has(toolName) ?? false;
  }

  private scopeKey(sessionId: string, toolName: string): string {
    return `${sessionId}:${toolName}`;
  }

  /**
   * Cleanup pending requests for a session
   */
  cleanup(sessionId: string): void {
    // Clear approvals
    this.clearSessionApprovals(sessionId);

    // Reject pending requests
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Session closed'));
        this.pendingRequests.delete(requestId);
        this.pendingByTool.delete(pending.scopeKey);
      }
    }
  }
}
