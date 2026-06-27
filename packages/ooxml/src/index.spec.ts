import JSZip = require("jszip");
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
    PageElementType: { TEXT: "TEXT" },
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
    univerDocumentSnapshotToPlainText,
    univerSlideSnapshotToPptxBytes,
    univerWorkbookSnapshotToBytes,
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
});
