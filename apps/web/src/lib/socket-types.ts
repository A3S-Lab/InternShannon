/**
 * Socket.IO type definitions for agent WebSocket connections
 */

import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "./types";

/**
 * Tool confirmation request from backend
 */
export interface ToolConfirmationRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
}

/**
 * Tool confirmation response to backend
 */
export interface ToolConfirmationResponse {
  requestId: string;
  approved: boolean;
  scope?: "once" | "task" | "session";
  toolName?: string;
}

/**
 * Typed Socket.IO client for agent sessions
 */
export interface AgentSocket {
  id?: string;
  connected: boolean;
  // Server to client events
  on(event: "message", listener: (data: BrowserIncomingMessage) => void): this;
  on(event: "exception", listener: (data: unknown) => void): this;
  on(event: "tool_confirmation_request", listener: (data: ToolConfirmationRequest) => void): this;
  on(event: "connect", listener: () => void): this;
  on(event: "disconnect", listener: (reason: string) => void): this;
  on(event: "connect_error", listener: (error: Error) => void): this;
  on(event: "reconnect", listener: (attemptNumber: number) => void): this;
  on(event: "reconnect_attempt", listener: (attemptNumber: number) => void): this;
  on(event: "reconnect_error", listener: (error: Error) => void): this;
  on(event: "reconnect_failed", listener: () => void): this;
  on(event: "connect_timeout", listener: () => void): this;
  onAny(listener: (eventName: string, ...args: unknown[]) => void): this;

  // Client to server events
  emit(event: "message", data: BrowserOutgoingMessage & { sessionId?: string }): this;
  emit(event: "tool_confirmation_response", data: ToolConfirmationResponse): this;
  emit(event: "subscribe", data: { sessionId: string }): this;
  emit(event: "ping", callback?: () => void): this;
  close(): this;

  // Remove listeners
  off(event: "message", listener?: (data: BrowserIncomingMessage) => void): this;
  off(event: "exception", listener?: (data: unknown) => void): this;
  off(event: "tool_confirmation_request", listener?: (data: ToolConfirmationRequest) => void): this;
  off(event: "connect", listener?: () => void): this;
  off(event: "disconnect", listener?: (reason: string) => void): this;
  off(event: "connect_error", listener?: (error: Error) => void): this;
}

/**
 * Socket connection options
 */
export interface SocketConnectionOptions {
  sessionId: string;
  gatewayUrl: string;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  timeout?: number;
}

/**
 * Socket connection state
 */
export enum SocketState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  ERROR = "error",
}

/**
 * Socket connection info
 */
export interface SocketConnectionInfo {
  sessionId: string;
  state: SocketState;
  connectedAt?: number;
  disconnectedAt?: number;
  reconnectAttempts: number;
  lastError?: Error;
}
