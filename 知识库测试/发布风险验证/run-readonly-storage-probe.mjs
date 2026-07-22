import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const entry = path.join(repoRoot, 'apps/sidecar/dist/main.js');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'internshannon-readonly-'));
const port = Number(process.env.KB_READONLY_PORT || 29693);
const apiBase = `http://127.0.0.1:${port}/api/v1`;
const reportPath = path.join(scriptDir, 'latest-readonly-storage-report.json');
let sidecar;
const checks = [];

try {
    assert(existsSync(entry), `missing Sidecar build: ${entry}`);
    sidecar = spawn(process.execPath, [entry], {
        cwd: repoRoot,
        env: { ...process.env, INTERNSHANNON_DATA_DIR: dataDir, APP_HOST: '127.0.0.1', APP_PORT: String(port), NODE_ENV: 'test' },
        stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForHealth();
    const asset = await request('/assets/me/knowledge');
    const original = 'READONLY-BASELINE-BQ-7429';
    await request(`/assets/${asset.id}/wiki/sources`, {
        method: 'POST',
        body: { ingest: false, sources: [{ name: 'readonly.txt', contentBase64: Buffer.from(original).toString('base64') }] },
    });
    pass('baseline source persisted before fault');

    chmodTree(dataDir, 0o444, 0o555);
    const failedWrite = await fetch(`${apiBase}/assets/${asset.id}/wiki/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ingest: false, sources: [{ name: 'should-fail.txt', contentBase64: Buffer.from('must not persist').toString('base64') }] }),
    });
    assert(!failedWrite.ok, `read-only write unexpectedly returned ${failedWrite.status}`);
    pass('read-only storage rejects a new source write', { httpStatus: failedWrite.status });

    const blob = await request(`/assets/${asset.id}/repository/blob?path=${encodeURIComponent('raw/sources/readonly.txt')}`);
    assert.equal(blob.content, original);
    pass('existing raw source remains readable and byte-identical after the failed write', { contentSha: blob.contentSha });

    const missing = await fetch(`${apiBase}/assets/${asset.id}/repository/blob?path=${encodeURIComponent('raw/sources/should-fail.txt')}`);
    assert.equal(missing.status, 404);
    pass('failed write leaves no partially visible source');

    writeReport({ status: 'passed', isolation: { dataDir, userDataUntouched: true }, checks });
} catch (error) {
    writeReport({
        status: 'failed',
        isolation: { dataDir, userDataUntouched: true },
        checks,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) },
    });
    process.exitCode = 1;
} finally {
    chmodTree(dataDir, 0o644, 0o755);
    if (sidecar && sidecar.exitCode === null) {
        sidecar.kill('SIGTERM');
        await Promise.race([new Promise(resolve => sidecar.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3_000))]);
        if (sidecar.exitCode === null) sidecar.kill('SIGKILL');
    }
    rmSync(dataDir, { recursive: true, force: true });
}

function pass(name, details = {}) {
    checks.push({ name, status: 'passed', ...details });
}

function writeReport(report) {
    writeFileSync(reportPath, `${JSON.stringify({
        runId: new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14),
        ...report,
        summary: { passed: checks.length, failed: report.status === 'failed' ? 1 : 0 },
    }, null, 2)}\n`);
    console.log(`[kb-readonly-storage] ${report.status}`);
}

function chmodTree(root, fileMode, directoryMode) {
    if (!existsSync(root)) return;
    const stat = statSync(root);
    if (stat.isDirectory()) {
        for (const entry of readdirSync(root)) chmodTree(path.join(root, entry), fileMode, directoryMode);
        chmodSync(root, directoryMode);
    } else {
        chmodSync(root, fileMode);
    }
}

async function request(pathname, options = {}) {
    const response = await fetch(`${apiBase}${pathname}`, {
        method: options.method || 'GET',
        headers: options.body ? { 'content-type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 500)}`);
    const payload = text ? JSON.parse(text) : null;
    return payload && typeof payload === 'object' && 'data' in payload && 'code' in payload ? payload.data : payload;
}

async function waitForHealth() {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if ((await fetch(`${apiBase}/health`).catch(() => null))?.ok) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('sidecar health timeout');
}
