import { getOfficeExtension } from "./file";

export type OfficeFileKind = "document" | "spreadsheet" | "presentation";
export type UnsupportedOfficeReason = "legacy-binary" | "opendocument-unsupported" | "not-office";

export interface OfficeFileCapability {
    extension: string;
    kind: OfficeFileKind | null;
    directUniver: boolean;
    editable: boolean;
    unsupportedReason?: UnsupportedOfficeReason;
}

export const OFFICE_DOCUMENT_EXTENSIONS = ["doc", "docx", "odt"] as const;
export const OFFICE_SPREADSHEET_EXTENSIONS = ["xls", "xlsx", "ods"] as const;
export const OFFICE_PRESENTATION_EXTENSIONS = ["ppt", "pptx", "odp"] as const;
export const DIRECT_UNIVER_DOCUMENT_EXTENSIONS = ["docx"] as const;
export const DIRECT_UNIVER_SPREADSHEET_EXTENSIONS = ["xls", "xlsx", "ods"] as const;
export const DIRECT_UNIVER_PRESENTATION_EXTENSIONS = ["pptx"] as const;

export const OFFICE_FILE_EXTENSIONS = [
    ...OFFICE_DOCUMENT_EXTENSIONS,
    ...OFFICE_SPREADSHEET_EXTENSIONS,
    ...OFFICE_PRESENTATION_EXTENSIONS,
] as const;

export const DIRECT_UNIVER_OFFICE_EXTENSIONS = [
    ...DIRECT_UNIVER_DOCUMENT_EXTENSIONS,
    ...DIRECT_UNIVER_SPREADSHEET_EXTENSIONS,
    ...DIRECT_UNIVER_PRESENTATION_EXTENSIONS,
] as const;

const DOCUMENT_EXTENSIONS = new Set<string>(OFFICE_DOCUMENT_EXTENSIONS);
const SPREADSHEET_EXTENSIONS = new Set<string>(OFFICE_SPREADSHEET_EXTENSIONS);
const PRESENTATION_EXTENSIONS = new Set<string>(OFFICE_PRESENTATION_EXTENSIONS);
const DIRECT_UNIVER_EXTENSIONS = new Set<string>(DIRECT_UNIVER_OFFICE_EXTENSIONS);
const LEGACY_BINARY_EXTENSIONS = new Set<string>(["doc", "ppt"]);
const OPENDOCUMENT_UNSUPPORTED_EXTENSIONS = new Set<string>(["odt", "odp"]);

export function getOfficeFileKind(file: string): OfficeFileKind | null {
    const ext = getOfficeExtension(file);
    if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
    if (SPREADSHEET_EXTENSIONS.has(ext)) return "spreadsheet";
    if (PRESENTATION_EXTENSIONS.has(ext)) return "presentation";
    return null;
}

export function isOfficeFile(file: string): boolean {
    return getOfficeFileKind(file) !== null;
}

export function canOpenOfficeFileWithUniver(file: string): boolean {
    return DIRECT_UNIVER_EXTENSIONS.has(getOfficeExtension(file));
}

export function getOfficeFileCapability(file: string): OfficeFileCapability {
    const extension = getOfficeExtension(file);
    const kind = getOfficeFileKind(file);
    const directUniver = DIRECT_UNIVER_EXTENSIONS.has(extension);

    if (!kind) {
        return {
            extension,
            kind,
            directUniver: false,
            editable: false,
            unsupportedReason: "not-office",
        };
    }

    if (directUniver) {
        return {
            extension,
            kind,
            directUniver: true,
            editable: true,
        };
    }

    return {
        extension,
        kind,
        directUniver: false,
        editable: false,
        unsupportedReason: LEGACY_BINARY_EXTENSIONS.has(extension)
            ? "legacy-binary"
            : OPENDOCUMENT_UNSUPPORTED_EXTENSIONS.has(extension)
              ? "opendocument-unsupported"
              : "not-office",
    };
}
