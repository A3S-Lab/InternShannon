import type { IDocumentData } from "@univerjs/core";
import { getPlainText, LocaleType } from "@univerjs/core";
import { getOfficeFileName } from "./file";

export function plainTextToUniverDocumentBody(text: string): NonNullable<IDocumentData["body"]> {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r");
    const dataStream = normalized.length > 0 ? `${normalized}\r\n` : "\r\n";
    const paragraphs: NonNullable<NonNullable<IDocumentData["body"]>["paragraphs"]> = [];

    for (let index = 0; index < dataStream.length; index += 1) {
        if (dataStream[index] === "\r") {
            paragraphs.push({
                startIndex: index,
                paragraphStyle: {
                    spaceAbove: { v: 5 },
                    lineSpacing: 1,
                    spaceBelow: { v: 0 },
                },
            });
        }
    }

    return {
        dataStream,
        textRuns: [],
        customBlocks: [],
        customDecorations: [],
        customRanges: [],
        tables: [],
        paragraphs,
        sectionBreaks: [{ startIndex: Math.max(dataStream.length - 1, 1) }],
    };
}

export function plainTextToUniverDocumentSnapshot(filename: string, text: string): IDocumentData {
    return {
        id: `doc-${Date.now()}`,
        locale: LocaleType.ZH_CN,
        title: getOfficeFileName(filename),
        tableSource: {},
        drawings: {},
        drawingsOrder: [],
        headers: {},
        footers: {},
        body: plainTextToUniverDocumentBody(text),
        documentStyle: {
            pageSize: {
                width: 595 / 0.75,
                height: 842 / 0.75,
            },
            documentFlavor: 1,
            marginTop: 50,
            marginBottom: 50,
            marginRight: 50,
            marginLeft: 50,
            renderConfig: {
                zeroWidthParagraphBreak: 0,
                vertexAngle: 0,
                centerAngle: 0,
                background: { rgb: "#f3f4f6" },
            },
            autoHyphenation: 1,
            doNotHyphenateCaps: 0,
            consecutiveHyphenLimit: 2,
            defaultHeaderId: "",
            defaultFooterId: "",
            evenPageHeaderId: "",
            evenPageFooterId: "",
            firstPageHeaderId: "",
            firstPageFooterId: "",
            evenAndOddHeaders: 0,
            useFirstPageHeaderFooter: 0,
            marginHeader: 30,
            marginFooter: 30,
        },
        settings: {},
    };
}

export function univerDocumentSnapshotToPlainText(snapshot: IDocumentData): string {
    const dataStream = snapshot.body?.dataStream ?? "";
    return getPlainText(dataStream).replace(/\r/g, "\n").replace(/\n$/, "");
}
