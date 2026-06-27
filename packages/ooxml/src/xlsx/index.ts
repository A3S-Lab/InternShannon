import {
    BooleanNumber,
    CellValueType,
    type ICellData,
    type IWorkbookData,
    type IWorksheetData,
    LocaleType,
} from "@univerjs/core";
import * as XLSX from "xlsx";
import { bytesToArrayBuffer, getOfficeFileName } from "../shared/file";

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
