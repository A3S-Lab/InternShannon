/**
 * Workflow Runtime JS - Single Machine JavaScript Runtime
 *
 * Handles workflow execution in a single process.
 * For environments without external orchestrator or OS backend services.
 */

import { Logger } from '@nestjs/common';
import {
  WorkflowDefinition,
  WorkflowExecution,
  ExecutionStatus,
} from './domain/entities';
import {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
  isPackageNodeType,
  workflowNodeMaterialPackageId,
} from './domain/value-objects';
import { ExecutionContext } from './engine/execution-context';
import { BaseNodeExecutor, NodeExecutorResult } from './engine/executors/base.executor';
import {
  StartNodeExecutor,
  EndNodeExecutor,
  ConditionNodeExecutor,
  LoopNodeExecutor,
  BlockStartNodeExecutor,
  BlockEndNodeExecutor,
  BreakNodeExecutor,
  ContinueNodeExecutor,
  HTTPNodeExecutor,
  CodeNodeExecutor,
  LLMNodeExecutor,
  QuestionClassifierNodeExecutor,
  ParameterExtractorNodeExecutor,
} from './engine/executors';
import { PackageNodeExecutor, createPackageExecutor } from './engine/executors/package.executor';
import { LLMCredentialResolver } from './engine/executors/llm-credential-resolver';
import { MaterialRegistry, ExecutorType } from './engine/material-registry';
import { BUILT_IN_PACKAGE_MATERIAL_ID, MaterialService } from './engine/material.service';
import { IWorkflowRepository, IWorkflowRuntime } from './interfaces';

/**
 * Package executor function type for JS runtime
 */
export type PackageExecutorFn = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Workflow Runtime JS - Single machine workflow execution engine
 */
export class WorkflowRuntimeJS {
  private readonly logger = new Logger(WorkflowRuntimeJS.name);
  private readonly materialRegistry: MaterialRegistry;
  private readonly materialService: MaterialService;
  private readonly repository: IWorkflowRepository;
  private readonly llmCredentialResolver?: LLMCredentialResolver;
  private readonly packageExecutors: Map<string, PackageExecutorFn> = new Map();

  constructor(repository: IWorkflowRepository, llmCredentialResolver?: LLMCredentialResolver) {
    this.repository = repository;
    this.materialRegistry = new MaterialRegistry();
    this.materialService = new MaterialService();
    this.llmCredentialResolver = llmCredentialResolver;
    this.registerBuiltInExecutors();
  }

  /**
   * Register built-in node executors
   */
  private registerBuiltInExecutors(): void {
    // Control flow executors
    this.materialRegistry.registerExecutorFactory(ExecutorType.Start, () => new StartNodeExecutor());
    this.materialRegistry.registerExecutorFactory(ExecutorType.End, () => new EndNodeExecutor());
    this.materialRegistry.registerExecutorFactory(ExecutorType.Condition, () => new ConditionNodeExecutor());
    this.materialRegistry.registerExecutorFactory(ExecutorType.Loop, () => new LoopNodeExecutor());

    // Block executors
    this.materialRegistry.registerExecutorFactory(ExecutorType.BlockStart, () => new BlockStartNodeExecutor());
    this.materialRegistry.registerExecutorFactory(ExecutorType.BlockEnd, () => new BlockEndNodeExecutor());

    // Loop control executors
    this.materialRegistry.registerExecutorFactory(ExecutorType.Break, () => new BreakNodeExecutor());
    this.materialRegistry.registerExecutorFactory(ExecutorType.Continue, () => new ContinueNodeExecutor());

    // Execution executors
    this.materialRegistry.registerExecutorFactory(ExecutorType.LLM, () => new LLMNodeExecutor(this.llmCredentialResolver));
    this.materialRegistry.registerExecutorFactory(ExecutorType.HTTP, () => new HTTPNodeExecutor());
    this.materialRegistry.registerExecutorFactory(ExecutorType.Code, () => new CodeNodeExecutor());
    this.materialRegistry.registerExecutorFactory(ExecutorType.QuestionClassifier, () => new QuestionClassifierNodeExecutor(this.llmCredentialResolver));
    this.materialRegistry.registerExecutorFactory(ExecutorType.ParameterExtractor, () => new ParameterExtractorNodeExecutor(this.llmCredentialResolver));

    // Package executor factory - handles all package-* node types
    this.materialRegistry.registerExecutorFactory(ExecutorType.Package, createPackageExecutor);

    this.logger.debug('Registered built-in executor factories');
  }

  /**
   * Register a package executor function
   */
  registerPackageExecutor(packageId: string, executor: PackageExecutorFn): void {
    this.packageExecutors.set(packageId, executor);
    this.logger.debug(`Registered package executor: ${packageId}`);
  }

  /**
   * Get registered package executor
   */
  getPackageExecutor(packageId: string): PackageExecutorFn | undefined {
    return this.packageExecutors.get(packageId);
  }

  /**
   * Load workflow definition and its materials
   */
  async loadWorkflow(definitionId: string): Promise<WorkflowDefinition | null> {
    const definition = await this.repository.findDefinitionById(definitionId);
    if (!definition) {
      return null;
    }

    await this.loadMaterials(definition);
    return definition;
  }

