import { confirmationPolicyForMode, permissionPolicyForMode } from './kernel-session-policies';

describe('permissionPolicyForMode', () => {
    it('allows SDK read-only tool names without HITL confirmation', () => {
        const policy = permissionPolicyForMode('default');

        expect(policy).toEqual(
            expect.objectContaining({
                defaultDecision: 'ask',
            }),
        );
        expect(policy?.allow).toEqual(expect.arrayContaining(['Read', 'List', 'LS', 'Glob', 'Grep']));
    });

    it('lets auto and plan modes bypass native confirmation', () => {
        expect(permissionPolicyForMode('auto')).toEqual({ defaultDecision: 'allow' });
        expect(permissionPolicyForMode('plan')).toEqual({ defaultDecision: 'allow' });
    });

    it('auto-approves SDK query-lane tools so read-only tools do not enter HITL', () => {
        expect(confirmationPolicyForMode('default')).toEqual({
            enabled: true,
            defaultTimeoutMs: 60_000,
            timeoutAction: 'reject',
            yoloLanes: ['query'],
        });
    });

    it('disables HITL confirmation policy for auto and plan modes', () => {
        expect(confirmationPolicyForMode('auto')).toBeUndefined();
        expect(confirmationPolicyForMode('plan')).toBeUndefined();
        expect(confirmationPolicyForMode('default', false)).toBeUndefined();
    });
});
