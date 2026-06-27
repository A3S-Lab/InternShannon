import { DOMParser } from "@xmldom/xmldom";
import { TOKEN } from "./stream-tokens";
import {
    BooleanNumber,
    type ICustomRange,
    type ICustomTable,
    type IDocDrawingBase,
    type IDocumentBody,
    type IDrawings,
    type IParagraph,
    type IParagraphStyle,
    type ITable,
    type ITableCell,
    type ITableRow,
    type ITextRun,
    type ITextStyle,
    CustomRangeType,
    DrawingTypeEnum,
    NamedStyleType,
    ObjectRelativeFromH,
    ObjectRelativeFromV,
    PositionedObjectLayoutType,
    PresetListType,
    TableAlignmentType,
    TableLayoutType,
    TableSizeType,
    TableTextWrapType,
} from "@univerjs/core";

// 标题标签 → Univer 命名样式。
const HEADING_NAMED_STYLE: Record<string, NamedStyleType> = {
    h1: NamedStyleType.HEADING_1,
    h2: NamedStyleType.HEADING_2,
    h3: NamedStyleType.HEADING_3,
    h4: NamedStyleType.HEADING_4,
    h5: NamedStyleType.HEADING_5,
    // Univer 命名样式最多到 HEADING_5；h6 退化为 HEADING_5。
    h6: NamedStyleType.HEADING_5,
};

// 标题字号近似（pt），用于在 textRuns 上叠加加粗+放大，保证脱离命名样式渲染器时仍可见层级。
const HEADING_FONT_SIZE: Record<string, number> = {
    h1: 28,
    h2: 22,
    h3: 18,
    h4: 16,
    h5: 14,
    h6: 13,
};

// 累积的内联样式（沿 DOM 继承）。
interface InlineStyle {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    color?: string;
    fontSize?: number;
    fontFamily?: string;
}

interface ListContext {
    ordered: boolean;
    level: number;
}

// 构建过程中的累加状态。
class DocumentBuilder {
    private parts: string[] = [];
    private length = 0;
    readonly textRuns: ITextRun[] = [];
    readonly paragraphs: IParagraph[] = [];
    readonly tables: ICustomTable[] = [];
    readonly customRanges: ICustomRange[] = [];
    readonly tableSource: Record<string, ITable> = {};
    readonly drawings: IDrawings = {};
    readonly drawingsOrder: string[] = [];

    private counter = 0;

    nextId(prefix: string): string {
        this.counter += 1;
        return `${prefix}-${this.counter}`;
    }

    get cursor(): number {
        return this.length;
    }

    pushToken(token: string): void {
        this.parts.push(token);
        this.length += token.length;
    }

    // 写入一段带样式的文本，并登记 textRun（st 含、ed 不含）。
    pushText(text: string, style: InlineStyle): void {
        if (text.length === 0) {
            return;
        }
        const start = this.length;
        this.parts.push(text);
        this.length += text.length;
        const ts = inlineStyleToTextStyle(style);
        if (ts) {
            this.textRuns.push({ st: start, ed: this.length, ts });
        }
    }

    // 段落结束：写入 \r 并登记段落（startIndex 指向该 \r 处）。
    endParagraph(paragraphStyle?: IParagraphStyle, bullet?: IParagraph["bullet"]): void {
        const startIndex = this.length;
        this.pushToken(TOKEN.PARAGRAPH);
        const paragraph: IParagraph = { startIndex };
        if (paragraphStyle) {
            paragraph.paragraphStyle = paragraphStyle;
        }
        if (bullet) {
            paragraph.bullet = bullet;
        }
        this.paragraphs.push(paragraph);
    }

    build(): IDocumentBody {
        // 文档以 \r\n 结尾（最后一段的 \r 已存在，补一个 section break \n）。
        this.pushToken(TOKEN.SECTION_BREAK);
        return {
            dataStream: this.parts.join(""),
            textRuns: this.textRuns,
            paragraphs: this.paragraphs,
            sectionBreaks: [{ startIndex: Math.max(this.length - 1, 1) }],
            tables: this.tables,
            customRanges: this.customRanges,
            customBlocks: [],
            customDecorations: [],
        };
    }
}

