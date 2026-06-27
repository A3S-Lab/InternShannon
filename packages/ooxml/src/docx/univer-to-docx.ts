import {
    AlignmentType,
    Document,
    ExternalHyperlink,
    HeadingLevel,
    ImageRun,
    LevelFormat,
    Packer,
    Paragraph,
    type ParagraphChild,
    type INumberingOptions,
    Table,
    TableCell,
    TableRow,
    TextRun,
    UnderlineType,
    WidthType,
} from "docx";
import { BooleanNumber, type IDocumentData, type ITextRun, type ITextStyle, NamedStyleType } from "@univerjs/core";
import { TABLE_TOKENS, TOKEN } from "./stream-tokens";

const NAMED_STYLE_TO_HEADING: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    [NamedStyleType.TITLE]: HeadingLevel.TITLE,
    [NamedStyleType.SUBTITLE]: HeadingLevel.HEADING_1,
    [NamedStyleType.HEADING_1]: HeadingLevel.HEADING_1,
    [NamedStyleType.HEADING_2]: HeadingLevel.HEADING_2,
    [NamedStyleType.HEADING_3]: HeadingLevel.HEADING_3,
    [NamedStyleType.HEADING_4]: HeadingLevel.HEADING_4,
    [NamedStyleType.HEADING_5]: HeadingLevel.HEADING_5,
};

const NUMBERING_REFERENCE = "univer-ordered-list";

interface HyperlinkRange {
    start: number;
    end: number; // inclusive (Univer customRange.endIndex)
    url: string;
}

interface DrawingInfo {
    base64: string;
    mime: string;
    width: number;
    height: number;
}

// 内联片段的形态：纯文本（带样式）或图片占位。
interface Segment {
    kind: "text" | "image";
    text: string;
    style?: ITextStyle;
    url?: string;
    drawing?: DrawingInfo;
}

interface ParagraphData {
    segments: Segment[];
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    list?: { ordered: boolean; level: number };
}

interface TableData {
    rows: ParagraphData[][][]; // 行 → 单元格 → 段落数组
}

type Block = { kind: "paragraph"; paragraph: ParagraphData } | { kind: "table"; table: TableData };

// 在 textRuns 中查找覆盖某索引的内联样式。
function findTextRunStyle(textRuns: ITextRun[], index: number): ITextStyle | undefined {
    for (const run of textRuns) {
        if (index >= run.st && index < run.ed) {
            return run.ts;
        }
    }
    return undefined;
}

function findHyperlink(ranges: HyperlinkRange[], index: number): HyperlinkRange | undefined {
    for (const range of ranges) {
        if (index >= range.start && index <= range.end) {
            return range;
        }
    }
    return undefined;
}

// 把一段连续文本（不含表格控制字符）切成 Segment 列表：按样式变化与超链接归属分组。
function sliceInlineSegments(
    dataStream: string,
    start: number,
    end: number,
    textRuns: ITextRun[],
    hyperlinks: HyperlinkRange[],
    drawingResolver: (index: number) => DrawingInfo | undefined,
): Segment[] {
    const segments: Segment[] = [];
    let buffer = "";
    let bufferStyle: ITextStyle | undefined;
    let bufferUrl: string | undefined;

    const flush = () => {
        if (buffer.length > 0) {
            segments.push({ kind: "text", text: buffer, style: bufferStyle, url: bufferUrl });
        }
        buffer = "";
    };

    for (let i = start; i < end; i += 1) {
        const ch = dataStream[i];
        if (ch === TOKEN.CUSTOM_BLOCK) {
            flush();
            const drawing = drawingResolver(i);
            if (drawing) {
                segments.push({ kind: "image", text: "", drawing });
            }
            continue;
        }
        const style = findTextRunStyle(textRuns, i);
        const link = findHyperlink(hyperlinks, i);
        const url = link?.url;
        if (buffer.length === 0) {
            bufferStyle = style;
            bufferUrl = url;
        } else if (!sameStyle(bufferStyle, style) || bufferUrl !== url) {
            flush();
            bufferStyle = style;
            bufferUrl = url;
        }
        buffer += ch;
    }
    flush();
    return segments;
}

