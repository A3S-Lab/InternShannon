import { builtinSkills as a3sBuiltinSkills } from "@a3s-lab/code";
import { Injectable } from "@nestjs/common";
import { promises as fs } from "fs";
import * as path from "path";
import { isCloud } from "@/shared/constants";
import type { ActiveSession, RuntimeSkillInfo, SessionRuntimeOverrides } from "./session-runtime.types";
import { isRemoteWorkspacePath } from "./workspace-path-kind";

export interface KernelSessionStatusViewModel {
    sessionId: string;
    workspace: string;
    storageWorkspace: string;
    runtimeWorkspace?: string;
    agentId: string;
    /** Effective model context window shared with SDK auto-compaction. */
    maxContextTokens?: number;
    /** Current prompt/context occupancy from the SDK. */
    contextUsedTokens?: number;
    contextUsedPercent?: number;
    /** True before the first provider measurement and immediately after compaction. */
    contextUsageEstimated?: boolean;
    contextUsagePendingRefresh?: boolean;
    toolNames: unknown;
    toolDefinitions: unknown;
    skills: RuntimeSkillInfo[];
    commands: string[];
    queueStats: unknown;
    mcpStatus: unknown[];
    memoryStats: unknown;
    initWarning: unknown;
    /** Current SDK run (3.2.x). `null` when the session is idle. */
    currentRun: unknown;
    /** Active tool calls observed for the currently running run. */
    activeTools: unknown;
    /** SDK run snapshots recorded by this session. */
    runs: unknown;
    /** All delegated subagent tasks observed by this session. */
    subagentTasks: unknown;
    /** In-flight subagent tasks (delegated long ops). */
    pendingSubagentTasks: unknown;
    /** Compact SDK trace events for diagnostics. */
    traceEvents: unknown;
    /** SDK verification reports recorded on this session. */
    verificationReports: unknown;
    /** Structured verification summary. */
    verificationSummary: unknown;
    /** Human-readable verification summary. */
    verificationSummaryText: string;
    /** Queue dead letters when the optional queue is enabled. */
    deadLetters: unknown;
    /** Detailed SDK queue metrics when enabled. */
    queueMetrics: unknown;
}

export type KernelContextStatusViewModel = Pick<
    KernelSessionStatusViewModel,
    | "sessionId"
    | "maxContextTokens"
    | "contextUsedTokens"
    | "contextUsedPercent"
    | "contextUsageEstimated"
    | "contextUsagePendingRefresh"
>;

@Injectable()
export class KernelSessionStatusService {
    /** Lightweight status path used by the explicit /context command. */
    async describeContext(activeSession: ActiveSession): Promise<KernelContextStatusViewModel> {
        const runs = await this.safeInspect(() => activeSession.session.runs(), () => []);
        const contextUsage = await this.resolveUsableContextUsage(activeSession, runs);
        return {
            sessionId: activeSession.session.sessionId,
            maxContextTokens: activeSession.maxContextTokens,
            ...(contextUsage?.usedTokens !== undefined
                ? { contextUsedTokens: contextUsage.usedTokens }
                : {}),
            ...(contextUsage?.percent !== undefined
                ? { contextUsedPercent: contextUsage.percent }
                : {}),
            ...(contextUsage?.estimated !== undefined
                ? { contextUsageEstimated: contextUsage.estimated }
                : {}),
            ...(contextUsage?.pendingRefresh !== undefined
                ? { contextUsagePendingRefresh: contextUsage.pendingRefresh }
                : {}),
        };
    }

