import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    copyToIsolatedDir,
    findBundledNode,
    findResourcesDir,
    findSidecarDir,
} from './smoke-standalone-sidecar.mjs';

const layouts = [
    { name: 'flat Windows', nodeRelativePath: 'node/node.exe', sidecarRelativePath: '', startAtSidecar: false },
    {
        name: 'nested Windows from Resources',
        nodeRelativePath: 'node/node.exe',
        sidecarRelativePath: 'sidecar',
        startAtSidecar: false,
    },
    {
        name: 'nested Windows from sidecar',
        nodeRelativePath: 'node/node.exe',
        sidecarRelativePath: 'sidecar',
        startAtSidecar: true,
    },
    { name: 'flat macOS', nodeRelativePath: 'node/bin/node', sidecarRelativePath: '', startAtSidecar: false },
    {
        name: 'nested macOS from Resources',
        nodeRelativePath: 'node/bin/node',
        sidecarRelativePath: 'sidecar',
        startAtSidecar: false,
    },
    {
        name: 'nested macOS from sidecar',
        nodeRelativePath: 'node/bin/node',
        sidecarRelativePath: 'sidecar',
        startAtSidecar: true,
    },
];

for (const layout of layouts) {
    test(`isolates complete ${layout.name} resources and keeps bundled Node`, () => {
        const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-smoke-fixture.'));
        const resourcesDir = path.join(fixtureRoot, 'Resources');
        const sidecarDir = path.join(resourcesDir, layout.sidecarRelativePath);
        const nodeExecutable = path.join(resourcesDir, layout.nodeRelativePath);
        const sentinel = path.join(resourcesDir, 'search-browser', 'sentinel.txt');
        fs.mkdirSync(sidecarDir, { recursive: true });
        fs.mkdirSync(path.dirname(nodeExecutable), { recursive: true });
        fs.mkdirSync(path.dirname(sentinel), { recursive: true });
        fs.writeFileSync(path.join(sidecarDir, 'main.js'), '');
        fs.writeFileSync(nodeExecutable, '');
        fs.writeFileSync(sentinel, 'complete resources');

        let isolatedRoot;
        try {
            const startDir = layout.startAtSidecar ? sidecarDir : resourcesDir;
            const resolvedSidecarDir = findSidecarDir(startDir);
            const resolvedResourcesDir = findResourcesDir(startDir, resolvedSidecarDir);
            const isolated = copyToIsolatedDir(resolvedResourcesDir, resolvedSidecarDir);
            isolatedRoot = isolated.isolatedRoot;

            assert.equal(resolvedSidecarDir, sidecarDir);
            assert.equal(resolvedResourcesDir, resourcesDir);
            assert.equal(
                findBundledNode(isolated.isolatedSidecarDir),
                path.join(isolated.isolatedResourcesDir, layout.nodeRelativePath),
            );
            assert.equal(
                fs.readFileSync(path.join(isolated.isolatedResourcesDir, 'search-browser', 'sentinel.txt'), 'utf8'),
                'complete resources',
            );
        } finally {
            if (isolatedRoot) {
                fs.rmSync(isolatedRoot, { recursive: true, force: true });
            }
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });
}