function sameStyle(a: ITextStyle | undefined, b: ITextStyle | undefined): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b) {
        return false;
    }
    return (
        a.bl === b.bl &&
        a.it === b.it &&
        a.fs === b.fs &&
        a.ff === b.ff &&
        a.cl?.rgb === b.cl?.rgb &&
        Boolean(a.ul?.s) === Boolean(b.ul?.s) &&
        Boolean(a.st?.s) === Boolean(b.st?.s)
    );
}

// 把 Univer body 解析为块序列（段落 / 表格）。
function parseBlocks(snapshot: IDocumentData): Block[] {
    const body = snapshot.body;
    if (!body) {
        return [];
    }
    const dataStream = body.dataStream ?? "";
    const textRuns = body.textRuns ?? [];
    const paragraphs = body.paragraphs ?? [];
    const hyperlinks: HyperlinkRange[] = (body.customRanges ?? [])
        .filter((range) => typeof (range.properties as { url?: string } | undefined)?.url === "string")
        .map((range) => ({
            start: range.startIndex,
            end: range.endIndex,
            url: (range.properties as { url: string }).url,
        }));

    // 段落样式按 startIndex（该段 \r 的位置）查找。
    const paragraphByStart = new Map<number, (typeof paragraphs)[number]>();
    for (const paragraph of paragraphs) {
        paragraphByStart.set(paragraph.startIndex, paragraph);
    }

    const drawingResolver = buildDrawingResolver(snapshot);
    const tableRanges = (body.tables ?? []).map((t) => ({ ...t }));

    const blocks: Block[] = [];
    let cursor = 0;
    const streamEnd = dataStream.length;

    while (cursor < streamEnd) {
        // 进入表格区域？
        const table = tableRanges.find((range) => range.startIndex === cursor);
        if (table && dataStream[cursor] === TOKEN.TABLE_START) {
            const parsed = parseTable(dataStream, table.startIndex, table.endIndex, textRuns, hyperlinks, drawingResolver);
            blocks.push({ kind: "table", table: parsed.table });
            cursor = parsed.nextIndex;
            continue;
        }

        // 普通段落：读到下一个 \r。
        let end = cursor;
        while (end < streamEnd && dataStream[end] !== TOKEN.PARAGRAPH && !TABLE_TOKENS.has(dataStream[end])) {
            end += 1;
        }
        if (dataStream[end] === TOKEN.PARAGRAPH) {
            const paragraphMeta = paragraphByStart.get(end);
            const segments = sliceInlineSegments(dataStream, cursor, end, textRuns, hyperlinks, drawingResolver);
            blocks.push({
                kind: "paragraph",
                paragraph: toParagraphData(segments, paragraphMeta),
            });
            cursor = end + 1;
            continue;
        }
        // 遇到 section break \n 或末尾：跳过。
        cursor = end + 1;
    }

    return blocks;
}

function toParagraphData(
    segments: Segment[],
    meta: { paragraphStyle?: { namedStyleType?: number }; bullet?: { listType?: string; nestingLevel?: number } } | undefined,
): ParagraphData {
    const data: ParagraphData = { segments };
    const named = meta?.paragraphStyle?.namedStyleType;
    if (typeof named === "number" && NAMED_STYLE_TO_HEADING[named]) {
        data.heading = NAMED_STYLE_TO_HEADING[named];
    }
    if (meta?.bullet) {
        const listType = meta.bullet.listType ?? "";
        data.list = {
            ordered: listType.startsWith("ORDER") || listType.includes("DECIMAL"),
            level: meta.bullet.nestingLevel ?? 0,
        };
    }
    return data;
}

interface ParsedTable {
    table: TableData;
    nextIndex: number;
}

