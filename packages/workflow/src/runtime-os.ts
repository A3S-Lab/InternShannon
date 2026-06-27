/**
 * Workflow Runtime OS - Operating System Backend Runtime
 *
 * Handles workflow execution via OS-level Job/CronJob services.
 * Used when running workflows on the OS backend with external orchestrator-like abstractions.
 */

import { Logger } from '@nestjs/common';
import {
  IWorkflowRuntime,
  JobExecutionOptions,
  PackageExecutionResult,
  PackageInfo,
} from './interfaces';
import { PackageType } from './domain/value-objects';

/**
 * Job Service interface for OS Runtime
 */
export interface IJobService {
  createJob(options: JobExecutionOptions): Promise<string>;
  waitForJob(jobId: string, timeoutMs?: number): Promise<PackageExecutionResult>;
  cancelJob(jobId: string): Promise<void>;
}

/**
 * Workflow Execution Service interface for nested workflows
 */
export interface IWorkflowExecutionService {
  createExecution(
    packageId: string,
    packageVersion: string | undefined,
    input: Record<string, unknown>,
    parentExecutionId?: string,
  ): Promise<string>;
  waitForExecution(
    executionId: string,
    timeoutMs?: number,
  ): Promise<PackageExecutionResult>;
  cancelExecution(executionId: string): Promise<void>;
}

/**
 * Package Service interface
 */
export interface IPackageService {
  getPackage(packageId: string, version?: string): Promise<PackageInfo | null>;
}

/**
 * Workflow Runtime OS - OS backend implementation of IWorkflowRuntime
 */
export class WorkflowRuntimeOS implements IWorkflowRuntime {
  private readonly logger = new Logger(WorkflowRuntimeOS.name);

  constructor(
    private readonly jobService?: IJobService,
    private readonly workflowExecutionService?: IWorkflowExecutionService,
    private readonly packageService?: IPackageService,
  ) {}

