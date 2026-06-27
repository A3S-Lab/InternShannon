import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * Thin bridge that lets services outside the kernel WebSocket gateway push
 * raw `message` frames to a session room. The kernel gateway attaches its
 * Socket.IO server here on bootstrap; consumers (e.g. runtime workflow
 * execution) inject this service and call `broadcastToSession`.
 *
 * Kept deliberately minimal — no event-type contract, no fan-out logic —
 * because the gateway already owns auth, room membership, and frame
 * normalisation. This is just the seam that avoids exporting the gateway
 * itself.
 */
@Injectable()
export class KernelSessionBroadcaster {
    private readonly logger = new Logger(KernelSessionBroadcaster.name);
    private server: Server | null = null;

    attach(server: Server): void {
        this.server = server;
    }

    broadcastToSession(sessionId: string, message: unknown): void {
        if (!this.server) {
            this.logger.debug(`Drop broadcast to ${sessionId}: gateway not yet attached`);
            return;
        }
        this.server.to(`session:${sessionId}`).emit('message', message);
    }
}
