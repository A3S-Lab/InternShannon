import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDesktopBundle } from "./check-desktop-bundle-size.mjs";

const budgets = {
  maxJavaScriptChunkBytes: 100,
  maxInitialJavaScriptBytes: 150,
  maxTotalJavaScriptBytes: 250,
};

test("accepts a split desktop bundle within every budget", () => {
  const report = evaluateDesktopBundle(
    {
      files: [
        { relativePath: "static/js/index.js", bytes: 60 },
        { relativePath: "static/js/async/office.js", bytes: 90 },
        { relativePath: "static/css/index.css", bytes: 999 },
      ],
      initialJavaScriptPaths: ["static/js/index.js"],
    },
    budgets,
  );

  assert.deepEqual(report.failures, []);
  assert.equal(report.initialJavaScriptBytes, 60);
  assert.equal(report.totalJavaScriptBytes, 150);
});

test("rejects oversized chunks, initial JavaScript, and total JavaScript", () => {
  const report = evaluateDesktopBundle(
    {
      files: [
        { relativePath: "static/js/index.js", bytes: 160 },
        { relativePath: "static/js/async/office.js", bytes: 110 },
      ],
      initialJavaScriptPaths: ["static/js/index.js"],
    },
    budgets,
  );

  assert.equal(report.failures.length, 3);
  assert.match(report.failures[0], /office\.js|index\.js/);
  assert.match(report.failures[1], /首屏 JavaScript/);
  assert.match(report.failures[2], /JavaScript 总量/);
});
