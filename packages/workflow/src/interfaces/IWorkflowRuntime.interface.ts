import type { PackageType } from '../domain/value-objects';

/**
 * Package Execution Result
 */
export interface PackageExecutionResult {
    success: boolean;
    output?: Record<string, unknown>;
    error?: string;
    jobId?: string;
    executionId?: string;  // For workflow type packages
}

/**
 * Job Execution Options
 */
export interface JobExecutionOptions {
    packageId: string;
    packageVersion?: string;
    expectedPackageType?: PackageType;
    input: Record<string, unknown>;
    timeout?: number;
    retryPolicy?: {
        maxRetries: number;
        retryDelay?: number;
    };
    metadata?: Record<string, unknown>;
}

/**
 * Package Info
 */
export interface PackageInfo {
    id: string;
    version: string;
    name: string;
    type: PackageType;
    metadata?: Record<string, unknown>;
}

/**
 * IWorkflowRuntime - Abstraction for workflow execution backend
 *
 * This interface allows the workflow engine to run on different backends:
 * - OsRuntime: Uses Job/Deployment from the OS backend
 * - StandaloneRuntime: Direct execution for testing/simple scenarios
 * - InternShannonRuntime: Custom execution for InternShannon standalone app
 */
export interface IWorkflowRuntime {
    /**
     * Execute a Package and wait for result
     * - For agent/tool/mcp types: creates a Job and waits
     * - For workflow type: creates a sub WorkflowExecution and waits
     */
    executePackage(options: JobExecutionOptions): Promise<PackageExecutionResult>;

    /**
     * Create a Job for async execution (returns immediately)
     * Only for job-backed package types: agent/tool/mcp
     */
    createJob(options: JobExecutionOptions): Promise<{ jobId: string }>;

    /**
     * Wait for a Job to complete
     */
    waitForJob(jobId: string, timeoutMs?: number): Promise<PackageExecutionResult>;

    /**
     * Cancel a running Job
     */
    cancelJob(jobId: string): Promise<void>;

    /**
     * Get Package information
     */
    getPackage(packageId: string, version?: string): Promise<PackageInfo | null>;

    /**
     * Create a sub-workflow execution (for workflow type packages)
     */
    createWorkflowExecution(
        packageId: string,
        packageVersion: string | undefined,
        input: Record<string, unknown>,
        parentExecutionId?: string,
    ): Promise<{ executionId: string }>;

    /**
     * Wait for a workflow execution to complete
     */
    waitForWorkflowExecution(
        executionId: string,
        timeoutMs?: number,
    ): Promise<PackageExecutionResult>;

    /**
     * Cancel a workflow execution
     */
    cancelWorkflowExecution(executionId: string): Promise<void>;
}
