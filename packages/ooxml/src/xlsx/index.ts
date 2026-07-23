import {
    BooleanNumber,
    CellValueType,
    type ICellData,
    type IWorkbookData,
    type IWorksheetData,
    LocaleType,
} from "@univerjs/core";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip = require("jszip");
import * as XLSX from "xlsx";
import { bytesToArrayBuffer, getOfficeFileName } from "../shared/file";

const SPREADSHEETML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ADVANCED_XLSX_PART = /^xl\/(?:charts|drawings|media|embeddings|externalLinks|pivotTables|pivotCache|slicers|ctrlProps)/i;

export interface PreservedXlsxExportOptions {
    originalBytes: Uint8Array;
    baselineSnapshot?: IWorkbookData;
}

function getSheetId(index: number): string {
    return `sheet-${index + 1}`;
}

function getCellType(value: unknown): CellValueType {
    if (typeof value === "number") return CellValueType.NUMBER;
    if (typeof value === "boolean") return CellValueType.BOOLEAN;
    return CellValueType.STRING;
}

function toCellValue(value: unknown): string | number | boolean {
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (value == null) return "";
    return String(value);
}

function toUniverCell(cell: XLSX.CellObject | undefined): ICellData | null {
    if (!cell || (cell.v == null && !cell.f)) return null;
    const value = toCellValue(cell.v ?? "");
    const result: ICellData = {
        v: value,
        t: getCellType(value),
    };
    if (cell.f) {
        result.f = cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
    }
    return result;
}

function getWorksheetRange(worksheet: XLSX.WorkSheet): XLSX.Range {
    try {
        return XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
    } catch {
        return XLSX.utils.decode_range("A1:A1");
    }
}