function inlineStyleToTextStyle(style: InlineStyle): ITextStyle | undefined {
    const ts: ITextStyle = {};
    if (style.bold) {
        ts.bl = BooleanNumber.TRUE;
    }
    if (style.italic) {
        ts.it = BooleanNumber.TRUE;
    }
    if (style.underline) {
        ts.ul = { s: BooleanNumber.TRUE };
    }
    if (style.strike) {
        ts.st = { s: BooleanNumber.TRUE };
    }
    if (style.color) {
        ts.cl = { rgb: style.color };
    }
    if (typeof style.fontSize === "number") {
        ts.fs = style.fontSize;
    }
    if (style.fontFamily) {
        ts.ff = style.fontFamily;
    }
    return Object.keys(ts).length > 0 ? ts : undefined;
}

// 从 element 的内联 style 属性中抽取颜色/字号/字体（best-effort）。
function readElementStyle(node: Element, inherited: InlineStyle): InlineStyle {
    const next: InlineStyle = { ...inherited };
    const styleAttr = node.getAttribute?.("style");
    if (!styleAttr) {
        return next;
    }
    for (const decl of styleAttr.split(";")) {
        const [rawProp, rawVal] = decl.split(":");
        if (!rawProp || !rawVal) {
            continue;
        }
        const prop = rawProp.trim().toLowerCase();
        const val = rawVal.trim();
        if (prop === "color") {
            const rgb = normalizeColor(val);
            if (rgb) {
                next.color = rgb;
            }
        } else if (prop === "font-weight") {
            if (val === "bold" || Number.parseInt(val, 10) >= 600) {
                next.bold = true;
            }
        } else if (prop === "font-style" && val === "italic") {
            next.italic = true;
        } else if (prop === "font-size") {
            const size = parseFontSize(val);
            if (size) {
                next.fontSize = size;
            }
        } else if (prop === "font-family") {
            next.fontFamily = val.replace(/['"]/g, "").split(",")[0]?.trim() || next.fontFamily;
        } else if (prop === "text-decoration" || prop === "text-decoration-line") {
            if (val.includes("underline")) {
                next.underline = true;
            }
            if (val.includes("line-through")) {
                next.strike = true;
            }
        }
    }
    return next;
}

function normalizeColor(value: string): string | undefined {
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
        const r = trimmed[1];
        const g = trimmed[2];
        const b = trimmed[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
        return trimmed.toLowerCase();
    }
    const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
        const toHex = (n: string) => Number.parseInt(n, 10).toString(16).padStart(2, "0");
        return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
    }
    return undefined;
}

function parseFontSize(value: string): number | undefined {
    const ptMatch = value.match(/([\d.]+)pt/);
    if (ptMatch) {
        return Math.round(Number.parseFloat(ptMatch[1]));
    }
    const pxMatch = value.match(/([\d.]+)px/);
    if (pxMatch) {
        // px → pt 近似（96dpi）。
        return Math.round(Number.parseFloat(pxMatch[1]) * 0.75);
    }
    return undefined;
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BLOCK_TAGS = new Set([...HEADING_TAGS, "p", "li", "blockquote", "pre"]);

function tagName(node: Node): string {
    return (node as Element).nodeName?.toLowerCase?.() ?? "";
}

function isElement(node: Node): node is Element {
    return node.nodeType === 1;
}

function isTextNode(node: Node): boolean {
    return node.nodeType === 3;
}

// 遍历内联子节点，把文本累加到 builder（用于一个段落 / 单元格内部）。
function walkInline(node: Node, builder: DocumentBuilder, style: InlineStyle): void {
    const children = Array.from(node.childNodes ?? []);
    for (const child of children) {
        if (isTextNode(child)) {
            const text = (child.nodeValue ?? "").replace(/\s+/g, " ");
            builder.pushText(text, style);
            continue;
        }
        if (!isElement(child)) {
            continue;
        }
        const tag = tagName(child);
        if (tag === "br") {
            builder.pushText(" ", style);
            continue;
        }
        if (tag === "img") {
            appendImage(child, builder);
            continue;
        }
        const childStyle = applyTagStyle(tag, readElementStyle(child, style));
        if (tag === "a") {
            appendHyperlink(child, builder, childStyle);
            continue;
        }
        walkInline(child, builder, childStyle);
    }
}

function applyTagStyle(tag: string, style: InlineStyle): InlineStyle {
    switch (tag) {
        case "strong":
        case "b":
            return { ...style, bold: true };
        case "em":
        case "i":
            return { ...style, italic: true };
        case "u":
            return { ...style, underline: true };
        case "s":
        case "strike":
        case "del":
            return { ...style, strike: true };
        default:
            return style;
    }
}

// 超链接：做成蓝色+下划线的 run，并用 customRanges 记录 url。
function appendHyperlink(node: Element, builder: DocumentBuilder, style: InlineStyle): void {
    const url = node.getAttribute?.("href") ?? "";
    const linkStyle: InlineStyle = {
        ...style,
        underline: true,
        color: style.color ?? "#1155cc",
    };
    const start = builder.cursor;
    walkInline(node, builder, linkStyle);
    const end = builder.cursor;
    if (url && end > start) {
        const range: ICustomRange = {
            startIndex: start,
            endIndex: end - 1,
            rangeId: builder.nextId("link"),
            rangeType: CustomRangeType.HYPERLINK,
            properties: { url },
        };
        builder.customRanges.push(range);
    }
}

// 内联图片：data URI → Univer drawing + 文档流里一个 CUSTOM_BLOCK 占位符。
function appendImage(node: Element, builder: DocumentBuilder): void {
    const src = node.getAttribute?.("src") ?? "";
    const parsed = parseDataUri(src);
    if (!parsed) {
        // 非 data URI（外链图片）暂不内联，跳过但不打断流程。
        return;
    }
    const width = toNumber(node.getAttribute?.("width")) ?? 200;
    const height = toNumber(node.getAttribute?.("height")) ?? 150;
    const drawingId = builder.nextId("drawing");
    const drawing: IDocDrawingBase = {
        unitId: "",
        subUnitId: "",
        drawingId,
        drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        title: "",
        description: "",
        layoutType: PositionedObjectLayoutType.INLINE,
        docTransform: {
            size: { width, height },
            positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 0 },
            positionV: { relativeFrom: ObjectRelativeFromV.PAGE, posOffset: 0 },
            angle: 0,
        },
        // base64 数据外挂在 source 上，导出端读取还原。
        source: parsed.base64,
        imageSourceType: parsed.mime,
    } as IDocDrawingBase & { source: string; imageSourceType: string };
    builder.drawings[drawingId] = drawing;
    builder.drawingsOrder.push(drawingId);
    builder.pushToken(TOKEN.CUSTOM_BLOCK);
}

interface ParsedDataUri {
    mime: string;
    base64: string;
}

function parseDataUri(src: string): ParsedDataUri | undefined {
    const match = src.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) {
        return undefined;
    }
    return { mime: match[1], base64: match[2] };
}

