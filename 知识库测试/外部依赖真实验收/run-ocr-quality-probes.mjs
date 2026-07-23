import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const origin = (process.env.KB_REAL_OCR_ORIGIN || "http://127.0.0.1:39871").replace(/\/+$/, "");
const reportPath = process.env.KB_OCR_QUALITY_REPORT || path.join(scriptDir, "latest-ocr-quality-report.json");
const directory = await mkdtemp(path.join(os.tmpdir(), "internshannon-ocr-quality-"));
const cases = [];

try {
  const cleanText = "OCR-CLEAN-7429\nKnowledge Base retention 109 percent";
  const clean = image([
    "-size", "1500x600", "xc:white", "-font", "/System/Library/Fonts/Supplemental/Arial.ttf",
    "-fill", "#111111", "-pointsize", "64", "-gravity", "center", "-annotate", "+0+0", cleanText, "png:-",
  ]);
  const cleanResult = await recognize(clean, "clean.png", "image/png");
  assert.equal(normalize(cleanResult.text), normalize(cleanText));
  cases.push({ name: "clean-english", status: "passed", characterAccuracy: 1, pages: cleanResult.pages.length });

  const mixedText = "知识库真实光学识别\n蓝鹊校验码 BQ-7429\n净收入留存率 109%";
  const mixed = image([
    "-size", "1500x600", "xc:white", "-font", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "-fill", "black", "-pointsize", "64", "-gravity", "center", "-annotate", "+0+0", mixedText, "png:-",
  ]);
  const mixedResult = await recognize(mixed, "mixed-zh-en.png", "image/png");
  const mixedAccuracy = characterAccuracy(normalize(mixedText), normalize(mixedResult.text));
  assert(mixedAccuracy >= 0.95, `mixed Chinese/English OCR accuracy ${mixedAccuracy}`);
  assert(mixedResult.text.includes("BQ-7429") && mixedResult.text.includes("109"));
  cases.push({ name: "mixed-chinese-english", status: "passed", characterAccuracy: mixedAccuracy, pages: mixedResult.pages.length });

  const rotatedText = "ROTATED-OCR-317\nRelease threshold 2.5 percent";
  const rotated = image([
    "-size", "1500x600", "xc:#eeeeee", "-font", "/System/Library/Fonts/Supplemental/Arial.ttf",
    "-fill", "#666666", "-pointsize", "62", "-gravity", "center", "-annotate", "+0+0", rotatedText,
    "-rotate", "2", "-blur", "0x0.5", "png:-",
  ]);
  const rotatedResult = await recognize(rotated, "rotated-low-contrast.png", "image/png");
  assert(rotatedResult.text.includes("ROTATED-OCR-317") && rotatedResult.text.includes("2.5"));
  cases.push({ name: "rotated-low-contrast", status: "passed", characterAccuracy: characterAccuracy(normalize(rotatedText), normalize(rotatedResult.text)), pages: rotatedResult.pages.length });

  const pdfText = "SCAN-PDF-427\nDelivery gate 297 files";
  const pdfPngPath = path.join(directory, "scan.png");
  const pdfPath = path.join(directory, "scan.pdf");
  runMagick([
    "-size", "1200x500", "xc:white", "-font", "/System/Library/Fonts/Supplemental/Arial.ttf",
    "-fill", "black", "-pointsize", "58", "-gravity", "center", "-annotate", "+0+0", pdfText, pdfPngPath,
  ]);
  runMagick([pdfPngPath, pdfPath]);
  const pdfResult = await recognize(await readFile(pdfPath), "scanned.pdf", "application/pdf");
  assert(pdfResult.text.includes("SCAN-PDF-427") && pdfResult.text.includes("297"));
  cases.push({ name: "scanned-pdf", status: "passed", characterAccuracy: characterAccuracy(normalize(pdfText), normalize(pdfResult.text)), pages: pdfResult.pages.length });

  const summary = {
    completedAt: new Date().toISOString(),
    status: "passed",
    provider: { engine: "tesseract", transport: "custom-http", real: true },
    thresholds: { mixedCharacterAccuracy: 0.95 },
    cases,
  };
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[ocr-quality-probes] passed report=${reportPath}`);
} catch (error) {
  const summary = { completedAt: new Date().toISOString(), status: "failed", cases, error: error instanceof Error ? error.message : String(error) };
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.error("[ocr-quality-probes] failed", error);
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}

function image(args) {
  const result = spawnSync("magick", args, { maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString().slice(0, 800));
  return result.stdout;
}

function runMagick(args) {
  const result = spawnSync("magick", args, { maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString().slice(0, 800));
}

async function recognize(bytes, filename, mimeType) {
  const response = await fetch(`${origin}/ocr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename, mimeType, outputFormat: "json", file: bytes.toString("base64") }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.metadata?.engine, "tesseract");
  return result;
}

function normalize(value) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function characterAccuracy(expected, actual) {
  const rows = Array.from({ length: expected.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= actual.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= expected.length; row += 1) {
    for (let column = 1; column <= actual.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (expected[row - 1] === actual[column - 1] ? 0 : 1),
      );
    }
  }
  return Number((1 - rows[expected.length][actual.length] / Math.max(expected.length, actual.length, 1)).toFixed(4));
}
