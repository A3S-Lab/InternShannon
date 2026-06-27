import { Injectable, Logger } from "@nestjs/common";
import { KernelSessionRuntimeAccessService } from "./kernel-session-runtime-access.service";

export interface KernelBtwQueryInput {
  sessionId: string;
  content?: string;
  emit: (message: unknown) => void;
}

@Injectable()
export class KernelBtwQueryService {
  private readonly logger = new Logger(KernelBtwQueryService.name);

  constructor(
    private readonly runtimeAccess: KernelSessionRuntimeAccessService
  ) {}

  async ask(input: KernelBtwQueryInput): Promise<void> {
    const question = input.content?.trim();
    this.logger.log(
      `[BTW] Received Kernel BTW Query for session ${input.sessionId}: ${question}`
    );

    if (!question) {
      this.logger.warn(`[BTW] Empty question for session ${input.sessionId}`);
      input.emit({
        type: "error",
        message: "BTW question is required",
      });
      return;
    }

    const activeSession =
      await this.runtimeAccess.getActiveOrCreate({
        sessionId: input.sessionId,
        emit: input.emit,
      });
    if (!activeSession) {
      this.logger.error(`[BTW] Failed to get session ${input.sessionId}`);
      input.emit({
        type: "error",
        message: "Failed to access session",
      });
      return;
    }

    try {
      this.logger.log(`[BTW] Calling session.send() for session ${input.sessionId}`);
      const result = await activeSession.session.send(
        { prompt: question },
        [],
      );
      const answer = result.text;
      this.logger.log(
        `[BTW] Got answer for session ${input.sessionId}: ${answer.substring(0, 100)}...`
      );

      input.emit({
        type: "stream_event",
        event: {
          type: "btw_answer",
          question,
          answer,
          totalTokens: result.totalTokens,
        },
      });

      this.logger.log(`[BTW] Broadcasted btw_answer event for session ${input.sessionId}`);
    } catch (error) {
      this.logger.error(
        `[BTW] Error in session.send() for session ${input.sessionId}: ${error}`
      );
      input.emit({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
