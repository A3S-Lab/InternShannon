/**
 * Material Definition - Flowgram.ai extension mechanism
 * Materials define custom node types that can be loaded dynamically
 */

/**
 * Package type enum for package-type nodes
 */
export enum PackageType {
    Agent = 'agent',
    Tool = 'tool',
    Model = 'model',
    Mcp = 'mcp',
    Workflow = 'workflow',
}

/**
 * Material Definition
 * Represents a loaded material that provides node type definitions
 */
export interface MaterialDefinition {
    id: string;
    name: string;
    description?: string;
    version: string;
    nodeTypes: MaterialNodeType[];
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Material Node Type
 * Defines a node type provided by a material
 */
export interface MaterialNodeType {
    /** Node type identifier (e.g., 'package-agent', 'custom-node') */
    type: string;
    /** Display label */
    label: string;
    /** Description of this node type */
    description?: string;
    /** Executor type that handles this node type */
    executorType: string;
    /** Package type if this is a package-type node */
    packageType?: PackageType;
    /** Default configuration for nodes of this type */
    defaultConfig: Record<string, unknown>;
    /** Icon identifier */
    icon?: string;
    /** Category for grouping in UI */
    category?: string;
    /** Input ports configuration */
    inputPorts?: PortDefinition[];
    /** Output ports configuration */
    outputPorts?: PortDefinition[];
}

/**
 * Port definition for node inputs/outputs
 */
export interface PortDefinition {
    name: string;
    label: string;
    type: 'any' | 'string' | 'number' | 'boolean' | 'object' | 'array';
    required?: boolean;
    defaultValue?: unknown;
}

/**
 * Material Reference in workflow
 */
export interface MaterialRef {
    packageId: string;
    version?: string;
}

export const materialRefPackageId = (ref: MaterialRef): string | undefined => {
    return ref.packageId.trim() ? ref.packageId.trim() : undefined;
};

export const PACKAGE_NODE_PREFIX = 'package-';

/**
 * Check if a node type is a package type
 */
export const isPackageNodeType = (type: string): boolean => {
    return type.startsWith(PACKAGE_NODE_PREFIX);
};

/**
 * Get package type from node type
 */
export const getPackageTypeFromNodeType = (nodeType: string): PackageType | undefined => {
    if (!isPackageNodeType(nodeType)) {
        return undefined;
    }
    const pkgType = nodeType.replace(PACKAGE_NODE_PREFIX, '');
    return pkgType as PackageType;
};

/**
 * Build node type from package type
 */
export const buildPackageNodeType = (packageType: PackageType): string => {
    return `${PACKAGE_NODE_PREFIX}${packageType}`;
};
