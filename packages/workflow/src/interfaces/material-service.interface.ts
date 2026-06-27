import { MaterialDefinition, MaterialRef } from '../domain/value-objects';

/**
 * Material Service Interface
 * Handles loading and managing materials (node type definitions)
 * Can be implemented differently per runtime environment
 */
export interface IMaterialService {
    /**
     * Load a material package by its reference.
     */
    loadMaterial(ref: MaterialRef): Promise<MaterialDefinition | null>;

    /**
     * Load multiple materials
     */
    loadMaterials(refs: MaterialRef[]): Promise<MaterialDefinition[]>;

    /**
     * Get all available materials
     */
    getAvailableMaterials(): Promise<MaterialDefinition[]>;

    /**
     * Get material package by package ID
     */
    getMaterialById(id: string): Promise<MaterialDefinition | null>;
}
