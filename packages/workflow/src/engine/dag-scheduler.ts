/**
 * DAG Scheduler for Parallel Node Execution
 * Implements true parallel execution of independent nodes
 */

import { WorkflowNode, WorkflowEdge } from '../domain/value-objects';

export interface NodeDependency {
    nodeId: string;
    predecessors: string[];
    level: number;
}

export class DagScheduler {
    /**
     * Build execution levels for parallel scheduling
     * Nodes at the same level have no dependencies and can execute in parallel
     */
    buildExecutionPlan(
        nodes: WorkflowNode[],
        edges: WorkflowEdge[],
        startNodeId: string,
    ): NodeDependency[][] {
        const nodeMap = new Map<string, WorkflowNode>();
        const adjacencyList = new Map<string, string[]>();
        const inDegree = new Map<string, number>();

        // Build maps
        for (const node of nodes) {
            nodeMap.set(node.id, node);
            adjacencyList.set(node.id, []);
            inDegree.set(node.id, 0);
        }

        // Build adjacency list and calculate in-degrees
        for (const edge of edges) {
            const adjs = adjacencyList.get(edge.sourceNodeId) || [];
            adjs.push(edge.targetNodeId);
            adjacencyList.set(edge.sourceNodeId, adjs);
            inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) || 0) + 1);
        }

        // Topological sort with level assignment
        const levels: NodeDependency[][] = [];
        const visited = new Set<string>();

        // Start with nodes that have in-degree 0 (start nodes or independent nodes)
        let currentLevel = 0;
        let frontier: string[] = [startNodeId];

        while (frontier.length > 0) {
            const nextFrontier: string[] = [];
            const levelNodes: NodeDependency[] = [];

            for (const nodeId of frontier) {
                if (visited.has(nodeId)) continue;
                visited.add(nodeId);

                const predecessors: string[] = [];
                for (const edge of edges) {
                    if (edge.targetNodeId === nodeId) {
                        predecessors.push(edge.sourceNodeId);
                    }
                }

                levelNodes.push({
                    nodeId,
                    predecessors,
                    level: currentLevel,
                });

                // Add successors to next frontier
                const successors = adjacencyList.get(nodeId) || [];
                for (const succId of successors) {
                    if (!visited.has(succId)) {
                        const newInDegree = (inDegree.get(succId) || 0) - 1;
                        inDegree.set(succId, newInDegree);
                        if (newInDegree <= 0) {
                            nextFrontier.push(succId);
                        }
                    }
                }
            }

            if (levelNodes.length > 0) {
                levels.push(levelNodes);
            }

            frontier = nextFrontier;
            currentLevel++;
        }

        return levels;
    }

    /**
     * Check if a node's predecessors are all executed
     */
    arePredecessorsExecuted(
        nodeId: string,
        edges: WorkflowEdge[],
        executedNodes: Set<string>,
    ): boolean {
        for (const edge of edges) {
            if (edge.targetNodeId === nodeId && !executedNodes.has(edge.sourceNodeId)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Get all immediate predecessors of a node
     */
    getPredecessors(nodeId: string, edges: WorkflowEdge[]): string[] {
        return edges.filter((e) => e.targetNodeId === nodeId).map((e) => e.sourceNodeId);
    }

    /**
     * Get all immediate successors of a node
     */
    getSuccessors(nodeId: string, edges: WorkflowEdge[]): string[] {
        return edges.filter((e) => e.sourceNodeId === nodeId).map((e) => e.targetNodeId);
    }
}

// Export singleton
export const dagScheduler = new DagScheduler();
