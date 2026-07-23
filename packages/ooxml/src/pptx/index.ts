import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { IDocumentData } from "@univerjs/core";
import { getPlainText, LocaleType } from "@univerjs/core";
import JSZip = require("jszip");
import { BasicShapes, PageElementType, PageType, type IPageElement, type ISlideData } from "@univerjs/slides";
import { bytesToArrayBuffer, getOfficeExtension, getOfficeFileName } from "../shared/file";
import { plainTextToUniverDocumentBody } from "../shared/text";

export interface PptxImportOptions {
    filename: string;
}

const SLIDE_WIDTH = 960;
const SLIDE_HEIGHT = 540;

interface SlideGeometry {
    emuWidth: number;
    emuHeight: number;
    width: number;
    height: number;
}

type ThemeColors = Record<string, string>;

function slideNumber(path: string): number {
    const match = path.match(/slide(\d+)\.xml$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function getTextNodes(element: Element): Element[] {
    return Array.from(element.getElementsByTagNameNS("*", "t"));
}

function firstDescendant(element: Element | Document, localName: string): Element | undefined {
    return Array.from(element.getElementsByTagNameNS("*", localName))[0];
}

function elementNumber(element: Element | undefined, name: string): number | undefined {
    const value = element?.getAttribute(name);
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
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

function presentationGeometry(xml: string | undefined): SlideGeometry {
    if (!xml) {
        return { emuWidth: 12_192_000, emuHeight: 6_858_000, width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
    }
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const size = firstDescendant(doc, "sldSz");
    const emuWidth = elementNumber(size, "cx") ?? 12_192_000;
    const emuHeight = elementNumber(size, "cy") ?? 6_858_000;
    return {
        emuWidth,
        emuHeight,
        width: SLIDE_WIDTH,
        height: Math.round((SLIDE_WIDTH * emuHeight) / emuWidth),
    };
}

function extractThemeColors(xml: string | undefined): ThemeColors {
    if (!xml) return {};
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const scheme = firstDescendant(doc, "clrScheme");
    if (!scheme) return {};
    const colors: ThemeColors = {};
    for (const child of Array.from(scheme.childNodes)) {
        if (child.nodeType !== 1) continue;
        const colorElement = child as Element;
        const srgb = firstDescendant(colorElement, "srgbClr")?.getAttribute("val");
        const system = firstDescendant(colorElement, "sysClr")?.getAttribute("lastClr");
        const value = srgb || system;
        if (value) colors[colorElement.localName] = `#${value}`;
    }
    return colors;
}

function colorFromContainer(container: Element | undefined, themeColors: ThemeColors): string | undefined {
    if (!container) return undefined;
    if (firstDescendant(container, "noFill")) return "rgba(255,255,255,0)";
    const direct = firstDescendant(container, "srgbClr")?.getAttribute("val");
    if (direct) return `#${direct}`;
    const scheme = firstDescendant(container, "schemeClr")?.getAttribute("val");
    return scheme ? themeColors[scheme] : undefined;
}

function shapeBounds(shape: Element, geometry: SlideGeometry): Pick<IPageElement, "left" | "top" | "width" | "height"> | undefined {
    const shapeProperties = firstDescendant(shape, "spPr");
    const transform = shapeProperties ? firstDescendant(shapeProperties, "xfrm") : undefined;
    const offset = transform ? firstDescendant(transform, "off") : undefined;
    const extent = transform ? firstDescendant(transform, "ext") : undefined;
    const x = elementNumber(offset, "x");
    const y = elementNumber(offset, "y");
    const cx = elementNumber(extent, "cx");
    const cy = elementNumber(extent, "cy");
    if (x === undefined || y === undefined || cx === undefined || cy === undefined) return undefined;
    return {
        left: (x / geometry.emuWidth) * geometry.width,
        top: (y / geometry.emuHeight) * geometry.height,
        width: (cx / geometry.emuWidth) * geometry.width,
        height: (cy / geometry.emuHeight) * geometry.height,
    };
}

function shapeIdentity(shape: Element, fallbackIndex: number): { id: string; title: string } {
    const nonVisual = firstDescendant(shape, "cNvPr");
    const sourceId = nonVisual?.getAttribute("id") || String(fallbackIndex + 1);
    return {
        id: `pptx-shape-${sourceId}-${fallbackIndex + 1}`,
        title: nonVisual?.getAttribute("name") || `Shape ${fallbackIndex + 1}`,
    };
}

function createShapeElement(
    shape: Element,
    index: number,
    geometry: SlideGeometry,
    themeColors: ThemeColors,
): IPageElement | undefined {
    const bounds = shapeBounds(shape, geometry);
    if (!bounds) return undefined;
    const shapeProperties = firstDescendant(shape, "spPr");
    const preset = firstDescendant(shapeProperties ?? shape, "prstGeom")?.getAttribute("prst");
    const supportedShape =
        preset === BasicShapes.Ellipse
            ? BasicShapes.Ellipse
            : preset === BasicShapes.RoundRect
              ? BasicShapes.RoundRect
              : BasicShapes.Rect;
    const explicitFill = shapeProperties ? firstDescendant(shapeProperties, "solidFill") : undefined;
    const style = firstDescendant(shape, "style");
    const styleFill = style ? firstDescendant(style, "fillRef") : undefined;
    const fill = colorFromContainer(explicitFill ?? shapeProperties, themeColors) ?? colorFromContainer(styleFill, themeColors) ?? "#4472C4";
    const identity = shapeIdentity(shape, index);
    return {
        ...identity,
        ...bounds,
        zIndex: index + 1,
        description: "",
        type: PageElementType.SHAPE,
        shape: {
            shapeType: supportedShape,
            text: "",
            shapeProperties: { shapeBackgroundFill: { rgb: fill } },
        },
    };
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

function createTextElement(
    text: string,
    index: number,
    isTitle: boolean,
    shape?: Element,
    geometry?: SlideGeometry,
): IPageElement {
    const fallbackTop = isTitle ? 54 : 130 + Math.max(0, index - 1) * 76;
    const fallbackHeight = Math.max(48, Math.min(168, text.split(/\r?\n/).length * 32));
    const bounds = shape && geometry ? shapeBounds(shape, geometry) : undefined;
    const identity = shape ? shapeIdentity(shape, index) : { id: `text-${index + 1}`, title: isTitle ? "title" : "text" };
    return {
        ...identity,
        zIndex: shape ? index + 1 : 20 + index,
        left: bounds?.left ?? 72,
        top: bounds?.top ?? fallbackTop,
        width: bounds?.width ?? SLIDE_WIDTH - 144,
        height: bounds?.height ?? fallbackHeight,
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

function extractSlideElements(xml: string, geometry: SlideGeometry, themeColors: ThemeColors): IPageElement[] {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const shapes = Array.from(doc.getElementsByTagNameNS("*", "sp"));
    const elements: IPageElement[] = [];
    let textIndex = 0;
    shapes.forEach((shape, shapeIndex) => {
        const text = textFromShape(shape);
        if (text) {
            elements.push(createTextElement(text, shapeIndex, textIndex === 0, shape, geometry));
            textIndex += 1;
            return;
        }
        if (firstDescendant(shape, "prstGeom")) {
            const element = createShapeElement(shape, shapeIndex, geometry, themeColors);
            if (element) elements.push(element);
        }
    });
    if (elements.length > 0) return elements;
    return extractSlideTexts(xml).map((text, index) => createTextElement(text, index, index === 0));
}

function createSlideSnapshot(filename: string, slideElements: IPageElement[][], geometry: SlideGeometry): ISlideData {
    const pages: NonNullable<ISlideData["body"]>["pages"] = {};
    const pageOrder: string[] = [];
    const normalizedSlides = slideElements.length > 0 ? slideElements : [[]];

    normalizedSlides.forEach((elements, pageIndex) => {
        const pageId = `page-${pageIndex + 1}`;
        const nonEmptyElements = elements.length > 0 ? elements : [createTextElement("", 0, true)];
        pageOrder.push(pageId);
        pages[pageId] = {
            id: pageId,
            pageType: PageType.SLIDE,
            zIndex: pageIndex + 1,
            title: `Slide ${pageIndex + 1}`,
            description: "",
            pageBackgroundFill: { rgb: "rgb(255,255,255)" },
            pageElements: Object.fromEntries(nonEmptyElements.map((element) => [element.id, element])),
        };
    });

    return {
        id: `slides-${Date.now()}`,
        locale: LocaleType.ZH_CN,
        title: getOfficeFileName(filename),
        pageSize: { width: geometry.width, height: geometry.height },
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
    const presentationXml = await zip.file("ppt/presentation.xml")?.async("text");
    const themeXml = await zip.file("ppt/theme/theme1.xml")?.async("text");
    const geometry = presentationGeometry(presentationXml);
    const themeColors = extractThemeColors(themeXml);
    const slideElements = await Promise.all(
        slidePaths.map(async (name) => {
            const xml = await zip.file(name)?.async("text");
            return xml ? extractSlideElements(xml, geometry, themeColors) : [];
        }),
    );
    return createSlideSnapshot(options.filename, slideElements, geometry);
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
        const elements = Object.values(page.pageElements)
            .filter((element) => element.type === PageElementType.TEXT)
            .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
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
