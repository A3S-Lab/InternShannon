import { Document, Packer, Paragraph, TextRun } from "docx";
import * as mammoth from "mammoth";
import type { IDocumentData } from "@univerjs/core";
import { getOfficeExtension, getOfficeFileName } from "../shared/file";
import { plainTextToUniverDocumentSnapshot, univerDocumentSnapshotToPlainText } from "../shared/text";
import { htmlToUniverDocumentBody } from "./html-to-univer";
import { univerDocumentSnapshotToRichDocxBytes } from "./univer-to-docx";

export interface DocxImportOptions {
    filename: string;
}

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

    const buffer = Buffer.from(data);

    try {
        const htmlResult = await mammoth.convertToHtml({ buffer });
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
        const raw = await mammoth.extractRawText({ buffer });
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

// 历史纯文本导出逻辑：每行一个裸 Paragraph(TextRun)。
async function plainTextDocxFallback(snapshot: IDocumentData): Promise<Uint8Array> {
    const text = univerDocumentSnapshotToPlainText(snapshot);
    const lines = text.length > 0 ? text.split("\n") : [""];
    const doc = new Document({
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
