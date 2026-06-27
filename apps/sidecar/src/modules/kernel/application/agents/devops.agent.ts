import { Injectable } from '@nestjs/common';
import type { AgentSpec } from '../../domain/services/agent-spec.interface';
import type { SessionRuntimeOverrides } from '../session-runtime.types';
import { LOCKED_AGENT_POLICY } from './locked-agent.policy';
import { DEVOPS_AGENT_GUIDELINES, DEVOPS_AGENT_ROLE } from './prompts/devops-agent.prompts';

export const DEVOPS_AGENT_ID = 'devops';

@Injectable()
export class DevOpsAgent implements AgentSpec {
    readonly id = DEVOPS_AGENT_ID;

    role(): string {
        return DEVOPS_AGENT_ROLE;
    }

    guidelines(): string {
        return DEVOPS_AGENT_GUIDELINES;
    }

    runtimeDefaults(): Partial<SessionRuntimeOverrides> {
        return {
            permissionMode: LOCKED_AGENT_POLICY.permissionMode,
            planningMode: LOCKED_AGENT_POLICY.planningMode,
            goalTracking: LOCKED_AGENT_POLICY.goalTracking,
            builtinSkills: true,
        };
    }
}
