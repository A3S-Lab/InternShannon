import { permissionPolicyForMode } from './kernel-session-policies';

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
});
