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
            confirmToolUse: jest.fn().mockResolvedValue(true),
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
        expect(session.confirmToolUse).toHaveBeenCalledWith('call_d5e81299c5d342bcb6fd580f', true, undefined);
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

    it('uses the SDK pending confirmation toolId when the event omits the real id', async () => {
        const runtimeState = {
            isCancelled: jest.fn().mockReturnValue(false),
        } as unknown as KernelSessionRuntimeStateService;
        const session = {
            pendingConfirmations: jest.fn().mockResolvedValue([
                {
                    toolId: 'call_real_pending_id',
                    toolName: 'ls',
                    args: {
                        path: '/Users/aspdelus/Documents/TEST/users/local/sessions/default-20260630-174451652',
                    },
                    remainingMs: 60_000,
                },
            ]),
            confirmToolUse: jest.fn().mockResolvedValue(true),
        } as unknown as Session;
        const confirmation = {
            requestConfirmation: jest.fn().mockResolvedValue(true),
        } as unknown as ToolConfirmationGate;
        const emit = jest.fn();
        const service = new KernelToolConfirmationService(runtimeState);

        const approved = await service.handleConfirmationRequired({
            sessionId: 'session-b',
            session,
            event: {
                type: 'confirmation_required',
                data: JSON.stringify({
                    args: {
                        path: '/Users/aspdelus/Documents/TEST/users/local/sessions/default-20260630-174451652',
                    },
                }),
            } as AgentEvent,
            confirmation,
            fallbackToolId: 'ls-0',
            fallbackToolName: 'ls',
            emit,
        });

        expect(approved).toBe(true);
        expect(confirmation.requestConfirmation).toHaveBeenCalledWith('session-b', 'ls', {
            path: '/Users/aspdelus/Documents/TEST/users/local/sessions/default-20260630-174451652',
        });
        expect(session.confirmToolUse).toHaveBeenCalledWith('call_real_pending_id', true, undefined);
        expect(session.confirmToolUse).not.toHaveBeenCalledWith('ls-0', true, undefined);
        expect(emit).toHaveBeenCalledWith({
            type: 'stream_event',
            event: {
                type: 'tool_confirmation_pending',
                toolId: 'call_real_pending_id',
                toolName: 'ls',
                toolInput: {
                    path: '/Users/aspdelus/Documents/TEST/users/local/sessions/default-20260630-174451652',
                },
            },
        });
    });

    it('retries confirmation with a pending SDK id when the first confirmToolUse misses', async () => {
        const runtimeState = {
            isCancelled: jest.fn().mockReturnValue(false),
        } as unknown as KernelSessionRuntimeStateService;
        const session = {
            pendingConfirmations: jest
                .fn()
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    {
                        toolId: 'call_real_retry_id',
                        toolName: 'ls',
                        args: {
                            path: '/Users/aspdelus/Documents/TEST/users/local/sessions/default-20260630-174451652',
                        },
                        remainingMs: 56_000,
                    },
                ]),
            confirmToolUse: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
        } as unknown as Session;
        const confirmation = {
            requestConfirmation: jest.fn().mockResolvedValue(true),
        } as unknown as ToolConfirmationGate;
        const emit = jest.fn();
        const service = new KernelToolConfirmationService(runtimeState);

        const approved = await service.handleConfirmationRequired({
            sessionId: 'session-c',
            session,
            event: {
                type: 'confirmation_required',
                data: JSON.stringify({
                    args: {
                        path: '/Users/aspdelus/Documents/TEST/users/local/sessions/default-20260630-174451652',
                    },
                }),
            } as AgentEvent,
            confirmation,
            fallbackToolId: 'ls-0',
            fallbackToolName: 'ls',
            emit,
        });

        expect(approved).toBe(true);
        expect(session.confirmToolUse).toHaveBeenNthCalledWith(1, 'ls-0', true, undefined);
        expect(session.confirmToolUse).toHaveBeenNthCalledWith(2, 'call_real_retry_id', true, undefined);
    });

    it('resolves repeated confirmation_required events from the SDK pending queue instead of timing out', async () => {
        const runtimeState = {
            isCancelled: jest.fn().mockReturnValue(false),
        } as unknown as KernelSessionRuntimeStateService;
        const session = {
            pendingConfirmations: jest
                .fn()
                .mockResolvedValueOnce([
                    {
                        toolId: 'call_first_pending_id',
                        toolName: 'Write',
                        args: { file_path: '/tmp/first.txt' },
                        remainingMs: 60_000,
                    },
                ])
                .mockResolvedValueOnce([
                    {
                        toolId: 'call_second_pending_id',
                        toolName: 'Write',
                        args: { file_path: '/tmp/second.txt' },
                        remainingMs: 60_000,
                    },
                ]),
            confirmToolUse: jest.fn().mockResolvedValue(true),
        } as unknown as Session;
        const confirmation = {
            requestConfirmation: jest.fn().mockResolvedValue(true),
        } as unknown as ToolConfirmationGate;
        const emit = jest.fn();
        const service = new KernelToolConfirmationService(runtimeState);

        const firstApproved = await service.handleConfirmationRequired({
            sessionId: 'session-d',
            session,
            event: {
                type: 'confirmation_required',
                data: JSON.stringify({ args: { file_path: '/tmp/first.txt' } }),
            } as AgentEvent,
            confirmation,
            emit,
        });
        const secondApproved = await service.handleConfirmationRequired({
            sessionId: 'session-d',
            session,
            event: {
                type: 'confirmation_required',
                data: JSON.stringify({ args: { file_path: '/tmp/second.txt' } }),
            } as AgentEvent,
            confirmation,
            emit,
        });

        expect(firstApproved).toBe(true);
        expect(secondApproved).toBe(true);
        expect(session.confirmToolUse).toHaveBeenNthCalledWith(1, 'call_first_pending_id', true, undefined);
        expect(session.confirmToolUse).toHaveBeenNthCalledWith(2, 'call_second_pending_id', true, undefined);
        expect(confirmation.requestConfirmation).toHaveBeenCalledTimes(2);
    });

    it('treats duplicate confirmation_required events for an already confirmed tool as idempotent', async () => {
        const runtimeState = {
            isCancelled: jest.fn().mockReturnValue(false),
        } as unknown as KernelSessionRuntimeStateService;
        const session = {
            pendingConfirmations: jest
                .fn()
                .mockResolvedValueOnce([
                    {
                        toolId: 'toolu_duplicate_write',
                        toolName: 'write',
                        args: {
                            content: 'OK',
                            file_path: 'confirm-debug.txt',
                        },
                        remainingMs: 60_000,
                    },
                ])
                .mockResolvedValueOnce([]),
            confirmToolUse: jest.fn().mockResolvedValueOnce(true),
        } as unknown as Session;
        const confirmation = {
            requestConfirmation: jest.fn().mockResolvedValue(true),
        } as unknown as ToolConfirmationGate;
        const emit = jest.fn();
        const service = new KernelToolConfirmationService(runtimeState);
        const logger = {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        Object.assign(service as unknown as { logger: typeof logger }, { logger });
        const event = {
            type: 'confirmation_required',
            data: JSON.stringify({
                toolId: 'toolu_duplicate_write',
                toolName: 'write',
                args: {
                    content: 'OK',
                    file_path: 'confirm-debug.txt',
                },
            }),
        } as AgentEvent;

        const firstApproved = await service.handleConfirmationRequired({
            sessionId: 'session-duplicate',
            session,
            event,
            confirmation,
            emit,
        });
        const duplicateApproved = await service.handleConfirmationRequired({
            sessionId: 'session-duplicate',
            session,
            event,
            confirmation,
            emit,
        });

        expect(firstApproved).toBe(true);
        expect(duplicateApproved).toBe(true);
        expect(confirmation.requestConfirmation).toHaveBeenCalledTimes(1);
        expect(session.confirmToolUse).toHaveBeenCalledTimes(1);
        expect(session.confirmToolUse).toHaveBeenCalledWith('toolu_duplicate_write', true, undefined);
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining('[kernel.tool.confirmation_duplicate]'),
        );
        expect(logger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('[kernel.tool.confirmation_not_found]'),
        );
    });
});
