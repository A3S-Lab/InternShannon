import type { WorkerAgentSpec } from '@a3s-lab/code';
import { Injectable } from '@nestjs/common';
import type { AgentSpec } from '../../domain/services/agent-spec.interface';
import type { SessionRuntimeOverrides } from '../session-runtime.types';

@Injectable()
export class DefaultAgent implements AgentSpec {
    readonly id = 'default';

    runtimeDefaults(): Partial<SessionRuntimeOverrides> {
        // The default assistant should stay conversational unless the caller
        // explicitly selects planning. Locked specialist agents own the forced
        // planning policy.
        return {
            planningMode: 'disabled',
            goalTracking: false,
            // Opt internShannon into the progressive-API (`capabilities`) WITHOUT whitelisting
            // its skills, so it can ground answers in the user's personal knowledge base
            // (assets module · personal-knowledge "search"). Execute access is gated
            // READ-ONLY for the default agent in CapabilitiesToolService.
            allowCapabilities: true,
        };
    }

    workers(): WorkerAgentSpec[] {
        return [];
    }
}
