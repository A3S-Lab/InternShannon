/**
 * Performance / execution harness for the optimized core engine.
 *
 * Drives the REAL WorkflowEngine (this package's src) with a latency-simulating
 * runtime + a call-counting repository + a peak-concurrency tracker, over four
 * graph shapes:
 *   S1  built-in compliance pipeline model (sequential agent chain)
 *   S2  wide parallel fan-out + join (exercises the bounded-concurrency cap + join-once)
 *   S3  mid-pipeline crash-resume (exercises frontier resume vs full replay)
 *
 * Package/agent nodes really run on external orchestrator ephemeral pods; here each "agent" node
 * is a sim executor with a fixed delay so engine scheduling (the part the
 * optimizations changed) is what's measured — not a faked external orchestrator layer. Wall-clock
 * is logged as informational; assertions are on the deterministic structural
 * metrics (peak concurrency, join-exec count, re-executed node count, DB writes).
 */
import { WorkflowEngine } from '../workflow-engine';
import { InMemoryWorkflowRepository } from '../../infrastructure/in-memory-repository';
import { StandaloneRuntime } from '../standalone-runtime';
import {
    WorkflowNode,
    WorkflowEdge,
    WorkflowNodeType,
    createEdge,
} from '../../domain/value-objects';
import { WorkflowDefinition, NodeExecution, NodeExecutionStatus, ExecutionStatus } from '../../domain/entities';

const SIM_MS = 25;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

class ConcurrencyTracker {
    inFlight = 0;
    peak = 0;
    enter() { this.inFlight += 1; this.peak = Math.max(this.peak, this.inFlight); }
    exit() { this.inFlight -= 1; }
}

class CountingRepository extends InMemoryWorkflowRepository {
    counts = { saveExecution: 0, updateExecutionStatus: 0, saveNodeExecution: 0, updateNodeExecutionStatus: 0, touchExecution: 0 };
    async saveExecution(e: any) { this.counts.saveExecution += 1; return super.saveExecution(e); }
    async updateExecutionStatus(id: string, s: any) { this.counts.updateExecutionStatus += 1; return super.updateExecutionStatus(id, s); }
    async saveNodeExecution(e: any) { this.counts.saveNodeExecution += 1; return super.saveNodeExecution(e); }
    async updateNodeExecutionStatus(id: string, s: any) { this.counts.updateNodeExecutionStatus += 1; return super.updateNodeExecutionStatus(id, s); }
    async touchExecution(id: string, m: any = {}) { this.counts.touchExecution += 1; return super.touchExecution(id, m); }
    totalWrites() { const c = this.counts; return c.saveExecution + c.updateExecutionStatus + c.saveNodeExecution + c.updateNodeExecutionStatus + c.touchExecution; }
}

/** Sim executor shared by all agent/package nodes: tracks per-node calls + concurrency. */
function makeSimExecutor(tracker: ConcurrencyTracker, calls: Map<string, number>, simMs = SIM_MS) {
    return {
        type: 'sim-agent',
        execute: async (_ctx: any, node: WorkflowNode) => {
            calls.set(node.id, (calls.get(node.id) ?? 0) + 1);
            tracker.enter();
            try { await sleep(simMs); } finally { tracker.exit(); }
            return { outputs: { ok: true, node: node.id } };
        },
    } as any;
}

function startNode(): WorkflowNode { return { id: 'start', type: WorkflowNodeType.Start, name: 'Start', data: {} }; }
function endNode(): WorkflowNode { return { id: 'end', type: WorkflowNodeType.End, name: 'End', data: {} }; }
function agent(id: string): WorkflowNode { return { id, type: 'sim-agent', name: id, data: {} }; }

function buildEngine(repo: CountingRepository, tracker: ConcurrencyTracker, calls: Map<string, number>, maxNodeConcurrency?: number) {
    const engine = new WorkflowEngine(new StandaloneRuntime(), repo, undefined, undefined, undefined,
        maxNodeConcurrency === undefined ? undefined : { maxNodeConcurrency });
    engine.registerExecutor('sim-agent', makeSimExecutor(tracker, calls));
    return engine;
}

