import {
    KNOWLEDGE_QUERY_RUNTIME_TOOL_NAME,
    KNOWLEDGE_READ_RUNTIME_TOOL_NAME,
    KNOWLEDGE_SEARCH_RUNTIME_TOOL_NAME,
} from "./capabilities-runtime.constants";
import { buildKnowledgeSourceRegistry, hasTrustedKnowledgeGrounding } from "./knowledge-source-reference";

const KNOWLEDGE_TOOL_NAMES = new Set([
    KNOWLEDGE_SEARCH_RUNTIME_TOOL_NAME,
    KNOWLEDGE_READ_RUNTIME_TOOL_NAME,
    KNOWLEDGE_QUERY_RUNTIME_TOOL_NAME,
]);
const PARENT_GROUNDING_REDUNDANT_TOOL_NAMES = new Set([
    KNOWLEDGE_SEARCH_RUNTIME_TOOL_NAME.toLowerCase(),
    KNOWLEDGE_QUERY_RUNTIME_TOOL_NAME.toLowerCase(),
    "task",
    "parallel_task",
]);
const MAX_TURN_TOOL_EVIDENCE = 16;

interface KnowledgeToolEvidence {
    toolName: string;
    result: unknown;
}

export interface RedundantGroundedSkillInput {
    toolName: string;
    toolInput: unknown;
    userContent: string;
    configuredSkills?: readonly string[];
    previouslyCompletedSkills?: ReadonlySet<string>;
    hasTrustedGrounding: boolean;
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

function normalizeNestedJson(value: unknown, depth = 0): unknown {
    if (depth > 6) return value;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
        try {
            return normalizeNestedJson(JSON.parse(trimmed), depth + 1);
        } catch {
            return value;
        }
    }
    if (Array.isArray(value)) return value.map((item) => normalizeNestedJson(item, depth + 1));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
            key,
            normalizeNestedJson(nested, depth + 1),
        ]),
    );
}

function parsedToolEvidence(output: unknown): unknown | null {
    const normalized = normalizeNestedJson(output);
    if (!normalized || typeof normalized !== "object") return null;
    const wrapped = Array.isArray(normalized) ? { result: normalized } : normalized;
    return buildKnowledgeSourceRegistry(JSON.stringify(wrapped)).length > 0 ? wrapped : null;
}

function normalizedSkillName(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function skillNameFromInput(value: unknown): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const record = value as Record<string, unknown>;
    return normalizedSkillName(record.skill_name) || normalizedSkillName(record.skillName);
}

export function skillNameForToolInvocation(toolName: string, toolInput: unknown): string | null {
    if (toolName.trim().toLowerCase() !== "skill") return null;
    return skillNameFromInput(toolInput) || null;
}

function requestedSkillNames(content: string): Set<string> {
    const names = new Set<string>();
    for (const match of content.matchAll(/\$([\p{L}\p{N}][\p{L}\p{N}._-]{0,127})/gu)) {
        const name = normalizedSkillName(match[1]);
        if (name) names.add(name);
    }
    return names;
}

/**
 * A per-message evidence ledger. Parent grounding remains first so its opaque
 * K handles stay stable; successful direct knowledge-tool evidence is appended
 * and becomes available to the final citation pass without entering history.
 */
export class KnowledgeTurnEvidenceLedger {
    private readonly parentPayload: Record<string, unknown> | null;
    private readonly toolEvidence: KnowledgeToolEvidence[] = [];

    constructor(private readonly parentGrounding?: string) {
        this.parentPayload = parseJsonRecord(parentGrounding);
    }

    hasTrustedGrounding(): boolean {
        return hasTrustedKnowledgeGrounding(this.grounding());
    }

    recordToolResult(toolName: string, output: unknown, isError = false): boolean {
        if (isError || !KNOWLEDGE_TOOL_NAMES.has(toolName) || this.toolEvidence.length >= MAX_TURN_TOOL_EVIDENCE) {
            return false;
        }
        const result = parsedToolEvidence(output);
        if (!result) return false;
        this.toolEvidence.push({ toolName, result });
        return true;
    }

    grounding(): string | undefined {
        if (this.toolEvidence.length === 0) return this.parentGrounding;
        return JSON.stringify({
            ...(this.parentPayload ?? { status: "ok" }),
            currentTurnToolEvidence: this.toolEvidence,
        });
    }
}

/**
 * Suppress only the same named Skill that the current user turn explicitly
 * requested (or the session explicitly configured). Other skills remain
 * available even when parent knowledge grounding exists.
 */
export function redundantGroundedSkillName(input: RedundantGroundedSkillInput): string | null {
    if (!input.hasTrustedGrounding || input.toolName.trim().toLowerCase() !== "skill") return null;
    const skillName = skillNameFromInput(input.toolInput);
    if (!skillName) return null;
    if (!input.previouslyCompletedSkills?.has(skillName)) return null;
    const configured = new Set((input.configuredSkills ?? []).map(normalizedSkillName).filter(Boolean));
    const requested = requestedSkillNames(input.userContent);
    return configured.has(skillName) || requested.has(skillName) ? skillName : null;
}

export function redundantGroundedSkillContinuationPrompt(originalUserContent: string, skillName: string): string {
    return [
        "Answer the original user request directly from the parent session's verified personal-knowledge grounding.",
        `The redundant Skill call \`${skillName}\` was suppressed because its output contract is already active in the parent session.`,
        "Do not call Skill again and do not repeat the knowledge lookup. Use only the verified grounding and the user's message.",
        "Original user request:",
        originalUserContent,
    ].join("\n");
}

/**
 * Parent grounding is an ownership lease for discovery on this turn. Once it
 * exists, another search/query/delegation round can only duplicate the same
 * lookup and may strand the native session behind a second active operation.
 * A bounded direct read remains allowed so the model can resolve one specific
 * source already exposed by the parent result.
 */
export function redundantParentGroundingToolName(toolName: string, parentGroundingOwned: boolean): string | null {
    if (!parentGroundingOwned) return null;
    const normalized = toolName.trim().toLowerCase();
    return PARENT_GROUNDING_REDUNDANT_TOOL_NAMES.has(normalized) ? toolName.trim() : null;
}

export function redundantParentGroundingToolContinuationPrompt(
    originalUserContent: string,
    suppressedToolName: string,
): string {
    return [
        "Answer the original user request directly from the parent session's personal-knowledge grounding.",
        `The redundant tool call \`${suppressedToolName}\` was suppressed because discovery and coverage planning already ran in the parent session.`,
        `Do not call \`${KNOWLEDGE_SEARCH_RUNTIME_TOOL_NAME}\`, \`${KNOWLEDGE_QUERY_RUNTIME_TOOL_NAME}\`, task, or parallel_task for this turn.`,
        `A single bounded \`${KNOWLEDGE_READ_RUNTIME_TOOL_NAME}\` call is allowed only when a specific source from the grounding needs a fuller read.`,
        "Respect the grounding coverage status, cite only verified handles, and answer without delegating the lookup again.",
        "Original user request:",
        originalUserContent,
    ].join("\n");
}
