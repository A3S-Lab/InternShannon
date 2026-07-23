import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statfsSync, writeFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const entry = path.join(repoRoot, 'apps/sidecar/dist/main.js');
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const port = Number(process.env.KB_BACKUP_DISK_PORT || 29694);
const apiBase = `http://127.0.0.1:${port}/api/v1`;
const scratchDir = mkdtempSync(path.join(os.tmpdir(), 'internshannon-backup-disk-'));
const imagePath = path.join(scratchDir, 'limited-volume.dmg');
const mountPoint = path.join(scratchDir, 'mounted');
const dataDir = path.join(mountPoint, 'profile');
const backupDir = path.join(scratchDir, 'backup');
const outputDir = path.join(scriptDir, 'backup-disk-runs', runId);
const reportPath = path.join(scriptDir, 'latest-backup-restore-disk-pressure-report.json');
const marker = `BACKUP-RESTORE-${runId}`;
const sourcePath = 'raw/sources/backup-baseline.txt';
const sourceBytes = Buffer.from(`${marker} 备份恢复、磁盘不足和索引引用必须保持一致。\n`.repeat(4096));
const sourceSha256 = sha256(sourceBytes);
const checks = [];
let sidecar;
let mounted = false;

mkdirSync(outputDir, { recursive: true });