    async describe(
        activeSession: ActiveSession,
        runtimeOverrides: SessionRuntimeOverrides = activeSession.runtimeOverrides,
    ): Promise<KernelSessionStatusViewModel> {
        const storageWorkspace =
            this.visibleStorageWorkspace(activeSession.storageWorkspace) || (!isCloud() ? activeSession.workspace : "");
        const commands = activeSession.session
            .listCommands()
            .map((command: unknown) => this.normalizeCommandName(command))
            .filter((command): command is string => !!command);
        const [
            queueStats,
            mcpStatus,
            memoryStats,
            currentRun,
            activeTools,
            runs,
            subagentTasks,
            pendingSubagentTasks,
            traceEvents,
            verificationReports,
            verificationSummary,
            verificationSummaryText,
            deadLetters,
            queueMetrics,
        ] = await Promise.all([
            activeSession.session.hasQueue()
                ? this.safeInspect(() => activeSession.session.queueStats())
                : Promise.resolve(null),
            this.safeInspect(
                () => activeSession.session.mcpStatus(),
                (error) => [{ name: "mcp", connected: false, toolCount: 0, error: String(error) }],
            ),
            activeSession.session.hasMemory
                ? this.safeInspect(() => activeSession.session.memoryStats())
                : Promise.resolve(null),
            // SDK 3.2.x run/task inspection — degrade gracefully if the binding
            // returns errors (e.g. older sidecar binary on a hot restart).
            this.safeInspect(() => activeSession.session.currentRun()),
            this.safeInspect(() => activeSession.session.activeTools()),
            this.safeInspect(() => activeSession.session.runs()),
            this.safeInspect(() => activeSession.session.subagentTasks()),
            this.safeInspect(() => activeSession.session.pendingSubagentTasks()),
            this.safeInspect(() => activeSession.session.traceEvents()),
            this.safeInspect(() => activeSession.session.verificationReports()),
            this.safeInspect(() => activeSession.session.verificationSummary()),
            this.safeInspect(
                () => activeSession.session.verificationSummaryText(),
                (error) => String(error),
            ),
            activeSession.session.hasQueue()
                ? this.safeInspect(() => activeSession.session.deadLetters())
                : Promise.resolve(null),
            activeSession.session.hasQueue()
                ? this.safeInspect(() => activeSession.session.queueMetrics())
                : Promise.resolve(null),
        ]);
        const contextUsage = await this.resolveUsableContextUsage(activeSession, runs);
        return {
            sessionId: activeSession.session.sessionId,
            workspace: storageWorkspace,
            storageWorkspace,
            ...(!isCloud() ? { runtimeWorkspace: activeSession.workspace } : {}),
            agentId: activeSession.agentId,
            maxContextTokens: activeSession.maxContextTokens,
            ...(contextUsage?.usedTokens !== undefined
                ? { contextUsedTokens: contextUsage.usedTokens }
                : {}),
            ...(contextUsage?.percent !== undefined
                ? { contextUsedPercent: contextUsage.percent }
                : {}),
            ...(contextUsage?.estimated !== undefined
                ? { contextUsageEstimated: contextUsage.estimated }
                : {}),
            ...(contextUsage?.pendingRefresh !== undefined
                ? { contextUsagePendingRefresh: contextUsage.pendingRefresh }
                : {}),
            toolNames: this.safeInspectSync(() => activeSession.session.toolNames()),
            toolDefinitions: this.safeInspectSync(() => activeSession.session.toolDefinitions()),
            skills: await this.listRuntimeSkills(activeSession, runtimeOverrides),
            commands: [...new Set(commands)],
            queueStats,
            mcpStatus: this.withMcpInitErrors(mcpStatus, activeSession),
            memoryStats,
            initWarning: activeSession.session.initWarning,
            currentRun,
            activeTools,
            runs,
            subagentTasks,
            pendingSubagentTasks,
            traceEvents,
            verificationReports,
            verificationSummary,
            verificationSummaryText:
                typeof verificationSummaryText === "string"
                    ? verificationSummaryText
                    : String(verificationSummaryText ?? ""),
            deadLetters,
            queueMetrics,
        };
    }

    private async resolveUsableContextUsage(
        activeSession: ActiveSession,
        runs: unknown,
    ): Promise<
        | {
              usedTokens?: number;
              maxTokens?: number;
              percent?: number;
              estimated?: boolean;
              pendingRefresh?: boolean;
          }
        | undefined
    > {
        const measured = await this.resolveContextUsage(
            activeSession.session,
            runs,
            activeSession.maxContextTokens,
        );
        if (measured?.usedTokens !== undefined && measured.pendingRefresh !== true) return measured;

        // Immediately after compaction (or before the first provider call) some
        // SDK builds expose only the denominator. Estimate the currently loaded
        // prompt instead of leaving /context in an indefinite "calculating"
        // state. The UI labels this result as estimated.
        return this.estimateContextUsage(activeSession) ?? measured;
    }

