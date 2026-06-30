import type { AgentEvent, Session } from '@a3s-lab/code';
import { KernelToolConfirmationService } from './kernel-tool-confirmation.service';
import type { KernelSessionRuntimeStateService } from './kernel-session-runtime-state.service';
import type { ToolConfirmationGate } from './tool-confirmation-gate';

describe('KernelToolConfirmationService', () => {
    it('uses fallback tool details when the SDK confirmation event omits toolId', async () => {
        const runtimeState = {
            isCancelled: jest.fn().mockReturnValue(false),
        } as unknown as KernelSessionRuntimeStateService;
        const session = {
            confirmToolUse: jest.fn().mockResolvedValue(undefined),
        } as unknown as Session;
        const confirmation = {
            requestConfirmation: jest.fn().mockResolvedValue(true),
        } as unknown as ToolConfirmationGate;
        const emit = jest.fn();
        const service = new KernelToolConfirmationService(runtimeState);

        const approved = await service.handleConfirmationRequired({
            sessionId: 'session-a',
            session,
            event: {
                type: 'confirmation_required',
                data: JSON.stringify({
                    args: {
                        path: '/Users/aspdelus/Documents/TEST/users/local/sessions/default-20260630-173127413',
                    },
                }),
            } as AgentEvent,
            confirmation,
            fallbackToolId: 'call_d5e81299c5d342bcb6fd580f',
            fallbackToolName: 'ls',
            emit,
        });

        expect(approved).toBe(true);
        expect(confirmation.requestConfirmation).toHaveBeenCalledWith('session-a', 'ls', {
            path: '/Users/aspdelus/Documents/TEST/users/local/sessions/default-20260630-173127413',
        });
        expect(session.confirmToolUse).toHaveBeenCalledWith('call_d5e81299c5d342bcb6fd580f', true);
        expect(emit).toHaveBeenCalledWith({
            type: 'stream_event',
            event: {
                type: 'tool_confirmation_pending',
                toolId: 'call_d5e81299c5d342bcb6fd580f',
                toolName: 'ls',
                toolInput: {
                    path: '/Users/aspdelus/Documents/TEST/users/local/sessions/default-20260630-173127413',
                },
            },
        });
    });
});
