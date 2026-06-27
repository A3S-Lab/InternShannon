import { Injectable } from '@nestjs/common';
import { EventBus as NestEventBus } from '@nestjs/cqrs';
import { DomainEvent } from '@/shared/domain/domain-event';
import { IEventBus } from './event-bus.interface';

@Injectable()
export class EventBusService implements IEventBus {
    constructor(private readonly eventBus: NestEventBus) {}

    async publish(event: DomainEvent): Promise<void> {
        await this.eventBus.publish(event);
    }

    async publishAll(events: DomainEvent[]): Promise<void> {
        await Promise.all(events.map(event => this.eventBus.publish(event)));
    }
}
