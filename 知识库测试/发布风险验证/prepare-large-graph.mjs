import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiBase = process.env.KB_GRAPH_API_BASE || 'http://127.0.0.1:29692/api/v1';
const nodeCount = Number(process.env.KB_GRAPH_NODE_COUNT || 1_000);
const reportPath = path.join(scriptDir, 'latest-large-graph-fixture.json');
const startedAt = performance.now();

assert(Number.isInteger(nodeCount) && nodeCount >= 1_000 && nodeCount <= 5_000);
const asset = await request('/assets/me/knowledge');
const files = Array.from({ length: nodeCount }, (_, index) => {
    const id = String(index).padStart(4, '0');
    const next = String((index + 1) % nodeCount).padStart(4, '0');
    const prior = String((index + nodeCount - 1) % nodeCount).padStart(4, '0');
    return {
        path: `scale/node-${id}.md`,
        content: [
            '---',
            'okf_version: "0.1"',
            `type: ${index % 3 === 0 ? 'Project' : index % 3 === 1 ? 'Concept' : 'Runbook'}`,
            `title: Scale Node ${id}`,
            `tags: [scale-${index % 10}, graph-test]`,
            '---',
            '',
            `# Scale Node ${id}`,
            '',
            `Links to [[Scale Node ${next}]] and [[Scale Node ${prior}]].`,
        ].join('\n'),
    };
});

const importStarted = performance.now();
const imported = await request(`/assets/${asset.id}/wiki/okf/import`, {
    method: 'POST',
    body: { files, overwrite: true },
});
const graphStarted = performance.now();
const graph = await request(`/assets/${asset.id}/wiki/graph`);
const completedAt = performance.now();

assert.equal(imported.imported, nodeCount);
assert(graph.nodes.length >= nodeCount, `expected >=${nodeCount} nodes, got ${graph.nodes.length}`);
assert(graph.edges.length >= nodeCount * 2, `expected >=${nodeCount * 2} edges, got ${graph.edges.length}`);

const report = {
    status: 'passed',
    assetId: asset.id,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    timingsMs: {
        import: Math.round((graphStarted - importStarted) * 100) / 100,
        graph: Math.round((completedAt - graphStarted) * 100) / 100,
        total: Math.round((completedAt - startedAt) * 100) / 100,
    },
    apiBase,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));

async function request(pathname, options = {}) {
    const response = await fetch(`${apiBase}${pathname}`, {
        method: options.method || 'GET',
        headers: options.body ? { 'content-type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 1_000)}`);
    const payload = text ? JSON.parse(text) : null;
    return payload && typeof payload === 'object' && 'data' in payload && 'code' in payload ? payload.data : payload;
}
