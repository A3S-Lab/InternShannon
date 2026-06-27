import { DomainEvent } from './domain-event';
import { Entity } from './entity';

export abstract class AggregateRoot<T> extends Entity<T> {
    private _domainEvents: DomainEvent[] = [];

    get domainEvents(): DomainEvent[] {
        return this._domainEvents;
    }

    public addDomainEvent(domainEvent: DomainEvent): void {
        this._domainEvents.push(domainEvent);
    }

    public clearEvents(): void {
        this._domainEvents = [];
    }
}
