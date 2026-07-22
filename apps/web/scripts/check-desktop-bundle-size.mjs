#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DESKTOP_BUNDLE_BUDGETS = Object.freeze({
  maxJavaScriptChunkBytes: 4 * 1024 * 1024,
  maxInitialJavaScriptBytes: 8 * 1024 * 1024,
  maxTotalJavaScriptBytes: 52 * 1024 * 1024,
});

export function evaluateDesktopBundle({ files, initialJavaScriptPaths }, budgets = DESKTOP_BUNDLE_BUDGETS) {
  const javascriptFiles = files.filter((file) => file.relativePath.endsWith(".js"));
  const initialPaths = new Set(initialJavaScriptPaths);
  const initialJavaScriptBytes = javascriptFiles
    .filter((file) => initialPaths.has(file.relativePath))
    .reduce((total, file) => total + file.bytes, 0);
  const totalJavaScriptBytes = javascriptFiles.reduce((total, file) => total + file.bytes, 0);
  const oversizedChunks = javascriptFiles
    .filter((file) => file.bytes > budgets.maxJavaScriptChunkBytes)
    .sort((left, right) => right.bytes - left.bytes);
  const failures = [];

  if (oversizedChunks.length > 0) {
    failures.push(
      `JavaScript chunk 超过 ${formatMiB(budgets.maxJavaScriptChunkBytes)}：${oversizedChunks
        .map((file) => `${file.relativePath} (${formatMiB(file.bytes)})`)
        .join(", ")}`,
    );
  }
  if (initialJavaScriptBytes > budgets.maxInitialJavaScriptBytes) {
    failures.push(
      `首屏 JavaScript 为 ${formatMiB(initialJavaScriptBytes)}，预算 ${formatMiB(budgets.maxInitialJavaScriptBytes)}`,
    );
  }
  if (totalJavaScriptBytes > budgets.maxTotalJavaScriptBytes) {
    failures.push(
      `JavaScript 总量为 ${formatMiB(totalJavaScriptBytes)}，预算 ${formatMiB(budgets.maxTotalJavaScriptBytes)}`,
    );
  }

  return {
    failures,
    initialJavaScriptBytes,
    javascriptChunkCount: javascriptFiles.length,
    largestJavaScriptChunkBytes: javascriptFiles.reduce((largest, file) => Math.max(largest, file.bytes), 0),
    totalJavaScriptBytes,
  };
}

export function readDesktopBundle(distRoot) {
  const files = collectFiles(distRoot).map((absolutePath) => ({
    absolutePath,
    bytes: fs.statSync(absolutePath).size,
    relativePath: path.relative(distRoot, absolutePath).replaceAll(path.sep, "/"),
  }));
  const indexPath = path.join(distRoot, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`找不到桌面构建入口：${indexPath}`);
  }
  const html = fs.readFileSync(indexPath, "utf8");
  const initialJavaScriptPaths = [...html.matchAll(/<script\b[^>]*\bsrc=["'](?:\.\/|\/)?([^"']+\.js)["']/g)].map(
    (match) => match[1],
  );
  return { files, initialJavaScriptPaths };
}

export function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(absolutePath) : [absolutePath];
  });
}

function runCli() {
  const distRoot = path.resolve("dist/workspace");
  const report = evaluateDesktopBundle(readDesktopBundle(distRoot));
  console.log(
    `desktop bundle budget: ${report.javascriptChunkCount} JS chunks, ` +
      `largest ${formatMiB(report.largestJavaScriptChunkBytes)}, ` +
      `initial ${formatMiB(report.initialJavaScriptBytes)}, total ${formatMiB(report.totalJavaScriptBytes)}`,
  );
  if (report.failures.length > 0) {
    for (const failure of report.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
