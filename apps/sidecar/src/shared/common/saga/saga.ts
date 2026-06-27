// ============================================================================
// Saga Infrastructure - Distributed Transaction Pattern
// ============================================================================

import { Logger } from '@nestjs/common';

/**
 * Step in a saga
 */
export interface SagaStep<TInput, TOutput, TCompensation = void> {
    /** Unique name of the step */
    name: string;
    /** Execute the step action */
    execute: (input: TInput) => Promise<TOutput>;
    /** Compensate the step (rollback) */
    compensate?: (input: TInput, output: TOutput) => Promise<TCompensation>;
}

/**
 * Saga execution result
 */
export interface SagaResult<_TOutput> {
    success: boolean;
    completedSteps: Array<{ name: string; output: unknown }>;
    failedStep?: string;
    error?: Error;
    compensationResults?: Array<{ name: string; result: unknown }>;
}

/**
 * Base Saga class for orchestrating distributed transactions
 *
 * @example
 * ```typescript
 * class CreateOrderSaga extends Saga<void, string> {
 *   constructor(
 *     private readonly inventoryService: InventoryService,
 *     private readonly paymentService: PaymentService,
 *     private readonly orderService: OrderService,
 *   ) {
 *     super('CreateOrderSaga');
 *   }
 *
 *   defineSteps(): SagaStep<void, string>[] {
 *     return [
 *       {
 *         name: 'reserve-inventory',
 *         execute: async () => this.inventoryService.reserve(...),
 *         compensate: async (_, output) => this.inventoryService.release(output),
 *       },
 *       {
 *         name: 'process-payment',
 *         execute: async () => this.paymentService.charge(...),
 *         compensate: async (_, output) => this.paymentService.refund(output),
 *       },
 *       {
 *         name: 'create-order',
 *         execute: async () => this.orderService.create(...),
 *       },
 *     ];
 *   }
 * }
 * ```
 */
export abstract class Saga<TInput, TOutput> {
    protected readonly logger: Logger;

    constructor(
        protected readonly name: string,
        protected readonly steps: SagaStep<TInput, TOutput>[],
    ) {
        this.logger = new Logger(`Saga:${name}`);
    }

    /**
     * Define the saga steps - override in subclasses
     */
    abstract defineSteps(): SagaStep<TInput, TOutput>[];

    /**
     * Execute the saga
     *
     * @param input Initial input to the saga
     * @returns Saga execution result
     */
    async execute(input: TInput): Promise<SagaResult<TOutput>> {
        const completedSteps: Array<{ name: string; output: unknown }> = [];
        const compensationResults: Array<{ name: string; result: unknown }> = [];
        const steps = this.defineSteps();

        this.logger.log(`Starting saga: ${this.name}`);

        for (const step of steps) {
            this.logger.debug(`Executing step: ${step.name}`);

            try {
                const output = await step.execute(input);
                completedSteps.push({ name: step.name, output });
                this.logger.debug(`Step completed: ${step.name}`);
            } catch (error) {
                this.logger.error(`Step failed: ${step.name}`, error);

                // Compensate completed steps in reverse order
                this.logger.log(`Starting compensation for saga: ${this.name}`);
                for (const completed of completedSteps.reverse()) {
                    const stepToCompensate = steps.find(s => s.name === completed.name);
                    if (stepToCompensate?.compensate) {
                        try {
                            this.logger.debug(`Compensating step: ${completed.name}`);
                            const result = await stepToCompensate.compensate(input, completed.output as TOutput);
                            compensationResults.push({ name: completed.name, result });
                            this.logger.debug(`Compensation completed: ${completed.name}`);
                        } catch (compensateError) {
                            this.logger.error(`Compensation failed for step: ${completed.name}`, compensateError);
                            // Continue compensating other steps even if one fails
                        }
                    }
                }

                return {
                    success: false,
                    completedSteps,
                    failedStep: step.name,
                    error: error instanceof Error ? error : new Error(String(error)),
                    compensationResults,
                };
            }
        }

        this.logger.log(`Saga completed successfully: ${this.name}`);
        return {
            success: true,
            completedSteps,
        };
    }

    /**
     * Execute saga with automatic retry on failure
     *
     * @param input Initial input
     * @param maxRetries Maximum number of retries
     * @param delayMs Delay between retries in milliseconds
     */
    async executeWithRetry(input: TInput, maxRetries = 3, delayMs = 1000): Promise<SagaResult<TOutput>> {
        let lastResult: SagaResult<TOutput>;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.logger.debug(`Saga attempt ${attempt}/${maxRetries}: ${this.name}`);

            lastResult = await this.execute(input);

            if (lastResult.success) {
                return lastResult;
            }

            if (attempt < maxRetries) {
                this.logger.warn(`Saga failed, retrying in ${delayMs}ms: ${this.name}`);
                await this.delay(delayMs);
            }
        }

        this.logger.error(`Saga failed after ${maxRetries} attempts: ${this.name}`);
        return lastResult!;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Simple command-style saga for fire-and-forget style operations
 */
export class CommandSaga<TInput> extends Saga<TInput, void> {
    defineSteps(): SagaStep<TInput, void>[] {
        return this.steps;
    }
}
