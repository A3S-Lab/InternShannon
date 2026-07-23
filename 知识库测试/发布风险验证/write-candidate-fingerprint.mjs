import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const reportPath = path.join(scriptDir, "latest-candidate-fingerprint.json");
const reportRelativePath = "知识库测试/发布风险验证/latest-candidate-fingerprint.json";

const git = (...args) => execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd: repoRoot, encoding: "utf8" }).trim();
const gitOptional = (...args) => {
  try {
    return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
const head = git("rev-parse", "HEAD");
const upstream = gitOptional("rev-parse", "@{upstream}");

const statusLines = execFileSync("git", ["-c", "core.quotepath=false", "status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const tracked = [];
const candidateUntracked = [];
const excludedUntracked = [];

for (const line of statusLines) {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3);
  const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
  // The report cannot hash itself: doing so would make every generated digest
  // describe the previous report bytes instead of the candidate it names.
  if (filePath === reportRelativePath) continue;
  if (status === "??") {
    if (isCandidatePath(filePath)) candidateUntracked.push(filePath);
    else excludedUntracked.push(filePath);
  } else {
    tracked.push({ status, path: filePath });
  }
}

const trackedPatch = execFileSync("git", ["-c", "core.quotepath=false", "diff", "--binary", "HEAD", "--", ...tracked.map((item) => item.path)], {
  cwd: repoRoot,
  maxBuffer: 128 * 1024 * 1024,
});
const untrackedFiles = candidateUntracked.map((filePath) => fileDigest(filePath));
const candidateDigest = createHash("sha256")
  .update(trackedPatch)
  .update(JSON.stringify(untrackedFiles))
  .digest("hex");

const report = {
  generatedAt: new Date().toISOString(),
  baseline: { head, upstream, headMatchesUpstream: upstream === null ? null : head === upstream },
  candidateDigest,
  trackedChanges: tracked,
  candidateUntracked: untrackedFiles,
  excludedUntracked,
  scopeRules: {
    included: ["apps/**", "packages/**", "docs/**", "知识库测试/**", ".gitignore"],
    excluded: ["this generated fingerprint report", "root SKILL.md", "standalone research PDFs"],
  },
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`[candidate-fingerprint] ${candidateDigest} tracked=${tracked.length} untracked=${untrackedFiles.length}`);

function isCandidatePath(filePath) {
  if (filePath === ".gitignore") return true;
  if (/^(apps|packages|docs)\//.test(filePath)) return true;
  if (filePath.startsWith("知识库测试/")) {
    return !/\/(?:ASM-Loc|E2E-TAD|FTCL|P-MIL|RSKP)\.pdf$/.test(filePath);
  }
  return false;
}

function fileDigest(filePath) {
  const absolute = path.join(repoRoot, filePath);
  const stats = statSync(absolute);
  const bytes = readFileSync(absolute);
  return {
    path: filePath,
    bytes: stats.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
