const DEFAULT_RESIZABLE_HANDLE_LABEL = "调整面板大小";

export function resolveResizableHandleLabel(label?: string | null): string {
  const normalizedLabel = label?.trim();
  return normalizedLabel || DEFAULT_RESIZABLE_HANDLE_LABEL;
}
