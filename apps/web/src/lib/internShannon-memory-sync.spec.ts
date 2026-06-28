import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveInternShannonMemorySyncFailureStatus } from "./internShannon-memory-sync.ts";

test("treats the desktop-only missing memory endpoint as local-only", () => {
  assert.equal(
    resolveInternShannonMemorySyncFailureStatus({
      code: 404,
      message: "Cannot GET /api/v1/kernel/me/memories",
    }),
    "local-only",
  );

  assert.equal(resolveInternShannonMemorySyncFailureStatus({ status: 501 }), "local-only");
});

test("treats nested missing memory endpoint responses as local-only", () => {
  assert.equal(
    resolveInternShannonMemorySyncFailureStatus({
      response: {
        status: "404",
      },
    }),
    "local-only",
  );
});

test("keeps real server failures visible as sync errors", () => {
  assert.equal(resolveInternShannonMemorySyncFailureStatus({ code: 500 }), "error");
  assert.equal(resolveInternShannonMemorySyncFailureStatus(new Error("database temporarily unavailable")), "error");
});
