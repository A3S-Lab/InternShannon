import type { CirculationEvent } from '../services/loop-controller.interface';

/**
 * Cross-process fact bus for loop circulation (review §5.1). The outbox relay publishes; loop
 * routers / observability consumers subscribe. Delivery is at-least-once — consumers MUST dedupe
 * by CirculationEvent.eventId (deterministic = hash(runId, iteration, eventName)).
 *
 * Desktop uses InProcessEventBus; the port stays abstract so callers do not depend on the concrete bus.
 */
export interface IEventBus {
    publish(event: CirculationEvent): Promise<void>;
    /** Register a subscriber. Errors in a subscriber must NOT break publish (fire-and-forget isolation). */
    subscribe(handler: (event: CirculationEvent) => void | Promise<void>): void;
}

export const EVENT_BUS = Symbol('EVENT_BUS');
