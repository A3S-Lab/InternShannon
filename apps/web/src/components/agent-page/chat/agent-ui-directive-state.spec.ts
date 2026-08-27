import assert from "node:assert/strict";
import test from "node:test";
import { parseTrustedAgentUiDirective } from "./agent-ui-directive-state.ts";

const valid = JSON.stringify({
  component: "quick-actions",
  props: { actions: [{ label: "授权并继续", icon: "book", prefill: "我授权并继续", autoSend: true }] },
});

test("parses a valid quick-action and repairs one missing final object brace", () => {
  assert.equal(parseTrustedAgentUiDirective(valid)?.component, "quick-actions");
  assert.equal(parseTrustedAgentUiDirective(valid.slice(0, -1))?.component, "quick-actions");
});

test("rejects malformed or unsafe quick-actions", () => {
  assert.equal(parseTrustedAgentUiDirective('{"component":"quick-actions"'), null);
  assert.equal(
    parseTrustedAgentUiDirective(
      JSON.stringify({ component: "quick-actions", props: { actions: [{ label: "外链", navigate: "//evil.test" }] } }),
    ),
    null,
  );
  assert.equal(
    parseTrustedAgentUiDirective(
      JSON.stringify({
        component: "quick-actions",
        props: { actions: [{ label: "未知字段", prefill: "继续", command: "unsafe" }] },
      }),
    ),
    null,
  );
  assert.equal(
    parseTrustedAgentUiDirective(
      JSON.stringify({
        component: "quick-actions",
        props: { actions: [{ label: "错误导航", navigate: "/knowledge", prefill: 123 }] },
      }),
    ),
    null,
  );
});
