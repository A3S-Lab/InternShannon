import type { Server } from 'socket.io';
import { WebSocketConfirmationManager } from './websocket-confirmation-manager';

describe('WebSocketConfirmationManager', () => {
    it('emits confirmation requests to the subscribed session room and resolves approved responses', async () => {
        const emitted: Array<{ room: string; event: string; payload: Record<string, unknown> }> = [];
        const server = {
            to: (room: string) => ({
                emit: (event: string, payload: Record<string, unknown>) => {
                    emitted.push({ room, event, payload });
                },
            }),
        } as unknown as Server;
        const manager = new WebSocketConfirmationManager(server, 1_000);

        const approval = manager.requestConfirmation('session-a', 'Bash', { command: 'true' });

        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatchObject({
            room: 'session:session-a',
            event: 'tool_confirmation_request',
        });
        expect(emitted[0].payload).toMatchObject({
            sessionId: 'session-a',
            toolName: 'Bash',
            toolInput: { command: 'true' },
        });

        manager.handleConfirmationResponse(
            {
                requestId: emitted[0].payload.requestId as string,
                approved: true,
                scope: 'once',
                toolName: 'Bash',
            },
            'session-a',
        );

        await expect(approval).resolves.toBe(true);
    });
});
