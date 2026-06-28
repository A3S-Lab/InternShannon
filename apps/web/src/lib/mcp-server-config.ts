export interface McpServerConfig {
  name: string;
  transport:
    | { type: "stdio"; command: string; args?: string[] }
    | { type: "http" | "streamable-http"; url: string; headers?: Record<string, string> };
  enabled?: boolean;
  env?: Record<string, string>;
  tool_timeout_secs?: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalDisplayString(value: unknown): string | undefined {
  const text = optionalText(value);
  if (text !== undefined) return text;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const numberValue = optionalNumber(value);
  return numberValue !== undefined && numberValue > 0 ? numberValue : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const stringValue = optionalText(item);
    return stringValue === undefined ? [] : [stringValue];
  });
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const output: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const trimmedKey = key.trim();
    const stringValue = optionalDisplayString(rawValue);
    if (trimmedKey && stringValue !== undefined) output[trimmedKey] = stringValue;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeMcpServerConfig(value: unknown): McpServerConfig | null {
  if (!isRecord(value)) return null;
  const name = optionalDisplayString(value.name);
  const transportRecord = isRecord(value.transport) ? value.transport : null;
  if (!name || !transportRecord) return null;

  const transportType = optionalText(transportRecord.type) ?? "stdio";
  const enabled = optionalBoolean(value.enabled);
  const env = normalizeStringRecord(value.env);
  const toolTimeoutSecs = optionalPositiveNumber(value.tool_timeout_secs ?? value.toolTimeoutSecs);
  let transport: McpServerConfig["transport"] | null = null;

  if (transportType === "stdio") {
    const command = optionalDisplayString(transportRecord.command);
    if (!command) return null;
    const args = normalizeStringList(transportRecord.args);
    transport = { type: "stdio", command };
    if (args.length > 0) transport.args = args;
  } else if (transportType === "http" || transportType === "streamable-http") {
    const url = optionalDisplayString(transportRecord.url);
    if (!url) return null;
    const headers = normalizeStringRecord(transportRecord.headers);
    transport = { type: transportType, url };
    if (headers) transport.headers = headers;
  } else {
    return null;
  }

  const server: McpServerConfig = { name, transport };
  if (enabled !== undefined) server.enabled = enabled;
  if (env) server.env = env;
  if (toolTimeoutSecs !== undefined) server.tool_timeout_secs = toolTimeoutSecs;
  return server;
}

export function normalizeMcpServerConfigs(value: unknown): McpServerConfig[] {
  return Array.isArray(value)
    ? value.flatMap((item): McpServerConfig[] => {
        const server = normalizeMcpServerConfig(item);
        return server ? [server] : [];
      })
    : [];
}
