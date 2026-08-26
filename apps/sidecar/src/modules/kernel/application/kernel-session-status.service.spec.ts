import { KernelSessionStatusService } from "./kernel-session-status.service";

function sessionWithContextUsage(contextUsage: Record<string, unknown>) {
    return {
        sessionId: "session-context",
        initWarning: null,
        listCommands: () => [],
        hasQueue: () => false,
        hasMemory: false,
        mcpStatus: async () => [],
        currentRun: async () => null,
        activeTools: async () => [],
        runs: async () => [],
        subagentTasks: async () => [],
        pendingSubagentTasks: async () => [],
        traceEvents: async () => [],
        verificationReports: async () => [],
        verificationSummary: async () => ({}),
        verificationSummaryText: async () => "",
        toolNames: () => [],
        toolDefinitions: () => [],
        contextUsage: async () => contextUsage,
        history: () => [{ role: "user", content: "压缩后仍需要统计当前上下文" }],
    };
}

function activeSession(contextUsage: Record<string, unknown>) {
    return {
        session: sessionWithContextUsage(contextUsage),
        workspace: "/workspace",
        storageWorkspace: "/workspace",
        agentId: "default",
        userId: "local",
        runtimeKey: "runtime",
        runtimeOverrides: {},
        maxContextTokens: 258_000,
        nativeConfirmationEnabled: false,
        nativeConfirmedToolKeys: new Set<string>(),
        createdAt: 1,
        lastActivityAt: 1,
    };
}

describe("KernelSessionStatusService context usage", () => {
    it("uses provider-measured prompt tokens with the application denominator", async () => {
        const status = await new KernelSessionStatusService().describe(
            activeSession({
                usedTokens: 112_793,
                maxTokens: 999_999,
                percent: 1,
                estimated: false,
                pendingRefresh: false,
            }) as never,
        );

        expect(status).toMatchObject({
            maxContextTokens: 258_000,
            contextUsedTokens: 112_793,
            contextUsedPercent: (112_793 / 258_000) * 100,
            contextUsageEstimated: false,
            contextUsagePendingRefresh: false,
        });
    });

    it("returns a non-zero estimate before the first provider call", async () => {
        const status = await new KernelSessionStatusService().describe(
            activeSession({
                usedTokens: 9_684,
                maxTokens: 258_000,
                estimated: true,
                pendingRefresh: false,
            }) as never,
        );

        expect(status).toMatchObject({
            contextUsedTokens: 9_684,
            contextUsageEstimated: true,
            contextUsagePendingRefresh: false,
        });
        expect(status.contextUsedPercent).toBeGreaterThan(0);
    });

    it("returns a bounded estimate instead of a pending-only state after compaction", async () => {
        const status = await new KernelSessionStatusService().describeContext(
            activeSession({
                maxTokens: 258_000,
                pendingRefresh: true,
            }) as never,
        );

        expect(status.contextUsedTokens).toBeGreaterThan(0);
        expect(status.contextUsedPercent).toBeGreaterThan(0);
        expect(status.contextUsageEstimated).toBe(true);
        expect(status.contextUsagePendingRefresh).toBe(false);
    });
});
