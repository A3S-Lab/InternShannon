import { Logger } from '@nestjs/common';
import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode } from '../../domain/value-objects';
import { MaterialNodeType, PackageType } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';

const PACKAGE_NODE_INTERNAL_DATA_KEYS = new Set([
    'inputsValues',
    'configMappings',
    'outputMappings',
    'conditions',
    'packageId',
    'packageVersion',
    'packageType',
    'expectedPackageType',
    'timeout',
    'retryPolicy',
    'inputsFromEdges',
    'inputs',
    'outputs',
    'assignment',
    'definitionType',
    'registryKind',
    'registryNodeId',
    'registrySourceId',
    'configSchema',
]);

/**
 * Package Node Executor
 * Handles package-* type nodes loaded via Material extension mechanism
 * The node type and package type are defined in the MaterialNodeType definition
 */
export class PackageNodeExecutor extends BaseNodeExecutor {
    private readonly logger = new Logger(PackageNodeExecutor.name);
    readonly type: string;
    readonly packageType: PackageType;

    constructor(nodeTypeDef: MaterialNodeType) {
        super();
        if (!nodeTypeDef.packageType) {
            throw new Error(`PackageNodeExecutor requires a MaterialNodeType with packageType`);
        }
        if (nodeTypeDef.packageType === PackageType.Model) {
            throw new Error('Package model nodes are not supported in workflows; use the built-in llm node instead.');
        }
        this.type = nodeTypeDef.type;
        this.packageType = nodeTypeDef.packageType;
    }

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        _cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = node.data as Record<string, unknown>;

        const packageId = typeof data.packageId === 'string' ? data.packageId.trim() : '';
        if (!packageId) {
            throw new Error(`自定义/Package 节点 ${node.id} 必须包含 packageId`);
        }

        const packageVersion = typeof data.packageVersion === 'string' ? data.packageVersion.trim() : '';
        if (!packageVersion) {
            throw new Error(`自定义/Package 节点 ${node.id} 必须包含 packageVersion`);
        }

        // Use context variables as implicit inputs only while edge-derived
        // inputs are enabled. With inputsFromEdges=false, an empty binding
        // set means the package receives an empty business input object.
        const inputsFromEdges = data.inputsFromEdges !== false;
        const resolvedInputs = Object.keys(inputs).length > 0
            ? inputs
            : inputsFromEdges
                ? context.getAllVariables()
                : {};
        const packageInput = {
            ...resolvedInputs,
            nodeConfig: this.nodeConfig(data),
            workflowContext: {
                variables: context.getAllVariables(),
                nodeOutputs: context.toSnapshot().nodeOutputs,
            },
        };

        this.logger.debug(
            `Executing package node ${node.id}: ${packageId}@${packageVersion} (type: ${this.packageType})`,
        );

        // Check if there's a registered package executor (for JS runtime)
        const packageExecutor = context.getPackageExecutor?.(packageId);
        if (packageExecutor) {
            const outputs = await packageExecutor(packageInput);
            return { outputs };
        }

        // Fall back to runtime execution if available
        if (context.runtime) {
            const result = await context.runtime.executePackage({
                packageId,
                packageVersion,
                expectedPackageType: this.packageType,
                input: packageInput,
                timeout: data.timeout as number | undefined,
                retryPolicy: data.retryPolicy as { maxRetries: number; retryDelay?: number } | undefined,
                metadata: {
                    nodeId: node.id,
                    nodeType: this.type,
                    packageType: this.packageType,
                    executionId: context.execution.id,
                },
            });

            if (!result.success) {
                throw new Error(`Package 节点 ${node.id} 执行失败：${result.error ?? '未知错误'}`);
            }

            return { outputs: result.output || {} };
        }

        throw new Error(`自定义/Package 节点 ${node.id} 未找到可执行器：${packageId}`);
    }

    private nodeConfig(data: Record<string, unknown>): Record<string, unknown> {
        return Object.fromEntries(Object.entries(data).filter(([key]) => !PACKAGE_NODE_INTERNAL_DATA_KEYS.has(key)));
    }
}

/**
 * Factory to create PackageNodeExecutor from MaterialNodeType
 */
export const createPackageExecutor = (nodeTypeDef: MaterialNodeType): PackageNodeExecutor => {
    if (!nodeTypeDef.packageType) {
        throw new Error(`Cannot create PackageExecutor for node type without packageType: ${nodeTypeDef.type}`);
    }
    return new PackageNodeExecutor(nodeTypeDef);
};
