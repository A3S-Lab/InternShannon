import { Injectable, Logger } from '@nestjs/common';
import { IEventBus } from '../../domain/events/event-bus.interface';
import type { CirculationEvent } from '../../domain/services/loop-controller.interface';

/**
 * Single-process desktop event bus. Subscriber errors are swallowed (warn) so
 * a bad consumer never breaks publish.
 */
@Injectable()
export class InProcessEventBus implements IEventBus {
    private readonly logger = new Logger(InProcessEventBus.name);
    private readonly handlers: Array<(event: CirculationEvent) => void | Promise<void>> = [];

    subscribe(handler: (event: CirculationEvent) => void | Promise<void>): void {
        this.handlers.push(handler);
    }

    async publish(event: CirculationEvent): Promise<void> {
        for (const handler of this.handlers) {
            try {
                await handler(event);
            } catch (error) {
                this.logger.warn(`Subscriber error for ${event.eventName} (${event.eventId}): ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
}
