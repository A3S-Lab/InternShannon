import type { WorkerAgentSpec } from '@a3s-lab/code';
import type { RuntimeMcpServerConfig, SessionRuntimeOverrides } from './session-runtime.contract';

export const AGENT_SPEC = Symbol('AGENT_SPEC');

export interface AgentSessionContext {
    sessionId: string;
    userId: string;
    agentId: string;
    metadata?: Record<string, unknown>;
}

export interface StreamEventContext {
    sessionId: string;
    agentId: string;
    userId: string;
    emit: (message: unknown) => void;
    metadata?: Record<string, unknown>;
}

export interface WorkspaceUploadMetadata {
    uploadId: string;
    fileName: string;
    mimeType?: string;
    size: number;
    sha256: string;
    path: string;
}

export interface AgentSpec {
    readonly id: string;

    /**
     * @deprecated Prefer typed slots: `role`, `guidelines`, `extra`.
     * Kept for built-in agents that haven't migrated yet; the registry routes
     * its return value into the SDK's `extra` slot for backward compatibility.
     */
    systemPrompt?(ctx?: { sessionId?: string }): string;

    /** SDK slot: agent identity prepended before the SDK's core agentic prompt. */
    role?(): string;

    /** SDK slot: domain guidelines appended after the SDK's core prompt. */
    guidelines?(): string;

    /**
     * SDK slot: freeform per-turn content appended at the end of the system prompt.
     * Right place for context-dependent injections (current phase, attached files, etc.).
     */
    extra?(ctx?: { sessionId?: string }): string;

    workers?(): WorkerAgentSpec[];

    mcpServers?(): RuntimeMcpServerConfig[];

    runtimeDefaults?(): Partial<SessionRuntimeOverrides>;

    onSessionCreate?(ctx: AgentSessionContext): Promise<Record<string, unknown> | void>;

    onSessionEnd?(ctx: { sessionId: string }): void;

    onFileAttached?(ctx: AgentSessionContext & { upload: WorkspaceUploadMetadata }): Promise<void>;

    onStreamText?(ctx: StreamEventContext, fullText: string, delta: string): void;

    /**
     * Called once per assistant turn after the model stream has fully closed
     * and the runner has the final assistant text. Lets agents perform
     * end-of-turn cleanup such as forcing a final persistence checkpoint of
     * any in-memory state that accumulated across stream ticks. Not called
     * when the turn is cancelled.
     *
     * Returning a Promise is supported and awaited by the runner so
     * persistence I/O finishes before downstream consumers see the turn done.
     */
    onStreamEnd?(ctx: StreamEventContext, fullText: string): Promise<void> | void;

    /**
     * Called once at the start of each user-driven turn, before the model
     * stream opens. Lets agents capture the latest user prompt for later use
     * in stream callbacks (e.g. deterministic planning triggered by a
     * marker in the assistant output).
     *
     * Returning a Promise is supported and awaited by the runner — useful
     * when an agent needs to rehydrate persisted state before the model
     * invocation starts, so the system prompt slot has full context.
     */
    onUserMessage?(
        ctx: { sessionId: string; agentId: string; userId: string },
        content: string,
    ): Promise<void> | void;
}
