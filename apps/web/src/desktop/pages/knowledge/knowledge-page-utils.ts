import type { WikiConfig } from "@/lib/api/assets";
import { parseAssetWorkspacePath } from "@/lib/asset-workspace-path";
import { hasTauriCore } from "@/lib/runtime-environment";
import { invokeDesktop } from "@/desktop/lib/tauri-runtime";

export interface PendingKnowledgeUpload {
  id: string;
  name: string;
  size: number;
  stage: "reading" | "uploading" | "starting";
}

export const DEFAULT_KNOWLEDGE_EMBEDDING: WikiConfig["embedding"] = {
  provider: "local",
  model: "local-hash-v1",
  dimensions: 192,
  keywordWeight: 1,
  vectorWeight: 6,
  mmrLambda: 0.78,
};

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "尚未索引";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",").pop() || "" : result);
    };
    reader.readAsDataURL(file);
  });
}

export type SavedFileDestination = "chosen" | "download" | "cancelled";

export async function saveBase64File(
  filename: string,
  contentBase64: string,
  mime: string,
): Promise<SavedFileDestination> {
  const binary = globalThis.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  if (hasTauriCore()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const destination = await save({
      defaultPath: filename,
      filters: [{ name: "OKF 知识包", extensions: ["zip", "okf"] }],
    });
    if (!destination) return "cancelled";
    await invokeDesktop("save_file_bytes", { path: destination, bytes: Array.from(bytes) });
    return "chosen";
  }

  const picker = (
    window as typeof window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
    }
  ).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: "OKF 知识包", accept: { [mime]: [".zip", ".okf"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([bytes], { type: mime }));
      await writable.close();
      return "chosen";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }

  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return "download";
}

export function relativeActiveFile(path: string | null | undefined) {
  return parseAssetWorkspacePath(path)?.relativePath ?? null;
}

export function pageTitle(path: string) {
  const name = path.split("/").pop() || path;
  return name.replace(/\.[^.]+$/, "") || name;
}
