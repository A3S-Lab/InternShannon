import { Document as DocxDocument, Packer, Paragraph, TextRun } from "docx";
import * as mammoth from "mammoth";
import type { IDocumentData } from "@univerjs/core";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip = require("jszip");
import { bytesToArrayBuffer, getOfficeExtension, getOfficeFileName } from "../shared/file";
import { plainTextToUniverDocumentSnapshot, univerDocumentSnapshotToPlainText } from "../shared/text";
import { htmlToUniverDocumentBody } from "./html-to-univer";
import { univerDocumentSnapshotToRichDocxBytes } from "./univer-to-docx";

export interface DocxImportOptions {
    filename: string;
}

export interface PreservedDocxExportOptions {
    originalBytes: Uint8Array;
    baselineSnapshot?: IDocumentData;
}

const WORDPROCESSINGML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const ADVANCED_DOCX_PART = /^word\/(?:header|footer|comments|footnotes|endnotes|media|embeddings|charts|diagrams|customXml)/i;

/**
 * 把 .docx 字节导入为 Univer 文档快照（富文本保真）。
 *
 * 优先路径：mammoth.convertToHtml → 解析语义化 HTML → 构建带样式/列表/表格/图片的 Univer body。
 * 兜底路径：任何解析失败都回退到纯文本（mammoth.extractRawText + plainTextToUniverDocumentSnapshot），
 * 保证最坏情况 = 历史纯文本行为，永不抛错、永不比现状更差。
 */
export async function docxBytesToUniverDocumentSnapshot(
    data: Uint8Array,
    options: DocxImportOptions,
): Promise<IDocumentData> {
    const ext = getOfficeExtension(options.filename);
    if (ext !== "docx") {
        // .doc（旧二进制）等格式本适配器不支持，明确抛错。
        throw new Error("Only .docx documents can be imported by the current OOXML adapter.");
    }

    const arrayBuffer = bytesToArrayBuffer(data);
    const nodeBuffer = (globalThis as unknown as {
        Buffer?: { from(value: Uint8Array): Buffer };
    }).Buffer;
    const mammothInput = nodeBuffer
        ? { buffer: nodeBuffer.from(data) }
        : { arrayBuffer };

    try {
        const htmlResult = await mammoth.convertToHtml(mammothInput);
        const html = htmlResult.value || "";
        const { body, tableSource, drawings, drawingsOrder } = htmlToUniverDocumentBody(html);
        const snapshot = plainTextToUniverDocumentSnapshot(options.filename, "");
        snapshot.title = getOfficeFileName(options.filename);
        snapshot.body = body;
        snapshot.tableSource = tableSource;
        snapshot.drawings = drawings;
        snapshot.drawingsOrder = drawingsOrder;
        return snapshot;
    } catch {
        // 兜底：纯文本导入，保留历史行为。
        const raw = await mammoth.extractRawText(mammothInput);
        return plainTextToUniverDocumentSnapshot(options.filename, raw.value || "");
    }
}

/**
 * 把 Univer 文档快照导出为 .docx 字节（保留标题/粗斜/下划线/删除线/颜色/字号/列表/表格/图片）。
 *
 * 优先路径：遍历 Univer body（dataStream + textRuns + paragraphs + tables + drawings）用 docx 库重建。
 * 兜底路径：富文本导出失败时回退到逐行纯文本 Paragraph（历史行为），永不抛错。
 */
export async function univerDocumentSnapshotToDocxBytes(snapshot: IDocumentData): Promise<Uint8Array> {
    try {
        return await univerDocumentSnapshotToRichDocxBytes(snapshot);
    } catch {
        return await plainTextDocxFallback(snapshot);
    }
}

/**
 * Saves a DOCX without rebuilding an advanced OOXML package.
 *
 * Simple documents keep using the rich exporter above. When the original package
 * contains parts that the adapter does not own (headers, comments, media, embedded
 * objects, and similar), only text inside safely matched body paragraphs is patched.
 * Every other ZIP part and every non-text XML node remains byte-for-byte untouched.
 * Structural or formatting changes that cannot be represented safely are rejected
 * instead of silently discarding unsupported content.
 */