// 解析一个表格区域：TABLE_START ... TABLE_END，内部 ROW/CELL 控制字符。
function parseTable(
    dataStream: string,
    startIndex: number,
    endIndex: number,
    textRuns: ITextRun[],
    hyperlinks: HyperlinkRange[],
    drawingResolver: (index: number) => DrawingInfo | undefined,
): ParsedTable {
    const rows: ParagraphData[][][] = [];
    let currentRow: ParagraphData[][] | null = null;
    let cellParagraphs: ParagraphData[] = [];
    let paragraphStart = -1;

    let i = startIndex;
    const limit = Math.min(endIndex, dataStream.length - 1);
    while (i <= limit) {
        const ch = dataStream[i];
        if (ch === TOKEN.TABLE_START) {
            i += 1;
            continue;
        }
        if (ch === TOKEN.TABLE_ROW_START) {
            currentRow = [];
            i += 1;
            continue;
        }
        if (ch === TOKEN.TABLE_CELL_START) {
            paragraphStart = i + 1;
            cellParagraphs = [];
            i += 1;
            continue;
        }
        if (ch === TOKEN.PARAGRAPH) {
            // 单元格内段落结束。
            const segments = sliceInlineSegments(dataStream, paragraphStart, i, textRuns, hyperlinks, drawingResolver);
            cellParagraphs.push({ segments });
            paragraphStart = i + 1;
            i += 1;
            continue;
        }
        if (ch === TOKEN.TABLE_CELL_END) {
            currentRow?.push(cellParagraphs.length > 0 ? cellParagraphs : [{ segments: [] }]);
            cellParagraphs = [];
            i += 1;
            continue;
        }
        if (ch === TOKEN.TABLE_ROW_END) {
            if (currentRow) {
                rows.push(currentRow);
            }
            currentRow = null;
            i += 1;
            continue;
        }
        if (ch === TOKEN.TABLE_END) {
            i += 1;
            break;
        }
        i += 1;
    }

    return { table: { rows }, nextIndex: i };
}

// 把携带 base64 的 Univer drawing 还原成可查表的索引（按 CUSTOM_BLOCK 出现顺序对应 drawingsOrder）。
function buildDrawingResolver(snapshot: IDocumentData): (index: number) => DrawingInfo | undefined {
    const drawings = snapshot.drawings ?? {};
    const order = snapshot.drawingsOrder ?? Object.keys(drawings);
    const dataStream = snapshot.body?.dataStream ?? "";
    // 文档流里第 n 个 CUSTOM_BLOCK 对应 drawingsOrder[n]。
    const blockIndexToDrawingId = new Map<number, string>();
    let blockCount = 0;
    for (let i = 0; i < dataStream.length; i += 1) {
        if (dataStream[i] === TOKEN.CUSTOM_BLOCK) {
            const id = order[blockCount];
            if (id) {
                blockIndexToDrawingId.set(i, id);
            }
            blockCount += 1;
        }
    }
    return (index: number) => {
        const id = blockIndexToDrawingId.get(index);
        if (!id) {
            return undefined;
        }
        const drawing = drawings[id] as
            | { source?: string; imageSourceType?: string; docTransform?: { size?: { width?: number; height?: number } } }
            | undefined;
        if (!drawing?.source) {
            return undefined;
        }
        return {
            base64: drawing.source,
            mime: drawing.imageSourceType ?? "image/png",
            width: drawing.docTransform?.size?.width ?? 200,
            height: drawing.docTransform?.size?.height ?? 150,
        };
    };
}

// ---- docx 构建 ----

