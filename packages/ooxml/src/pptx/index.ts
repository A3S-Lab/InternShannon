import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { IDocumentData } from "@univerjs/core";
import { getPlainText, LocaleType } from "@univerjs/core";
import JSZip = require("jszip");
import { PageElementType, PageType, type IPageElement, type ISlideData } from "@univerjs/slides";
import { bytesToArrayBuffer, getOfficeExtension, getOfficeFileName } from "../shared/file";
import { plainTextToUniverDocumentBody } from "../shared/text";

export interface PptxImportOptions {
    filename: string;
}

const SLIDE_WIDTH = 960;
const SLIDE_HEIGHT = 540;

function slideNumber(path: string): number {
    const match = path.match(/slide(\d+)\.xml$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function getTextNodes(element: Element): Element[] {
    return Array.from(element.getElementsByTagNameNS("*", "t"));
}

function textFromShape(shape: Element): string {
    return getTextNodes(shape)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
}

function extractSlideTexts(xml: string): string[] {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const shapes = Array.from(doc.getElementsByTagNameNS("*", "sp"));
    const texts = shapes.map(textFromShape).filter(Boolean);
    if (texts.length > 0) return texts;
    return Array.from(doc.getElementsByTagNameNS("*", "t"))
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean);
}

function richTextDocument(text: string): IDocumentData {
    return {
        id: `slide-rich-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        locale: LocaleType.ZH_CN,
        title: "text",
        body: plainTextToUniverDocumentBody(text),
        documentStyle: {},
    };
}

function createTextElement(text: string, index: number, isTitle: boolean): IPageElement {
    const top = isTitle ? 54 : 130 + Math.max(0, index - 1) * 76;
    const height = Math.max(48, Math.min(168, text.split(/\r?\n/).length * 32));
    return {
        id: `text-${index + 1}`,
        zIndex: 20 + index,
        left: 72,
        top,
        width: SLIDE_WIDTH - 144,
        height,
        title: isTitle ? "title" : "text",
        description: "",
        type: PageElementType.TEXT,
        richText: {
            text,
            rich: richTextDocument(text),
            fs: isTitle ? 34 : 22,
            bl: isTitle ? 1 : 0,
            cl: { rgb: "rgb(51, 51, 51)" },
        },
    };
}

function createSlideSnapshot(filename: string, slideTexts: string[][]): ISlideData {
    const pages: NonNullable<ISlideData["body"]>["pages"] = {};
    const pageOrder: string[] = [];
    const normalizedSlides = slideTexts.length > 0 ? slideTexts : [[""]];

    normalizedSlides.forEach((texts, pageIndex) => {
        const pageId = `page-${pageIndex + 1}`;
        const nonEmptyTexts = texts.length > 0 ? texts : [""];
        pageOrder.push(pageId);
        pages[pageId] = {
            id: pageId,
            pageType: PageType.SLIDE,
            zIndex: pageIndex + 1,
            title: `Slide ${pageIndex + 1}`,
            description: "",
            pageBackgroundFill: { rgb: "rgb(255,255,255)" },
            pageElements: Object.fromEntries(
                nonEmptyTexts.map((text, index) => {
                    const element = createTextElement(text, index, index === 0);
                    return [element.id, element];
                }),
            ),
        };
    });

    return {
        id: `slides-${Date.now()}`,
        locale: LocaleType.ZH_CN,
        title: getOfficeFileName(filename),
        pageSize: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
        body: { pages, pageOrder },
    };
}

function getSortedSlidePaths(zip: JSZip): string[] {
    return Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => slideNumber(a) - slideNumber(b));
}

export async function pptxBytesToUniverSlideSnapshot(data: Uint8Array, options: PptxImportOptions): Promise<ISlideData> {
    const ext = getOfficeExtension(options.filename);
    if (ext !== "pptx") {
        throw new Error("Only .pptx presentations can be imported by the current OOXML adapter.");
    }

    const zip = await JSZip.loadAsync(bytesToArrayBuffer(data));
    const slidePaths = getSortedSlidePaths(zip);
    const slideTexts = await Promise.all(
        slidePaths.map(async (name) => {
            const xml = await zip.file(name)?.async("text");
            return xml ? extractSlideTexts(xml) : [];
        }),
    );
    return createSlideSnapshot(options.filename, slideTexts);
}

function plainTextFromRichDocument(documentData: IDocumentData | undefined): string {
    const dataStream = documentData?.body?.dataStream;
    return dataStream ? getPlainText(dataStream).replace(/\r/g, "\n").trim() : "";
}

function textFromSlideElement(element: IPageElement): string {
    return element.richText?.text || plainTextFromRichDocument(element.richText?.rich) || "";
}

export async function univerSlideSnapshotToPptxBytes(snapshot: ISlideData, originalBytes: Uint8Array): Promise<Uint8Array> {
    const zip = await JSZip.loadAsync(bytesToArrayBuffer(originalBytes));
    const slidePaths = getSortedSlidePaths(zip);
    const pages = snapshot.body?.pages ?? {};
    const pageOrder = snapshot.body?.pageOrder ?? Object.keys(pages);
    const serializer = new XMLSerializer();

    for (let pageIndex = 0; pageIndex < Math.min(pageOrder.length, slidePaths.length); pageIndex += 1) {
        const pageId = pageOrder[pageIndex];
        const page = pages[pageId];
        if (!page) continue;
        const slidePath = slidePaths[pageIndex];
        const xml = await zip.file(slidePath)?.async("text");
        if (!xml) continue;
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        const shapes = Array.from(doc.getElementsByTagNameNS("*", "sp"));
        const elements = Object.values(page.pageElements).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
        let textElementIndex = 0;

        for (const shape of shapes) {
            const textNodes = getTextNodes(shape);
            if (textNodes.length === 0) continue;
            const element = elements[textElementIndex];
            textElementIndex += 1;
            if (!element || element.type !== PageElementType.TEXT) continue;
            const text = textFromSlideElement(element);
            textNodes[0].textContent = text;
            textNodes.slice(1).forEach((node) => {
                node.textContent = "";
            });
        }

        zip.file(slidePath, serializer.serializeToString(doc));
    }

    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
