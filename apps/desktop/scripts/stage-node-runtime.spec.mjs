import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    parseArgs,
    readPinnedNodeVersion,
    resetResourceDir,
    stageRuntime,
} from './stage-node-runtime.mjs';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-node-stage.'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const resourceDirectory = path.join(root, 'resources', 'node');
    const resourceStagingRoot = path.join(root, 'staging');
    const runtimeDirectory = path.join(root, 'runtime');
    fs.mkdirSync(resourceDirectory, { recursive: true });
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    fs.writeFileSync(path.join(resourceDirectory, '.gitkeep'), '\n');
    fs.writeFileSync(path.join(resourceDirectory, 'stale.txt'), 'stale');
    fs.writeFileSync(path.join(runtimeDirectory, 'node.exe'), 'node fixture');
    const sentinelPath = path.join(resourceDirectory, '.gitkeep');
    return {
        resourceDirectory,
        resourceStagingRoot,
        runtimeDirectory,
        sentinelPath,
        sentinelBytes: fs.readFileSync(sentinelPath),
        sentinelMtimeMs: fs.statSync(sentinelPath).mtimeMs,
    };
}

function assertSentinelUnchanged(state) {
    assert.deepEqual(fs.readFileSync(state.sentinelPath), state.sentinelBytes);
    assert.equal(fs.statSync(state.sentinelPath).mtimeMs, state.sentinelMtimeMs);
    assert.deepEqual(fs.readdirSync(state.resourceStagingRoot), []);
}

test('defaults every platform to the exact Node version pinned by .nvmrc', () => {
    assert.equal(readPinnedNodeVersion(), 'v22.18.0');
    assert.equal(parseArgs([], {}).version, 'v22.18.0');
    assert.equal(parseArgs([], { INTERNSHANNON_NODE_VERSION: '   ' }).version, 'v22.18.0');
});

test('rejects an environment override that would drift from the pinned Node runtime', () => {
    assert.throws(
        () => parseArgs([], { INTERNSHANNON_NODE_VERSION: 'v22.19.0' }),
        /must match .*\.nvmrc \(v22\.18\.0\)/,
    );
});

test('rejects a command-line override that would drift from the pinned Node runtime', () => {
    assert.throws(
        () => parseArgs(['--version', 'v23.0.0'], {}),
        /must match .*\.nvmrc \(v22\.18\.0\)/,
    );
});

test('stages Node without replacing the tracked resource sentinel', async (t) => {
    const state = fixture(t);
    const staged = await stageRuntime(
        state.runtimeDirectory,
        {
            version: 'v22.18.0',
            major: '22',
            platform: 'win',
            arch: 'x64',
            source: 'https://nodejs.org/dist/v22.18.0/node-v22.18.0-win-x64.zip',
            archive: '.cache/node-runtime/node-v22.18.0-win-x64.zip',
            sha256: 'a'.repeat(64),
            downloaded: false,
        },
        {
            resourceDirectory: state.resourceDirectory,
            resourceStagingRoot: state.resourceStagingRoot,
        },
    );
    assertSentinelUnchanged(state);
    assert.equal(fs.existsSync(path.join(state.resourceDirectory, 'node.exe')), true);
    assert.equal(staged.result.executable, path.join(state.resourceDirectory, 'node.exe'));
    assert.equal(fs.existsSync(staged.result.executable), true);
    assert.equal(
        JSON.parse(
            fs.readFileSync(
                path.join(state.resourceDirectory, 'node-runtime-manifest.json'),
                'utf8',
            ),
        ).version,
        'v22.18.0',
    );
    assert.equal(fs.existsSync(path.join(state.resourceDirectory, 'stale.txt')), false);
});

test('clean removes Node payload and leaves the tracked sentinel unchanged', async (t) => {
    const state = fixture(t);
    await resetResourceDir({
        resourceDirectory: state.resourceDirectory,
        resourceStagingRoot: state.resourceStagingRoot,
    });
    assert.deepEqual(fs.readdirSync(state.resourceDirectory), ['.gitkeep']);
    assertSentinelUnchanged(state);
    await resetResourceDir({
        resourceDirectory: state.resourceDirectory,
        resourceStagingRoot: state.resourceStagingRoot,
    });
    assertSentinelUnchanged(state);
});

test('clean deterministically creates the tracked sentinel for an empty resource state', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-node-clean.'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const resourceDirectory = path.join(root, 'resources', 'node');
    const resourceStagingRoot = path.join(root, 'staging');
    await resetResourceDir({ resourceDirectory, resourceStagingRoot });
    assert.deepEqual(fs.readdirSync(resourceDirectory), ['.gitkeep']);
    assert.equal(fs.readFileSync(path.join(resourceDirectory, '.gitkeep'), 'utf8'), '\n');
});
