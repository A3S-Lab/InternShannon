import * as assert from "node:assert/strict";
import { test } from "node:test";
import { pathToActivityKey, resolveStoredActivityRoute, shouldPersistActivityKey } from "./activity-route-state.ts";

const staticKeys = ["chat", "knowledge", "settings"];
const routeMap = {
  chat: "/",
  knowledge: "/knowledge",
  settings: "/settings",
};

test("maps the default route to chat", () => {
  assert.equal(pathToActivityKey("/", {}, staticKeys, routeMap), "chat");
});

test("maps agent config routes to the knowledge activity for legacy compatibility", () => {
  assert.equal(pathToActivityKey("/agent/default/config", {}, staticKeys, routeMap), "knowledge");
});

test("maps builtin settings and knowledge subroutes to their activity keys", () => {
  assert.equal(pathToActivityKey("/settings", {}, staticKeys, routeMap), "settings");
  assert.equal(pathToActivityKey("/knowledge/pages", {}, staticKeys, routeMap), "knowledge");
  assert.equal(pathToActivityKey("/skills/local", {}, staticKeys, routeMap), "knowledge");
});

test("plugin routes win over static segment fallback", () => {
  assert.equal(pathToActivityKey("/tools/review", { "review-tools": "/tools" }, staticKeys, routeMap), "review-tools");
});

test("persists non-root recognized activity routes only", () => {
  assert.equal(shouldPersistActivityKey("/", "chat", routeMap), false);
  assert.equal(shouldPersistActivityKey("/agent/default/config", "knowledge", routeMap), true);
  assert.equal(shouldPersistActivityKey("/missing", "chat", routeMap), false);
  assert.equal(shouldPersistActivityKey("/plugin", "unknown-plugin", routeMap), false);
});

test("restores a stored builtin activity only from the root route", () => {
  assert.deepEqual(
    resolveStoredActivityRoute({
      storedKey: "settings",
      pathname: "/",
      routeMap,
      staticKeys,
    }),
    { kind: "navigate", path: "/settings" },
  );

  assert.deepEqual(
    resolveStoredActivityRoute({
      storedKey: "settings",
      pathname: "/knowledge",
      routeMap,
      staticKeys,
    }),
    { kind: "none" },
  );
});

test("does not clear unknown dynamic activity keys before their routes are known", () => {
  assert.deepEqual(
    resolveStoredActivityRoute({
      storedKey: "review-tools",
      pathname: "/",
      routeMap,
      staticKeys,
    }),
    { kind: "none" },
  );
});

test("clears stale builtin activity keys when the static route map no longer contains them", () => {
  assert.deepEqual(
    resolveStoredActivityRoute({
      storedKey: "settings",
      pathname: "/",
      routeMap: { chat: "/", knowledge: "/knowledge" },
      staticKeys,
    }),
    { kind: "clear" },
  );
});
