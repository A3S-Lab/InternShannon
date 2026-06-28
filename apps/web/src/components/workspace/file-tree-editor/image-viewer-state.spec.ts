import * as assert from "node:assert/strict";
import { test } from "node:test";
import { createImageObjectUrl, getImageMimeType } from "./image-viewer-state.ts";

test("resolves supported image MIME types from file paths", () => {
  assert.equal(getImageMimeType("/tmp/photo.PNG"), "image/png");
  assert.equal(getImageMimeType("/tmp/vector.svg"), "image/svg+xml");
  assert.equal(getImageMimeType("/tmp/unknown"), "application/octet-stream");
});

test("creates object URLs from copied image bytes", async () => {
  let blob: Blob | null = null;
  const data = new Uint8Array([1, 2, 3]);
  const url = createImageObjectUrl(data, "image/png", {
    createObjectURL(nextBlob: Blob) {
      blob = nextBlob;
      return "blob:test-image";
    },
  });

  data[0] = 9;

  assert.equal(url, "blob:test-image");
  assert.equal(blob?.type, "image/png");
  assert.equal(blob?.size, 3);
  assert.deepEqual(Array.from(new Uint8Array(await blob!.arrayBuffer())), [1, 2, 3]);
});
