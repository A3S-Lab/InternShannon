import { Inject, Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import { promises as fs } from "fs";
import { isCloud } from "@/shared/constants";
import {
  IKernelService,
  KERNEL_SERVICE,
} from "../domain/services/kernel-service.interface";
import { KernelConversationLogService } from "./kernel-conversation-log.service";
import { KernelSessionRuntimeFactory } from "./kernel-session-runtime-factory.service";
import { KernelSessionRuntimeStateService } from "./kernel-session-runtime-state.service";

export interface KernelSessionResetResult {
  workspace?: string;
  storageWorkspace?: string;
  messagesCleared: number;
  runtimeFilesCleared: number;
}

@Injectable()
export class KernelSessionResetService {
  private readonly logger = new Logger(KernelSessionResetService.name);

  constructor(
    @Inject(KERNEL_SERVICE)
    private readonly kernelService: IKernelService,
    private readonly runtimeState: KernelSessionRuntimeStateService,
    private readonly runtimeFactory: KernelSessionRuntimeFactory,
    private readonly conversationLog: KernelConversationLogService
  ) {}

  async reset(sessionId: string): Promise<KernelSessionResetResult> {
    const activeSession = this.runtimeState.getActiveSession(sessionId);
    const kernelSession = activeSession?.storageWorkspace
      ? null
      : await this.kernelService.getSession(sessionId).catch(() => null);
    const storedWorkspace = activeSession?.storageWorkspace || kernelSession?.cwd;
    const storageWorkspace = this.visibleStorageWorkspace(storedWorkspace);
    const runtimeWorkspace = await this.resolveRuntimeWorkspace(
      sessionId,
      activeSession?.workspace,
      storedWorkspace
    );

    if (activeSession) {
      try {
        activeSession.session.close();
      } catch (error) {
        this.logger.warn(
          `Failed to close active session before clearing ${sessionId}: ${error}`
        );
      }
      this.runtimeState.deleteActiveSession(sessionId);
      this.runtimeState.recordCloseMetric('reset');
    }

    const [messagesCleared, runtimeFilesCleared] = await Promise.all([
      this.conversationLog.clearSessionMessages(sessionId),
      runtimeWorkspace
        ? this.clearRuntimeFiles(sessionId, runtimeWorkspace)
        : Promise.resolve(0),
    ]);
    const visibleWorkspace =
      storageWorkspace || (!isCloud() ? runtimeWorkspace : undefined);

    return {
      workspace: visibleWorkspace,
      storageWorkspace: visibleWorkspace,
      messagesCleared,
      runtimeFilesCleared,
    };
  }

  private async resolveRuntimeWorkspace(
    sessionId: string,
    activeWorkspace?: string,
    storageWorkspace?: string
  ): Promise<string | undefined> {
    if (activeWorkspace) return activeWorkspace;
    if (!storageWorkspace) return undefined;

    return this.runtimeFactory
      .resolveRuntimeWorkspace(sessionId, storageWorkspace)
      .catch((error) => {
        this.logger.warn(
          `Failed to resolve runtime workspace for clearing ${sessionId}: ${error}`
        );
        return undefined;
      });
  }

  private visibleStorageWorkspace(workspace?: string): string | undefined {
    const trimmed = workspace?.trim();
    if (!trimmed) return undefined;
    if (isCloud() && !this.isRemoteWorkspacePath(trimmed)) return undefined;
    return trimmed;
  }

  private isRemoteWorkspacePath(value: string): boolean {
    const match = value.match(/^([a-z][a-z0-9+.-]*):\/{1,2}/i);
    const scheme = match?.[1]?.toLowerCase();
    return Boolean(scheme && scheme !== "file");
  }

  private async clearRuntimeFiles(
    sessionId: string,
    workspace: string
  ): Promise<number> {
    const files = [
      path.join(workspace, ".sessions", `${sessionId}.json`),
      path.join(workspace, ".sessions", "traces", `${sessionId}.json`),
      path.join(workspace, ".sessions", "runs", `${sessionId}.json`),
      path.join(workspace, ".sessions", "verification", `${sessionId}.json`),
      path.join(workspace, ".sessions", "artifacts", sessionId),
    ];

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const existed = await fs.stat(file).then(() => true).catch(() => false);
          await fs.rm(file, { recursive: true, force: true });
          return existed ? 1 : 0;
        } catch {
          return 0;
        }
      })
    );
    return results.reduce((total, item) => total + item, 0);
  }
}
