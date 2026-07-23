import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtures = path.join(repoRoot, "知识库测试", "Phase5-9网页测试", "office");
const reportPath = process.env.KB_OFFICE_REPORT || path.join(scriptDir, "latest-microsoft-office-report.json");
const directory = path.join(scriptDir, "runs", `office-${Date.now()}`);
await mkdir(directory, { recursive: true });
const requireFromWeb = createRequire(path.join(repoRoot, "apps/web/package.json"));
const JSZip = requireFromWeb("jszip");
const markerPrefix = `EXTERNAL-OFFICE-${Date.now()}`;
const results = [];

try {
  const files = {
    docx: path.join(directory, "knowledge-fidelity.docx"),
    xlsx: path.join(directory, "knowledge-fidelity.xlsx"),
    pptx: path.join(directory, "knowledge-fidelity.pptx"),
  };
  for (const extension of Object.keys(files)) await cp(path.join(fixtures, `knowledge-smoke.${extension}`), files[extension]);

  await verifyWord(files.docx, `${markerPrefix}-WORD`);
  await verifyExcel(files.xlsx, `${markerPrefix}-EXCEL`);
  try {
    await verifyPowerPoint(files.pptx, `${markerPrefix}-POWERPOINT`);
  } catch (error) {
    results.push({
      application: "Microsoft PowerPoint",
      extension: "pptx",
      status: "blocked",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const summary = {
    completedAt: new Date().toISOString(),
    status: results.some((item) => item.status === "failed") ? "failed" : results.some((item) => item.status === "blocked") ? "passed_with_blocks" : "passed",
    applicationVersion: "16.110.3",
    matrix: results,
    libreOffice: await readLibreOfficeEvidence(),
  };
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  assert.notEqual(summary.status, "failed");
  console.log(`[microsoft-office-fidelity] ${summary.status} report=${reportPath}`);
} catch (error) {
  const summary = {
    completedAt: new Date().toISOString(),
    status: "failed",
    applicationVersion: "16.110.3",
    matrix: results,
    error: error instanceof Error ? error.message : String(error),
    libreOffice: await readLibreOfficeEvidence(),
  };
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.error("[microsoft-office-fidelity] failed", error);
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function verifyWord(file, marker) {
  const before = await packageStats(file, "docx");
  await openWithApplication("Microsoft Word", file);
  await appleScript(`
tell application "Microsoft Word"
  set doc to document 1
  set titleRange to text object of paragraph 1 of doc
  set content of titleRange to (${quote(marker)} & return)
  save doc
  close doc saving no
end tell`);
  const after = await packageStats(file, "docx");
  assert(after.text.includes(marker));
  assert.equal(after.primaryParts, before.primaryParts);
  assert(after.tableCount >= before.tableCount);
  results.push({ application: "Microsoft Word", extension: "docx", status: "passed", markerPersisted: true, primaryParts: after.primaryParts, tableCount: after.tableCount });
}

async function verifyExcel(file, marker) {
  const before = await packageStats(file, "xlsx");
  await openWithApplication("Microsoft Excel", file);
  await appleScript(`
tell application "Microsoft Excel"
  set book to workbook 1
  set value of range "D1" of worksheet 1 of book to ${quote(marker)}
  save book
  close book saving no
end tell`);
  const after = await packageStats(file, "xlsx");
  assert(after.text.includes(marker));
  assert.equal(after.primaryParts, before.primaryParts);
  assert(after.formulaCount >= before.formulaCount);
  results.push({ application: "Microsoft Excel", extension: "xlsx", status: "passed", markerPersisted: true, primaryParts: after.primaryParts, formulaCount: after.formulaCount });
}

async function verifyPowerPoint(file, marker) {
  const before = await packageStats(file, "pptx");
  await openWithApplication("Microsoft PowerPoint", file);
  await appleScript(`
tell application "Microsoft PowerPoint"
  set deck to presentation 1
  set content of text range of text frame of shape 1 of slide 1 of deck to ${quote(marker)}
  save deck in POSIX file ${quote(file)}
  close deck
end tell`);
  const after = await packageStats(file, "pptx");
  assert(after.text.includes(marker));
  assert.equal(after.primaryParts, before.primaryParts);
  results.push({ application: "Microsoft PowerPoint", extension: "pptx", status: "passed", markerPersisted: true, primaryParts: after.primaryParts });
}

async function packageStats(file, extension) {
  const archive = await JSZip.loadAsync(await readFile(file));
  const xmlPaths = Object.keys(archive.files).filter((entry) => entry.endsWith(".xml"));
  const texts = await Promise.all(xmlPaths.map((entry) => archive.file(entry).async("string")));
  const text = texts.join("\n");
  const primaryParts = extension === "docx"
    ? xmlPaths.filter((entry) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(entry)).length
    : extension === "xlsx"
      ? xmlPaths.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry)).length
      : xmlPaths.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry)).length;
  return {
    text,
    primaryParts,
    tableCount: (text.match(/<w:tbl[ >]/g) || []).length,
    formulaCount: (text.match(/<f[ >]/g) || []).length,
  };
}

async function appleScript(source) {
  await execFileAsync("osascript", ["-e", source], { timeout: 120000, maxBuffer: 1024 * 1024 });
}

async function openWithApplication(application, file) {
  await execFileAsync("open", ["-a", application, file], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const collection = application === "Microsoft Word" ? "documents" : application === "Microsoft Excel" ? "workbooks" : "presentations";
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync(
        "osascript",
        ["-e", `tell application ${quote(application)} to get count of ${collection}`],
        { timeout: 5000, maxBuffer: 1024 * 1024 },
      );
      if (Number(stdout.trim()) > 0) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${application} did not open ${path.basename(file)}`);
}

function quote(value) {
  return JSON.stringify(value);
}

async function readLibreOfficeEvidence() {
  try {
    const filename = "latest-libreoffice-report.json";
    const report = JSON.parse(await readFile(path.join(scriptDir, filename), "utf8"));
    if (report.status === "passed") {
      return {
        status: "passed",
        version: report.installation?.version,
        validatedSeparately: true,
        report: filename,
        scenarios: report.scenarios?.length || 0,
      };
    }
    return { status: "blocked", reason: `Separate LibreOffice report status=${report.status}`, report: filename };
  } catch {
    return { status: "blocked", reason: "LibreOffice validation report is missing" };
  }
}
