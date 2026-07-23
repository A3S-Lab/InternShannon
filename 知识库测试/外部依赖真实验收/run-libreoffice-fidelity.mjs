import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  libreOfficeRoundTripBytes,
  libreOfficeVersion,
  resolveLibreOfficeBinary,
} from "./libreoffice-roundtrip-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const requireFromWeb = createRequire(path.join(repoRoot, "apps/web/package.json"));
const JSZip = requireFromWeb("jszip");
const {
  docxBytesToUniverDocumentSnapshot,
  plainTextToUniverDocumentSnapshot,
  pptxBytesToUniverSlideSnapshot,
  univerDocumentSnapshotToDocxBytes,
  univerSlideSnapshotToPptxBytes,
  univerWorkbookSnapshotToBytes,
  workbookBytesToUniverSnapshot,
} = requireFromWeb("@a3s-lab/ooxml");

const sofficePath = resolveLibreOfficeBinary(process.env.LIBREOFFICE_PATH || "");
const reportPath = process.env.KB_LIBREOFFICE_REPORT || path.join(scriptDir, "latest-libreoffice-report.json");
const fixtures = path.join(repoRoot, "知识库测试", "Phase5-9网页测试", "office");
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const runDir = path.join(scriptDir, "runs", `libreoffice-${runId}`);
const scenarios = [
  { id: "renewal-operations", title: "蓝鹊客户续费运营", marker: "LO-RENEWAL-BQ3-7429", fact: "净收入留存率不低于 109%" },
  { id: "literature-research", title: "小样本目标定位文献研究", marker: "LO-RESEARCH-ASMLOC-317", fact: "需要三个相互独立的实验设置" },
  { id: "release-incident", title: "Orion 发布事故复盘", marker: "LO-RELEASE-ORION-731", fact: "5 分钟错误率超过 2.5% 必须回退" },
];

await mkdir(runDir, { recursive: true });
const report = {
  runId,
  completedAt: null,
  status: "running",
  installation: {},
  probes: [],
  scenarios: [],
  summary: { total: 0, passed: 0, failed: 0 },
};

try {
  report.installation = {
    binary: sofficePath,
    version: await libreOfficeVersion(sofficePath),
    architecture: process.arch,
    real: true,
  };
  await runFixtureProbes();
  for (const scenario of scenarios) await runScenario(scenario);
  report.completedAt = new Date().toISOString();
  report.summary.total = report.probes.length + report.scenarios.reduce((sum, item) => sum + item.formats.length, 0);
  report.summary.passed = report.probes.filter((item) => item.status === "passed").length
    + report.scenarios.flatMap((item) => item.formats).filter((item) => item.status === "passed").length;
  report.summary.failed = report.summary.total - report.summary.passed;
  report.status = report.summary.failed === 0 ? "passed" : "failed";
  assert.equal(report.status, "passed");
} catch (error) {
  report.completedAt = new Date().toISOString();
  report.status = "failed";
  report.error = error instanceof Error ? error.stack || error.message : String(error);
  process.exitCode = 1;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.KB_LIBREOFFICE_KEEP_RUN !== "1") await rm(runDir, { recursive: true, force: true });
}

console.log(`[libreoffice-fidelity] ${report.status} report=${reportPath}`);

async function runFixtureProbes() {
  for (const extension of ["docx", "xlsx", "pptx"]) {
    const bytes = await readFile(path.join(fixtures, `knowledge-smoke.${extension}`));
    const before = await inspectOffice(bytes, extension, `probe-before.${extension}`);
    const marker = `LIBREOFFICE-PROBE-${extension.toUpperCase()}-${runId}`;
    const converted = await libreOfficeRoundTripBytes({ bytes, extension, filename: `probe.${extension}`, marker, sofficePath });
    const after = await inspectOffice(converted.bytes, extension, `probe-after.${extension}`);
    assert(after.serialized.includes(marker), `${extension} probe lost LibreOffice marker`);
    assert(after.primaryParts >= before.primaryParts, `${extension} probe lost primary document parts`);
    if (extension === "docx") assert(after.tableCount >= before.tableCount, "DOCX probe lost tables");
    if (extension === "xlsx") assert(after.formulaCount >= before.formulaCount, "XLSX probe lost formulas");
    report.probes.push({
      extension,
      status: "passed",
      markerPersisted: true,
      primaryParts: after.primaryParts,
      tableCount: after.tableCount,
      formulaCount: after.formulaCount,
    });
  }
}

