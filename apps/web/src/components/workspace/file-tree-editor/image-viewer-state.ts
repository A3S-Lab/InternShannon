export function getImageMimeType(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

export function createImageObjectUrl(
  data: Uint8Array,
  mime: string,
  urlApi: Pick<typeof URL, "createObjectURL"> = URL,
): string {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return urlApi.createObjectURL(new Blob([buffer], { type: mime }));
}
