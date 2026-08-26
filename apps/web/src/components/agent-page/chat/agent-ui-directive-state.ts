export interface AgentUiDirective {
  component: "quick-actions";
  props: Record<string, unknown>;
}

const ACTION_ICONS = new Set(["rocket", "search", "plus", "book", "tool", "package"]);
const DIRECTIVE_FIELDS = new Set(["component", "props"]);
const PROPS_FIELDS = new Set(["title", "actions"]);
const ACTION_FIELDS = new Set(["label", "description", "icon", "navigate", "prefill", "autoSend"]);

export function parseTrustedAgentUiDirective(code: string): AgentUiDirective | null {
  const trimmed = code.trim();
  const direct = parseRecord(trimmed);
  if (direct && isDirective(direct)) return direct;
  if (objectBraceBalance(trimmed) !== 1) return null;
  const repaired = parseRecord(`${trimmed}}`);
  return repaired && isDirective(repaired) ? repaired : null;
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function objectBraceBalance(value: string): number {
  let balance = 0;
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") balance += 1;
    else if (char === "}") balance -= 1;
    if (balance < 0) return balance;
  }
  return inString ? Number.NaN : balance;
}

function isDirective(value: Record<string, unknown>): value is Record<string, unknown> & AgentUiDirective {
  if (!hasOnlyFields(value, DIRECTIVE_FIELDS)) return false;
  if (value.component !== "quick-actions") return false;
  const props = value.props;
  if (!props || typeof props !== "object" || Array.isArray(props)) return false;
  const record = props as Record<string, unknown>;
  if (!hasOnlyFields(record, PROPS_FIELDS)) return false;
  if (record.title !== undefined && (typeof record.title !== "string" || !bounded(record.title, 120))) return false;
  if (!Array.isArray(record.actions) || record.actions.length < 1 || record.actions.length > 4) return false;
  return record.actions.every(isAction);
}

function isAction(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  if (!hasOnlyFields(action, ACTION_FIELDS)) return false;
  if (typeof action.label !== "string" || !bounded(action.label, 80)) return false;
  if (action.description !== undefined && (typeof action.description !== "string" || !bounded(action.description, 160)))
    return false;
  if (action.icon !== undefined && (typeof action.icon !== "string" || !ACTION_ICONS.has(action.icon))) return false;
  if (action.autoSend !== undefined && typeof action.autoSend !== "boolean") return false;
  const hasPrefill = typeof action.prefill === "string" && bounded(action.prefill, 2_000);
  const hasNavigate =
    typeof action.navigate === "string" &&
    bounded(action.navigate, 512) &&
    action.navigate.startsWith("/") &&
    !action.navigate.startsWith("//");
  if (hasPrefill === hasNavigate) return false;
  if (action.prefill !== undefined && !hasPrefill) return false;
  if (action.navigate !== undefined && !hasNavigate) return false;
  return action.autoSend === undefined || hasPrefill;
}

function bounded(value: string, max: number): boolean {
  const length = value.trim().length;
  return length > 0 && length <= max;
}

function hasOnlyFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((field) => allowed.has(field));
}
