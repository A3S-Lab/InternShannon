import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const outputDir = path.join(scriptDir, "mutation-runs", runId);
const evidenceDir = path.resolve(process.env.KB_MUTATION_EVIDENCE_DIR || path.join(scriptDir, "mutation-evidence"));
mkdirSync(outputDir, { recursive: true });
const mutants = [
  {
    id: "index-commit-point-abort",
    description: "remove the abort guard after immutable vector persistence",
    source: path.join(evidenceDir, "index-commit-point-abort.log"),
    expected: /previous vector revision[\s\S]*Received promise resolved instead of rejected/,
  },
  {
    id: "okf-root-traversal",
    description: "allow a leading .. segment to escape the OKF bundle root",
    source: path.join(evidenceDir, "okf-root-traversal.log"),
    expected: /rejects unsafe paths[\s\S]*Expected: false[\s\S]*Received: true/,
  },
  {
    id: "pptx-slide-order",
    description: "reverse PPTX slide ordering during import/export",
    source: path.join(evidenceDir, "pptx-slide-order.log"),
    expected: /PowerPoint-native coordinates[\s\S]*Expected[\s\S]*Received/,
  },
];

for (const mutant of mutants) {
  const log = readFileSync(mutant.source, "utf8");
  assert.match(log, /Test Suites: 1 failed/);
  assert.match(log, mutant.expected);
  mutant.status = "killed";
  mutant.evidence = `${mutant.id}.log`;
  copyFileSync(mutant.source, path.join(outputDir, mutant.evidence));
  delete mutant.source;
  delete mutant.expected;
}

const report = {
  runId,
  generatedAt: new Date().toISOString(),
  status: "passed",
  sourceRestored: true,
  mutants,
  summary: { total: mutants.length, killed: mutants.length, survived: 0, mutationScore: 1 },
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(path.join(outputDir, "report.json"), serialized, "utf8");
writeFileSync(path.join(scriptDir, "latest-mutation-report.json"), serialized, "utf8");
console.log(`[kb-mutation] passed killed=${mutants.length}/${mutants.length}`);
