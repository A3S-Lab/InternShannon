export type InternShannonMemorySyncStatus = "idle" | "loading" | "synced" | "local-only" | "error";

export function resolveInternShannonMemorySyncFailureStatus(
  error: unknown,
): Extract<InternShannonMemorySyncStatus, "local-only" | "error"> {
  const status = errorHttpStatus(error);
  if (status === 404 || status === 501) return "local-only";
  return "error";
}

function errorHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  return (
    numericStatus(record.code) ??
    numericStatus(record.status) ??
    numericStatus(record.statusCode) ??
    nestedResponseStatus(record.response)
  );
}

function nestedResponseStatus(response: unknown): number | null {
  if (!response || typeof response !== "object") return null;
  const record = response as Record<string, unknown>;
  return numericStatus(record.status) ?? numericStatus(record.statusCode);
}

function numericStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
