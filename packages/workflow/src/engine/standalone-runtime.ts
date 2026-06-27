import { Logger } from '@nestjs/common';
import {
    IWorkflowRuntime,
    JobExecutionOptions,
    PackageExecutionResult,
    PackageInfo,
} from '../interfaces';
import { PackageType } from '../domain/value-objects';

/**
 * Standalone Runtime - single machine workflow execution
 *
 * For environments where external job/CronJob are not available.
 * Uses a3s-box or direct process execution for Package execution.
 */
export class StandaloneRuntime implements IWorkflowRuntime {
    private readonly logger = new Logger(StandaloneRuntime.name);

    /**
     * Package registry for standalone execution
     * Maps packageId -> package executor function
     */
    private packageExecutors: Map<string, (input: Record<string, unknown>) => Promise<Record<string, unknown>>> = new Map();
    private packageExecutorTypes: Map<string, PackageType> = new Map();

    constructor(
        private readonly packageLoader?: (
            packageId: string,
            version?: string,
        ) => Promise<{ execute(input: Record<string, unknown>): Promise<Record<string, unknown>> } | null>,
    ) {}

    /**
     * Register a package executor for standalone execution
     */
    registerPackageExecutor(
        packageId: string,
        executor: (input: Record<string, unknown>) => Promise<Record<string, unknown>>,
        packageType?: PackageType,
    ): void {
        this.packageExecutors.set(packageId, executor);
        this.packageExecutorTypes.set(packageId, packageType ?? this.inferPackageType(packageId));
        this.logger.debug(`Registered executor for package: ${packageId}`);
    }

    /**
     * Execute a Package synchronously and wait for result
     */
    async executePackage(options: JobExecutionOptions): Promise<PackageExecutionResult> {
        const maxRetries = options.retryPolicy?.maxRetries ?? 0;
        const retryDelay = options.retryPolicy?.retryDelay ?? 1000;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await this.executePackageOnce(options);
                if (result.success) {
                    return result;
                }
                lastError = new Error(result.error);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
            }

