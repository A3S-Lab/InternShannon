import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { hasElementWithDisplayName } from "./dialog-title-detection.ts";

function DialogTitleLike({ children }: { children: React.ReactNode }) {
  return React.createElement("h2", null, children);
}
DialogTitleLike.displayName = "DialogTitle";

test("detects a wrapped dialog title nested inside layout elements", () => {
  const content = React.createElement(
    "div",
    null,
    React.createElement("section", null, React.createElement(DialogTitleLike, null, "完成首次默认配置")),
  );

  assert.equal(hasElementWithDisplayName(content, "DialogTitle"), true);
});

test("detects forwardRef title wrappers by displayName", () => {
  const ForwardedTitle = React.forwardRef<HTMLHeadingElement, { children: React.ReactNode }>((props, ref) =>
    React.createElement("h2", { ref }, props.children),
  );
  ForwardedTitle.displayName = "DialogTitle";

  const content = React.createElement(
    "div",
    null,
    React.createElement("section", null, React.createElement(ForwardedTitle, null, "移动会话列表")),
  );

  assert.equal(hasElementWithDisplayName(content, "DialogTitle"), true);
});

test("does not treat ordinary nested elements as dialog titles", () => {
  const content = React.createElement("div", null, React.createElement("h2", null, "完成首次默认配置"));

  assert.equal(hasElementWithDisplayName(content, "DialogTitle"), false);
});
