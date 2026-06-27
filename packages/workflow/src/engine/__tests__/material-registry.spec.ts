import { MaterialRegistry, ExecutorType } from '../material-registry';
import { MaterialDefinition, MaterialNodeType, PackageType } from '../../domain/value-objects';
import { BaseNodeExecutor, NodeExecutorResult } from '../executors/base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode } from '../../domain/value-objects';

describe('MaterialRegistry', () => {
    let registry: MaterialRegistry;

    beforeEach(() => {
        registry = new MaterialRegistry();
    });

    describe('executor factory registration', () => {
        it('should register and retrieve executor factory', () => {
            const mockExecutor = new (class MockExecutor extends BaseNodeExecutor {
                type = 'test';
                async doExecute() {
                    return { outputs: {} };
                }
            })();

            registry.registerExecutorFactory('test', () => mockExecutor);

            const executor = registry.getExecutor('test');
            expect(executor).toBeDefined();
            expect(executor).toBe(mockExecutor);
        });

        it('should cache executor instances', () => {
            const mockExecutor = new (class MockExecutor extends BaseNodeExecutor {
                type = 'test-cached';
                async doExecute() {
                    return { outputs: {} };
                }
            })();

            registry.registerExecutorFactory('test-cached', () => mockExecutor);

            const executor1 = registry.getExecutor('test-cached');
            const executor2 = registry.getExecutor('test-cached');

            expect(executor1).toBe(executor2); // Same instance
        });

        it('should return undefined for unregistered executor type', () => {
            const executor = registry.getExecutor('nonexistent');
            expect(executor).toBeUndefined();
        });
    });

    describe('material loading', () => {
        it('should load material and register its node types', async () => {
            const material: MaterialDefinition = {
                id: 'test-material',
                name: 'Test Material',
                version: '1.0.0',
                nodeTypes: [
                    {
                        type: 'custom-node',
                        label: 'Custom Node',
                        executorType: 'custom-executor',
                        defaultConfig: {},
                    },
                ],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await registry.loadMaterial(material);

            const loadedNodeType = registry.getNodeType('custom-node');
            expect(loadedNodeType).toBeDefined();
            expect(loadedNodeType?.label).toBe('Custom Node');
        });

        it('should skip package model node types', async () => {
            const material: MaterialDefinition = {
                id: 'package-material',
                name: 'Package Material',
                version: '1.0.0',
                nodeTypes: [
                    {
                        type: 'package-tool',
                        label: 'Tool',
                        executorType: ExecutorType.Package,
                        packageType: PackageType.Tool,
                        defaultConfig: {},
                    },
                    {
                        type: 'package-model',
                        label: 'Model',
                        executorType: ExecutorType.Package,
                        packageType: PackageType.Model,
                        defaultConfig: {},
                    },
                ],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await registry.loadMaterial(material);

            expect(registry.getNodeType('package-tool')).toBeDefined();
            expect(registry.getNodeType('package-model')).toBeUndefined();
            expect(registry.getMaterial('package-material')?.nodeTypes.map(nodeType => nodeType.type)).toEqual(['package-tool']);
        });

        it('should retrieve material by ID', async () => {
            const material: MaterialDefinition = {
                id: 'my-material',
                name: 'My Material',
                version: '1.0.0',
                nodeTypes: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await registry.loadMaterial(material);

            const retrieved = registry.getMaterial('my-material');
            expect(retrieved).toBeDefined();
            expect(retrieved?.name).toBe('My Material');
        });

        it('should get all loaded materials', async () => {
            const material1: MaterialDefinition = {
                id: 'material-1',
                name: 'Material 1',
                version: '1.0.0',
                nodeTypes: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const material2: MaterialDefinition = {
                id: 'material-2',
                name: 'Material 2',
                version: '1.0.0',
                nodeTypes: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await registry.loadMaterials([material1, material2]);

            const allMaterials = registry.getAllMaterials();
            expect(allMaterials).toHaveLength(2);
        });
    });

    describe('node type management', () => {
        it('should check if node type is registered', async () => {
            const material: MaterialDefinition = {
                id: 'test-material',
                name: 'Test Material',
                version: '1.0.0',
                nodeTypes: [
                    {
                        type: 'my-node',
                        label: 'My Node',
                        executorType: 'my-executor',
                        defaultConfig: {},
                    },
                ],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await registry.loadMaterial(material);

            expect(registry.hasNodeType('my-node')).toBe(true);
            expect(registry.hasNodeType('nonexistent')).toBe(false);
        });

        it('should get registered node types', async () => {
            const material: MaterialDefinition = {
                id: 'test-material',
                name: 'Test Material',
                version: '1.0.0',
                nodeTypes: [
                    { type: 'node-1', label: 'Node 1', executorType: 'exec-1', defaultConfig: {} },
                    { type: 'node-2', label: 'Node 2', executorType: 'exec-2', defaultConfig: {} },
                ],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await registry.loadMaterial(material);

            const nodeTypes = registry.getRegisteredNodeTypes();
            expect(nodeTypes).toContain('node-1');
            expect(nodeTypes).toContain('node-2');
        });
    });

    describe('reset', () => {
        it('should clear all materials and cache', async () => {
            const material: MaterialDefinition = {
                id: 'test-material',
                name: 'Test Material',
                version: '1.0.0',
                nodeTypes: [
                    { type: 'my-node', label: 'My Node', executorType: 'my-executor', defaultConfig: {} },
                ],
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            await registry.loadMaterial(material);
            registry.getExecutor('test'); // This would cache something if registered

            registry.reset();

            expect(registry.getAllMaterials()).toHaveLength(0);
            expect(registry.getRegisteredNodeTypes()).toHaveLength(0);
            expect(registry.getMaterial('test-material')).toBeUndefined();
        });
    });
});
