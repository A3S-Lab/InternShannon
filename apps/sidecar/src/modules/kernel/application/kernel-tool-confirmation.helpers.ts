export function extractToolInputForConfirmation(
  normalizedEvent: Record<string, unknown>,
  eventData: Record<string, unknown>
): Record<string, unknown> {
  const candidates = [
    normalizedEvent.input,
    normalizedEvent.toolInput,
    normalizedEvent.tool_input,
    eventData.input,
    eventData.toolInput,
    eventData.tool_input,
    eventData.arguments,
    eventData.args,
  ];
  const contentBlock = eventData.content_block;
  if (contentBlock && typeof contentBlock === "object") {
    candidates.push((contentBlock as Record<string, unknown>).input);
  }

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return {};
}

export function normalizeConfirmationPolicyArgs(args: unknown[]): {
  toolName: string;
  toolInput: Record<string, unknown>;
} {
  const first = args[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const record = first as Record<string, unknown>;
    return {
      toolName:
        nonEmptyString(record.toolName) ||
        nonEmptyString(record.tool_name) ||
        nonEmptyString(record.name) ||
        nonEmptyString(record.tool) ||
        "",
      toolInput: extractToolInputForConfirmation(record, record),
    };
  }

  const second = args[1];
  return {
    toolName: typeof first === "string" ? first.trim() : "",
    toolInput:
      second && typeof second === "object" && !Array.isArray(second)
        ? (second as Record<string, unknown>)
        : {},
  };
}

export function toolConfirmationKey(
  toolName: string,
  toolId: string | undefined,
  toolInput: Record<string, unknown>
): string {
  if (toolId?.trim()) return `${toolName}:${toolId.trim()}`;
  try {
    return `${toolName}:${JSON.stringify(toolInput)}`;
  } catch {
    return `${toolName}:${Date.now()}`;
  }
}

export function safeRuntimePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