function textStyleToRunOptions(style: ITextStyle | undefined): {
    bold?: boolean;
    italics?: boolean;
    underline?: { type: (typeof UnderlineType)[keyof typeof UnderlineType] };
    strike?: boolean;
    color?: string;
    size?: number;
    font?: string;
} {
    if (!style) {
        return {};
    }
    const options: ReturnType<typeof textStyleToRunOptions> = {};
    if (style.bl === BooleanNumber.TRUE) {
        options.bold = true;
    }
    if (style.it === BooleanNumber.TRUE) {
        options.italics = true;
    }
    if (style.ul?.s === BooleanNumber.TRUE) {
        options.underline = { type: UnderlineType.SINGLE };
    }
    if (style.st?.s === BooleanNumber.TRUE) {
        options.strike = true;
    }
    if (style.cl?.rgb) {
        options.color = style.cl.rgb.replace(/^#/, "");
    }
    if (typeof style.fs === "number") {
        // docx 的 size 单位是 half-points。
        options.size = Math.round(style.fs * 2);
    }
    if (style.ff) {
        options.font = style.ff;
    }
    return options;
}

function segmentsToChildren(segments: Segment[]): ParagraphChild[] {
    const children: ParagraphChild[] = [];
    for (const segment of segments) {
        if (segment.kind === "image" && segment.drawing) {
            const run = buildImageRun(segment.drawing);
            if (run) {
                children.push(run);
            }
            continue;
        }
        if (segment.text.length === 0) {
            continue;
        }
        const runOptions = textStyleToRunOptions(segment.style);
        if (segment.url) {
            children.push(
                new ExternalHyperlink({
                    link: segment.url,
                    children: [
                        new TextRun({
                            text: segment.text,
                            ...runOptions,
                            // 超链接默认蓝色下划线（若未显式着色）。
                            color: runOptions.color ?? "1155CC",
                            underline: runOptions.underline ?? { type: UnderlineType.SINGLE },
                        }),
                    ],
                }),
            );
            continue;
        }
        children.push(new TextRun({ text: segment.text, ...runOptions }));
    }
    return children;
}

function buildImageRun(drawing: DrawingInfo): ImageRun | undefined {
    try {
        const type = mimeToImageType(drawing.mime);
        return new ImageRun({
            type,
            data: Buffer.from(drawing.base64, "base64"),
            transformation: { width: Math.round(drawing.width), height: Math.round(drawing.height) },
        });
    } catch {
        return undefined;
    }
}

function mimeToImageType(mime: string): "jpg" | "png" | "gif" | "bmp" {
    if (mime.includes("jpeg") || mime.includes("jpg")) {
        return "jpg";
    }
    if (mime.includes("gif")) {
        return "gif";
    }
    if (mime.includes("bmp")) {
        return "bmp";
    }
    return "png";
}

// docx 的 IParagraphOptions 字段是 readonly，这里用一个可变形状先聚合再构造。
interface MutableParagraphOptions {
    children: ParagraphChild[];
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    numbering?: { reference: string; level: number };
    bullet?: { level: number };
}

function buildParagraph(data: ParagraphData): Paragraph {
    const options: MutableParagraphOptions = { children: segmentsToChildren(data.segments) };
    if (data.heading) {
        options.heading = data.heading;
    }
    if (data.list) {
        if (data.list.ordered) {
            options.numbering = { reference: NUMBERING_REFERENCE, level: Math.min(data.list.level, 8) };
        } else {
            options.bullet = { level: Math.min(data.list.level, 8) };
        }
    }
    return new Paragraph(options);
}

function buildTable(data: TableData): Table {
    const rows = data.rows.map(
        (row) =>
            new TableRow({
                children: row.map(
                    (cellParagraphs) =>
                        new TableCell({
                            width: { size: 100 / Math.max(row.length, 1), type: WidthType.PERCENTAGE },
                            children:
                                cellParagraphs.length > 0
                                    ? cellParagraphs.map((p) => buildParagraph(p))
                                    : [new Paragraph({ children: [] })],
                        }),
                ),
            }),
    );
    return new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
    });
}

// 标准的有序列表 numbering 定义（9 级，逐级数字格式）。
function buildNumberingConfig(): INumberingOptions {
    return {
        config: [
            {
                reference: NUMBERING_REFERENCE,
                levels: Array.from({ length: 9 }, (_, level) => ({
                    level,
                    format: LevelFormat.DECIMAL,
                    text: `%${level + 1}.`,
                    alignment: AlignmentType.START,
                })),
            },
        ],
    };
}

// 入口：把 Univer 文档快照转成保留富文本格式的 docx 字节。
export async function univerDocumentSnapshotToRichDocxBytes(snapshot: IDocumentData): Promise<Uint8Array> {
    const blocks = parseBlocks(snapshot);
    const children = blocks.map((block) =>
        block.kind === "table" ? buildTable(block.table) : buildParagraph(block.paragraph),
    );
    const doc = new Document({
        numbering: buildNumberingConfig(),
        sections: [{ children: children.length > 0 ? children : [new Paragraph({ children: [] })] }],
    });
    const arrayBuffer = await Packer.toArrayBuffer(doc);
    return new Uint8Array(arrayBuffer);
}
