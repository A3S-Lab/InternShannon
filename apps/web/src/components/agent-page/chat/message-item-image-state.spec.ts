import * as assert from "node:assert/strict";
import { test } from "node:test";
import { createInlineImageItems } from "./message-item-image-state.ts";

test("builds stable inline image props before InternShannon renders user image messages", () => {
  assert.deepEqual(
    createInlineImageItems([
      { mediaType: " image/png ", data: " abc123 " },
      { mediaType: "image/jpeg", data: "def456" },
    ]),
    [
      {
        key: "image/png:abc123",
        href: "data:image/png;base64,abc123",
        src: "data:image/png;base64,abc123",
        alt: "图片 1",
      },
      {
        key: "image/jpeg:def456",
        href: "data:image/jpeg;base64,def456",
        src: "data:image/jpeg;base64,def456",
        alt: "图片 2",
      },
    ],
  );
});

test("numbers only visible inline images before InternShannon renders alt text", () => {
  assert.deepEqual(
    createInlineImageItems([
      { mediaType: " ", data: "ignored" },
      { mediaType: "image/webp", data: "webp-data" },
      { mediaType: "image/png", data: "   " },
      { mediaType: "image/png", data: "png-data" },
    ]).map((item) => item.alt),
    ["图片 1", "图片 2"],
  );
});