function toNumber(value: string | null | undefined): number | undefined {
    if (!value) {
        return undefined;
    }
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
}

// 处理块级节点序列（body、li 列表、单元格内部都复用）。
function walkBlocks(nodes: Node[], builder: DocumentBuilder, listStack: ListContext[]): void {
    for (const node of nodes) {
        if (isTextNode(node)) {
            const text = (node.nodeValue ?? "").trim();
            if (text.length > 0) {
                builder.pushText(text.replace(/\s+/g, " "), {});
                builder.endParagraph(defaultParagraphStyle());
            }
            continue;
        }
        if (!isElement(node)) {
            continue;
        }
        const tag = tagName(node);
        if (tag === "table") {
            appendTable(node, builder);
            continue;
        }
        if (tag === "ul" || tag === "ol") {
            walkList(node, builder, listStack, tag === "ol");
            continue;
        }
        if (HEADING_TAGS.has(tag)) {
            appendHeading(node, builder, tag);
            continue;
        }
        if (tag === "p" || tag === "blockquote" || tag === "pre" || tag === "div") {
            appendParagraph(node, builder, listStack);
            continue;
        }
        // 兜底：未知块级容器，递归其子节点。
        walkBlocks(Array.from(node.childNodes ?? []), builder, listStack);
    }
}

function defaultParagraphStyle(): IParagraphStyle {
    return { spaceAbove: { v: 5 }, lineSpacing: 1, spaceBelow: { v: 0 } };
}