export async function univerDocumentSnapshotToPreservedDocxBytes(
    snapshot: IDocumentData,
    options: PreservedDocxExportOptions,
): Promise<Uint8Array> {
    const originalZip = await JSZip.loadAsync(bytesToArrayBuffer(options.originalBytes));
    if (!Object.keys(originalZip.files).some((name) => ADVANCED_DOCX_PART.test(name))) {
        return univerDocumentSnapshotToDocxBytes(snapshot);
    }

    const baseline =
        options.baselineSnapshot ??
        (await docxBytesToUniverDocumentSnapshot(options.originalBytes, { filename: "preserved.docx" }));
    if (documentFormatSignature(snapshot) !== documentFormatSignature(baseline)) {
        throw new Error(
            "该 DOCX 含页眉、批注、媒体或其他高级结构；当前只能安全保存正文文字修改。请撤销格式或结构调整后重试。",
        );
    }

    const [baselineBytes, targetBytes, originalXml] = await Promise.all([
        univerDocumentSnapshotToDocxBytes(baseline),
        univerDocumentSnapshotToDocxBytes(snapshot),
        originalZip.file("word/document.xml")?.async("text"),
    ]);
    if (!originalXml) throw new Error("Invalid DOCX package: word/document.xml is missing.");

    const [baselineZip, targetZip] = await Promise.all([
        JSZip.loadAsync(bytesToArrayBuffer(baselineBytes)),
        JSZip.loadAsync(bytesToArrayBuffer(targetBytes)),
    ]);
    const [baselineXml, targetXml] = await Promise.all([
        baselineZip.file("word/document.xml")?.async("text"),
        targetZip.file("word/document.xml")?.async("text"),
    ]);
    if (!baselineXml || !targetXml) throw new Error("Unable to build the DOCX text-preservation baseline.");

    const parser = new DOMParser();
    const originalDocument = parser.parseFromString(originalXml, "application/xml");
    const baselineDocument = parser.parseFromString(baselineXml, "application/xml");
    const targetDocument = parser.parseFromString(targetXml, "application/xml");
    const originalParagraphs = elements(originalDocument, WORDPROCESSINGML_NS, "p");
    const baselineParagraphs = elements(baselineDocument, WORDPROCESSINGML_NS, "p");
    const targetParagraphs = elements(targetDocument, WORDPROCESSINGML_NS, "p");
    if (originalParagraphs.length !== baselineParagraphs.length || baselineParagraphs.length !== targetParagraphs.length) {
        throw new Error(
            "该 DOCX 含高级结构，且正文段落结构已经变化；为避免丢失页眉、批注或媒体，本次保存已阻止。",
        );
    }

    for (let index = 0; index < originalParagraphs.length; index += 1) {
        const before = paragraphText(baselineParagraphs[index]);
        const after = paragraphText(targetParagraphs[index]);
        if (before === after) continue;
        patchParagraphText(originalDocument, originalParagraphs[index], after);
    }

    originalZip.file("word/document.xml", new XMLSerializer().serializeToString(originalDocument));
    return originalZip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function elements(document: Document, namespace: string, localName: string): Element[] {
    return Array.from(document.getElementsByTagNameNS(namespace, localName)) as Element[];
}

function paragraphText(paragraph: Element): string {
    return Array.from(paragraph.getElementsByTagNameNS(WORDPROCESSINGML_NS, "t"))
        .map((node) => node.textContent ?? "")
        .join("");
}

function patchParagraphText(document: Document, paragraph: Element, value: string): void {
    const textNodes = Array.from(paragraph.getElementsByTagNameNS(WORDPROCESSINGML_NS, "t")) as Element[];
    if (textNodes.length === 0) {
        const run = document.createElementNS(WORDPROCESSINGML_NS, "w:r");
        const text = document.createElementNS(WORDPROCESSINGML_NS, "w:t");
        run.appendChild(text);
        paragraph.appendChild(run);
        textNodes.push(text);
    }

    const originalLengths = textNodes.map((node) => (node.textContent ?? "").length);
    let offset = 0;
    textNodes.forEach((node, index) => {
        const isLast = index === textNodes.length - 1;
        const nextOffset = isLast ? value.length : Math.min(value.length, offset + originalLengths[index]);
        const segment = value.slice(offset, nextOffset);
        while (node.firstChild) node.removeChild(node.firstChild);
        node.appendChild(document.createTextNode(segment));
        if (/^\s|\s$/.test(segment)) node.setAttributeNS(XML_NS, "xml:space", "preserve");
        else node.removeAttributeNS(XML_NS, "space");
        offset = nextOffset;
    });
}

function documentFormatSignature(snapshot: IDocumentData): string {
    return JSON.stringify({
        textRuns: (snapshot.body?.textRuns ?? []).map((run) => run.ts ?? null),
        paragraphs: (snapshot.body?.paragraphs ?? []).map((paragraph) => ({
            bullet: paragraph.bullet ?? null,
            paragraphStyle: paragraph.paragraphStyle ?? null,
        })),
        tables: (snapshot.body?.tables ?? []).map((table) => table.tableId),
        tableStructure: Object.values(snapshot.tableSource ?? {}).map((table) =>
            table.tableRows.map((row) => row.tableCells.length),
        ),
        drawings: snapshot.drawings ?? null,
        drawingsOrder: snapshot.drawingsOrder ?? null,
    });
}

// 历史纯文本导出逻辑：每行一个裸 Paragraph(TextRun)。
async function plainTextDocxFallback(snapshot: IDocumentData): Promise<Uint8Array> {
    const text = univerDocumentSnapshotToPlainText(snapshot);
    const lines = text.length > 0 ? text.split("\n") : [""];
    const doc = new DocxDocument({
        sections: [
            {
                children: lines.map(
                    (line) =>
                        new Paragraph({
                            children: [new TextRun(line)],
                        }),
                ),
            },
        ],
    });
    const arrayBuffer = await Packer.toArrayBuffer(doc);
    return new Uint8Array(arrayBuffer);
}

export { plainTextToUniverDocumentSnapshot, univerDocumentSnapshotToPlainText };