            // Retry if not on last attempt
            if (attempt < maxRetries) {
                const delay = retryDelay * 2 ** attempt;
                this.logger.debug(`Retry ${attempt + 1}/${maxRetries} for package ${options.packageId} after ${delay}ms`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        return {
            success: false,
            error: lastError ? lastError.message : `Package ${options.packageId} failed after ${maxRetries + 1} attempts`,
        };
    }

    private async executePackageOnce(options: JobExecutionOptions): Promise<PackageExecutionResult> {
        try {
            const pkg = await this.getPackage(options.packageId, options.packageVersion);
            if (!pkg) {
                return { success: false, error: `Package ${options.packageId} not found` };
            }
            const typeError = this.packageTypeError(pkg, options);
            if (typeError) {
                return { success: false, error: typeError };
            }

            this.logger.log(`Executing package ${pkg.id}@${pkg.version} on standalone runtime`);

            // Use custom executor if registered
            const customExecutor = this.packageExecutors.get(options.packageId);
            if (customExecutor) {
                const output = await this.executeWithTimeout(
                    () => customExecutor(options.input),
                    options.timeout,
                );
                return { success: true, output };
            }

            // Use package loader if provided
            if (this.packageLoader) {
                const loader = await this.packageLoader(options.packageId, options.packageVersion);
                if (loader) {
                    const output = await this.executeWithTimeout(
                        () => loader.execute(options.input),
                        options.timeout,
                    );
                    return { success: true, output };
                }
            }

            // No executor or loader available - package cannot be executed
            return { success: false, error: `Package ${options.packageId} not found` };
        } catch (error) {
            this.logger.error(`Package execution failed: ${error}`);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Create a Job (returns immediately for async execution)
     * In standalone mode, this returns a pseudo job ID
     */
    async createJob(options: JobExecutionOptions): Promise<{ jobId: string }> {
        const jobId = `standalone-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.logger.debug(`Created standalone job: ${jobId}`);
        return { jobId };
    }

    /**
     * Wait for Job to complete
     * In standalone mode, this executes synchronously
     */
    async waitForJob(jobId: string, timeoutMs?: number): Promise<PackageExecutionResult> {
        this.logger.debug(`Waiting for job: ${jobId}`);
        // In standalone mode, jobs are synchronous, so return immediately
        return { success: true, output: { jobId, status: 'completed' } };
    }

    /**
     * Cancel a running Job
     * Not applicable in standalone synchronous mode
     */
    async cancelJob(jobId: string): Promise<void> {
        this.logger.warn(`Cancel requested for job ${jobId}, but not supported in standalone mode`);
    }

    /**
     * Get Package information
     */
    async getPackage(packageId: string, version?: string): Promise<PackageInfo | null> {
        // Check if we have a custom executor registered
        if (this.packageExecutors.has(packageId)) {
            return {
                id: packageId,
                version: version || '1.0.0',
                name: packageId,
                type: this.packageExecutorTypes.get(packageId) ?? this.inferPackageType(packageId),
            };
        }

        // If packageLoader is provided, check with it
        if (this.packageLoader) {
            const loader = await this.packageLoader(packageId, version);
            if (loader) {
                return {
                    id: packageId,
                    version: version || '1.0.0',
                    name: packageId,
                    type: this.inferPackageType(packageId),
                };
            }
        }

        // Return mock package info with inferred type (for getPackage queries)
        return {
            id: packageId,
            version: version || '1.0.0',
            name: packageId,
            type: this.inferPackageType(packageId),
        };
    }

    /**
     * Create a sub-workflow execution
     * In standalone mode, this is a no-op (nested execution happens in-process)
     */
    async createWorkflowExecution(
        packageId: string,
        packageVersion: string | undefined,
        input: Record<string, unknown>,
        parentExecutionId?: string,
    ): Promise<{ executionId: string }> {
        const executionId = `standalone-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.logger.debug(`Created standalone execution: ${executionId}`);
        return { executionId };
    }

    /**
     * Wait for workflow execution to complete
     */
    async waitForWorkflowExecution(
        executionId: string,
        timeoutMs?: number,
    ): Promise<PackageExecutionResult> {
        return { success: true, output: { executionId, status: 'completed' } };
    }

    /**
     * Cancel a workflow execution
     */
    async cancelWorkflowExecution(executionId: string): Promise<void> {
        this.logger.warn(`Cancel requested for execution ${executionId}, not supported in standalone mode`);
    }

    /**
     * Execute with timeout
     */
    private async executeWithTimeout<T>(
        fn: () => Promise<T>,
        timeoutMs?: number,
    ): Promise<T> {
        if (!timeoutMs) {
            return fn();
        }

        return Promise.race([
            fn(),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Execution timeout after ${timeoutMs}ms`)), timeoutMs),
            ),
        ]);
    }

    /**
     * Simulate execution for testing
     */
    private async simulateExecution(timeoutMs?: number): Promise<void> {
        const delay = timeoutMs || 100;
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 1000)));
    }

    private packageTypeError(pkg: PackageInfo, options: JobExecutionOptions): string | undefined {
        if (!options.expectedPackageType || options.expectedPackageType === pkg.type) {
            return undefined;
        }
        return `Package ${pkg.id}:${pkg.version} type mismatch: expected ${options.expectedPackageType}, got ${pkg.type}`;
    }

    private inferPackageType(packageId: string): PackageType {
        if (packageId.startsWith('wf-') || packageId.includes('workflow')) {
            return PackageType.Workflow;
        }
        if (packageId.startsWith('agent-') || packageId.includes('agent')) {
            return PackageType.Agent;
        }
        if (packageId.startsWith('model-') || packageId.includes('model')) {
            return PackageType.Model;
        }
        if (packageId.startsWith('mcp-') || packageId.includes('mcp')) {
            return PackageType.Mcp;
        }
        return PackageType.Tool;
    }
}
