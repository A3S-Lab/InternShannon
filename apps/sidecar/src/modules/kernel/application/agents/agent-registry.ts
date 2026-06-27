import { Inject, Injectable, Optional } from '@nestjs/common';
import { AGENT_SPEC, type AgentSpec } from '../../domain/services/agent-spec.interface';
import type { RuntimeMcpServerConfig, SessionRuntimeOverrides } from '../session-runtime.types';

@Injectable()
export class AgentRegistry {
    private static readonly DEFAULT_AGENT_ALIASES = new Map<string, string>([['super-admin', 'default']]);

    private readonly specs = new Map<string, AgentSpec>();

    constructor(
        @Optional()
        @Inject(AGENT_SPEC)
        specs: AgentSpec[] = [],
    ) {
        for (const s of specs) {
            this.specs.set(s.id, s);
        }
    }

    resolve(agentId: string): AgentSpec | undefined {
        return this.specFor(agentId);
    }

    list(): AgentSpec[] {
        return [...this.specs.values()];
    }

    has(agentId: string): boolean {
        return !!this.specFor(agentId);
    }

    resolveOverrides(agentId: string, base: SessionRuntimeOverrides, sessionId?: string): SessionRuntimeOverrides {
        const spec = this.specFor(agentId);
        if (!spec) return base;

        const defaults = spec.runtimeDefaults?.() ?? {};
        const merged: SessionRuntimeOverrides = { ...base };
        for (const [key, value] of Object.entries(defaults)) {
            if ((merged as Record<string, unknown>)[key] == null) {
                (merged as Record<string, unknown>)[key] = value;
            }
        }

        // SDK slots — only fill from the agent if the caller didn't already supply.
        const ctx = sessionId ? { sessionId } : undefined;
        if (!merged.role && spec.role) {
            const role = spec.role();
            if (role?.trim()) merged.role = role.trim();
        }
        if (!merged.guidelines && spec.guidelines) {
            const guidelines = spec.guidelines();
            if (guidelines?.trim()) merged.guidelines = guidelines.trim();
        }
        if (!merged.extra && spec.extra) {
            const extra = spec.extra(ctx);
            if (extra?.trim()) merged.extra = extra.trim();
        }

        // Backward-compat: legacy `systemPrompt()` lands in `extra` only if `extra`
        // wasn't already supplied through the typed slot.
        if (!merged.extra && !merged.systemPrompt && spec.systemPrompt) {
            const legacy = spec.systemPrompt(ctx);
            if (legacy?.trim()) merged.systemPrompt = legacy.trim();
        }

        return merged;
    }

    resolveMcpServers(agentId: string): RuntimeMcpServerConfig[] {
        return this.specFor(agentId)?.mcpServers?.() ?? [];
    }

    private specFor(agentId: string): AgentSpec | undefined {
        const direct = this.specs.get(agentId);
        if (direct) return direct;
        const aliasTarget = AgentRegistry.DEFAULT_AGENT_ALIASES.get(agentId);
        return aliasTarget ? this.specs.get(aliasTarget) : undefined;
    }
}
