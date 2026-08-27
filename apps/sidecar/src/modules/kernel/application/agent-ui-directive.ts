export const AGENT_UI_DEGRADED_NOTICE = "快捷操作暂不可用，请参考正文继续操作。";

const AGENT_UI_FENCE = /```agent-ui[ \t]*\r?\n([\s\S]*?)(?:```[ \t]*(?=\r?\n|$)|$)/giu;
const AGENT_UI_PLACEHOLDER_PREFIX = "INTERNAL_AGENT_UI_DIRECTIVE_TOKEN";
const ACTION_ICONS = new Set(["rocket", "search", "plus", "book", "tool", "package"]);
const DIRECTIVE_FIELDS = new Set(["component", "props"]);
const PROPS_FIELDS = new Set(["title", "actions"]);
const ACTION_FIELDS = new Set(["label", "description", "icon", "navigate", "prefill", "autoSend"]);
const FULLWIDTH_LABELED_SOURCE_HANDLE = /［([^［］｜|\n]{1,240})\s*[｜|]\s*K\d+(?::[^］\n]{1,240})?］/gu;
const DOUBLE_LABELED_SOURCE_HANDLE = /\[\[([^\[\]|\n]{1,240})\s*\|\s*K\d+(?::[^\]\n]{1,240})?\]\]/gu;
const SINGLE_LABELED_SOURCE_HANDLE = /(?<!\[)\[([^\[\]|\n]{1,240})\s*\|\s*K\d+(?::[^\]\n]{1,240})?\](?!\])/gu;
const OPAQUE_SOURCE_HANDLE =
    /(?:\[\[\s*K\d+(?::[^\]\n]{1,240})?\]\]|［\s*K\d+(?::[^］\n]{1,240})?］|(?<!\[)\[\s*K\d+(?::[^\]\n]{1,240})?\](?!\])|(?<![\p{L}\p{N}_])K\d+(?:(?::|#)[^\s\[\]［］，,。；;！？!?()（）【】]{0,160})?(?![\p{L}\p{N}_]))/gu;
const DANGEROUS_URI =
    /(?<![A-Za-z0-9_-])(?:(?:asset|file):\/{1,2}[^\s<>"'`，,。；;：:！？!?、）】］}]*|(?:javascript|data):[^\s<>"'`）】］}]*)/giu;

export type AgentUiDirectiveStatus = "valid" | "repaired" | "invalid";

export interface AgentUiDirectiveNormalization {
    text: string;
    validCount: number;
    repairedCount: number;
    invalidCount: number;
}

export interface ParsedAgentUiDirective {
    status: Exclude<AgentUiDirectiveStatus, "invalid">;
    value: Record<string, unknown>;
}

export interface IsolatedAgentUiDirective {
    placeholder: string;
    serialized: string;
    status: Exclude<AgentUiDirectiveStatus, "invalid">;
}

/**
 * Prose-only text plus application-owned directives held outside the citation
 * pipeline. Callers must pass `text` to citation/safety processing and then
 * restore with {@link restoreAgentUiDirectivesAfterCitation}.
 */
export interface AgentUiCitationIsolation {
    text: string;
    directives: readonly IsolatedAgentUiDirective[];
    invalidCount: number;
}

export function normalizeAgentUiDirectives(text: string): AgentUiDirectiveNormalization {
    const isolation = isolateAgentUiDirectivesForCitation(text);
    return restoreAgentUiDirectivesAfterCitation(isolation.text, isolation);
}

/**
 * Remove every agent-ui body from model-authored prose before citation
 * finalization. Valid directives are schema-checked, scrubbed and represented
 * by collision-free opaque placeholders; invalid directives fail closed to a
 * plain-text notice immediately.
 */
export function isolateAgentUiDirectivesForCitation(text: string): AgentUiCitationIsolation {
    const directives: IsolatedAgentUiDirective[] = [];
    let invalidCount = 0;
    const isolated = text.replace(AGENT_UI_FENCE, (_whole, rawBody: string) => {
        const parsed = parseAgentUiDirective(rawBody);
        if (!parsed) {
            invalidCount += 1;
            return AGENT_UI_DEGRADED_NOTICE;
        }
        const placeholder = nextPlaceholder(text, directives);
        directives.push({
            placeholder,
            serialized: `\`\`\`agent-ui\n${JSON.stringify(parsed.value, null, 2)}\n\`\`\``,
            status: parsed.status,
        });
        return placeholder;
    });
    return { text: isolated, directives, invalidCount };
}

/** Restore isolated directives after citation finalization without ever
 * accepting a duplicated, removed or model-authored placeholder as a card. */
export function restoreAgentUiDirectivesAfterCitation(
    text: string,
    isolation: AgentUiCitationIsolation,
): AgentUiDirectiveNormalization {
    let normalized = text;
    let validCount = 0;
    let repairedCount = 0;
    let invalidCount = isolation.invalidCount;
    for (const directive of isolation.directives) {
        const occurrences = normalized.split(directive.placeholder).length - 1;
        if (occurrences !== 1) {
            invalidCount += 1;
            if (occurrences > 0) normalized = normalized.replaceAll(directive.placeholder, "");
            normalized = appendDegradedNotice(normalized);
            continue;
        }
        normalized = normalized.replace(directive.placeholder, directive.serialized);
        if (directive.status === "repaired") repairedCount += 1;
        else validCount += 1;
    }
    return { text: normalized, validCount, repairedCount, invalidCount };
}

export function parseAgentUiDirective(raw: string): ParsedAgentUiDirective | null {
    const trimmed = raw.trim();
    const direct = parseJsonRecord(trimmed);
    if (direct && isQuickActionsDirective(direct)) return sanitizeQuickActionsDirective(direct, "valid");

    // The one deterministic repair accepted by the product contract: the JSON
    // has exactly one unmatched opening object brace and appending one final
    // `}` produces a directive that passes the full schema. Nothing else is
    // guessed or rewritten.
    if (objectBraceBalance(trimmed) !== 1) return null;
    const repaired = parseJsonRecord(`${trimmed}}`);
    if (!repaired || !isQuickActionsDirective(repaired)) return null;
    return sanitizeQuickActionsDirective(repaired, "repaired");
}

function nextPlaceholder(text: string, directives: readonly IsolatedAgentUiDirective[]): string {
    const directiveIndex = directives.length;
    let collisionIndex = 0;
    while (true) {
        // Keep this token in ordinary visible ASCII. The citation finalizer owns
        // the private-use namespace, and rejects every model-authored value in
        // it before restoring its own references. Scanning the complete raw
        // input (including directive bodies) prevents user text from aliasing
        // an application-owned token during the restore pass.
        const candidate = `${AGENT_UI_PLACEHOLDER_PREFIX}_${directiveIndex}_${collisionIndex}_END`;
        if (!text.includes(candidate) && directives.every((directive) => directive.placeholder !== candidate)) {
            return candidate;
        }
        collisionIndex += 1;
    }
}

function appendDegradedNotice(text: string): string {
    if (!text) return AGENT_UI_DEGRADED_NOTICE;
    return `${text}${text.endsWith("\n") ? "" : "\n"}${AGENT_UI_DEGRADED_NOTICE}`;
}

function sanitizeQuickActionsDirective(
    value: Record<string, unknown>,
    initialStatus: Exclude<AgentUiDirectiveStatus, "invalid">,
): ParsedAgentUiDirective | null {
    const props = value.props as Record<string, unknown>;
    let changed = false;
    const clean = (input: string): string => {
        const result = cleanDirectiveText(input);
        if (result !== input) changed = true;
        return result;
    };
    const cleanOptional = (input: unknown): string | undefined => {
        if (typeof input !== "string") return undefined;
        const result = clean(input);
        if (result) return result;
        changed = true;
        return undefined;
    };
    const actions = (props.actions as Record<string, unknown>[]).map((action) => {
        const cleaned: Record<string, unknown> = { label: clean(action.label as string) };
        const description = cleanOptional(action.description);
        if (description !== undefined) cleaned.description = description;
        if (action.icon !== undefined) cleaned.icon = action.icon;
        if (action.navigate !== undefined) {
            if (containsDangerousUri(action.navigate as string)) return null;
            cleaned.navigate = action.navigate;
        }
        if (action.prefill !== undefined) cleaned.prefill = clean(action.prefill as string);
        if (action.autoSend !== undefined) cleaned.autoSend = action.autoSend;
        return cleaned;
    });
    if (actions.some((action) => action === null)) return null;
    const cleanedProps: Record<string, unknown> = { actions };
    const title = cleanOptional(props.title);
    if (title !== undefined) cleanedProps.title = title;
    const cleaned = { component: "quick-actions", props: cleanedProps };
    if (!isQuickActionsDirective(cleaned)) return null;
    return { status: changed ? "repaired" : initialStatus, value: cleaned };
}

function containsDangerousUri(value: string): boolean {
    DANGEROUS_URI.lastIndex = 0;
    const result = DANGEROUS_URI.test(value);
    DANGEROUS_URI.lastIndex = 0;
    return result;
}

function cleanDirectiveText(value: string): string {
    return value
        .replace(FULLWIDTH_LABELED_SOURCE_HANDLE, "$1")
        .replace(DOUBLE_LABELED_SOURCE_HANDLE, "$1")
        .replace(SINGLE_LABELED_SOURCE_HANDLE, "$1")
        .replace(OPAQUE_SOURCE_HANDLE, "")
        .replace(DANGEROUS_URI, "")
        .replace(/[ \t]{2,}/gu, " ")
        .replace(/[ \t]+([，。；：！？])/gu, "$1")
        .trim();
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
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

function isQuickActionsDirective(value: Record<string, unknown>): boolean {
    if (!hasOnlyFields(value, DIRECTIVE_FIELDS)) return false;
    if (value.component !== "quick-actions") return false;
    const props = value.props;
    if (!props || typeof props !== "object" || Array.isArray(props)) return false;
    const record = props as Record<string, unknown>;
    if (!hasOnlyFields(record, PROPS_FIELDS)) return false;
    if (record.title !== undefined && (typeof record.title !== "string" || !bounded(record.title, 120))) return false;
    if (!Array.isArray(record.actions) || record.actions.length < 1 || record.actions.length > 4) return false;
    return record.actions.every(isQuickAction);
}

function isQuickAction(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const action = value as Record<string, unknown>;
    if (!hasOnlyFields(action, ACTION_FIELDS)) return false;
    if (typeof action.label !== "string" || !bounded(action.label, 80)) return false;
    if (
        action.description !== undefined &&
        (typeof action.description !== "string" || !bounded(action.description, 160))
    ) {
        return false;
    }
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
    if (action.autoSend !== undefined && !hasPrefill) return false;
    return true;
}

function bounded(value: string, max: number): boolean {
    const length = value.trim().length;
    return length > 0 && length <= max;
}

function hasOnlyFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
    return Object.keys(value).every((field) => allowed.has(field));
}