function worksheetToUniverSheet(
    worksheet: XLSX.WorkSheet,
    name: string,
    id: string,
    hidden: boolean,
): Partial<IWorksheetData> {
    const range = getWorksheetRange(worksheet);
    const rowCount = Math.max(range.e.r + 1, 100);
    const columnCount = Math.max(range.e.c + 1, 26);
    const cellData: IWorksheetData["cellData"] = {};

    Object.entries(worksheet).forEach(([address, cell]) => {
        if (address.startsWith("!")) return;
        const position = XLSX.utils.decode_cell(address);
        const univerCell = toUniverCell(cell as XLSX.CellObject | undefined);
        if (!univerCell) return;
        cellData[position.r] ??= {};
        cellData[position.r][position.c] = univerCell;
    });

    const columnData: IWorksheetData["columnData"] = {};
    worksheet["!cols"]?.forEach((column, index) => {
        if (!column?.wpx && !column?.wch) return;
        columnData[index] = { w: column.wpx ?? Math.round((column.wch ?? 10) * 8) };
    });

    const rowData: IWorksheetData["rowData"] = {};
    worksheet["!rows"]?.forEach((row, index) => {
        if (!row?.hpx && !row?.hpt) return;
        rowData[index] = { h: row.hpx ?? Math.round((row.hpt ?? 18) * 1.33) };
    });

    return {
        id,
        name,
        tabColor: "",
        hidden: hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE,
        freeze: { startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
        rowCount,
        columnCount,
        zoomRatio: 1,
        scrollTop: 0,
        scrollLeft: 0,
        defaultColumnWidth: 88,
        defaultRowHeight: 24,
        mergeData:
            worksheet["!merges"]?.map((merge) => ({
                startRow: merge.s.r,
                startColumn: merge.s.c,
                endRow: merge.e.r,
                endColumn: merge.e.c,
            })) ?? [],
        cellData,
        rowData,
        columnData,
        rowHeader: { width: 46 },
        columnHeader: { height: 24 },
        showGridlines: BooleanNumber.TRUE,
        rightToLeft: BooleanNumber.FALSE,
    };
}

export function workbookBytesToUniverSnapshot(data: Uint8Array, options: { filename: string }): IWorkbookData {
    const workbook = XLSX.read(bytesToArrayBuffer(data), {
        type: "array",
        cellDates: false,
        cellFormula: true,
        cellStyles: true,
    });
    const sheetNames = workbook.SheetNames.length > 0 ? workbook.SheetNames : ["Sheet1"];
    const sheetOrder = sheetNames.map((_, index) => getSheetId(index));
    const sheets: IWorkbookData["sheets"] = {};

    sheetNames.forEach((name, index) => {
        const sheetId = sheetOrder[index];
        const worksheet = workbook.Sheets[name] ?? XLSX.utils.aoa_to_sheet([[]]);
        const hidden = Boolean(workbook.Workbook?.Sheets?.[index]?.Hidden);
        sheets[sheetId] = worksheetToUniverSheet(worksheet, name, sheetId, hidden);
    });

    return {
        id: `workbook-${Date.now()}`,
        name: getOfficeFileName(options.filename),
        appVersion: "0.24.0",
        locale: LocaleType.ZH_CN,
        styles: {},
        sheetOrder,
        sheets,
    };
}

function toSheetJsCell(cell: ICellData | null | undefined): XLSX.CellObject | null {
    if (!cell || (cell.v == null && !cell.f)) return null;
    const value = cell.v ?? "";
    const result: XLSX.CellObject = {
        t: typeof value === "number" ? "n" : typeof value === "boolean" ? "b" : "s",
        v: value,
    };
    if (cell.f) {
        result.f = cell.f.startsWith("=") ? cell.f.slice(1) : cell.f;
    }
    return result;
}

function univerSheetToWorksheet(sheet: Partial<IWorksheetData>): XLSX.WorkSheet {
    const worksheet: XLSX.WorkSheet = {};
    let maxRow = 0;
    let maxColumn = 0;

    Object.entries(sheet.cellData ?? {}).forEach(([rowKey, columns]) => {
        const row = Number(rowKey);
        Object.entries(columns ?? {}).forEach(([columnKey, cell]) => {
            const column = Number(columnKey);
            const sheetCell = toSheetJsCell(cell as ICellData | null | undefined);
            if (!sheetCell) return;
            worksheet[XLSX.utils.encode_cell({ r: row, c: column })] = sheetCell;
            maxRow = Math.max(maxRow, row);
            maxColumn = Math.max(maxColumn, column);
        });
    });

    worksheet["!ref"] = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(maxRow, 0), c: Math.max(maxColumn, 0) },
    });
    worksheet["!merges"] =
        sheet.mergeData?.map((merge) => ({
            s: { r: merge.startRow, c: merge.startColumn },
            e: { r: Math.max(merge.endRow, merge.startRow), c: Math.max(merge.endColumn, merge.startColumn) },
        })) ?? [];
    return worksheet;
}

export function univerWorkbookSnapshotToBytes(snapshot: IWorkbookData, ext = "xlsx"): Uint8Array {
    const workbook = XLSX.utils.book_new();

    snapshot.sheetOrder.forEach((sheetId) => {
        const sheet = snapshot.sheets[sheetId];
        if (!sheet) return;
        XLSX.utils.book_append_sheet(workbook, univerSheetToWorksheet(sheet), sheet.name || sheetId);
    });

    if (ext === "csv") {
        const firstSheetName = workbook.SheetNames[0];
        const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : XLSX.utils.aoa_to_sheet([[]]);
        return new TextEncoder().encode(XLSX.utils.sheet_to_csv(firstSheet));
    }

    const bookType = ext === "xls" ? "biff8" : ext === "ods" ? "ods" : "xlsx";
    const output = XLSX.write(workbook, { bookType, type: "array" }) as ArrayBuffer;
    return new Uint8Array(output);
}

/**
 * Saves an XLSX by editing worksheet XML inside the original package.
 * Charts, drawings, media, relationships, styles, comments, macros and other
 * unowned parts stay untouched. Unsafe sheet-layout or style mutations are
 * rejected with a user-facing error instead of silently rebuilding the ZIP.
 */
