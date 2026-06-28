import {
  normalizeSocketBoolean,
  normalizeSocketOptionalText,
  normalizeSocketText,
} from "./socket-message-normalization.ts";

interface StreamToolNormalizeOptions {
  fallbackToolName?: string | null;
}

export interface NormalizedStreamToolStartEvent {
  toolUseId: string;
  toolName: string;
  input?: string;
}

export interface NormalizedStreamToolEndEvent {
  toolUseId: string;
  toolName: string;
  output: string;
  isError: boolean;
  before?: string;
  after?: string;
  filePath?: string;
}

export interface NormalizedStreamToolOutputDeltaEvent {
  toolUseId: string;
  toolName: string;
  delta: string;
  elapsedTimeSeconds?: number;
}

export interface NormalizedStreamToolProgressEvent {
  toolUseId: string;
  toolName: string;
  elapsedTimeSeconds: number;
  input?: string;
  output?: string;
}

export function normalizeStreamToolStartEvent(
  event: Record<string, unknown>,
  options: StreamToolNormalizeOptions = {},
): NormalizedStreamToolStartEvent | null {
  const toolName = normalizeStreamToolName(event, options);
  if (!toolName) return null;

  const normalized: NormalizedStreamToolStartEvent = {
    toolUseId: normalizeStreamToolId(event),
    toolName,
  };
  const input = normalizeStreamFirstOptionalText(event.input, event.toolInput, event.tool_input);
  if (input !== undefined) normalized.input = input;
  return normalized;
}

export function normalizeStreamToolEndEvent(
  event: Record<string, unknown>,
  options: StreamToolNormalizeOptions = {},
): NormalizedStreamToolEndEvent | null {
  const toolName = normalizeStreamToolName(event, options);
  if (!toolName) return null;

  const status = normalizeSocketText(event.status).trim().toLowerCase();
  const exitCode = normalizeOptionalFiniteNumber(event.exitCode ?? event.exit_code);
  const failedByExitCode = exitCode !== undefined && exitCode !== 0;
  const normalized: NormalizedStreamToolEndEvent = {
    toolUseId: normalizeStreamToolId(event),
    toolName,
    output: normalizeStreamFirstText(event.output, event.toolOutput, event.tool_output, event.result),
    isError: normalizeSocketBoolean(
      event.isError ?? event.is_error ?? event.error,
      status === "failed" || status === "error" || failedByExitCode,
    ),
  };

  const before = normalizeSocketOptionalText(event.before);
  const after = normalizeSocketOptionalText(event.after);
  const filePath = normalizeSocketOptionalText(event.filePath ?? event.file_path ?? event.path);
  if (before !== undefined) normalized.before = before;
  if (after !== undefined) normalized.after = after;
  if (filePath !== undefined) normalized.filePath = filePath;
  return normalized;
}

export function normalizeStreamToolOutputDeltaEvent(
  event: Record<string, unknown>,
  options: StreamToolNormalizeOptions = {},
): NormalizedStreamToolOutputDeltaEvent | null {
  const toolName = normalizeStreamToolName(event, options);
  if (!toolName) return null;

  const elapsedTimeSeconds = normalizeFirstOptionalFiniteNumber(event.elapsedTimeSeconds, event.elapsed_time_seconds);
  const elapsedTimeSecondsFromMs = normalizeFirstOptionalMillisecondsAsSeconds(event.elapsedMs, event.elapsed_ms);
  const normalized: NormalizedStreamToolOutputDeltaEvent = {
    toolUseId: normalizeStreamToolId(event),
    toolName,
    delta: normalizeStreamFirstText(event.delta, event.outputDelta, event.output_delta, event.text, event.output),
  };
  if (elapsedTimeSeconds !== undefined) normalized.elapsedTimeSeconds = elapsedTimeSeconds;
  else if (elapsedTimeSecondsFromMs !== undefined) normalized.elapsedTimeSeconds = elapsedTimeSecondsFromMs;
  return normalized;
}

export function normalizeStreamToolProgressEvent(
  event: Record<string, unknown>,
  options: StreamToolNormalizeOptions = {},
): NormalizedStreamToolProgressEvent | null {
  const toolName = normalizeStreamToolName(event, options);
  if (!toolName) return null;

  const normalized: NormalizedStreamToolProgressEvent = {
    toolUseId: normalizeStreamToolId(event),
    toolName,
    elapsedTimeSeconds:
      normalizeFirstOptionalFiniteNumber(event.elapsedTimeSeconds, event.elapsed_time_seconds) ??
      normalizeFirstOptionalMillisecondsAsSeconds(event.elapsedMs, event.elapsed_ms) ??
      0,
  };
  const input = normalizeStreamFirstOptionalText(event.input, event.toolInput, event.tool_input);
  const output = normalizeStreamFirstOptionalText(event.output, event.toolOutput, event.tool_output, event.result);
  if (input !== undefined) normalized.input = input;
  if (output !== undefined) normalized.output = output;
  return normalized;
}

function normalizeStreamToolName(
  event: Record<string, unknown>,
  options: StreamToolNormalizeOptions,
): string | null {
  const toolName = normalizeStreamFirstText(event.toolName, event.tool_name, event.name, event.tool);
  if (toolName) return toolName;
  const fallback = typeof options.fallbackToolName === "string" ? options.fallbackToolName.trim() : "";
  return fallback || null;
}

function normalizeStreamToolId(event: Record<string, unknown>): string {
  return normalizeStreamFirstText(
    event.toolUseId,
    event.tool_use_id,
    event.toolId,
    event.tool_id,
    event.toolCallId,
    event.tool_call_id,
    event.id,
  );
}

function normalizeStreamFirstText(...values: unknown[]): string {
  for (const value of values) {
    const text = normalizeSocketText(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizeStreamFirstOptionalText(...values: unknown[]): string | undefined {
  const text = normalizeStreamFirstText(...values);
  return text || undefined;
}

function normalizeOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeFirstOptionalFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const normalized = normalizeOptionalFiniteNumber(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function normalizeOptionalMillisecondsAsSeconds(value: unknown): number | undefined {
  const milliseconds = normalizeOptionalFiniteNumber(value);
  return milliseconds === undefined ? undefined : milliseconds / 1_000;
}

function normalizeFirstOptionalMillisecondsAsSeconds(...values: unknown[]): number | undefined {
  const milliseconds = normalizeFirstOptionalFiniteNumber(...values);
  return milliseconds === undefined ? undefined : milliseconds / 1_000;
}
