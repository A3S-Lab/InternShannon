import assert from "node:assert/strict";
import test from "node:test";

import { escapeXml, injectOdfMarker } from "./libreoffice-roundtrip-lib.mjs";

test("escapeXml protects ODF marker text", () => {
  assert.equal(escapeXml(`A&B <C> "D" 'E'`), "A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;");
});

test("injectOdfMarker appends Writer content", () => {
  const xml = injectOdfMarker("<office:text><text:p>before</text:p></office:text>", "docx", "DOCX-A&B");
  assert.match(xml, /<text:p>DOCX-A&amp;B<\/text:p><\/office:text>/);
});

test("injectOdfMarker appends a Calc row", () => {
  const xml = injectOdfMarker("<table:table></table:table>", "xlsx", "XLSX-MARKER");
  assert.match(xml, /<table:table-row>.*XLSX-MARKER.*<\/table:table-row>/);
});

test("injectOdfMarker appends Impress text", () => {
  const xml = injectOdfMarker("<draw:text-box><text:p>before</text:p></draw:text-box>", "pptx", "PPTX-MARKER");
  assert.match(xml, /PPTX-MARKER<\/text:p><\/draw:text-box>/);
});

test("injectOdfMarker supports Impress custom shapes", () => {
  const xml = injectOdfMarker("<draw:custom-shape><text:p>before</text:p></draw:custom-shape>", "pptx", "PPTX-SHAPE");
  assert.match(xml, /PPTX-SHAPE<\/text:p><\/draw:custom-shape>/);
});

test("injectOdfMarker rejects malformed ODF roots", () => {
  assert.throws(() => injectOdfMarker("<office:text/>", "docx", "missing"));
  assert.throws(() => injectOdfMarker("<table:table/>", "xlsx", "missing"));
  assert.throws(() => injectOdfMarker("<office:presentation/>", "pptx", "missing"));
});
