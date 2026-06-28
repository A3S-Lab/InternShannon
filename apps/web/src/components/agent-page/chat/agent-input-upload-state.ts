export interface PendingFile {
  id: string;
  name: string;
  mediaType: string;
  data: string;
  progress?: number;
}

export interface UploadedWorkspaceFile {
  path: string;
  label: string;
}

interface DroppedFileItemEntry {
  isDirectory?: boolean;
}

interface DroppedFileItemLike {
  kind?: string;
  webkitGetAsEntry?: () => DroppedFileItemEntry | null;
  getAsFile?: () => File | null;
}

interface DroppedFileTransferLike {
  items?: ArrayLike<DroppedFileItemLike> | null;
  files?: ArrayLike<File> | null;
}

let fileIdCounter = 0;

export function createPendingFileId(): string {
  return `file-${Date.now()}-${++fileIdCounter}`;
}

export function createPendingFilesFromPastedImages(images: { mediaType: string; data: string }[]): PendingFile[] {
  const files: PendingFile[] = [];
  for (const img of images) {
    const mediaType = img.mediaType.trim();
    const data = img.data.trim();
    if (!mediaType || !data) continue;
    files.push({
      id: createPendingFileId(),
      name: "粘贴图片",
      mediaType,
      data,
    });
  }
  return files;
}

export function sanitizeWorkspaceFileName(name: string): string {
  const sanitized = name
    .replace(/[\\/]/g, "-")
    .replace(/[<>:"|?*]/g, "-")
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized : `upload-${Date.now()}`;
}

export function fileLabelFromPath(path: string, fallback: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || fallback;
}

export function clampUploadPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function formatUploadBytes(value: number): string {
  const bytes = Math.max(0, value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatUploadSizeText(loaded: number, total: number): string {
  return total > 0 ? `${formatUploadBytes(loaded)} / ${formatUploadBytes(total)}` : "准备上传";
}

export function resolveUploadButtonTitle(reason: "disabled" | "connecting" | "uploading" | null): string {
  if (reason === "connecting") return "等待本地服务连接";
  if (reason === "uploading") return "文件正在上传中";
  if (reason === "disabled") return "上传不可用";
  return "上传文件到工作区";
}

export function getDroppedFiles(dataTransfer: DroppedFileTransferLike): { files: File[]; skippedDirectories: number } {
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length === 0) {
    return { files: Array.from(dataTransfer.files ?? []), skippedDirectories: 0 };
  }

  const files: File[] = [];
  let skippedDirectories = 0;
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      skippedDirectories += 1;
      continue;
    }
    const file = item.getAsFile?.();
    if (file) files.push(file);
  }
  return { files, skippedDirectories };
}