  /**
   * Execute a Package and wait for result
   */
  async executePackage(options: JobExecutionOptions): Promise<PackageExecutionResult> {
    try {
      this.logger.log(
        `Executing package ${options.packageId}:${options.packageVersion || 'latest'}`,
      );

      const pkg = await this.getPackage(options.packageId, options.packageVersion);
      if (!pkg) {
        return { success: false, error: `Package ${options.packageId} not found` };
      }
      const typeError = this.packageTypeError(pkg, options);
      if (typeError) {
        return { success: false, error: typeError };
      }
      const resolvedOptions = this.resolvedPackageOptions(options, pkg);

      if (pkg.type === PackageType.Workflow) {
        return this.executeWorkflowPackage(resolvedOptions);
      } else {
        return this.executeJobPackage(resolvedOptions);
      }
    } catch (error) {
      this.logger.error(`Package execution failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute a job-based package (agent, tool, mcp)
   */
  private async executeJobPackage(options: JobExecutionOptions): Promise<PackageExecutionResult> {
    if (this.jobService) {
      const jobId = await this.jobService.createJob(options);
      return this.jobService.waitForJob(jobId, options.timeout ? options.timeout * 1000 : undefined);
    }

    await this.simulateExecution(options.timeout);
    return {
      success: true,
      output: {
        result: `Executed ${options.packageId} via OS Job`,
        timestamp: new Date().toISOString(),
      },
      jobId: `mock-job-${Date.now()}`,
    };
  }

  /**
   * Execute a workflow package (nested workflow)
   */
  private async executeWorkflowPackage(
    options: JobExecutionOptions,
  ): Promise<PackageExecutionResult> {
    if (this.workflowExecutionService) {
      const executionId = await this.workflowExecutionService.createExecution(
        options.packageId,
        options.packageVersion,
        options.input,
        options.metadata?.parentExecutionId as string | undefined,
      );
      return this.workflowExecutionService.waitForExecution(
        executionId,
        options.timeout ? options.timeout * 1000 : undefined,
      );
    }

    await this.simulateExecution(options.timeout);
    return {
      success: true,
      output: {
        result: `Executed workflow ${options.packageId}`,
        timestamp: new Date().toISOString(),
      },
      executionId: `mock-exec-${Date.now()}`,
    };
  }

  /**
   * Create a Job for async execution
   */
  async createJob(options: JobExecutionOptions): Promise<{ jobId: string }> {
    if (this.jobService) {
      const jobId = await this.jobService.createJob(options);
      return { jobId };
    }

    const jobId = `os-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.debug(`Created mock job: ${jobId}`);
    return { jobId };
  }

  /**
   * Wait for Job to complete
   */
  async waitForJob(jobId: string, timeoutMs?: number): Promise<PackageExecutionResult> {
    if (this.jobService) {
      return this.jobService.waitForJob(jobId, timeoutMs);
    }

    await this.simulateExecution(timeoutMs);
    return {
      success: true,
      output: { jobId, status: 'completed' },
      jobId,
    };
  }

  /**
   * Cancel a running Job
   */
  async cancelJob(jobId: string): Promise<void> {
    if (this.jobService) {
      await this.jobService.cancelJob(jobId);
      return;
    }

    this.logger.debug(`Mock cancel job: ${jobId}`);
  }

  /**
   * Get Package information
   */
  async getPackage(packageId: string, version?: string): Promise<PackageInfo | null> {
    if (this.packageService) {
      return this.packageService.getPackage(packageId, version);
    }

    return {
      id: packageId,
      version: version || '1.0.0',
      name: packageId,
      type: this.inferPackageType(packageId),
    };
  }

  /**
   * Infer package type from package ID
   */
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

  private resolvedPackageOptions(options: JobExecutionOptions, pkg: PackageInfo): JobExecutionOptions {
    return {
      ...options,
      packageId: pkg.id,
      packageVersion: pkg.version,
      metadata: {
        ...(options.metadata ?? {}),
        runtimePackageId: pkg.id,
        runtimePackageVersion: pkg.version,
        runtimePackageType: pkg.type,
      },
    };
  }

  private packageTypeError(pkg: PackageInfo, options: JobExecutionOptions): string | undefined {
    if (!options.expectedPackageType || options.expectedPackageType === pkg.type) {
      return undefined;
    }
    return `Package ${pkg.id}:${pkg.version} type mismatch: expected ${options.expectedPackageType}, got ${pkg.type}`;
  }

  /**
   * Create a sub-workflow execution
   */
  async createWorkflowExecution(
    packageId: string,
    packageVersion: string | undefined,
    input: Record<string, unknown>,
    parentExecutionId?: string,
  ): Promise<{ executionId: string }> {
    if (this.workflowExecutionService) {
      const executionId = await this.workflowExecutionService.createExecution(
        packageId,
        packageVersion,
        input,
        parentExecutionId,
      );
      return { executionId };
    }

    const executionId = `os-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.debug(`Created mock execution: ${executionId}`);
    return { executionId };
  }

  /**
   * Wait for workflow execution to complete
   */
  async waitForWorkflowExecution(
    executionId: string,
    timeoutMs?: number,
  ): Promise<PackageExecutionResult> {
    if (this.workflowExecutionService) {
      return this.workflowExecutionService.waitForExecution(executionId, timeoutMs);
    }

    await this.simulateExecution(timeoutMs);
    return {
      success: true,
      output: { executionId, status: 'completed' },
      executionId,
    };
  }

  /**
   * Cancel a workflow execution
   */
  async cancelWorkflowExecution(executionId: string): Promise<void> {
    if (this.workflowExecutionService) {
      await this.workflowExecutionService.cancelExecution(executionId);
      return;
    }

    this.logger.debug(`Mock cancel execution: ${executionId}`);
  }

  /**
   * Simulate execution for testing
   */
  private async simulateExecution(timeoutMs?: number): Promise<void> {
    const delay = Math.min(timeoutMs || 100, 1000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