  /**
   * Load materials required by a workflow
   */
  private async loadMaterials(definition: WorkflowDefinition): Promise<void> {
    const materialPackageIds = new Set<string>();

    for (const node of definition.graph.nodes) {
      const packageId = workflowNodeMaterialPackageId(node);
      if (packageId) {
        materialPackageIds.add(packageId);
      }
      if (isPackageNodeType(node.type)) {
        materialPackageIds.add(BUILT_IN_PACKAGE_MATERIAL_ID);
      }
    }

    for (const packageId of materialPackageIds) {
      const material = await this.materialService.getMaterialById(packageId);
      if (material) {
        await this.materialRegistry.loadMaterial(material);
      }
    }

    this.logger.debug(`Loaded ${materialPackageIds.size} materials for workflow: ${definition.id}`);
  }

  /**
   * Execute a workflow
   */
  async execute(
    definitionId: string,
    input: Record<string, unknown>,
    parentExecutionId?: string,
  ): Promise<WorkflowExecution> {
    const definition = await this.loadWorkflow(definitionId);
    if (!definition) {
      throw new Error(`Workflow definition ${definitionId} not found`);
    }

    const execution: WorkflowExecution = {
      id: this.generateId(),
      workflowDefinitionId: definitionId,
      version: definition.version,
      input,
      status: ExecutionStatus.Pending,
      currentNodeIds: [],
      executedNodeIds: [],
      failedNodeIds: [],
      variables: { ...input },
      nodeOutputs: {},
      parentExecutionId,
      rootExecutionId: parentExecutionId,
      createdAt: new Date(),
    };
    await this.repository.saveExecution(execution);

    try {
      await this.runExecution(execution, definition);
    } catch (error) {
      execution.status = ExecutionStatus.Failed;
      execution.error = error instanceof Error ? error.message : String(error);
      await this.repository.updateExecutionStatus(execution.id, {
        status: ExecutionStatus.Failed,
        error: execution.error,
      });
    }

    return execution;
  }

  /**
   * Run the actual workflow execution
   */
  private async runExecution(
    execution: WorkflowExecution,
    definition: WorkflowDefinition,
  ): Promise<void> {
    const nodeMap = new Map<string, WorkflowNode>();
    const edgeMap = new Map<string, WorkflowEdge[]>();

    for (const node of definition.graph.nodes) {
      nodeMap.set(node.id, node);
      edgeMap.set(node.id, []);
    }
    for (const edge of definition.graph.edges) {
      // Store edges by targetNodeId (incoming edges to a node)
      const edges = edgeMap.get(edge.targetNodeId) || [];
      edges.push(edge);
      edgeMap.set(edge.targetNodeId, edges);
    }

    // Create context with null runtime (JS runtime uses direct execution)
    const context = new ExecutionContext(
      execution,
      definition,
      null as unknown as IWorkflowRuntime,
      nodeMap,
      edgeMap,
    );

    // Set up package executors in context for PackageNodeExecutor to use
    context.setPackageExecutors(this.packageExecutors);

    const startNode = definition.graph.nodes.find((n) => n.type === WorkflowNodeType.Start);
    if (!startNode) {
      throw new Error('Workflow has no start node');
    }

    execution.status = ExecutionStatus.Running;
    execution.startedAt = new Date();
    await this.repository.updateExecutionStatus(execution.id, {
      status: ExecutionStatus.Running,
      startedAt: execution.startedAt,
    });

    await this.executeNode(context, startNode);

    const endNode = definition.graph.nodes.find((n) => n.type === WorkflowNodeType.End);
    if (endNode && context.isNodeExecuted(endNode.id)) {
      const output = context.getNodeOutputs(endNode.id);
      execution.output = output;
      execution.status = ExecutionStatus.Succeeded;
      execution.completedAt = new Date();
      await this.repository.updateExecutionStatus(execution.id, {
        status: ExecutionStatus.Succeeded,
        output,
        completedAt: execution.completedAt,
      });
    } else if (context.failedNodes.size > 0) {
      execution.status = ExecutionStatus.Failed;
      execution.completedAt = new Date();
      await this.repository.updateExecutionStatus(execution.id, {
        status: ExecutionStatus.Failed,
        completedAt: execution.completedAt,
      });
    }
  }

  /**
   * Execute a single node
   */
  private async executeNode(context: ExecutionContext, node: WorkflowNode): Promise<void> {
    if (context.isNodeExecuted(node.id)) {
      return;
    }

    if (!context.allPredecessorsExecuted(node.id)) {
      return;
    }

    const executor = this.materialRegistry.getExecutor(node.type);
    if (!executor) {
      throw new Error(`No executor for node type: ${node.type}`);
    }

    context.markNodePending(node.id);

    try {
      const result = await executor.execute(context, node);
      context.markNodeExecuted(node.id);
      await this.processNextNodes(context, node, result);
    } catch (error) {
      context.markNodeFailed(node.id);
      throw error;
    }
  }

  /**
   * Process next nodes after current node execution
   */
  private async processNextNodes(
    context: ExecutionContext,
    node: WorkflowNode,
    result: NodeExecutorResult,
  ): Promise<void> {
    if (result.branch) {
      const targetNode = context.getSuccessors(node.id).find((n) => n.id === result.branch);
      if (targetNode) {
        await this.executeNode(context, targetNode);
      }
      return;
    }

    const successors = context.getSuccessors(node.id);
    for (const successor of successors) {
      await this.executeNode(context, successor);
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}
