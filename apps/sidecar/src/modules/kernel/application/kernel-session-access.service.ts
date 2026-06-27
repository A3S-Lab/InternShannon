import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { NotFoundException } from "@/shared/common/errors";
import { Session } from "../domain/entities/session.entity";
import {
  type IKernelService,
  KERNEL_SERVICE,
} from "../domain/services/kernel-service.interface";

@Injectable()
export class KernelSessionAccessService {
  constructor(
    @Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService
  ) {}

  resolveUserId(userId?: string | null): string {
    return userId || "desktop-user";
  }

  async isPlatformBypassUser(userId?: string | null): Promise<boolean> {
    return false;
  }

  async requireOwnedSession(
    sessionId: string,
    userId?: string | null
  ): Promise<Session> {
    const session = await this.kernelService.getSession(sessionId);
    if (!session) {
      throw new NotFoundException("Kernel session not found");
    }
    if (this.isOwnedBy(session, userId)) {
      return session;
    }
    throw new NotFoundException("Kernel session not found");
  }

  isOwnedBy(session: Session, userId?: string | null): boolean {
    return session.userId === this.resolveUserId(userId);
  }

  async assertWorkspacePathAccess(
    pathValue?: string | null,
    userId?: string | null
  ): Promise<void> {
    const target = this.normalizeAccessPath(pathValue);
    if (!target) {
      return;
    }
    this.assertNoPathTraversal(target);
    return;
  }

  private normalizeAccessPath(pathValue?: string | null): string {
    const normalized = (pathValue ?? "")
      .trim()
      .replace(/\\/g, "/");
    return normalized
      .replace(/([^:])\/{2,}/g, "$1/")
      .replace(/\/+$/g, "");
  }

  private assertNoPathTraversal(pathValue: string): void {
    const segments = pathValue.split("/").filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === "..")) {
      throw new BadRequestException(
        "workspace path cannot contain traversal segments"
      );
    }
  }
}
