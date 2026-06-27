import { Injectable, type OnModuleInit } from '@nestjs/common';
import { KernelSessionRuntimeFactory } from './kernel-session-runtime-factory.service';
import {
    KernelSessionRuntimeStateService,
    type SessionCloseReason,
} from './kernel-session-runtime-state.service';
import type { ActiveSession, SessionRuntimeOverrides } from './session-runtime.types';

export interface KernelSessionRuntimeAccessInput {
    sessionId: string;
    agentId?: string;
    cwd?: string;
    overrides?: SessionRuntimeOverrides;
    emit: (message: unknown) => void;
}

@Injectable()
export class KernelSessionRuntimeAccessService implements OnModuleInit {
    constructor(
        private readonly runtimeState: KernelSessionRuntimeStateService,
        private readonly runtimeFactory: KernelSessionRuntimeFactory,
    ) {}

    onModuleInit(): void {
        // Wire the sweeper / shutdown hook back to `closeActive` without
        // forcing the state service to depend on the access service (which
        // would close a DI cycle: state → access → factory → state).
        this.runtimeState.registerReaper((sessionId, reason) =>
            this.closeActiveWithReason(sessionId, reason),
        );
    }

    async refreshRuntimeCatalog(): Promise<void> {
        await this.runtimeState.refreshModelsConfig();
    }

    patchRuntimeOverrides(sessionId: string, patch?: SessionRuntimeOverrides): void {
        this.runtimeState.patchRuntimeOverrides(sessionId, patch);
    }

    runtimeOverrides(sessionId: string): SessionRuntimeOverrides {
        return this.runtimeState.runtimeOverrides(sessionId);
    }

    async systemRuntimeDefaults(): Promise<SessionRuntimeOverrides> {
        await this.refreshRuntimeCatalog();
        return this.runtimeState.runtimeConfigBuilder().systemRuntimeDefaults();
    }

    active(sessionId: string): ActiveSession | null {
        const session = this.runtimeState.getActiveSession(sessionId) ?? null;
        if (session) this.runtimeState.touchActivity(sessionId);
        return session;
    }

    getOrCreate(input: KernelSessionRuntimeAccessInput): Promise<ActiveSession | null> {
        return this.runtimeFactory.getOrCreateSession(input);
    }

    async getActiveOrCreate(input: KernelSessionRuntimeAccessInput): Promise<ActiveSession | null> {
        return this.active(input.sessionId) ?? (await this.getOrCreate(input));
    }

    closeActive(sessionId: string): boolean {
        return this.closeActiveWithReason(sessionId, 'explicit');
    }

    private closeActiveWithReason(sessionId: string, reason: SessionCloseReason): boolean {
        const activeSession = this.runtimeState.getActiveSession(sessionId);
        if (!activeSession) {
            return false;
        }

        activeSession.session.close();
        this.runtimeState.deleteActiveSession(sessionId);
        this.runtimeState.recordCloseMetric(reason);
        return true;
    }
}
