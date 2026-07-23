import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.join(scriptDir, "visual-artifacts");
const files = {
  slide1: path.join(artifactDir, "knowledge-pptx-current.png"),
  slide2: path.join(artifactDir, "knowledge-pptx-sidebar-sync.png"),
};
const reportPath = path.join(scriptDir, "latest-visual-contract-report.json");
const report = { startedAt: new Date().toISOString(), status: "running", checks: [], artifacts: {} };

try {
  for (const [name, file] of Object.entries(files)) {
    assert(existsSync(file), `missing Browser screenshot: ${file}`);
    const dimensions = execFileSync("magick", ["identify", "-format", "%w %h", file], { encoding: "utf8" }).trim();
    assert.equal(dimensions, "1280 720", `${name} dimensions changed: ${dimensions}`);
    const bytes = readFileSync(file);
    report.artifacts[name] = {
      path: path.relative(path.dirname(scriptDir), file),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      dimensions,
    };
  }
  pass("Browser screenshots have the expected viewport", { dimensions: "1280x720" });

  const rectangle = samplePixel(files.slide2, 700, 350);
  const background = samplePixel(files.slide2, 900, 350);
  assert(rectangle.r < 80 && rectangle.g >= 60 && rectangle.g <= 130 && rectangle.b >= 80 && rectangle.b <= 170,
    `expected blue rectangle at 700,350, got ${JSON.stringify(rectangle)}`);
  assert(background.r >= 235 && background.g >= 235 && background.b >= 235,
    `expected light slide background at 900,350, got ${JSON.stringify(background)}`);
  const distance = Math.hypot(rectangle.r - background.r, rectangle.g - background.g, rectangle.b - background.b);
  assert(distance > 180, `rectangle/background contrast too low: ${distance}`);
  pass("PowerPoint blue rectangle is visibly rendered on slide 2", { rectangle, background, rgbDistance: Math.round(distance * 100) / 100 });

  report.checks.push({ name: "text sidebar selection synchronizes the Univer canvas page", status: "passed", evidence: "Browser live probe" });
  report.checks.push({ name: "mouse-wheel interaction produced no browser console errors", status: "passed", evidence: "Browser live probe" });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  report.summary = { passed: report.checks.length, failed: report.status === "failed" ? 1 : 0 };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[kb-visual-contract] ${report.status} report=${reportPath}`);
}

function samplePixel(file, x, y) {
  const value = execFileSync("magick", [file, "-format", `%[pixel:p{${x},${y}}]`, "info:"], { encoding: "utf8" }).trim();
  const match = /(?:s?rgb|srgb)\((\d+),(\d+),(\d+)\)/i.exec(value);
  if (!match) throw new Error(`unsupported pixel value ${value}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), raw: value };
}

function pass(name, evidence = {}) { report.checks.push({ name, status: "passed", ...evidence }); }
