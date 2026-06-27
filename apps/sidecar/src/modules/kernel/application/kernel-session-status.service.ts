import { builtinSkills as a3sBuiltinSkills } from '@a3s-lab/code';
import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { isCloud } from '@/shared/constants';
import type { ActiveSession, RuntimeSkillInfo, SessionRuntimeOverrides } from './session-runtime.types';

export interface KernelSessionStatusViewModel {
    sessionId: string;
    workspace: string;
    storageWorkspace: string;
    runtimeWorkspace?: string;
    agentId: string;
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

@Injectable()
export class KernelSessionStatusService {
    async describe(
        activeSession: ActiveSession,
        runtimeOverrides: SessionRuntimeOverrides = activeSession.runtimeOverrides,
    ): Promise<KernelSessionStatusViewModel> {
        const storageWorkspace =
            this.visibleStorageWorkspace(activeSession.storageWorkspace) || (!isCloud() ? activeSession.workspace : '');
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
                error => [{ name: 'mcp', connected: false, toolCount: 0, error: String(error) }],
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
                error => String(error),
            ),
            activeSession.session.hasQueue()
                ? this.safeInspect(() => activeSession.session.deadLetters())
                : Promise.resolve(null),
            activeSession.session.hasQueue()
                ? this.safeInspect(() => activeSession.session.queueMetrics())
                : Promise.resolve(null),
        ]);
        return {
            sessionId: activeSession.session.sessionId,
            workspace: storageWorkspace,
            storageWorkspace,
            ...(!isCloud() ? { runtimeWorkspace: activeSession.workspace } : {}),
            agentId: activeSession.agentId,
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
                typeof verificationSummaryText === 'string'
                    ? verificationSummaryText
                    : String(verificationSummaryText ?? ''),
            deadLetters,
            queueMetrics,
        };
    }

    private safeInspect<T>(
        read: () => T | Promise<T>,
        onError: (error: unknown) => unknown = error => ({ error: String(error) }),
    ): Promise<unknown> {
        return Promise.resolve().then(read).catch(onError);
    }

    private safeInspectSync<T>(
        read: () => T,
        onError: (error: unknown) => unknown = error => ({ error: String(error) }),
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
            ...(activeSession.mcpInitErrors ?? []).map(item => ({
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
            (overrides?.skills ?? []).map(skill => this.normalizeSkillName(skill)).filter(Boolean),
        );
        return Array.from(byName.values())
            .filter(skill => configured.size === 0 || configured.has(this.normalizeSkillName(skill.name)))
            .sort((a, b) => a.name.localeCompare(b.name));
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
        return Boolean(scheme && scheme !== 'file');
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
                if (entry.name.startsWith('.')) continue;
                const skillPath = entry.isDirectory()
                    ? path.join(root, entry.name, 'SKILL.md')
                    : path.join(root, entry.name);
                if (!entry.isDirectory() && !entry.name.endsWith('.md')) continue;
                try {
                    const content = await fs.readFile(skillPath, 'utf8');
                    skills.push({
                        name: this.frontmatterString(content, 'name') || entry.name.replace(/\.md$/i, ''),
                        description: this.frontmatterString(content, 'description'),
                        kind: this.frontmatterString(content, 'kind') || 'instruction',
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
        const match = content.match(new RegExp(`(?:^|\\n)${key}:\\s*(.+?)(?:\\n|$)`, 'i'));
        return match?.[1]?.trim() || undefined;
    }

    private normalizeCommandName(command: unknown): string | null {
        if (typeof command === 'string') return command.trim() || null;
        if (!command || typeof command !== 'object') return null;
        const record = command as Record<string, unknown>;
        const value = record.name ?? record.command ?? record.id ?? record.title ?? record.label;
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    private normalizeSkillName(value: string): string {
        return value
            .trim()
            .toLowerCase()
            .replace(/[\s_]+/g, '-');
    }
}
