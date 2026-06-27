import { Logger } from '@nestjs/common';
import {
    MaterialDefinition,
    MaterialNodeType,
    PackageType,
    getPackageTypeFromNodeType,
} from '../domain/value-objects';
import { BaseNodeExecutor } from './executors';

/**
 * Material Registry - manages materials and node executor registration
 * Follows Flowgram.ai's extension mechanism for loading node types dynamically
 */
export class MaterialRegistry {
    private readonly logger = new Logger(MaterialRegistry.name);

    /** packageId -> MaterialDefinition */
    private materials: Map<string, MaterialDefinition> = new Map();

    /** nodeType -> MaterialNodeType */
    private nodeTypes: Map<string, MaterialNodeType> = new Map();

    /** executorType -> executor instance factory */
    private executorFactories: Map<string, (nodeType: MaterialNodeType) => BaseNodeExecutor> = new Map();

    /** nodeType -> cached executor instance */
    private executorCache: Map<string, BaseNodeExecutor> = new Map();

    constructor() {
        this.registerBuiltInExecutors();
    }

    /**
     * Register executor factory for an executor type
     */
    registerExecutorFactory(
        executorType: string,
        factory: (nodeType: MaterialNodeType) => BaseNodeExecutor,
    ): void {
        this.executorFactories.set(executorType, factory);
        this.logger.debug(`Registered executor factory: ${executorType}`);
    }

    /**
     * Load a material and its node types
     */
    async loadMaterial(material: MaterialDefinition): Promise<void> {
        const nodeTypes = material.nodeTypes.filter(nodeType => !this.isUnsupportedWorkflowModelNodeType(nodeType));
        const loadedMaterial = nodeTypes.length === material.nodeTypes.length
            ? material
            : { ...material, nodeTypes };

        this.materials.set(material.id, loadedMaterial);

        for (const nodeType of nodeTypes) {
            this.nodeTypes.set(nodeType.type, nodeType);
            this.logger.debug(`Loaded node type: ${nodeType.type} from material: ${material.id}`);
        }

        this.logger.log(`Loaded material: ${material.id} with ${nodeTypes.length} node types`);
    }

    /**
     * Load multiple materials at once
     */
    async loadMaterials(materials: MaterialDefinition[]): Promise<void> {
        for (const material of materials) {
            await this.loadMaterial(material);
        }
    }

    /**
     * Get a material by ID
     */
    getMaterial(packageId: string): MaterialDefinition | undefined {
        return this.materials.get(packageId);
    }

    /**
     * Get all loaded materials
     */
    getAllMaterials(): MaterialDefinition[] {
        return Array.from(this.materials.values());
    }

    /**
     * Get node type definition
     */
    getNodeType(nodeType: string): MaterialNodeType | undefined {
        return this.nodeTypes.get(nodeType);
    }

    /**
     * Check if a node type is registered
     */
    hasNodeType(nodeType: string): boolean {
        return this.nodeTypes.has(nodeType);
    }

    /**
     * Get executor for a node type
     * Creates executor if not cached
     */
    getExecutor(nodeType: string): BaseNodeExecutor | undefined {
        // Check cache first
        if (this.executorCache.has(nodeType)) {
            return this.executorCache.get(nodeType);
        }

        // First check if this is a built-in executor type directly (e.g., 'start', 'end')
        const builtInFactory = this.executorFactories.get(nodeType);
        if (builtInFactory) {
            const executor = builtInFactory({ type: nodeType } as MaterialNodeType);
            this.executorCache.set(nodeType, executor);
            return executor;
        }

        // Then check if it's a material-based node type
        const nodeTypeDef = this.nodeTypes.get(nodeType);
        if (!nodeTypeDef) {
            return undefined;
        }

        const factory = this.executorFactories.get(nodeTypeDef.executorType);
        if (!factory) {
            this.logger.warn(`No executor factory for executor type: ${nodeTypeDef.executorType}`);
            return undefined;
        }

        const executor = factory(nodeTypeDef);
        this.executorCache.set(nodeType, executor);
        return executor;
    }

    /**
     * Get all registered node types
     */
    getRegisteredNodeTypes(): string[] {
        return Array.from(this.nodeTypes.keys());
    }

    /**
     * Get node types by category
     */
    getNodeTypesByCategory(category: string): MaterialNodeType[] {
        return Array.from(this.nodeTypes.values()).filter(
            (nt) => nt.category === category,
        );
    }

    /**
     * Get all node types for a material
     */
    getMaterialNodeTypes(packageId: string): MaterialNodeType[] {
        const material = this.materials.get(packageId);
        return material?.nodeTypes || [];
    }

    /**
     * Clear all materials and cache
     */
    reset(): void {
        this.materials.clear();
        this.nodeTypes.clear();
        this.executorCache.clear();
        this.logger.debug('Material registry reset');
    }

    private isUnsupportedWorkflowModelNodeType(nodeType: MaterialNodeType): boolean {
        const packageType = nodeType.packageType ?? getPackageTypeFromNodeType(nodeType.type);
        return packageType === PackageType.Model
            || nodeType.type === 'package-model'
            || (nodeType.executorType === ExecutorType.Package && nodeType.type === 'model');
    }

    /**
     * Register built-in executor factories
     */
    private registerBuiltInExecutors(): void {
        // Built-in executor types are registered by the engine
        // This method is called during construction
    }
}

/**
 * Built-in executor types
 */
export enum ExecutorType {
    Start = 'start',
    End = 'end',
    Condition = 'condition',
    Loop = 'loop',
    Break = 'break',
    Continue = 'continue',
    BlockStart = 'block-start',
    BlockEnd = 'block-end',
    Package = 'package',
    LLM = 'llm',
    Code = 'code',
    HTTP = 'http',
    QuestionClassifier = 'question-classifier',
    ParameterExtractor = 'parameter-extractor',
    // Data-flow kinds
    Aggregator = 'aggregator',
    Template = 'template',
    Answer = 'answer',
    VariableAssigner = 'variable-assigner',
    ListOperator = 'list-operator',
    Comment = 'comment',
    Group = 'group',
}
