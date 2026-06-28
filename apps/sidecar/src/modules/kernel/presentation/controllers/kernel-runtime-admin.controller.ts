import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { DesktopCapabilityApi } from '@/shared/security/desktop-access';
import { ApiOkResponse } from '@/shared/api/openapi';
import { DesktopOwnerId } from '@/shared/security/decorators/desktop-owner.decorator';
import {
    type ActiveSessionSummary,
    KernelSessionRuntimeStateService,
} from '../../application/kernel-session-runtime-state.service';

interface RuntimeDiagResponse {
    total: number;
    sweepIntervalMs: number;
    idleTimeoutMs: number;
    summary: {
        oldestAgeMs: number | null;
        oldestIdleMs: number | null;
        idleOverThreshold: number;
        byAgentId: Record<string, number>;
    };
    /**
     * Per-session detail. `userIdHash` is a short fingerprint instead of the
     * raw uuid — enough for an operator to group by user without leaking the
     * mapping to anyone else who happens to hit the endpoint.
     */
    sessions: Array<{
        sessionId: string;
        agentId: string;
        userIdHash: string;
        runtimeKey: string;
        ageMs: number;
        idleMs: number;
        isOwner: boolean;
    }>;
}

@ApiTags('内核 - 运行时诊断')
// Desktop 诊断端点返回 active runtime session 汇总（总数 / 按 agentId 分布 /
// 每个 session 的 age/idle）。DesktopCapabilityApi 仅保留菜单元数据，不执行登录校验。
@DesktopCapabilityApi('platform:runtime:access')
@Controller('kernel/runtime')
export class KernelRuntimeAdminController {
    constructor(private readonly runtimeState: KernelSessionRuntimeStateService) {}

    @Get('diag')
    @ApiOkResponse({ summary: '列出 active runtime session 汇总(诊断 leak / sweeper 状态)', type: Object })
    diag(@DesktopOwnerId() userId: string): RuntimeDiagResponse {
        const summaries = this.runtimeState.activeSessionSummaries();
        const idleThreshold = this.idleThresholdMs();
        const sweepInterval = this.sweepIntervalMs();

        const byAgentId: Record<string, number> = {};
        let oldestAgeMs: number | null = null;
        let oldestIdleMs: number | null = null;
        let idleOverThreshold = 0;
        for (const item of summaries) {
            byAgentId[item.agentId] = (byAgentId[item.agentId] ?? 0) + 1;
            if (oldestAgeMs === null || item.ageMs > oldestAgeMs) oldestAgeMs = item.ageMs;
            if (oldestIdleMs === null || item.idleMs > oldestIdleMs) oldestIdleMs = item.idleMs;
            if (item.idleMs >= idleThreshold) idleOverThreshold += 1;
        }

        return {
            total: summaries.length,
            sweepIntervalMs: sweepInterval,
            idleTimeoutMs: idleThreshold,
            summary: {
                oldestAgeMs,
                oldestIdleMs,
                idleOverThreshold,
                byAgentId,
            },
            sessions: summaries.map(item => this.toResponseEntry(item, userId)),
        };
    }

    private toResponseEntry(item: ActiveSessionSummary, userId: string) {
        return {
            sessionId: item.sessionId,
            agentId: item.agentId,
            userIdHash: this.hashUserId(item.userId),
            runtimeKey: item.runtimeKey,
            ageMs: item.ageMs,
            idleMs: item.idleMs,
            isOwner: item.userId === userId,
        };
    }

    private hashUserId(userId: string): string {
        return createHash('sha256').update(userId).digest('hex').slice(0, 12);
    }

    private idleThresholdMs(): number {
        const raw = process.env.KERNEL_RUNTIME_IDLE_TIMEOUT_MS;
        const parsed = raw ? Number.parseInt(raw, 10) : NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 60 * 1000;
    }

    private sweepIntervalMs(): number {
        const raw = process.env.KERNEL_RUNTIME_SWEEP_INTERVAL_MS;
        const parsed = raw ? Number.parseInt(raw, 10) : NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60 * 1000;
    }
}