async function runScenario(scenario) {
  const formats = [];
  for (const extension of ["docx", "xlsx", "pptx"]) {
    const appMarker = `${scenario.marker}-${extension.toUpperCase()}-SHUXIAOAN`;
    const libreMarker = `${scenario.marker}-${extension.toUpperCase()}-LIBREOFFICE`;
    const initial = await createWithShuXiaoAn(scenario, extension, appMarker);
    const converted = await libreOfficeRoundTripBytes({
      bytes: initial,
      extension,
      filename: `${scenario.id}.${extension}`,
      marker: libreMarker,
      sofficePath,
    });
    const imported = await inspectOffice(converted.bytes, extension, `${scenario.id}.${extension}`);
    assert(imported.serialized.includes(appMarker), `${scenario.id} ${extension} lost ShuXiaoAn marker in LibreOffice`);
    assert(imported.serialized.includes(libreMarker), `${scenario.id} ${extension} lost LibreOffice marker in ShuXiaoAn`);
    const savedAgain = await saveWithShuXiaoAn(imported.snapshot, converted.bytes, extension);
    const finalProbe = await libreOfficeRoundTripBytes({
      bytes: savedAgain,
      extension,
      filename: `${scenario.id}-final.${extension}`,
      marker: `${scenario.marker}-${extension.toUpperCase()}-FINAL-PROBE`,
      sofficePath,
    });
    const finalImported = await inspectOffice(finalProbe.bytes, extension, `${scenario.id}-final.${extension}`);
    assert(finalImported.serialized.includes(appMarker), `${scenario.id} ${extension} lost initial marker after second round-trip`);
    assert(finalImported.serialized.includes(libreMarker), `${scenario.id} ${extension} lost LibreOffice edit after ShuXiaoAn save`);
    formats.push({
      extension,
      status: "passed",
      shuXiaoAnToLibreOffice: true,
      libreOfficeToShuXiaoAn: true,
      reopenAfterShuXiaoAnSave: true,
      inputBytes: initial.length,
      outputBytes: finalProbe.bytes.length,
    });
  }
  report.scenarios.push({ id: scenario.id, title: scenario.title, status: "passed", formats });
}

async function createWithShuXiaoAn(scenario, extension, marker) {
  if (extension === "docx") {
    const snapshot = plainTextToUniverDocumentSnapshot(`${scenario.id}.docx`, `${scenario.title}\n${marker}\n${scenario.fact}`);
    return Buffer.from(await univerDocumentSnapshotToDocxBytes(snapshot));
  }
  if (extension === "xlsx") {
    const snapshot = workbookBytesToUniverSnapshot(await readFile(path.join(fixtures, "knowledge-smoke.xlsx")), { filename: `${scenario.id}.xlsx` });
    const sheet = snapshot.sheets[snapshot.sheetOrder[0]];
    sheet.cellData ||= {};
    sheet.cellData[0] ||= {};
    sheet.cellData[0][0] = { v: marker, t: 1 };
    sheet.cellData[1] ||= {};
    sheet.cellData[1][0] = { v: scenario.fact, t: 1 };
    return Buffer.from(univerWorkbookSnapshotToBytes(snapshot, "xlsx"));
  }
  const original = await readFile(path.join(fixtures, "knowledge-smoke.pptx"));
  const snapshot = await pptxBytesToUniverSlideSnapshot(original, { filename: `${scenario.id}.pptx` });
  const firstPage = snapshot.body.pages[snapshot.body.pageOrder[0]];
  const firstElement = Object.values(firstPage.pageElements).find((item) => item.richText);
  assert(firstElement?.richText, "PPTX fixture has no editable rich text");
  firstElement.richText.text = `${scenario.title} ${marker} ${scenario.fact}`;
  firstElement.richText.rich = undefined;
  return Buffer.from(await univerSlideSnapshotToPptxBytes(snapshot, original));
}

async function saveWithShuXiaoAn(snapshot, sourceBytes, extension) {
  if (extension === "docx") return Buffer.from(await univerDocumentSnapshotToDocxBytes(snapshot));
  if (extension === "xlsx") return Buffer.from(univerWorkbookSnapshotToBytes(snapshot, "xlsx"));
  return Buffer.from(await univerSlideSnapshotToPptxBytes(snapshot, sourceBytes));
}

async function inspectOffice(bytes, extension, filename) {
  const archive = await JSZip.loadAsync(bytes);
  const xmlPaths = Object.keys(archive.files).filter((entry) => entry.endsWith(".xml"));
  const xml = (await Promise.all(xmlPaths.map((entry) => archive.file(entry).async("string")))).join("\n");
  let snapshot;
  if (extension === "docx") snapshot = await docxBytesToUniverDocumentSnapshot(bytes, { filename });
  else if (extension === "xlsx") snapshot = workbookBytesToUniverSnapshot(bytes, { filename });
  else snapshot = await pptxBytesToUniverSlideSnapshot(bytes, { filename });
  return {
    snapshot,
    serialized: JSON.stringify(snapshot),
    primaryParts: extension === "docx"
      ? xmlPaths.filter((entry) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(entry)).length
      : extension === "xlsx"
        ? xmlPaths.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry)).length
        : xmlPaths.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry)).length,
    tableCount: (xml.match(/<w:tbl[ >]/g) || []).length,
    formulaCount: (xml.match(/<f[ >]/g) || []).length,
  };
}
