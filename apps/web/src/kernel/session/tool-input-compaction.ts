const DEFAULT_MAX_TOOL_INPUT_BYTES = 8 * 1024;

export interface ToolInputCompactionOptions {
  maxBytes?: number;
}

export function compactToolInputForUi(
  toolName: string,
  rawInput: string | undefined,
  options: ToolInputCompactionOptions = {},
): string {
  if (!rawInput) return "";
  const maxBytes = positiveInt(options.maxBytes, DEFAULT_MAX_TOOL_INPUT_BYTES);
  const rawBytes = byteLength(rawInput);
  if (rawBytes <= maxBytes) return rawInput;

  const parsed = parseRecord(rawInput);
  const path = extractPath(parsed);
  const omittedFields = parsed ? largeStringFieldNames(parsed) : [];
  const displayTarget = path || normalizeToolNameForDisplay(toolName);
  const summary: Record<string, unknown> = {
    __display: `${displayTarget} · input ${formatBytes(rawBytes)}，大字段已为界面省略`,
    __omitted: true,
    __rawBytes: rawBytes,
  };
  if (path) summary.path = path;
  if (omittedFields.length > 0) summary.__omittedFields = omittedFields;
  return JSON.stringify(summary, null, 2);
}

function parseRecord(rawInput: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawInput);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractPath(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  for (const key of ["path", "filePath", "file_path", "filename"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function largeStringFieldNames(record: Record<string, unknown>): string[] {
  return Object.entries(record)
    .filter(([, value]) => typeof value === "string" && byteLength(value) > 512)
    .map(([key]) => key);
}

function normalizeToolNameForDisplay(toolName: string): string {
  const normalized = toolName.trim();
  return normalized || "tool";
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