try {
    assert(existsSync(entry), `missing Sidecar build: ${entry}`);
    mkdirSync(mountPoint, { recursive: true });
    execFileSync('hdiutil', ['create', '-size', '96m', '-fs', 'HFS+', '-volname', `InternShannonKB${runId}`, '-quiet', imagePath]);
    execFileSync('hdiutil', ['attach', '-nobrowse', '-mountpoint', mountPoint, imagePath], { stdio: 'ignore' });
    mounted = true;
    mkdirSync(dataDir, { recursive: true });
    pass('isolated capacity-limited volume mounted', { volumeBytes: statfsSync(mountPoint).blocks * statfsSync(mountPoint).bsize });

    sidecar = startSidecar('01-baseline.log');
    await waitForHealth();
    const asset = await request('/assets/me/knowledge');
    await uploadSource(asset.id, 'backup-baseline.txt', sourceBytes);
    const job = await request(`/assets/${asset.id}/wiki/ingest-jobs`, { method: 'POST', body: { sourcePaths: [sourcePath] } });
    const terminal = await waitForJob(asset.id, job.jobId);
    assert.equal(terminal.status, 'succeeded', JSON.stringify(terminal));
    await assertSource(asset.id, sourcePath, sourceBytes);
    await assertSearch(asset.id, marker, sourcePath);
    pass('baseline profile persisted source, index and citation', { assetId: asset.id, sourceSha256 });

    await stopSidecar();
    cpSync(dataDir, backupDir, { recursive: true, force: true });
    pass('offline profile backup completed', { backupDir, sourceSha256 });

    sidecar = startSidecar('02-after-backup.log');
    await waitForHealth();
    await uploadSource(asset.id, 'post-backup-change.txt', Buffer.from('THIS CHANGE MUST DISAPPEAR AFTER RESTORE'));
    await stopSidecar();

    rmSync(dataDir, { recursive: true, force: true });
    cpSync(backupDir, dataDir, { recursive: true, force: true });
    sidecar = startSidecar('03-restored.log');
    await waitForHealth();
    const restored = await request('/assets/me/knowledge');
    assert.equal(restored.id, asset.id);
    await assertSource(asset.id, sourcePath, sourceBytes);
    await assertSearch(asset.id, marker, sourcePath);
    const postBackup = await fetch(`${apiBase}/assets/${asset.id}/repository/blob?path=${encodeURIComponent('raw/sources/post-backup-change.txt')}`);
    assert.equal(postBackup.status, 404);
    pass('restored profile exactly returns to the backup boundary');

    const reserveBytes = 1024 * 1024;
    const availableBefore = availableBytes(mountPoint);
    const fillerBytes = Math.max(0, availableBefore - reserveBytes);
    writeAllocatedFile(path.join(mountPoint, 'disk-pressure.fill'), fillerBytes);
    const availableAfterFill = availableBytes(mountPoint);
    assert(availableAfterFill < 2 * 1024 * 1024, `expected <2MiB free, got ${availableAfterFill}`);
    pass('real filesystem pressure leaves less than 2 MiB free', { availableBefore, fillerBytes, availableAfterFill });

    const oversized = Buffer.alloc(8 * 1024 * 1024, 0x51);
    const failedWrite = await fetch(`${apiBase}/assets/${asset.id}/wiki/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ingest: false, sources: [{ name: 'must-not-partially-persist.bin', contentBase64: oversized.toString('base64') }] }),
    });
    assert(!failedWrite.ok, `disk-pressure write unexpectedly returned ${failedWrite.status}`);
    pass('insufficient disk space rejects the new source write', { httpStatus: failedWrite.status });

    await assertSource(asset.id, sourcePath, sourceBytes);
    await assertSearch(asset.id, marker, sourcePath);
    const partial = await fetch(`${apiBase}/assets/${asset.id}/repository/blob?path=${encodeURIComponent('raw/sources/must-not-partially-persist.bin')}`);
    assert.equal(partial.status, 404);
    pass('disk-full failure preserves prior source/index and exposes no partial blob');

    writeReport('passed', { assetId: asset.id, sourceSha256, isolation: { scratchDir, userDataUntouched: true } });
} catch (error) {
    writeReport('failed', {
        isolation: { scratchDir, userDataUntouched: true },
        error: error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) },
    });
    process.exitCode = 1;
} finally {
    await stopSidecar();
    if (mounted) {
        try { execFileSync('hdiutil', ['detach', mountPoint, '-quiet']); } catch {
            try { execFileSync('hdiutil', ['detach', mountPoint, '-force', '-quiet']); } catch {}
        }
    }
    rmSync(scratchDir, { recursive: true, force: true });
}

function startSidecar(logName) {
    const log = createWriteStream(path.join(outputDir, logName), { flags: 'a' });
    const child = spawn(process.execPath, [entry], {
        cwd: repoRoot,
        env: { ...process.env, INTERNSHANNON_DATA_DIR: dataDir, APP_HOST: '127.0.0.1', APP_PORT: String(port), NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.once('exit', () => log.end());
    return child;
}

async function stopSidecar() {
    if (!sidecar || sidecar.exitCode !== null || sidecar.signalCode) return;
    const child = sidecar;
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5_000))]);
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
    sidecar = undefined;
}

async function uploadSource(assetId, name, content) {
    await request(`/assets/${assetId}/wiki/sources`, {
        method: 'POST',
        body: { ingest: false, sources: [{ name, contentBase64: content.toString('base64') }] },
    });
}

async function assertSource(assetId, repositoryPath, expected) {
    const blob = await request(`/assets/${assetId}/repository/blob?path=${encodeURIComponent(repositoryPath)}`);
    const actual = blob.contentBase64 ? Buffer.from(blob.contentBase64, 'base64') : Buffer.from(blob.content ?? '');
    assert.equal(sha256(actual), sha256(expected));
}

async function assertSearch(assetId, query, expectedPath) {
    const search = await request(`/assets/${assetId}/wiki/search?q=${encodeURIComponent(query)}&limit=8`);
    assert(
        search.hits?.some(hit => hit.citations?.some(citation =>
            typeof citation === 'string'
                ? citation.endsWith(`/${expectedPath}`)
                : citation?.path === expectedPath || citation?.resource?.endsWith(`/${expectedPath}`),
        )),
        JSON.stringify(search),
    );
}

async function waitForJob(assetId, jobId) {
    const deadline = Date.now() + 180_000;
    let latest;
    while (Date.now() < deadline) {
        latest = await request(`/assets/${assetId}/wiki/ingest-jobs/${jobId}`);
        if (['succeeded', 'failed', 'cancelled'].includes(latest.status)) return latest;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`job ${jobId} did not finish: ${JSON.stringify(latest)}`);
}

async function waitForHealth() {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if ((await fetch(`${apiBase}/health`).catch(() => null))?.ok) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Sidecar health timeout');
}

async function request(pathname, options = {}) {
    const response = await fetch(`${apiBase}${pathname}`, {
        method: options.method || 'GET',
        headers: options.body ? { 'content-type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${response.status}: ${text.slice(0, 1000)}`);
    const payload = text ? JSON.parse(text) : null;
    return payload && typeof payload === 'object' && 'data' in payload && 'code' in payload ? payload.data : payload;
}

function availableBytes(target) {
    const stats = statfsSync(target);
    return Number(stats.bavail) * Number(stats.bsize);
}

function writeAllocatedFile(target, bytes) {
    const fd = openSync(target, 'w');
    const chunk = Buffer.alloc(1024 * 1024, 0x46);
    let remaining = bytes;
    try {
        while (remaining > 0) {
            const size = Math.min(chunk.length, remaining);
            writeSync(fd, chunk, 0, size);
            remaining -= size;
        }
    } finally {
        closeSync(fd);
    }
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function pass(name, details = {}) {
    checks.push({ name, status: 'passed', ...details });
}

function writeReport(status, details = {}) {
    const report = {
        runId,
        startedAt: `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T${runId.slice(8, 10)}:${runId.slice(10, 12)}:${runId.slice(12, 14)}Z`,
        completedAt: new Date().toISOString(),
        status,
        checks,
        ...details,
        summary: { passed: checks.length, failed: status === 'failed' ? 1 : 0 },
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    writeFileSync(path.join(outputDir, 'report.json'), serialized);
    writeFileSync(reportPath, serialized);
    console.log(`[kb-backup-restore-disk-pressure] ${status} checks=${checks.length}`);
}
