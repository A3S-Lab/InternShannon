import { Injectable, Optional } from "@nestjs/common";
interface LifecycleFeedbackService {
  record(input: unknown): void;
}

const SessionLifecycleEvent = {
  ACTIVATED: "session.activated",
  COMPLETED: "session.completed",
  ABORTED: "session.aborted",
} as const;

const MessageLifecycleEvent = {
  RUN_STARTED: "message.run_started",
  RUN_COMPLETED: "message.run_completed",
  RUN_CANCELLED: "message.run_cancelled",
  RUN_FAILED: "message.run_failed",
} as const;

type SessionLifecycleEvent = (typeof SessionLifecycleEvent)[keyof typeof SessionLifecycleEvent];
type MessageLifecycleEvent = (typeof MessageLifecycleEvent)[keyof typeof MessageLifecycleEvent];

export interface KernelMessageRunLifecycleInput {
  sessionId: string;
  messageId: string;
  agentId?: string;
  model?: string;
  contentLength?: number;
  assistantTextLength?: number;
  totalTokens?: number;
  durationMs?: number;
  reason?: string;
  errorMessage?: string;
}

interface KernelLifecycleExtra {
  source: string;
  currentStatus: string;
  role?: string;
  reason?: string;
  errorMessage?: string;
}

@Injectable()
export class KernelLifecycleFeedbackService {
  constructor(
    @Optional()
    private readonly lifecycleFeedback?: LifecycleFeedbackService
  ) {}

  recordMessageRunStarted(input: KernelMessageRunLifecycleInput): void {
    this.recordSession(SessionLifecycleEvent.ACTIVATED, input, {
      currentStatus: "active",
      source: "kernel.message_run.start",
    });
    this.recordMessage(MessageLifecycleEvent.RUN_STARTED, input, {
      role: "user",
      currentStatus: "running",
      source: "kernel.message_run.start",
    });
  }

  recordMessageRunCompleted(input: KernelMessageRunLifecycleInput): void {
    this.recordSession(SessionLifecycleEvent.COMPLETED, input, {
      currentStatus: "idle",
      source: "kernel.message_run.complete",
    });
    this.recordMessage(MessageLifecycleEvent.RUN_COMPLETED, input, {
      role: "assistant",
      currentStatus: "completed",
      source: "kernel.message_run.complete",
    });
  }

  recordMessageRunCancelled(input: KernelMessageRunLifecycleInput): void {
    this.recordSession(SessionLifecycleEvent.ABORTED, input, {
      currentStatus: "cancelled",
      reason: input.reason,
      source: "kernel.message_run.cancel",
    });
    this.recordMessage(MessageLifecycleEvent.RUN_CANCELLED, input, {
      currentStatus: "cancelled",
      reason: input.reason,
      source: "kernel.message_run.cancel",
    });
  }

  recordMessageRunFailed(input: KernelMessageRunLifecycleInput): void {
    this.recordSession(SessionLifecycleEvent.ABORTED, input, {
      currentStatus: "error",
      errorMessage: input.errorMessage,
      source: "kernel.message_run.error",
    });
    this.recordMessage(MessageLifecycleEvent.RUN_FAILED, input, {
      currentStatus: "error",
      errorMessage: input.errorMessage,
      source: "kernel.message_run.error",
    });
  }

  private recordSession(
    event: SessionLifecycleEvent,
    input: KernelMessageRunLifecycleInput,
    extra: KernelLifecycleExtra,
  ): void {
    this.lifecycleFeedback?.record({
      entityType: "session",
      event,
      entity: {
        sessionId: input.sessionId,
        agentId: input.agentId,
      },
      source: extra.source,
      currentStatus: extra.currentStatus,
      errorMessage: extra.errorMessage,
      durationMs: input.durationMs,
      details: {
        messageId: input.messageId,
        model: input.model,
        reason: extra.reason,
      },
    });
  }

  private recordMessage(
    event: MessageLifecycleEvent,
    input: KernelMessageRunLifecycleInput,
    extra: KernelLifecycleExtra,
  ): void {
    this.lifecycleFeedback?.record({
      entityType: "message",
      event,
      entity: {
        messageId: input.messageId,
        messageRunId: input.messageId,
        sessionId: input.sessionId,
        agentId: input.agentId,
      },
      source: extra.source,
      currentStatus: extra.currentStatus,
      errorMessage: extra.errorMessage,
      durationMs: input.durationMs,
      details: {
        model: input.model,
        contentLength: input.contentLength,
        assistantTextLength: input.assistantTextLength,
        totalTokens: input.totalTokens,
        role: extra.role,
        reason: extra.reason,
      },
    });
  }

}