function appendHeading(node: Element, builder: DocumentBuilder, tag: string): void {
    const named = HEADING_NAMED_STYLE[tag];
    const fontSize = HEADING_FONT_SIZE[tag];
    // 标题文本叠加 加粗+放大字号，保证脱离命名样式渲染器也可见层级。
    walkInline(node, builder, { bold: true, fontSize });
    builder.endParagraph({ ...defaultParagraphStyle(), namedStyleType: named });
}

function appendParagraph(node: Element, builder: DocumentBuilder, listStack: ListContext[]): void {
    // 段落可能含嵌套块级元素（例如 blockquote 内嵌套）；先处理纯内联场景。
    const hasBlockChild = Array.from(node.childNodes ?? []).some(
        (child) =>
            isElement(child) &&
            (BLOCK_TAGS.has(tagName(child)) ||
                tagName(child) === "table" ||
                tagName(child) === "ul" ||
                tagName(child) === "ol"),
    );
    if (hasBlockChild) {
        walkBlocks(Array.from(node.childNodes ?? []), builder, listStack);
        return;
    }
    walkInline(node, builder, {});
    builder.endParagraph(defaultParagraphStyle());
}

// 有序/无序列表，支持嵌套（nestingLevel 来自 listStack 深度）。
function walkList(node: Element, builder: DocumentBuilder, listStack: ListContext[], ordered: boolean): void {
    const level = listStack.length;
    const ctx: ListContext = { ordered, level };
    listStack.push(ctx);
    const listId = builder.nextId(ordered ? "ol" : "ul");
    for (const child of Array.from(node.childNodes ?? [])) {
        if (!isElement(child) || tagName(child) !== "li") {
            continue;
        }
        appendListItem(child, builder, listStack, listId);
    }
    listStack.pop();
}

function appendListItem(node: Element, builder: DocumentBuilder, listStack: ListContext[], listId: string): void {
    const ctx = listStack[listStack.length - 1];
    // li 的直接内联内容
    const inlineChildren: Node[] = [];
    const nestedBlocks: Node[] = [];
    for (const child of Array.from(node.childNodes ?? [])) {
        if (isElement(child) && (tagName(child) === "ul" || tagName(child) === "ol")) {
            nestedBlocks.push(child);
        } else {
            inlineChildren.push(child);
        }
    }
    for (const child of inlineChildren) {
        if (isTextNode(child)) {
            builder.pushText((child.nodeValue ?? "").replace(/\s+/g, " "), {});
        } else if (isElement(child)) {
            walkInline(child, builder, applyTagStyle(tagName(child), readElementStyle(child, {})));
        }
    }
    builder.endParagraph(defaultParagraphStyle(), {
        listId,
        listType: ctx.ordered ? PresetListType.ORDER_LIST : PresetListType.BULLET_LIST,
        nestingLevel: ctx.level,
    });
    // 嵌套列表
    for (const nested of nestedBlocks) {
        walkList(nested as Element, builder, listStack, tagName(nested) === "ol");
    }
}

interface ParsedCell {
    text: Node[];
}

// 表格：在文档流写入 TABLE/ROW/CELL 控制字符，单元格内容是各自的段落；同时登记 tableSource 结构。
function appendTable(node: Element, builder: DocumentBuilder): void {
    const rows = collectTableRows(node);
    if (rows.length === 0) {
        return;
    }
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const tableId = builder.nextId("table");
    const startIndex = builder.cursor;
    builder.pushToken(TOKEN.TABLE_START);

    const tableRows: ITableRow[] = [];
    for (const row of rows) {
        builder.pushToken(TOKEN.TABLE_ROW_START);
        const cells: ITableCell[] = [];
        for (let c = 0; c < columnCount; c += 1) {
            builder.pushToken(TOKEN.TABLE_CELL_START);
            const cell = row[c];
            if (cell) {
                // 单元格内容：内联文本，单段落结尾。
                walkInline(cellWrapper(cell), builder, {});
            }
            builder.endParagraph(defaultParagraphStyle());
            builder.pushToken(TOKEN.TABLE_CELL_END);
            cells.push({});
        }
        builder.pushToken(TOKEN.TABLE_ROW_END);
        tableRows.push({
            tableCells: cells,
            trHeight: { val: { v: 0 }, hRule: 0 },
        });
    }

    builder.pushToken(TOKEN.TABLE_END);
    const endIndex = builder.cursor - 1;

    const table: ITable = {
        tableId,
        tableRows,
        tableColumns: Array.from({ length: columnCount }, () => ({
            size: { type: TableSizeType.SPECIFIED, width: { v: 200 } },
        })),
        align: TableAlignmentType.START,
        indent: { v: 0 },
        textWrap: TableTextWrapType.NONE,
        position: {
            positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 0 },
            positionV: { relativeFrom: ObjectRelativeFromV.PAGE, posOffset: 0 },
        },
        dist: { distB: 0, distL: 0, distR: 0, distT: 0 },
        size: { type: TableSizeType.UNSPECIFIED, width: { v: 0 } },
        layout: TableLayoutType.FIXED,
    };
    builder.tableSource[tableId] = table;
    builder.tables.push({ startIndex, endIndex, tableId });
}

