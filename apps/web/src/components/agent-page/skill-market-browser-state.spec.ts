import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSkillMarketErrorMessage,
  INITIAL_SKILL_MARKET_SEARCH_STATE,
  resolveSkillMarketEmptyState,
} from "./skill-market-browser-state.ts";

test("starts the marketplace in loading state before the first search resolves", () => {
  assert.deepEqual(INITIAL_SKILL_MARKET_SEARCH_STATE, {
    loading: true,
    apiAvailable: null,
    searchError: null,
  });
});

test("offers a retry action when the skill marketplace backend is unavailable", () => {
  const unavailable = resolveSkillMarketEmptyState(false, false, "HTTP 503 Service Unavailable");

  assert.equal(unavailable.title, "后端技能市场暂不可用");
  assert.equal(unavailable.description, "最近一次请求失败：HTTP 503 Service Unavailable");
  assert.equal(unavailable.retryLabel, "重试加载");
  assert.equal(unavailable.retryAriaLabel, "重新加载技能市场");

  const unknown = resolveSkillMarketEmptyState(null, true);
  assert.equal(unknown.retryLabel, "重试加载");
  assert.equal(unknown.description, "请确认本地后端已启动，或稍后重试。");
});

test("does not show a retry action for normal empty marketplace states", () => {
  const noResults = resolveSkillMarketEmptyState(true, true);
  assert.equal(noResults.title, "无匹配结果");
  assert.equal(noResults.retryLabel, undefined);

  const empty = resolveSkillMarketEmptyState(true, false);
  assert.equal(empty.title, "暂无技能");
  assert.equal(empty.retryLabel, undefined);
});

test("formats marketplace errors into compact user-facing details", () => {
  assert.equal(
    formatSkillMarketErrorMessage(new Error("Request timed out after 15000ms")),
    "Request timed out after 15000ms",
  );
  assert.equal(
    formatSkillMarketErrorMessage({ message: "  Failed   to fetch\n/api/marketplace  " }),
    "Failed to fetch /api/marketplace",
  );
  assert.equal(formatSkillMarketErrorMessage(null), "请求技能市场失败，请确认本地后端已启动。");

  const formatted = formatSkillMarketErrorMessage("x".repeat(200));
  assert.equal(formatted.length, 140);
  assert.ok(formatted.endsWith("…"));
});