async function saveDef(repo: CountingRepository, id: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): Promise<WorkflowDefinition> {
    const def: WorkflowDefinition = {
        id, packageId: `pkg-${id}`, version: '1.0.0', name: id,
        graph: { nodes, edges }, createdAt: new Date(), updatedAt: new Date(),
    };
    await repo.saveDefinition(def);
    return def;
}

function logMetrics(title: string, rows: Record<string, unknown>) {
    // eslint-disable-next-line no-console
    console.log(`\n[PERF] ${title}\n` + Object.entries(rows).map(([k, v]) => `   ${k.padEnd(26)} ${v}`).join('\n'));
}

describe('engine performance harness', () => {
    jest.setTimeout(30_000);

    it('S1 — built-in compliance pipeline (sequential agent chain): executes + write amplification', async () => {
        const repo = new CountingRepository();
        const tracker = new ConcurrencyTracker();
        const calls = new Map<string, number>();
        const engine = buildEngine(repo, tracker, calls);

        // Model of builtin-assets/flows/finance/compliance-review-pipeline (start -> N agents -> end).
        const agentIds = ['qualification-check', 'sensitive-info-detect', 'compliance-check', 'risk-report', 'report-write'];
        const nodes: WorkflowNode[] = [startNode(), ...agentIds.map(agent), endNode()];
        const chain = ['start', ...agentIds, 'end'];
        const edges: WorkflowEdge[] = chain.slice(0, -1).map((s, i) => createEdge(`e${i}`, s, chain[i + 1]));
        await saveDef(repo, 'compliance', nodes, edges);

        const t0 = performance.now();
        const exec = await engine.execute('compliance', { request: 'review' });
        const wallMs = Math.round(performance.now() - t0);

        const nodeCount = nodes.length;
        const agentCount = agentIds.length;
        logMetrics('S1 compliance pipeline (sequential)', {
            status: exec.status,
            nodes: nodeCount,
            'wall-clock(ms)': wallMs,
            'expected min(ms)': agentCount * SIM_MS,
            'DB writes (total)': repo.totalWrites(),
            'DB writes / node': (repo.totalWrites() / nodeCount).toFixed(1),
            'breakdown': JSON.stringify(repo.counts),
            'peak concurrency': tracker.peak,
        });

        expect(exec.status).toBe(ExecutionStatus.Succeeded);
        expect([...calls.values()].every(n => n === 1)).toBe(true); // each agent runs exactly once
        expect(tracker.peak).toBe(1); // sequential chain -> never more than 1 in flight
    });

    it('S2 — wide fan-out + join: bounded concurrency (cap=8) vs unbounded, join runs once', async () => {
        const WIDTH = 20;
        async function run(cap: number | undefined) {
            const repo = new CountingRepository();
            const tracker = new ConcurrencyTracker();
            const calls = new Map<string, number>();
            const engine = buildEngine(repo, tracker, calls, cap);

            const fan = Array.from({ length: WIDTH }, (_, i) => agent(`p${i}`));
            const join = agent('join');
            const nodes = [startNode(), ...fan, join, endNode()];
            const edges: WorkflowEdge[] = [
                ...fan.map((n, i) => createEdge(`s${i}`, 'start', n.id)),
                ...fan.map((n, i) => createEdge(`j${i}`, n.id, 'join')),
                createEdge('je', 'join', 'end'),
            ];
            await saveDef(repo, `fanout-${cap}`, nodes, edges);

            const t0 = performance.now();
            const exec = await engine.execute(`fanout-${cap}`, {});
            const wallMs = Math.round(performance.now() - t0);
            return { exec, wallMs, peak: tracker.peak, joinRuns: calls.get('join') ?? 0, writes: repo.totalWrites() };
        }

        const bounded = await run(8);
        const unbounded = await run(0);

        logMetrics(`S2 wide fan-out (width=${WIDTH}, sim=${SIM_MS}ms/node)`, {
            'cap=8  peak concurrency': bounded.peak,
            'cap=8  wall-clock(ms)': bounded.wallMs,
            'cap=8  join exec count': bounded.joinRuns,
            'cap=0  peak concurrency': unbounded.peak,
            'cap=0  wall-clock(ms)': unbounded.wallMs,
            'cap=0  join exec count': unbounded.joinRuns,
            'speedup unbounded/bounded': (bounded.wallMs / Math.max(1, unbounded.wallMs)).toFixed(2) + 'x',
        });

        // Correctness: join executes exactly once in BOTH (the diamond-join fix).
        expect(bounded.joinRuns).toBe(1);
        expect(unbounded.joinRuns).toBe(1);
        expect(bounded.exec.status).toBe(ExecutionStatus.Succeeded);
        expect(unbounded.exec.status).toBe(ExecutionStatus.Succeeded);
        // Bounded caps simultaneous "external jobs" at 8; unbounded bursts all 20.
        expect(bounded.peak).toBeLessThanOrEqual(8);
        expect(bounded.peak).toBe(8);
        expect(unbounded.peak).toBe(WIDTH);
    });

    it('S3 — mid-pipeline crash-resume: frontier re-drive skips completed agents (saves external jobs)', async () => {
        const repo = new CountingRepository();
        const tracker = new ConcurrencyTracker();
        const calls = new Map<string, number>();
        const engine = buildEngine(repo, tracker, calls);

        const agentIds = ['a1', 'a2', 'a3', 'a4', 'a5'];
        const nodes: WorkflowNode[] = [startNode(), ...agentIds.map(agent), endNode()];
        const chain = ['start', ...agentIds, 'end'];
        const edges: WorkflowEdge[] = chain.slice(0, -1).map((s, i) => createEdge(`e${i}`, s, chain[i + 1]));
        await saveDef(repo, 'resumable', nodes, edges);

        // Simulate a crash after start + a1 + a2 + a3 completed (3 of 5 agents done).
        const completed = ['start', 'a1', 'a2', 'a3'];
        const execId = 'resume-exec';
        await repo.saveExecution({
            id: execId, workflowDefinitionId: 'resumable', version: '1.0.0', input: {},
            status: ExecutionStatus.Pending, currentNodeIds: [], executedNodeIds: [], failedNodeIds: [],
            variables: {}, nodeOutputs: {}, createdAt: new Date(),
        });
        for (const nodeId of completed) {
            const row: NodeExecution = {
                id: `${execId}:${nodeId}`, executionId: execId, nodeId,
                nodeType: nodeId === 'start' ? WorkflowNodeType.Start : 'sim-agent',
                status: NodeExecutionStatus.Succeeded, input: {}, output: { ok: true, node: nodeId },
                createdAt: new Date(), completedAt: new Date(),
            };
            await repo.saveNodeExecution(row);
        }

        const exec = await engine.resume(execId);

        const reExecuted = [...calls.keys()].sort();
        const totalAgentRuns = [...calls.values()].reduce((a, b) => a + b, 0);
        logMetrics('S3 crash-resume (5 agents, 3 already done)', {
            status: exec.status,
            'agents re-executed': totalAgentRuns,
            're-executed ids': JSON.stringify(reExecuted),
            'full-replay would re-run': agentIds.length,
            'agent external jobs saved': agentIds.length - totalAgentRuns,
        });

        expect(exec.status).toBe(ExecutionStatus.Succeeded);
        // The 3 completed agents are NOT re-run; only the remaining frontier (a4, a5).
        expect(reExecuted).toEqual(['a4', 'a5']);
        expect(calls.get('a1')).toBeUndefined();
        expect(calls.get('a2')).toBeUndefined();
        expect(calls.get('a3')).toBeUndefined();
    });
});
