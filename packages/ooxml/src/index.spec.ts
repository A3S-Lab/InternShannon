import JSZip = require("jszip");
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import * as XLSX from "xlsx";

jest.mock("@univerjs/core", () => ({
    BooleanNumber: { FALSE: 0, TRUE: 1 },
    CellValueType: { BOOLEAN: 2, NUMBER: 1, STRING: 0 },
    LocaleType: { ZH_CN: "zhCN" },
    // 富文本 docx 往返用到的枚举（数值对齐 @univerjs/core 0.24 的 d.ts 定义）。
    NamedStyleType: {
        NAMED_STYLE_TYPE_UNSPECIFIED: 0,
        NORMAL_TEXT: 1,
        TITLE: 2,
        SUBTITLE: 3,
        HEADING_1: 4,
        HEADING_2: 5,
        HEADING_3: 6,
        HEADING_4: 7,
        HEADING_5: 8,
    },
    PresetListType: { ORDER_LIST: "ORDER_LIST", BULLET_LIST: "BULLET_LIST" },
    CustomRangeType: { HYPERLINK: 0 },
    DrawingTypeEnum: { DRAWING_IMAGE: 0 },
    ObjectRelativeFromH: { PAGE: 0 },
    ObjectRelativeFromV: { PAGE: 0 },
    PositionedObjectLayoutType: { INLINE: 0 },
    TableAlignmentType: { START: 0, CENTER: 1, END: 2 },
    TableSizeType: { UNSPECIFIED: 0, SPECIFIED: 1 },
    TableTextWrapType: { NONE: 0, WRAP: 1 },
    TableLayoutType: { AUTO_FIT: 0, FIXED: 1 },
    getPlainText: (dataStream: string) =>
        dataStream.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, ""),
}));

jest.mock("@univerjs/slides", () => ({
    BasicShapes: { Rect: "rect", RoundRect: "roundRect", Ellipse: "ellipse" },
    PageElementType: { SHAPE: 0, TEXT: 2 },
    PageType: { SLIDE: "SLIDE" },
}));

import {
    docxBytesToUniverDocumentSnapshot,
    getOfficeExtension,
    getOfficeFileCapability,
    getOfficeFileKind,
    getOfficeFileName,
    pptxBytesToUniverSlideSnapshot,
    plainTextToUniverDocumentSnapshot,
    univerDocumentSnapshotToDocxBytes,
    univerDocumentSnapshotToPreservedDocxBytes,
    univerDocumentSnapshotToPlainText,
    univerSlideSnapshotToPptxBytes,
    univerWorkbookSnapshotToBytes,
    univerWorkbookSnapshotToPreservedXlsxBytes,
    workbookBytesToUniverSnapshot,
} from "./index";

