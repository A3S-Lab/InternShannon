import { getAgentRuntime, getAgentRuntimeOptional } from "@/runtime";

export {
  getRuntimeCapabilities,
  getSpaRuntimeKind,
  hasTauriCore,
  isWebRuntime,
  type RuntimeCapabilities,
  type SpaRuntimeKind,
} from "./runtime-environment";

export function desktopOnlyMessage(action = "该操作"): string {
  return `${action}仅在桌面版可用，网页版请手动输入路径或改用桌面应用。`;
}

export async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const runtime = getAgentRuntime();
  if (!runtime.isDesktop) {
    throw new Error(desktopOnlyMessage());
  }
  const result = await runtime.invoke<T>(command, args);
  if (result === null) {
    throw new Error(`Desktop command "${command}" failed or returned null`);
  }
  return result;
}

export async function invokeDesktopOptional<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  const runtime = getAgentRuntimeOptional();
  if (!runtime) return null;
  return runtime.invoke<T>(command, args);
}

export async function openNativeDialog(options: Record<string, unknown>): Promise<string | string[] | null> {
  const runtime = getAgentRuntimeOptional();
  if (runtime?.isDesktop && runtime.pickDirectory && options.directory) {
    const defaultPath = typeof options.defaultPath === "string" ? options.defaultPath : undefined;
    return await runtime.pickDirectory(defaultPath);
  }

  const title = typeof options.title === "string" ? options.title : "输入路径";
  const value = window.prompt(
    `${title}\n\n浏览器环境无���打开系统文件夹选择器。\n请手动输入文件夹的完整路径，\n或者使用桌面版应用来选择文件夹。`,
  );
  return value?.trim() || null;
}

export async function openNativeDirectoryDialog(): Promise<string | null> {
  const selected = await openNativeDialog({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export async function openExternalUrl(url: string): Promise<void> {
  const runtime = getAgentRuntimeOptional();
  if (runtime?.openUrl) {
    await runtime.openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openLocalPath(path: string): Promise<boolean> {
  if (!path.trim()) return false;
  const runtime = getAgentRuntimeOptional();
  if (!runtime?.openFolder) return false;
  await runtime.openFolder(path);
  return true;
}
