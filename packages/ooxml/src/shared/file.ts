export interface OfficeFileRef {
    path?: string;
    filename?: string;
}

export function getOfficeFileName(file: string | OfficeFileRef): string {
    const value = typeof file === "string" ? file : (file.filename ?? file.path ?? "");
    return value.split(/[\\/]/).pop() || "untitled";
}

export function getOfficeExtension(file: string | OfficeFileRef): string {
    return getOfficeFileName(file).split(".").pop()?.toLowerCase() ?? "";
}

export function bytesToArrayBuffer(data: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    return buffer;
}
