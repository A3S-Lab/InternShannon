export type NativeOpenMode = "reveal" | "open-file";

export interface NativeOpenOptions {
  isDirectory?: boolean;
  mode?: NativeOpenMode;
}

function parentPathOf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastForward = normalized.lastIndexOf("/");
  const lastBackward = normalized.lastIndexOf("\\");
  const separatorIndex = Math.max(lastForward, lastBackward);

  if (separatorIndex < 0) return "";
  if (separatorIndex === 0) return normalized.slice(0, 1);
  if (separatorIndex === 2 && /^[A-Za-z]:[\\/]/.test(normalized)) {
    return normalized.slice(0, 3);
  }

  return normalized.slice(0, separatorIndex);
}

export function resolveNativeRevealPath(
  path: string | null | undefined,
  options: { isDirectory?: boolean; rootPath?: string | null } = {},
): string {
  const targetPath = path?.trim() ?? "";
  if (!targetPath) return "";
  if (options.isDirectory) return targetPath;

  const parentPath = parentPathOf(targetPath);
  return parentPath || options.rootPath?.trim() || targetPath;
}