export async function univerWorkbookSnapshotToPreservedXlsxBytes(
    snapshot: IWorkbookData,
    options: PreservedXlsxExportOptions,
): Promise<Uint8Array> {
    const zip = await JSZip.loadAsync(bytesToArrayBuffer(options.originalBytes));
    if (!Object.keys(zip.files).some((name) => ADVANCED_XLSX_PART.test(name))) {
        return univerWorkbookSnapshotToBytes(snapshot, "xlsx");
    }

    const baseline =
        options.baselineSnapshot ?? workbookBytesToUniverSnapshot(options.originalBytes, { filename: "preserved.xlsx" });
    assertSafeWorkbookStructure(snapshot, baseline);

    const [workbookXml, relationshipsXml] = await Promise.all([
        zip.file("xl/workbook.xml")?.async("text"),
        zip.file("xl/_rels/workbook.xml.rels")?.async("text"),
    ]);
    if (!workbookXml || !relationshipsXml) throw new Error("Invalid XLSX package: workbook relationships are missing.");

    const parser = new DOMParser();
    const workbookDocument = parser.parseFromString(workbookXml, "application/xml");
    const relationshipsDocument = parser.parseFromString(relationshipsXml, "application/xml");
    const relationshipTargets = new Map<string, string>();
    for (const relationship of elements(relationshipsDocument, PACKAGE_REL_NS, "Relationship")) {
        const id = relationship.getAttribute("Id");
        const target = relationship.getAttribute("Target");
        if (id && target) relationshipTargets.set(id, resolveWorkbookTarget(target));
    }

    const workbookSheets = elements(workbookDocument, SPREADSHEETML_NS, "sheet");
    if (workbookSheets.length !== snapshot.sheetOrder.length) {
        throw new Error("该 XLSX 含图表或绘图，且工作表数量已经变化；为避免丢失高级结构，本次保存已阻止。");
    }

    for (let index = 0; index < workbookSheets.length; index += 1) {
        const sheetElement = workbookSheets[index];
        const relationshipId = sheetElement.getAttributeNS(OFFICE_REL_NS, "id") ?? sheetElement.getAttribute("r:id");
        const worksheetPath = relationshipId ? relationshipTargets.get(relationshipId) : undefined;
        const sheetId = snapshot.sheetOrder[index];
        const sheet = snapshot.sheets[sheetId];
        const baselineSheetId = baseline.sheetOrder[index];
        const baselineSheet = baseline.sheets[baselineSheetId];
        if (!worksheetPath || !sheet || !baselineSheet) {
            throw new Error("Unable to map the XLSX workbook sheets to their original package parts.");
        }
        const originalName = sheetElement.getAttribute("name") ?? "";
        if ((sheet.name || sheetId) !== originalName) {
            throw new Error("该 XLSX 含图表或绘图，暂不支持在保真模式下重命名工作表。");
        }

        const worksheetXml = await zip.file(worksheetPath)?.async("text");
        if (!worksheetXml) throw new Error(`Invalid XLSX package: ${worksheetPath} is missing.`);
        const worksheetDocument = parser.parseFromString(worksheetXml, "application/xml");
        patchWorksheet(worksheetDocument, sheet, baselineSheet);
        zip.file(worksheetPath, new XMLSerializer().serializeToString(worksheetDocument));
    }

    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function elements(document: Document, namespace: string, localName: string): Element[] {
    return Array.from(document.getElementsByTagNameNS(namespace, localName)) as Element[];
}

function resolveWorkbookTarget(target: string): string {
    const segments = (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/");
    const resolved: string[] = [];
    for (const segment of segments) {
        if (!segment || segment === ".") continue;
        if (segment === "..") resolved.pop();
        else resolved.push(segment);
    }
    return resolved.join("/");
}

function assertSafeWorkbookStructure(snapshot: IWorkbookData, baseline: IWorkbookData): void {
    if (snapshot.sheetOrder.length !== baseline.sheetOrder.length) {
        throw new Error("该 XLSX 含图表或绘图，暂不支持在保真模式下增删工作表。");
    }
    for (let index = 0; index < snapshot.sheetOrder.length; index += 1) {
        const sheet = snapshot.sheets[snapshot.sheetOrder[index]];
        const before = baseline.sheets[baseline.sheetOrder[index]];
        if (!sheet || !before) throw new Error("Unable to compare XLSX workbook structure safely.");
        const layout = (value: Partial<IWorksheetData>) =>
            JSON.stringify({
                rowData: value.rowData ?? {},
                columnData: value.columnData ?? {},
                freeze: value.freeze ?? null,
                hidden: value.hidden ?? null,
            });
        if (layout(sheet) !== layout(before)) {
            throw new Error("该 XLSX 含图表或绘图；当前只能安全保存单元格内容与合并区域修改。请撤销行列尺寸或冻结设置调整后重试。");
        }
        for (const [rowKey, columns] of Object.entries(sheet.cellData ?? {})) {
            for (const [columnKey, cell] of Object.entries(columns ?? {})) {
                const oldStyle = before.cellData?.[Number(rowKey)]?.[Number(columnKey)]?.s ?? null;
                if (JSON.stringify((cell as ICellData | undefined)?.s ?? null) !== JSON.stringify(oldStyle)) {
                    throw new Error("该 XLSX 含图表或绘图，暂不支持在保真模式下修改单元格样式。");
                }
            }
        }
    }
}

function patchWorksheet(
    document: Document,
    sheet: Partial<IWorksheetData>,
    baseline: Partial<IWorksheetData>,
): void {
    const sheetData = elements(document, SPREADSHEETML_NS, "sheetData")[0];
    if (!sheetData?.parentNode) throw new Error("Invalid XLSX worksheet: sheetData is missing.");
    const originalRows = new Map<number, Element>();
    const originalCells = new Map<string, Element>();
    for (const row of Array.from(sheetData.childNodes)) {
        if (row.nodeType !== 1 || (row as Element).localName !== "row") continue;
        const element = row as Element;
        const rowNumber = Number(element.getAttribute("r"));
        if (Number.isFinite(rowNumber) && rowNumber > 0) originalRows.set(rowNumber - 1, element);
        for (const cell of Array.from(element.childNodes)) {
            if (cell.nodeType !== 1 || (cell as Element).localName !== "c") continue;
            const reference = (cell as Element).getAttribute("r");
            if (reference) originalCells.set(reference, cell as Element);
        }
    }

    const replacement = document.createElementNS(SPREADSHEETML_NS, "sheetData");
    const targetRows = new Set<number>(originalRows.keys());
    for (const rowKey of Object.keys(sheet.cellData ?? {})) targetRows.add(Number(rowKey));
    const usedCells: Array<{ row: number; column: number }> = [];

    for (const rowIndex of [...targetRows].filter(Number.isFinite).sort((left, right) => left - right)) {
        const originalRow = originalRows.get(rowIndex);
        const row = originalRow
            ? (originalRow.cloneNode(false) as Element)
            : document.createElementNS(SPREADSHEETML_NS, "row");
        row.setAttribute("r", String(rowIndex + 1));
        const columns = sheet.cellData?.[rowIndex] ?? {};
        for (const [columnKey, cell] of Object.entries(columns).sort(([left], [right]) => Number(left) - Number(right))) {
            const columnIndex = Number(columnKey);
            const reference = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
            const baselineCell = baseline.cellData?.[rowIndex]?.[columnIndex];
            const originalCell = originalCells.get(reference);
            const nextCell = cell as ICellData | null | undefined;
            if (originalCell && cellContentSignature(nextCell) === cellContentSignature(baselineCell)) {
                row.appendChild(originalCell.cloneNode(true));
            } else {
                const serialized = createCell(document, reference, nextCell, originalCell);
                if (serialized) row.appendChild(serialized);
            }
            if (nextCell && (nextCell.v != null || nextCell.f)) usedCells.push({ row: rowIndex, column: columnIndex });
        }
        if (originalRow) {
            for (const child of Array.from(originalRow.childNodes)) {
                if (child.nodeType === 1 && (child as Element).localName === "c") continue;
                row.appendChild(child.cloneNode(true));
            }
        }
        if (row.childNodes.length > 0 || originalRow) replacement.appendChild(row);
    }
    sheetData.parentNode.replaceChild(replacement, sheetData);
    patchMergeCells(document, replacement, sheet.mergeData ?? []);
    patchDimension(document, usedCells);
}

function cellContentSignature(cell: ICellData | null | undefined): string {
    return JSON.stringify({ v: cell?.v ?? null, f: cell?.f ?? null, t: cell?.t ?? null });
}

function createCell(
    document: Document,
    reference: string,
    cell: ICellData | null | undefined,
    original: Element | undefined,
): Element | null {
    if (!cell || (cell.v == null && !cell.f)) return null;
    const result = document.createElementNS(SPREADSHEETML_NS, "c");
    result.setAttribute("r", reference);
    const style = original?.getAttribute("s");
    if (style) result.setAttribute("s", style);
    if (cell.f) {
        const formula = document.createElementNS(SPREADSHEETML_NS, "f");
        formula.appendChild(document.createTextNode(cell.f.startsWith("=") ? cell.f.slice(1) : cell.f));
        result.appendChild(formula);
    }
    const value = cell.v ?? "";
    if (typeof value === "string") {
        if (cell.f) {
            result.setAttribute("t", "str");
            const node = document.createElementNS(SPREADSHEETML_NS, "v");
            node.appendChild(document.createTextNode(value));
            result.appendChild(node);
        } else {
            result.setAttribute("t", "inlineStr");
            const inline = document.createElementNS(SPREADSHEETML_NS, "is");
            const text = document.createElementNS(SPREADSHEETML_NS, "t");
            text.appendChild(document.createTextNode(value));
            inline.appendChild(text);
            result.appendChild(inline);
        }
    } else {
        if (typeof value === "boolean") result.setAttribute("t", "b");
        const node = document.createElementNS(SPREADSHEETML_NS, "v");
        node.appendChild(document.createTextNode(typeof value === "boolean" ? (value ? "1" : "0") : String(value)));
        result.appendChild(node);
    }
    return result;
}

function patchMergeCells(document: Document, sheetData: Element, merges: NonNullable<IWorksheetData["mergeData"]>): void {
    const existing = elements(document, SPREADSHEETML_NS, "mergeCells")[0];
    if (merges.length === 0) {
        existing?.parentNode?.removeChild(existing);
        return;
    }
    const replacement = document.createElementNS(SPREADSHEETML_NS, "mergeCells");
    replacement.setAttribute("count", String(merges.length));
    for (const merge of merges) {
        const node = document.createElementNS(SPREADSHEETML_NS, "mergeCell");
        node.setAttribute(
            "ref",
            XLSX.utils.encode_range({
                s: { r: merge.startRow, c: merge.startColumn },
                e: { r: merge.endRow, c: merge.endColumn },
            }),
        );
        replacement.appendChild(node);
    }
    if (existing?.parentNode) existing.parentNode.replaceChild(replacement, existing);
    else sheetData.parentNode?.insertBefore(replacement, sheetData.nextSibling);
}

function patchDimension(document: Document, cells: Array<{ row: number; column: number }>): void {
    const dimension = elements(document, SPREADSHEETML_NS, "dimension")[0];
    if (!dimension) return;
    if (cells.length === 0) {
        dimension.setAttribute("ref", "A1");
        return;
    }
    const rows = cells.map((cell) => cell.row);
    const columns = cells.map((cell) => cell.column);
    dimension.setAttribute(
        "ref",
        XLSX.utils.encode_range({
            s: { r: Math.min(...rows), c: Math.min(...columns) },
            e: { r: Math.max(...rows), c: Math.max(...columns) },
        }),
    );
}
