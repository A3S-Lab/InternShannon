import { Logger } from '@nestjs/common';

/**
 * Telemetry Service - OpenTelemetry integration for workflow engine
 *
 * This service provides distributed tracing and structured logging for workflow execution.
 * It wraps OpenTelemetry APIs to provide a simple interface for the workflow engine.
 */
export class WorkflowTelemetryService {
    private readonly logger = new Logger(WorkflowTelemetryService.name);
    private enabled = false;

    /**
     * Initialize telemetry (should be called once at startup)
     */
    initialize(): void {
        try {
            // Check if OpenTelemetry is available
            // In production, this would initialize the OpenTelemetry SDK
            this.enabled = false; // Disabled by default until OpenTelemetry is installed
            this.logger.log('Workflow telemetry service initialized (tracing disabled)');
        } catch (error) {
            this.logger.warn('Failed to initialize telemetry', error);
            this.enabled = false;
        }
    }

    /**
     * Start a span for workflow execution
     */
    startExecutionSpan(executionId: string, workflowName: string): TelemetrySpan {
        if (!this.enabled) {
            return new NoOpSpan();
        }

        // In production, this would create an OpenTelemetry span
        return new NoOpSpan();
    }

    /**
     * Start a span for node execution
     */
    startNodeSpan(
        executionId: string,
        nodeId: string,
        nodeType: string,
        parentSpan?: TelemetrySpan,
    ): TelemetrySpan {
        if (!this.enabled) {
            return new NoOpSpan();
        }

        // In production, this would create an OpenTelemetry span
        return new NoOpSpan();
    }

    /**
     * Log structured event
     */
    logEvent(event: TelemetryEvent): void {
        if (!this.enabled) {
            return;
        }

        // In production, this would send to OpenTelemetry collector
        this.logger.log({
            event: event.name,
            ...event.attributes,
            timestamp: new Date().toISOString(),
        });
    }
}

/**
 * Telemetry Span interface
 */
export interface TelemetrySpan {
    setStatus(status: 'ok' | 'error'): void;
    setAttributes(attributes: Record<string, string | number | boolean>): void;
    recordException(error: Error): void;
    end(): void;
}

/**
 * Telemetry Event interface
 */
export interface TelemetryEvent {
    name: string;
    attributes: Record<string, string | number | boolean>;
}

/**
 * No-op span implementation (used when telemetry is disabled)
 */
class NoOpSpan implements TelemetrySpan {
    setStatus(_status: 'ok' | 'error'): void {}
    setAttributes(_attributes: Record<string, string | number | boolean>): void {}
    recordException(_error: Error): void {}
    end(): void {}
}