// 把单元格的子节点包成一个可遍历的虚拟节点（复用 walkInline 的 childNodes 协议）。
function cellWrapper(cell: ParsedCell): Node {
    return { childNodes: cell.text } as unknown as Node;
}

function collectTableRows(table: Element): ParsedCell[][] {
    const rows: ParsedCell[][] = [];
    const rowEls = findDescendants(table, "tr");
    for (const tr of rowEls) {
        const cells: ParsedCell[] = [];
        for (const child of Array.from(tr.childNodes ?? [])) {
            if (isElement(child) && (tagName(child) === "td" || tagName(child) === "th")) {
                cells.push({ text: Array.from(child.childNodes ?? []) });
            }
        }
        if (cells.length > 0) {
            rows.push(cells);
        }
    }
    return rows;
}

// 浅层查找直接 tr（含 thead/tbody/tfoot 一层包裹），避免抓到嵌套表格的 tr。
function findDescendants(table: Element, tag: string): Element[] {
    const result: Element[] = [];
    const visit = (parent: Element, allowSection: boolean) => {
        for (const child of Array.from(parent.childNodes ?? [])) {
            if (!isElement(child)) {
                continue;
            }
            const childTag = tagName(child);
            if (childTag === tag) {
                result.push(child);
            } else if (allowSection && (childTag === "thead" || childTag === "tbody" || childTag === "tfoot")) {
                visit(child, false);
            }
            // 不下钻到嵌套 table。
        }
    };
    visit(table, true);
    return result;
}

export interface HtmlToBodyResult {
    body: IDocumentBody;
    tableSource: Record<string, ITable>;
    drawings: IDrawings;
    drawingsOrder: string[];
}

// 入口：把 mammoth 产出的 HTML 转成 Univer 文档 body + 旁路资源。
export function htmlToUniverDocumentBody(html: string): HtmlToBodyResult {
    // 静默 errorHandler：mammoth 产出的 HTML 一般良构；个别警告不应打断流程，
    // 真正致命的解析失败由上层 index.ts 的 try/catch 兜底回退到纯文本。
    const noop = () => {};
    const parser = new DOMParser({ errorHandler: { warning: noop, error: noop, fatalError: noop } });
    const doc = parser.parseFromString(wrapHtml(html), "text/html");
    const builder = new DocumentBuilder();
    const body = findBodyElement(doc);
    const topNodes = body ? Array.from(body.childNodes ?? []) : [];
    walkBlocks(topNodes, builder, []);
    // 没有产出任何段落时，至少给一个空段落，避免空 dataStream。
    if (builder.paragraphs.length === 0) {
        builder.endParagraph(defaultParagraphStyle());
    }
    return {
        body: builder.build(),
        tableSource: builder.tableSource,
        drawings: builder.drawings,
        drawingsOrder: builder.drawingsOrder,
    };
}

function wrapHtml(html: string): string {
    const trimmed = html.trim();
    if (/<html[\s>]/i.test(trimmed) || /<body[\s>]/i.test(trimmed)) {
        return trimmed;
    }
    return `<html><body>${trimmed}</body></html>`;
}

function findBodyElement(doc: Document): Element | null {
    const bodies = doc.getElementsByTagName?.("body");
    if (bodies && bodies.length > 0) {
        return bodies.item(0);
    }
    return doc.documentElement ?? null;
}