    private estimateContextUsage(
        activeSession: ActiveSession,
    ):
        | {
              usedTokens: number;
              maxTokens: number;
              percent: number;
              estimated: true;
              pendingRefresh: false;
          }
        | undefined {
        const maxTokens = this.positiveNumber(activeSession.maxContextTokens);
        if (maxTokens === undefined) return undefined;
        const session = activeSession.session as unknown as {
            history?: () => unknown;
            toolDefinitions?: () => unknown;
            listCommands?: () => unknown;
        };
        const promptSnapshot = {
            systemPrompt: activeSession.runtimeOverrides.systemPrompt ?? "",
            history: this.safeInspectSync(() => session.history?.() ?? []),
            toolDefinitions: this.safeInspectSync(() => session.toolDefinitions?.() ?? []),
            commands: this.safeInspectSync(() => session.listCommands?.() ?? []),
        };
        const serialized = JSON.stringify(promptSnapshot);
        const cjkCount = (serialized.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length;
        const remainingCodePoints = Math.max(0, Array.from(serialized).length - cjkCount);
        const structuralOverhead = 256;
        const usedTokens = Math.max(
            1,
            Math.min(maxTokens, Math.ceil(cjkCount + remainingCodePoints / 4) + structuralOverhead),
        );
        return {
            usedTokens,
            maxTokens,
            percent: (usedTokens / maxTokens) * 100,
            estimated: true,
            pendingRefresh: false,
        };
    }

    private async resolveContextUsage(
        session: ActiveSession["session"],
        runs: unknown,
        configuredMaxTokens?: number,
    ): Promise<
        | {
              usedTokens?: number;
              maxTokens?: number;
              percent?: number;
              estimated?: boolean;
              pendingRefresh?: boolean;
          }
        | undefined
    > {
        const nativeContextUsage = (session as unknown as { contextUsage?: () => Promise<unknown> }).contextUsage;
        if (typeof nativeContextUsage === "function") {
            try {
                const normalized = this.normalizeContextUsage(await nativeContextUsage.call(session), configuredMaxTokens);
                if (normalized) return normalized;
            } catch {
                // Fall through to retained run events for packages built before
                // the contextUsage API was introduced.
            }
        }

        if (!Array.isArray(runs)) return undefined;
        const orderedRuns = [...runs]
            .filter((run): run is Record<string, unknown> => this.isRecord(run))
            .sort(
                (left, right) =>
                    this.numberValue(right.updated_at_ms ?? right.updatedAtMs) -
                    this.numberValue(left.updated_at_ms ?? left.updatedAtMs),
            );
        const runEvents = (session as unknown as { runEvents?: (runId: string) => Promise<unknown> }).runEvents;
        if (typeof runEvents !== "function") return undefined;

        for (const run of orderedRuns) {
            const runId = this.stringValue(run.id);
            if (!runId) continue;
            try {
                const events = await runEvents.call(session, runId);
                const recovered = this.contextUsageFromRunEvents(events, configuredMaxTokens);
                if (recovered) return recovered;
            } catch {
                // A single evicted/corrupt run must not hide usage from older
                // retained runs.
            }
        }
        return undefined;
    }

    private normalizeContextUsage(
        value: unknown,
        configuredMaxTokens?: number,
    ):
        | {
              usedTokens: number;
              maxTokens: number;
              percent: number;
              estimated: boolean;
              pendingRefresh: boolean;
          }
        | undefined {
        if (!this.isRecord(value)) return undefined;
        const usedTokens = this.nonNegativeNumber(value.usedTokens ?? value.used_tokens);
        const maxTokens =
            this.positiveNumber(configuredMaxTokens) ??
            this.positiveNumber(value.maxTokens ?? value.max_tokens);
        if (usedTokens === undefined || maxTokens === undefined) return undefined;
        return {
            usedTokens,
            maxTokens,
            percent: (usedTokens / maxTokens) * 100,
            estimated: value.estimated === true,
            pendingRefresh: value.pendingRefresh === true || value.pending_refresh === true,
        };
    }

    private contextUsageFromRunEvents(
        value: unknown,
        configuredMaxTokens?: number,
    ):
        | {
              usedTokens?: number;
              maxTokens?: number;
              percent?: number;
              estimated?: boolean;
              pendingRefresh?: boolean;
          }
        | undefined {
        if (!Array.isArray(value)) return undefined;
        let latestTurn: { timestamp: number; usedTokens: number } | undefined;
        let latestCompaction = -1;
        for (const item of value) {
            if (!this.isRecord(item)) continue;
            const event = this.isRecord(item.payload)
                ? item.payload
                : this.isRecord(item.event)
                  ? item.event
                  : item;
            const type = this.stringValue(item.type ?? event.type);
            const metadata = this.isRecord(item.metadata) ? item.metadata : {};
            const timestamp = this.numberValue(
                metadata.timestamp_ms ?? metadata.timestampMs ?? item.timestamp_ms ?? item.timestampMs,
            );
            if (type === "context_compacted") {
                latestCompaction = Math.max(latestCompaction, timestamp);
                continue;
            }
            if (type !== "turn_end") continue;
            const usage = this.isRecord(event.usage)
                ? event.usage
                : this.isRecord(event.payload) && this.isRecord(event.payload.usage)
                  ? event.payload.usage
                  : undefined;
            const usedTokens = usage
                ? this.nonNegativeNumber(
                      usage.promptTokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.input_tokens,
                  )
                : undefined;
            if (usedTokens !== undefined && (!latestTurn || timestamp >= latestTurn.timestamp)) {
                latestTurn = { timestamp, usedTokens };
            }
        }
        const maxTokens = this.positiveNumber(configuredMaxTokens);
        if (!latestTurn || latestCompaction >= latestTurn.timestamp) {
            return latestCompaction >= 0
                ? { maxTokens, estimated: true, pendingRefresh: true }
                : undefined;
        }
        return {
            usedTokens: latestTurn.usedTokens,
            maxTokens,
            percent: maxTokens ? (latestTurn.usedTokens / maxTokens) * 100 : undefined,
            estimated: false,
            pendingRefresh: false,
        };
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    private stringValue(value: unknown): string {
        return typeof value === "string" ? value : "";
    }

    private numberValue(value: unknown): number {
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    }

    private nonNegativeNumber(value: unknown): number | undefined {
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
    }

    private positiveNumber(value: unknown): number | undefined {
        return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
    }

    private safeInspect<T>(
        read: () => T | Promise<T>,
        onError: (error: unknown) => unknown = (error) => ({ error: String(error) }),
    ): Promise<unknown> {
        return Promise.resolve().then(read).catch(onError);
    }

    private safeInspectSync<T>(
        read: () => T,
        onError: (error: unknown) => unknown = (error) => ({ error: String(error) }),
    ): unknown {
        try {
            return read();
        } catch (error) {
            return onError(error);
        }
    }

    private withMcpInitErrors(mcpStatus: unknown, activeSession: ActiveSession): unknown[] {
        return [
            ...(Array.isArray(mcpStatus) ? mcpStatus : []),
            ...(activeSession.mcpInitErrors ?? []).map((item) => ({
                name: item.name,
                connected: false,
                toolCount: 0,
                error: item.error,
            })),
        ];
    }

    private async listRuntimeSkills(
        activeSession: ActiveSession,
        overrides?: SessionRuntimeOverrides,
    ): Promise<RuntimeSkillInfo[]> {
        const byName = new Map<string, RuntimeSkillInfo>();
        if (overrides?.builtinSkills) {
            for (const skill of a3sBuiltinSkills()) {
                byName.set(skill.name, {
                    name: skill.name,
                    description: skill.description,
                    kind: skill.kind,
                });
            }
        }
        for (const dir of this.runtimeSkillDirs(overrides)) {
            for (const skill of await this.listSkillsFromDirectory(dir, activeSession.workspace)) {
                byName.set(skill.name, skill);
            }
        }
        const configured = new Set(
            (overrides?.skills ?? []).map((skill) => this.normalizeSkillName(skill)).filter(Boolean),
        );
        return Array.from(byName.values())
            .filter((skill) => configured.size === 0 || configured.has(this.normalizeSkillName(skill.name)))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private visibleStorageWorkspace(workspace?: string): string | undefined {
        const trimmed = workspace?.trim();
        if (!trimmed) return undefined;
        if (isCloud() && !this.isRemoteWorkspacePath(trimmed)) return undefined;
        return trimmed;
    }

    private isRemoteWorkspacePath(value: string): boolean {
        return isRemoteWorkspacePath(value);
    }

    private runtimeSkillDirs(overrides?: SessionRuntimeOverrides): string[] {
        const dirs = overrides?.skillDirs ?? [];
        if (!isCloud()) return dirs;
        return [];
    }

    private async listSkillsFromDirectory(dir: string, workspace: string): Promise<RuntimeSkillInfo[]> {
        const root = path.isAbsolute(dir) ? dir : path.join(workspace, dir);
        try {
            const entries = await fs.readdir(root, { withFileTypes: true });
            const skills: RuntimeSkillInfo[] = [];
            for (const entry of entries) {
                if (entry.name.startsWith(".")) continue;
                const skillPath = entry.isDirectory()
                    ? path.join(root, entry.name, "SKILL.md")
                    : path.join(root, entry.name);
                if (!entry.isDirectory() && !entry.name.endsWith(".md")) continue;
                try {
                    const content = await fs.readFile(skillPath, "utf8");
                    skills.push({
                        name: this.frontmatterString(content, "name") || entry.name.replace(/\.md$/i, ""),
                        description: this.frontmatterString(content, "description"),
                        kind: this.frontmatterString(content, "kind") || "instruction",
                    });
                } catch {
                    // Ignore broken skill files; a3s-code will surface runtime load errors separately.
                }
            }
            return skills;
        } catch {
            return [];
        }
    }

    private frontmatterString(content: string, key: string): string | undefined {
        const match = content.match(new RegExp(`(?:^|\\n)${key}:\\s*(.+?)(?:\\n|$)`, "i"));
        return match?.[1]?.trim() || undefined;
    }

    private normalizeCommandName(command: unknown): string | null {
        if (typeof command === "string") return command.trim() || null;
        if (!command || typeof command !== "object") return null;
        const record = command as Record<string, unknown>;
        const value = record.name ?? record.command ?? record.id ?? record.title ?? record.label;
        return typeof value === "string" && value.trim() ? value.trim() : null;
    }

    private normalizeSkillName(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/[\s_]+/g, "-");
    }
}