function workbookBytes(rows: unknown[][]): Uint8Array {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet.C3 = { t: "n", v: 42, f: "SUM(B2:B2)" };
    worksheet["!ref"] = "A1:C3";
    XLSX.utils.book_append_sheet(workbook, worksheet, "Scores");
    return new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

async function sparseWorkbookBytes(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file(
        "[Content_Types].xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    );
    zip.file(
        "_rels/.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    );
    zip.file(
        "xl/workbook.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sparse" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    );
    zip.file(
        "xl/_rels/workbook.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    );
    zip.file(
        "xl/worksheets/sheet1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:XFD1048576"/>
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>start</t></is></c></row>
    <row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>end</t></is></c></row>
  </sheetData>
</worksheet>`,
    );
    return zip.generateAsync({ type: "uint8array" });
}

function slideXml(text: string): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:t>${text}</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

async function pptxBytes(text: string): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml(text));
    return zip.generateAsync({ type: "uint8array" });
}

const POWERPOINT_NATIVE_FIXTURE = path.resolve(
    __dirname,
    "../../../知识库测试/Phase5-9网页测试/office/knowledge-smoke.pptx",
);

function xmlDocument(xml: string): Document {
    return new DOMParser().parseFromString(xml, "application/xml");
}

function elements(document: Document | Element, localName: string): Element[] {
    return Array.from(document.getElementsByTagNameNS("*", localName));
}

async function zipText(zip: JSZip, name: string): Promise<string> {
    const value = await zip.file(name)?.async("text");
    if (!value) throw new Error(`Missing fixture part: ${name}`);
    return value;
}

function relationshipTypes(xml: string): string[] {
    return elements(xmlDocument(xml), "Relationship").map((relationship) => relationship.getAttribute("Type") ?? "");
}

describe("office file helpers", () => {
    it("normalizes file names and extensions from paths or refs", () => {
        expect(getOfficeFileName("/tmp/reports/quarter.xlsx")).toBe("quarter.xlsx");
        expect(getOfficeFileName({ path: "C:\\tmp\\deck.pptx" })).toBe("deck.pptx");
        expect(getOfficeFileName({ filename: "memo.docx", path: "ignored.xlsx" })).toBe("memo.docx");
        expect(getOfficeExtension("/tmp/reports/quarter.XLSX")).toBe("xlsx");
        expect(getOfficeExtension("README")).toBe("readme");
    });

    it("round-trips Univer document plain text snapshots", () => {
        const snapshot = plainTextToUniverDocumentSnapshot("memo.docx", "first line\nsecond line");

        expect(snapshot.title).toBe("memo.docx");
        expect(univerDocumentSnapshotToPlainText(snapshot)).toBe("first line\nsecond line");
    });

    it("describes direct Univer support without loading adapter dependencies", () => {
        expect(getOfficeFileKind("memo.docx")).toBe("document");
        expect(getOfficeFileKind("sheet.xls")).toBe("spreadsheet");
        expect(getOfficeFileKind("deck.pptx")).toBe("presentation");
        expect(getOfficeFileKind("image.png")).toBeNull();

        expect(getOfficeFileCapability("memo.docx")).toMatchObject({
            kind: "document",
            directUniver: true,
            editable: true,
        });
        expect(getOfficeFileCapability("legacy.doc")).toMatchObject({
            kind: "document",
            directUniver: false,
            editable: false,
            unsupportedReason: "legacy-binary",
        });
        expect(getOfficeFileCapability("slides.odp")).toMatchObject({
            kind: "presentation",
            directUniver: false,
            editable: false,
            unsupportedReason: "opendocument-unsupported",
        });
    });
});

describe("workbookBytesToUniverSnapshot", () => {
    it("imports cell values and formulas, then exports workbook bytes", () => {
        const snapshot = workbookBytesToUniverSnapshot(
            workbookBytes([
                ["Name", "Score", "Active"],
                ["Ada", 42, true],
            ]),
            { filename: "scores.xlsx" },
        );
        const sheet = snapshot.sheets[snapshot.sheetOrder[0]];

        expect(snapshot.name).toBe("scores.xlsx");
        expect(sheet.name).toBe("Scores");
        expect(sheet.cellData?.[1]?.[0]?.v).toBe("Ada");
        expect(sheet.cellData?.[1]?.[1]?.v).toBe(42);
        expect(sheet.cellData?.[1]?.[2]?.v).toBe(true);
        expect(sheet.cellData?.[2]?.[2]?.f).toBe("=SUM(B2:B2)");

        const output = univerWorkbookSnapshotToBytes(snapshot, "xlsx");
        const workbook = XLSX.read(output, { type: "array" });
        const exported = workbook.Sheets.Scores;
        expect(exported.A2.v).toBe("Ada");
        expect(exported.B2.v).toBe(42);
        expect(exported.C3.f).toBe("SUM(B2:B2)");
    });

    it("imports sparse sheets by visiting actual cells instead of the whole range", async () => {
        const snapshot = workbookBytesToUniverSnapshot(await sparseWorkbookBytes(), { filename: "sparse.xlsx" });
        const sheet = snapshot.sheets[snapshot.sheetOrder[0]];

        expect(sheet.name).toBe("Sparse");
        expect(sheet.rowCount).toBe(1048576);
        expect(sheet.columnCount).toBe(16384);
        expect(sheet.cellData?.[0]?.[0]?.v).toBe("start");
        expect(sheet.cellData?.[1048575]?.[16383]?.v).toBe("end");
    });

    it("edits cells in place while preserving advanced chart, drawing, media and relationship parts", async () => {
        const original = workbookBytes([
            ["Metric", "Value"],
            ["Renewal", 42],
        ]);
        const zip = await JSZip.loadAsync(original);
        const worksheetPath = "xl/worksheets/sheet1.xml";
        const worksheet = await zipText(zip, worksheetPath);
        const withRelationshipNamespace = worksheet.includes("xmlns:r=")
            ? worksheet
            : worksheet.replace(
                  "<worksheet",
                  '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
              );
        zip.file(worksheetPath, withRelationshipNamespace.replace("</worksheet>", '<drawing r:id="rId99"/></worksheet>'));
        zip.file(
            "xl/worksheets/_rels/sheet1.xml.rels",
            '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing99.xml"/></Relationships>',
        );
        zip.file(
            "xl/drawings/drawing99.xml",
            '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor/></xdr:wsDr>',
        );
        zip.file(
            "xl/charts/chart99.xml",
            '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart/></c:chartSpace>',
        );
        zip.file("xl/media/preserve.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
        const augmented = await zip.generateAsync({ type: "uint8array" });
        const snapshot = workbookBytesToUniverSnapshot(augmented, { filename: "advanced.xlsx" });
        const baseline = JSON.parse(JSON.stringify(snapshot));
        snapshot.sheets[snapshot.sheetOrder[0]].cellData![1]![1]!.v = 84;

        const output = await univerWorkbookSnapshotToPreservedXlsxBytes(snapshot, {
            originalBytes: augmented,
            baselineSnapshot: baseline,
        });
        const before = await JSZip.loadAsync(augmented);
        const after = await JSZip.loadAsync(output);
        for (const part of [
            "xl/worksheets/_rels/sheet1.xml.rels",
            "xl/drawings/drawing99.xml",
            "xl/charts/chart99.xml",
            "xl/media/preserve.png",
        ]) {
            expect(await after.file(part)?.async("uint8array")).toEqual(await before.file(part)?.async("uint8array"));
        }
        expect(await zipText(after, worksheetPath)).toContain('<drawing r:id="rId99"/>');
        const reopened = XLSX.read(output, { type: "array" });
        expect(reopened.Sheets.Scores.B2.v).toBe(84);
    });

    it("rejects unsafe style changes in advanced workbooks instead of silently rebuilding them", async () => {
        const original = workbookBytes([["value"]]);
        const zip = await JSZip.loadAsync(original);
        zip.file("xl/charts/chart99.xml", "<chart/>");
        const augmented = await zip.generateAsync({ type: "uint8array" });
        const snapshot = workbookBytesToUniverSnapshot(augmented, { filename: "advanced.xlsx" });
        const baseline = JSON.parse(JSON.stringify(snapshot));
        snapshot.sheets[snapshot.sheetOrder[0]].cellData![0]![0]!.s = { bl: 1 };
        await expect(
            univerWorkbookSnapshotToPreservedXlsxBytes(snapshot, {
                originalBytes: augmented,
                baselineSnapshot: baseline,
            }),
        ).rejects.toThrow(/暂不支持.*单元格样式/);
    });
});

describe("pptxBytesToUniverSlideSnapshot", () => {
    it("imports and writes back editable slide text while preserving the package", async () => {
        const original = await pptxBytes("Original title");
        const snapshot = await pptxBytesToUniverSlideSnapshot(original, { filename: "deck.pptx" });
        const page = snapshot.body?.pages[snapshot.body.pageOrder[0]];
        const firstElement = Object.values(page?.pageElements ?? {})[0];

        expect(snapshot.title).toBe("deck.pptx");
        expect(firstElement?.richText?.text).toBe("Original title");

        if (firstElement?.richText) {
            firstElement.richText.text = "Updated title";
        }
        const updated = await univerSlideSnapshotToPptxBytes(snapshot, original);
        const zip = await JSZip.loadAsync(updated);
        const xml = await zip.file("ppt/slides/slide1.xml")?.async("text");

        expect(xml).toContain(">Updated title<");
        expect(xml).not.toContain(">Original title<");
    });

    it("imports PowerPoint-native coordinates, theme fill and a non-text rectangle", async () => {
        const original = new Uint8Array(readFileSync(POWERPOINT_NATIVE_FIXTURE));
        const snapshot = await pptxBytesToUniverSlideSnapshot(original, { filename: "knowledge-smoke.pptx" });
        const pageIds = snapshot.body?.pageOrder ?? [];
        const secondPage = pageIds[1] ? snapshot.body?.pages[pageIds[1]] : undefined;
        const pageElements = Object.values(secondPage?.pageElements ?? {});
        const text = pageElements.find((element) => element.type === 2);
        const rectangle = pageElements.find((element) => element.type === 0);

        expect(pageIds).toHaveLength(2);
        expect(snapshot.pageSize).toEqual({ width: 960, height: 540 });
        expect(text).toMatchObject({
            title: "文本框 3",
            left: expect.closeTo(71.16, 1),
            top: expect.closeTo(58.6, 1),
            richText: { text: "111" },
        });
        expect(rectangle).toMatchObject({
            title: "矩形 4",
            left: expect.closeTo(92.93, 1),
            top: expect.closeTo(140.65, 1),
            width: expect.closeTo(293.86, 1),
            height: expect.closeTo(157.4, 1),
            shape: {
                shapeType: "rect",
                shapeProperties: { shapeBackgroundFill: { rgb: "#156082" } },
            },
        });
    });

    it("keeps master, layout, theme, relationship and shape geometry parts unchanged on text save", async () => {
        const original = new Uint8Array(readFileSync(POWERPOINT_NATIVE_FIXTURE));
        const snapshot = await pptxBytesToUniverSlideSnapshot(original, { filename: "knowledge-smoke.pptx" });
        const firstPageId = snapshot.body?.pageOrder[0];
        const firstPage = firstPageId ? snapshot.body?.pages[firstPageId] : undefined;
        const firstText = Object.values(firstPage?.pageElements ?? {}).find((element) => element.type === 2);
        if (firstText?.richText) firstText.richText.text = "PowerPoint native round-trip BQ-7429";

        const output = await univerSlideSnapshotToPptxBytes(snapshot, original);
        const before = await JSZip.loadAsync(original);
        const after = await JSZip.loadAsync(output);
        const invariantParts = [
            "[Content_Types].xml",
            "_rels/.rels",
            "ppt/_rels/presentation.xml.rels",
            "ppt/slideMasters/slideMaster1.xml",
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            "ppt/slideLayouts/slideLayout1.xml",
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            "ppt/theme/theme1.xml",
            "ppt/slides/_rels/slide1.xml.rels",
            "ppt/slides/_rels/slide2.xml.rels",
        ];
        for (const part of invariantParts) {
            expect(await after.file(part)?.async("text")).toBe(await before.file(part)?.async("text"));
        }
        const firstSlide = await zipText(after, "ppt/slides/slide1.xml");
        const secondSlide = xmlDocument(await zipText(after, "ppt/slides/slide2.xml"));
        const rectangle = elements(secondSlide, "sp").find((shape) =>
            elements(shape, "cNvPr").some((nonVisual) => nonVisual.getAttribute("name") === "矩形 4"),
        );
        const transform = rectangle ? elements(rectangle, "xfrm")[0] : undefined;

        expect(firstSlide).toContain("PowerPoint native round-trip BQ-7429");
        expect(rectangle).toBeDefined();
        expect(elements(rectangle as Element, "prstGeom")[0]?.getAttribute("prst")).toBe("rect");
        expect(elements(transform as Element, "off")[0]).toMatchObject({});
        expect(elements(transform as Element, "off")[0]?.getAttribute("x")).toBe("1180214");
        expect(elements(transform as Element, "off")[0]?.getAttribute("y")).toBe("1786270");
        expect(elements(transform as Element, "ext")[0]?.getAttribute("cx")).toBe("3732028");
        expect(elements(transform as Element, "ext")[0]?.getAttribute("cy")).toBe("1998921");
    });
});

describe("PowerPoint-native PPTX package contract", () => {
    it("contains content types, master, layouts, theme and complete relationship chains", async () => {
        const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(POWERPOINT_NATIVE_FIXTURE)));
        const requiredParts = [
            "[Content_Types].xml",
            "_rels/.rels",
            "ppt/presentation.xml",
            "ppt/_rels/presentation.xml.rels",
            "ppt/slideMasters/slideMaster1.xml",
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            "ppt/slideLayouts/slideLayout1.xml",
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            "ppt/theme/theme1.xml",
            "ppt/slides/slide1.xml",
            "ppt/slides/_rels/slide1.xml.rels",
            "ppt/slides/slide2.xml",
            "ppt/slides/_rels/slide2.xml.rels",
        ];
        for (const part of requiredParts) expect(zip.file(part)).not.toBeNull();

        const contentTypes = await zipText(zip, "[Content_Types].xml");
        expect(contentTypes).toContain("presentationml.presentation.main+xml");
        expect(contentTypes).toContain("presentationml.slideMaster+xml");
        expect(contentTypes).toContain("presentationml.slideLayout+xml");
        expect(contentTypes).toContain("openxmlformats-officedocument.theme+xml");
        expect(contentTypes.match(/presentationml\.slide\+xml/g)).toHaveLength(2);

        const rootRelationships = relationshipTypes(await zipText(zip, "_rels/.rels"));
        expect(rootRelationships).toContain("http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument");

        const presentationRelationships = relationshipTypes(await zipText(zip, "ppt/_rels/presentation.xml.rels"));
        expect(presentationRelationships).toEqual(
            expect.arrayContaining([
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
            ]),
        );
        expect(presentationRelationships.filter((type) => type.endsWith("/slide"))).toHaveLength(2);

        const masterRelationships = relationshipTypes(await zipText(zip, "ppt/slideMasters/_rels/slideMaster1.xml.rels"));
        expect(masterRelationships).toEqual(
            expect.arrayContaining([
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
            ]),
        );
        for (const slideNumber of [1, 2]) {
            const types = relationshipTypes(await zipText(zip, `ppt/slides/_rels/slide${slideNumber}.xml.rels`));
            expect(types).toEqual(["http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"]);
        }
        const layoutRelationships = relationshipTypes(await zipText(zip, "ppt/slideLayouts/_rels/slideLayout1.xml.rels"));
        expect(layoutRelationships).toEqual(["http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster"]);
    });

    it("provides non-visual shape properties, positive geometry and a theme-backed rectangle", async () => {
        const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(POWERPOINT_NATIVE_FIXTURE)));
        const slide = xmlDocument(await zipText(zip, "ppt/slides/slide2.xml"));
        const shapeTree = elements(slide, "spTree")[0];
        expect(elements(shapeTree, "nvGrpSpPr")).toHaveLength(1);
        expect(elements(shapeTree, "grpSpPr")).toHaveLength(1);

        const rectangle = elements(shapeTree, "sp").find((shape) =>
            elements(shape, "cNvPr").some((nonVisual) => nonVisual.getAttribute("name") === "矩形 4"),
        );
        expect(rectangle).toBeDefined();
        const nonVisual = elements(rectangle as Element, "nvSpPr")[0];
        expect(elements(nonVisual, "cNvPr")[0]?.getAttribute("id")).toBe("5");
        expect(elements(nonVisual, "cNvSpPr")).toHaveLength(1);
        expect(elements(nonVisual, "nvPr")).toHaveLength(1);

        const properties = elements(rectangle as Element, "spPr")[0];
        const transform = elements(properties, "xfrm")[0];
        const offset = elements(transform, "off")[0];
        const extent = elements(transform, "ext")[0];
        expect(Number(offset.getAttribute("x"))).toBeGreaterThanOrEqual(0);
        expect(Number(offset.getAttribute("y"))).toBeGreaterThanOrEqual(0);
        expect(Number(extent.getAttribute("cx"))).toBeGreaterThan(0);
        expect(Number(extent.getAttribute("cy"))).toBeGreaterThan(0);
        expect(elements(properties, "prstGeom")[0]?.getAttribute("prst")).toBe("rect");
        expect(elements(rectangle as Element, "fillRef")[0]?.getAttribute("idx")).toBe("1");
        expect(elements(rectangle as Element, "fillRef")[0]?.textContent).toBe("");
        expect(elements(elements(rectangle as Element, "fillRef")[0], "schemeClr")[0]?.getAttribute("val")).toBe("accent1");
    });

    it("terminates safely for deterministic truncated and byte-flipped PPTX inputs", async () => {
        const original = new Uint8Array(readFileSync(POWERPOINT_NATIVE_FIXTURE));
        const mutations: Uint8Array[] = [
            original.slice(0, 0),
            original.slice(0, 4),
            original.slice(0, Math.floor(original.length / 2)),
            original.slice(0, original.length - 22),
        ];
        let state = 0x50505458;
        for (let iteration = 0; iteration < 32; iteration += 1) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            const mutated = original.slice();
            const offset = state % mutated.length;
            mutated[offset] ^= 0xff;
            mutations.push(mutated);
        }

        let rejected = 0;
        let parsed = 0;
        for (const [index, input] of mutations.entries()) {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const timeoutResult = new Promise<{ status: "timeout" }>((resolve) => {
                timeout = setTimeout(() => resolve({ status: "timeout" }), 2000);
            });
            const outcome = await Promise.race([
                pptxBytesToUniverSlideSnapshot(input, { filename: `mutated-${index}.pptx` })
                    .then((snapshot) => ({ status: "parsed" as const, snapshot }))
                    .catch((error: unknown) => ({ status: "rejected" as const, error })),
                timeoutResult,
            ]).finally(() => {
                if (timeout) clearTimeout(timeout);
            });
            expect(outcome.status).not.toBe("timeout");
            if (outcome.status === "rejected") {
                rejected += 1;
                expect(outcome.error).toBeInstanceOf(Error);
            } else if (outcome.status === "parsed") {
                parsed += 1;
                expect(outcome.snapshot.body?.pageOrder).toBeInstanceOf(Array);
            }
        }
        expect(rejected + parsed).toBe(mutations.length);
        expect(rejected).toBeGreaterThan(0);
        expect(parsed).toBeGreaterThan(0);
    });
});

// 富文本 .docx 往返：标题 / 粗斜 / 列表 / 表格 应被保留。
async function richDocxBytes(): Promise<Uint8Array> {
    const {
        Document,
        HeadingLevel,
        Packer,
        Paragraph,
        Table,
        TableCell,
        TableRow,
        TextRun,
        WidthType,
    } = await import("docx");

    const doc = new Document({
        sections: [
            {
                children: [
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Quarterly Report")] }),
                    new Paragraph({
                        children: [
                            new TextRun({ text: "Bold part", bold: true }),
                            new TextRun({ text: " and italic part", italics: true }),
                        ],
                    }),
                    new Paragraph({ bullet: { level: 0 }, children: [new TextRun("First bullet")] }),
                    new Paragraph({ bullet: { level: 0 }, children: [new TextRun("Second bullet")] }),
                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        rows: [
                            new TableRow({
                                children: [
                                    new TableCell({ children: [new Paragraph({ children: [new TextRun("Cell A1")] })] }),
                                    new TableCell({ children: [new Paragraph({ children: [new TextRun("Cell B1")] })] }),
                                ],
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({ children: [new Paragraph({ children: [new TextRun("Cell A2")] })] }),
                                    new TableCell({ children: [new Paragraph({ children: [new TextRun("Cell B2")] })] }),
                                ],
                            }),
                        ],
                    }),
                ],
            },
        ],
    });
    const arrayBuffer = await Packer.toArrayBuffer(doc);
    return new Uint8Array(arrayBuffer);
}

function dataStreamText(snapshot: { body?: { dataStream?: string } }): string {
    // 去掉所有控制字符（含表格/段落/图片占位 token），仅保留可见文本便于断言。
    const stream = snapshot.body?.dataStream ?? "";
    let out = "";
    for (const ch of stream) {
        out += ch.charCodeAt(0) < 0x20 ? " " : ch;
    }
    return out;
}

describe("docx rich-text round-trip", () => {
    it("preserves headings, bold/italic runs, list items and table cells through import → export → import", async () => {
        const original = await richDocxBytes();

        const first = await docxBytesToUniverDocumentSnapshot(original, { filename: "report.docx" });
        expect(first.title).toBe("report.docx");

        // 标题段落带命名样式（HEADING_1 = 4）。
        const hasHeading = (first.body?.paragraphs ?? []).some((p) => p.paragraphStyle?.namedStyleType === 4);
        expect(hasHeading).toBe(true);

        // 粗体 run。
        const hasBoldRun = (first.body?.textRuns ?? []).some((r) => r.ts?.bl === 1);
        expect(hasBoldRun).toBe(true);
        // 斜体 run。
        const hasItalicRun = (first.body?.textRuns ?? []).some((r) => r.ts?.it === 1);
        expect(hasItalicRun).toBe(true);

        // 列表项（bullet）。
        const bulletCount = (first.body?.paragraphs ?? []).filter((p) => p.bullet).length;
        expect(bulletCount).toBeGreaterThanOrEqual(2);

        // 表格结构（body.tables + tableSource）。
        expect((first.body?.tables ?? []).length).toBe(1);
        const tableId = first.body?.tables?.[0]?.tableId ?? "";
        expect(first.tableSource?.[tableId]?.tableRows.length).toBe(2);

        // 文本内容完整。
        const firstText = dataStreamText(first);
        expect(firstText).toContain("Quarterly Report");
        expect(firstText).toContain("Bold part");
        expect(firstText).toContain("Cell A1");
        expect(firstText).toContain("Cell B2");

        // 导出再导入，关键格式仍在。
        const exported = await univerDocumentSnapshotToDocxBytes(first);
        expect(exported.byteLength).toBeGreaterThan(0);

        const second = await docxBytesToUniverDocumentSnapshot(exported, { filename: "report.docx" });
        const secondText = dataStreamText(second);
        expect(secondText).toContain("Quarterly Report");
        expect(secondText).toContain("Bold part");
        expect(secondText).toContain("Cell A1");
        expect(secondText).toContain("Cell B2");

        expect((second.body?.paragraphs ?? []).some((p) => p.paragraphStyle?.namedStyleType === 4)).toBe(true);
        expect((second.body?.textRuns ?? []).some((r) => r.ts?.bl === 1)).toBe(true);
        expect((second.body?.paragraphs ?? []).filter((p) => p.bullet).length).toBeGreaterThanOrEqual(2);
        expect((second.body?.tables ?? []).length).toBe(1);
    });

    it("falls back to plain-text behaviour when rich parsing yields no markup", async () => {
        // 空文档：富文本路径应产出至少一个空段落，且不抛错。
        const { Document, Packer, Paragraph, TextRun } = await import("docx");
        const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("plain only")] })] }] });
        const bytes = new Uint8Array(await Packer.toArrayBuffer(doc));

        const snapshot = await docxBytesToUniverDocumentSnapshot(bytes, { filename: "plain.docx" });
        expect(dataStreamText(snapshot)).toContain("plain only");

        const exported = await univerDocumentSnapshotToDocxBytes(snapshot);
        expect(exported.byteLength).toBeGreaterThan(0);
    });

    it("rejects legacy .doc binaries explicitly", async () => {
        await expect(docxBytesToUniverDocumentSnapshot(new Uint8Array([1, 2, 3]), { filename: "legacy.doc" })).rejects.toThrow(
            /Only \.docx/,
        );
    });

    it("patches body text while preserving headers, comments, media, relationships and section references", async () => {
        const original = await richDocxBytes();
        const zip = await JSZip.loadAsync(original);
        const documentXml = await zipText(zip, "word/document.xml");
        zip.file(
            "word/document.xml",
            documentXml.replace(
                /<w:sectPr([^>]*)>/,
                '<w:sectPr$1><w:headerReference w:type="default" r:id="rId99"/>',
            ),
        );
        const relationshipsPath = "word/_rels/document.xml.rels";
        const relationships = await zipText(zip, relationshipsPath);
        zip.file(
            relationshipsPath,
            relationships.replace(
                "</Relationships>",
                '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header99.xml"/><Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>',
            ),
        );
        zip.file(
            "word/header99.xml",
            '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>preserve-header</w:t></w:r></w:p></w:hdr>',
        );
        zip.file(
            "word/comments.xml",
            '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0"><w:p><w:r><w:t>preserve-comment</w:t></w:r></w:p></w:comment></w:comments>',
        );
        zip.file("word/media/preserve.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
        const augmented = await zip.generateAsync({ type: "uint8array" });
        const snapshot = await docxBytesToUniverDocumentSnapshot(augmented, { filename: "advanced.docx" });
        const baseline = JSON.parse(JSON.stringify(snapshot));
        snapshot.body!.dataStream = snapshot.body!.dataStream.replace("Quarterly Report", "Quarterly Update");

        const output = await univerDocumentSnapshotToPreservedDocxBytes(snapshot, {
            originalBytes: augmented,
            baselineSnapshot: baseline,
        });
        const before = await JSZip.loadAsync(augmented);
        const after = await JSZip.loadAsync(output);
        for (const part of ["word/header99.xml", "word/comments.xml", "word/media/preserve.png", relationshipsPath]) {
            expect(await after.file(part)?.async("uint8array")).toEqual(await before.file(part)?.async("uint8array"));
        }
        const updatedDocument = await zipText(after, "word/document.xml");
        expect(updatedDocument).toContain("Quarterly Update");
        expect(updatedDocument).toContain('w:headerReference w:type="default" r:id="rId99"');
    });

    it("rejects unsafe formatting changes in advanced documents instead of losing package parts", async () => {
        const original = await richDocxBytes();
        const zip = await JSZip.loadAsync(original);
        zip.file("word/header99.xml", "<w:hdr/>");
        const augmented = await zip.generateAsync({ type: "uint8array" });
        const snapshot = await docxBytesToUniverDocumentSnapshot(augmented, { filename: "advanced.docx" });
        const baseline = JSON.parse(JSON.stringify(snapshot));
        const originalBold = snapshot.body!.textRuns![0]!.ts?.bl;
        snapshot.body!.textRuns![0]!.ts = {
            ...(snapshot.body!.textRuns![0]!.ts ?? {}),
            bl: originalBold === 1 ? 0 : 1,
        };
        await expect(
            univerDocumentSnapshotToPreservedDocxBytes(snapshot, {
                originalBytes: augmented,
                baselineSnapshot: baseline,
            }),
        ).rejects.toThrow(/只能安全保存正文文字修改/);
    });
});
