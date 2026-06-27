import { Injectable, Logger } from '@nestjs/common';
import { IMaterialService } from '../interfaces';
import {
    MaterialDefinition,
    MaterialNodeType,
    MaterialRef,
    PackageType,
    buildPackageNodeType,
    materialRefPackageId,
} from '../domain/value-objects';

export const BUILT_IN_PACKAGE_MATERIAL_ID = 'packages';

/**
 * Default Material Service Implementation
 * Loads materials from a static registry (for testing or simple scenarios)
 * Runtime-specific implementations should extend this or implement IMaterialService
 */
@Injectable()
export class MaterialService implements IMaterialService {
    private readonly logger = new Logger(MaterialService.name);
    private materials: Map<string, MaterialDefinition> = new Map();

    constructor() {
        this.registerBuiltInMaterials();
    }

    /**
     * Register built-in materials for package node types
     */
    private registerBuiltInMaterials(): void {
        const packageMaterial: MaterialDefinition = {
            id: BUILT_IN_PACKAGE_MATERIAL_ID,
            name: 'Package Nodes',
            description: 'Built-in package node types for executing agents, tools, MCP servers, and workflows.',
            version: '1.0.0',
            nodeTypes: [
                {
                    type: buildPackageNodeType(PackageType.Agent),
                    label: '智能体',
                    description: 'Execute an Agent package',
                    executorType: 'package',
                    packageType: PackageType.Agent,
                    defaultConfig: {},
                    category: 'execution',
                    inputPorts: [{ name: 'input', label: 'Input', type: 'any', required: true }],
                    outputPorts: [{ name: 'output', label: 'Output', type: 'any' }],
                },
                {
                    type: buildPackageNodeType(PackageType.Tool),
                    label: '工具',
                    description: 'Execute a Tool package',
                    executorType: 'package',
                    packageType: PackageType.Tool,
                    defaultConfig: {},
                    category: 'execution',
                    inputPorts: [{ name: 'input', label: 'Input', type: 'any', required: true }],
                    outputPorts: [{ name: 'output', label: 'Output', type: 'any' }],
                },
                {
                    type: buildPackageNodeType(PackageType.Mcp),
                    label: 'MCP',
                    description: 'Execute an MCP package',
                    executorType: 'package',
                    packageType: PackageType.Mcp,
                    defaultConfig: {},
                    category: 'execution',
                    inputPorts: [{ name: 'input', label: 'Input', type: 'any', required: true }],
                    outputPorts: [{ name: 'output', label: 'Output', type: 'any' }],
                },
            ],
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        this.materials.set(packageMaterial.id, packageMaterial);
        this.logger.log(`Registered built-in material: ${packageMaterial.id} with ${packageMaterial.nodeTypes.length} node types`);
    }

    async loadMaterial(ref: MaterialRef): Promise<MaterialDefinition | null> {
        const packageId = materialRefPackageId(ref);
        return packageId ? this.materials.get(packageId) || null : null;
    }

    async loadMaterials(refs: MaterialRef[]): Promise<MaterialDefinition[]> {
        const results: MaterialDefinition[] = [];
        for (const ref of refs) {
            const material = await this.loadMaterial(ref);
            if (material) {
                results.push(material);
            }
        }
        return results;
    }

    async getAvailableMaterials(): Promise<MaterialDefinition[]> {
        return Array.from(this.materials.values());
    }

    async getMaterialById(id: string): Promise<MaterialDefinition | null> {
        return this.materials.get(id) || null;
    }

    /**
     * Register a custom material (for runtime-specific extensions)
     */
    registerMaterial(material: MaterialDefinition): void {
        this.materials.set(material.id, material);
        this.logger.log(`Registered custom material: ${material.id}`);
    }
}
