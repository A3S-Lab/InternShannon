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

    it('also targets the socket that initiated the message run', async () => {
        const targetedRooms: string[] = [];
        const server = {
            to: (room: string) => {
                targetedRooms.push(room);
                return server;
            },
            emit: jest.fn(),
        } as unknown as Server & { emit: jest.Mock };
        const manager = new WebSocketConfirmationManager(server, 1_000);
        const gate = manager.forClient('socket-1');

        const approval = gate.requestConfirmation('session-a', 'Write', { file_path: '/tmp/a.txt' });

        expect(targetedRooms).toEqual(['session:session-a', 'socket-1']);
        expect(server.emit).toHaveBeenCalledWith(
            'tool_confirmation_request',
            expect.objectContaining({
                sessionId: 'session-a',
                toolName: 'Write',
                toolInput: { file_path: '/tmp/a.txt' },
            }),
        );

        const request = server.emit.mock.calls[0]?.[1] as { requestId: string };
        manager.handleConfirmationResponse({ requestId: request.requestId, approved: false }, 'session-a');

        await expect(approval).resolves.toBe(false);
    });

    it('does not resolve a pending request from the wrong session response', async () => {
        const emitted: Array<{ room: string; event: string; payload: Record<string, unknown> }> = [];
        const server = {
            to: (room: string) => ({
                emit: (event: string, payload: Record<string, unknown>) => {
                    emitted.push({ room, event, payload });
                },
            }),
        } as unknown as Server;
        const manager = new WebSocketConfirmationManager(server, 25);

        const approval = manager.requestConfirmation('session-a', 'Write', { file_path: '/tmp/a.txt' });
        const requestId = emitted[0].payload.requestId as string;

        manager.handleConfirmationResponse(
            {
                requestId,
                approved: true,
                scope: 'session',
                toolName: 'Write',
            },
            'session-b',
        );

        await expect(Promise.race([approval.then(() => 'resolved'), delay(5).then(() => 'pending')])).resolves.toBe(
            'pending',
        );

        manager.handleConfirmationResponse(
            {
                requestId,
                approved: true,
                scope: 'session',
                toolName: 'Write',
            },
            'session-a',
        );

        await expect(approval).resolves.toBe(true);
    });
});

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
