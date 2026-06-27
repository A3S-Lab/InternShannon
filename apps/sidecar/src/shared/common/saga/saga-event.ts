// ============================================================================
// Saga Event - Event-driven Saga Support
// ============================================================================

import { Logger } from '@nestjs/common';

/**
 * Saga event base interface
 */
export interface SagaEvent {
    /** Event type identifier */
    type: string;
    /** Correlation ID for tracking saga progress */
    correlationId: string;
    /** Timestamp when event was created */
    timestamp: Date;
}

/**
 * Step failure event
 */
export interface SagaStepFailedEvent extends SagaEvent {
    type: 'saga.step.failed';
    stepName: string;
    error: string;
}

/**
 * Step completed event
 */
export interface SagaStepCompletedEvent extends SagaEvent {
    type: 'saga.step.completed';
    stepName: string;
    output: unknown;
}

/**
 * Saga completed event
 */
export interface SagaCompletedEvent extends SagaEvent {
    type: 'saga.completed';
    output: unknown;
}

/**
 * Saga compensated event (rollback)
 */
export interface SagaCompensatedEvent extends SagaEvent {
    type: 'saga.compensated';
    completedSteps: string[];
}

/**
 * Saga failed event
 */
export interface SagaFailedEvent extends SagaEvent {
    type: 'saga.failed';
    failedStep: string;
    error: string;
}

/**
 * Union type for all saga events
 */
export type SagaEvents =
    | SagaStepFailedEvent
    | SagaStepCompletedEvent
    | SagaCompletedEvent
    | SagaCompensatedEvent
    | SagaFailedEvent;

/**
 * Publishes saga events for monitoring and choreography
 */
export class SagaEventPublisher {
    private readonly logger = new Logger(SagaEventPublisher.name);

    constructor(
        private readonly eventBus?: {
            publish: (event: SagaEvent) => Promise<void>;
        },
    ) {}

    /**
     * Publish a saga event
     */
    async publish(event: SagaEvent): Promise<void> {
        this.logger.debug(`Publishing saga event: ${event.type}`, { correlationId: event.correlationId });

        if (this.eventBus) {
            await this.eventBus.publish(event);
        }
    }

    /**
     * Create and publish step completed event
     */
    async publishStepCompleted(correlationId: string, stepName: string, output: unknown): Promise<void> {
        const event: SagaStepCompletedEvent = {
            type: 'saga.step.completed',
            correlationId,
            stepName,
            output,
            timestamp: new Date(),
        };
        await this.publish(event);
    }

    /**
     * Create and publish step failed event
     */
    async publishStepFailed(correlationId: string, stepName: string, error: Error): Promise<void> {
        const event: SagaStepFailedEvent = {
            type: 'saga.step.failed',
            correlationId,
            stepName,
            error: error.message,
            timestamp: new Date(),
        };
        await this.publish(event);
    }

    /**
     * Create and publish saga completed event
     */
    async publishCompleted(correlationId: string, output: unknown): Promise<void> {
        const event: SagaCompletedEvent = {
            type: 'saga.completed',
            correlationId,
            output,
            timestamp: new Date(),
        };
        await this.publish(event);
    }

    /**
     * Create and publish saga compensated event
     */
    async publishCompensated(correlationId: string, completedSteps: string[]): Promise<void> {
        const event: SagaCompensatedEvent = {
            type: 'saga.compensated',
            correlationId,
            completedSteps,
            timestamp: new Date(),
        };
        await this.publish(event);
    }

    /**
     * Create and publish saga failed event
     */
    async publishFailed(correlationId: string, failedStep: string, error: Error): Promise<void> {
        const event: SagaFailedEvent = {
            type: 'saga.failed',
            correlationId,
            failedStep,
            error: error.message,
            timestamp: new Date(),
        };
        await this.publish(event);
    }
}
