import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const require = createRequire(path.join(repoRoot, 'packages/ooxml/package.json'));
const JSZip = require('jszip');
const adapters = require(path.join(repoRoot, 'packages/ooxml/dist/index.js'));
const fixtures = path.join(repoRoot, '知识库测试/Phase5-9网页测试/office');
const manualArtifactsDir = path.join(scriptDir, 'manual-office');
const checks = [];
const manualArtifacts = [];

mkdirSync(manualArtifactsDir, { recursive: true });

await probePptx();
await probeDocx();
await probeXlsx();

const failed = checks.filter(check => check.status === 'failed').length;
const report = {
    runId: new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14),
    status: failed === 0 ? 'passed' : 'failed',
    checks,
    manualArtifacts,
    summary: {
        passed: checks.filter(check => check.status === 'passed').length,
        failed,
    },
    interpretation: 'Supported edits must work; unsupported OOXML parts must not disappear silently.',
};
writeFileSync(path.join(scriptDir, 'latest-office-fidelity-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));

async function probePptx() {
    const original = new Uint8Array(readFileSync(path.join(fixtures, 'knowledge-smoke.pptx')));
    const snapshot = await adapters.pptxBytesToUniverSlideSnapshot(original, { filename: 'knowledge-smoke.pptx' });
    const page = snapshot.body?.pages?.[snapshot.body?.pageOrder?.[0]];
    const textElement = Object.values(page?.pageElements ?? {}).find(element => element?.richText?.text);
    if (textElement?.richText) textElement.richText.text = 'P2 fidelity probe BQ-7429';
    const output = await adapters.univerSlideSnapshotToPptxBytes(snapshot, original);
    const before = await JSZip.loadAsync(original);
    const after = await JSZip.loadAsync(output);
    const invariantParts = [
        'ppt/slideMasters/slideMaster1.xml',
        'ppt/slideMasters/_rels/slideMaster1.xml.rels',
        'ppt/slideLayouts/slideLayout1.xml',
        'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
        'ppt/theme/theme1.xml',
        'ppt/_rels/presentation.xml.rels',
    ];
    const mismatches = [];
    for (const part of invariantParts) {
        const left = await before.file(part)?.async('nodebuffer');
        const right = await after.file(part)?.async('nodebuffer');
        if (!left || !right || sha(left) !== sha(right)) mismatches.push(part);
    }
    const slide = await after.file('ppt/slides/slide1.xml')?.async('text');
    checks.push({
        name: 'PPTX supported text edit preserves master/layout/theme relationships',
        status: mismatches.length === 0 && slide?.includes('P2 fidelity probe BQ-7429') ? 'passed' : 'failed',
        mismatches,
    });
}

async function probeDocx() {
    const zip = await JSZip.loadAsync(readFileSync(path.join(fixtures, 'knowledge-smoke.docx')));
    zip.file('word/comments.xml', '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0"><w:p><w:r><w:t>preserve-comment</w:t></w:r></w:p></w:comment></w:comments>');
    zip.file('word/header99.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>preserve-header</w:t></w:r></w:p></w:hdr>');
    zip.file('word/media/preserve.png', Buffer.from('89504e470d0a1a0a', 'hex'));
    const augmented = await zip.generateAsync({ type: 'uint8array' });
    const snapshot = await adapters.docxBytesToUniverDocumentSnapshot(augmented, { filename: 'complex.docx' });
    const baseline = structuredClone(snapshot);
    const match = snapshot.body?.dataStream?.match(/[^\r\n]+/);
    const replacement = match ? 'P2-DOCX-PRESERVED'.padEnd(match[0].length, '-').slice(0, match[0].length) : '';
    if (match && snapshot.body) snapshot.body.dataStream = snapshot.body.dataStream.replace(match[0], replacement);
    const output = await adapters.univerDocumentSnapshotToPreservedDocxBytes(snapshot, {
        originalBytes: augmented,
        baselineSnapshot: baseline,
    });
    const before = await JSZip.loadAsync(augmented);
    const after = await JSZip.loadAsync(output);
    const preservedParts = ['word/comments.xml', 'word/header99.xml', 'word/media/preserve.png'];
    const missing = preservedParts.filter(part => !after.file(part));
    const changed = [];
    for (const part of preservedParts) {
        const left = await before.file(part)?.async('nodebuffer');
        const right = await after.file(part)?.async('nodebuffer');
        if (!left || !right || sha(left) !== sha(right)) changed.push(part);
    }
    const documentXml = await after.file('word/document.xml')?.async('text');
    const originalPath = path.join(manualArtifactsDir, 'complex-docx-before-shuxiaoan.docx');
    const savedPath = path.join(manualArtifactsDir, 'complex-docx-after-shuxiaoan.docx');
    writeFileSync(originalPath, augmented);
    writeFileSync(savedPath, output);
    manualArtifacts.push({
        format: 'docx',
        before: path.relative(repoRoot, originalPath),
        after: path.relative(repoRoot, savedPath),
        beforeSha256: sha(augmented),
        afterSha256: sha(output),
    });
    checks.push({
        name: 'DOCX unsupported comments/header/media parts survive an edit export',
        status: missing.length === 0 && changed.length === 0 && (!replacement || documentXml?.includes(replacement)) ? 'passed' : 'failed',
        missing,
        changed,
        editApplied: Boolean(replacement && documentXml?.includes(replacement)),
        releaseRisk: missing.length || changed.length ? 'Complex DOCX save can silently discard unsupported package parts.' : undefined,
    });
}

async function probeXlsx() {
    const zip = await JSZip.loadAsync(readFileSync(path.join(fixtures, 'knowledge-smoke.xlsx')));
    zip.file('xl/charts/chart99.xml', '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>');
    zip.file('xl/drawings/drawing99.xml', '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>');
    zip.file('xl/media/preserve.png', Buffer.from('89504e470d0a1a0a', 'hex'));
    const augmented = await zip.generateAsync({ type: 'uint8array' });
    const snapshot = adapters.workbookBytesToUniverSnapshot(augmented, { filename: 'complex.xlsx' });
    const baseline = structuredClone(snapshot);
    const sheet = snapshot.sheets[snapshot.sheetOrder[0]];
    sheet.cellData ??= {};
    sheet.cellData[0] ??= {};
    sheet.cellData[0][0] = { v: 'P2-XLSX-PRESERVED', t: 0 };
    const output = await adapters.univerWorkbookSnapshotToPreservedXlsxBytes(snapshot, {
        originalBytes: augmented,
        baselineSnapshot: baseline,
    });
    const before = await JSZip.loadAsync(augmented);
    const after = await JSZip.loadAsync(output);
    const preservedParts = ['xl/charts/chart99.xml', 'xl/drawings/drawing99.xml', 'xl/media/preserve.png'];
    const missing = preservedParts.filter(part => !after.file(part));
    const changed = [];
    for (const part of preservedParts) {
        const left = await before.file(part)?.async('nodebuffer');
        const right = await after.file(part)?.async('nodebuffer');
        if (!left || !right || sha(left) !== sha(right)) changed.push(part);
    }
    const workbook = require('xlsx').read(output, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const originalPath = path.join(manualArtifactsDir, 'complex-xlsx-before-shuxiaoan.xlsx');
    const savedPath = path.join(manualArtifactsDir, 'complex-xlsx-after-shuxiaoan.xlsx');
    writeFileSync(originalPath, augmented);
    writeFileSync(savedPath, output);
    manualArtifacts.push({
        format: 'xlsx',
        before: path.relative(repoRoot, originalPath),
        after: path.relative(repoRoot, savedPath),
        beforeSha256: sha(augmented),
        afterSha256: sha(output),
    });
    checks.push({
        name: 'XLSX unsupported chart/drawing/media parts survive an edit export',
        status: missing.length === 0 && changed.length === 0 && firstSheet?.A1?.v === 'P2-XLSX-PRESERVED' ? 'passed' : 'failed',
        missing,
        changed,
        editApplied: firstSheet?.A1?.v === 'P2-XLSX-PRESERVED',
        releaseRisk: missing.length || changed.length ? 'Complex XLSX save can silently discard unsupported package parts.' : undefined,
    });
}

function sha(value) {
    return createHash('sha256').update(value).digest('hex');
}
