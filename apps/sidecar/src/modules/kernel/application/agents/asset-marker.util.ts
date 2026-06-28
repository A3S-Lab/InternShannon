/**
 * Stream marker parsers for the asset (development) agent.
 *
 * Each detector advances along the assistant-stream text via an explicit
 * offset so the agent can consume every marker exactly once across deltas.
 * Keeps explicit offsets so streamed assistant text can be parsed
 * incrementally without consuming the same marker twice.
 *
 * Both detectors also reject markers that fall inside a markdown code
 * context (fenced block / inline code / blockquote) to defend against
 * prompt-injection where untrusted user content is quoted back by the
 * model — see `markdown-context.util.ts`.
 */

import { isInsideMarkdownCodeContext } from './markdown-context.util';

export type AssetAgentPhase = "understanding" | "creating" | "configuring" | "done";

const VALID_PHASES = new Set<AssetAgentPhase>([
    "understanding",
    "creating",
    "configuring",
    "done",
]);

const PHASE_REGEX = /\[ASSET_PHASE:(understanding|creating|configuring|done)\]/;
const CREATED_REGEX = /\[ASSET_CREATED:([\w-]+)\]/;

export interface ParsedAssetPhaseMarker {
    phase: AssetAgentPhase;
    index: number;
    /** Length of the full matched marker (e.g. `[ASSET_PHASE:creating]`). */
    length: number;
}

export interface ParsedAssetCreatedMarker {
    assetId: string;
    index: number;
    /** Length of the full matched marker. */
    length: number;
}

export function detectAssetPhaseMarker(
    text: string,
    fromOffset = 0,
): ParsedAssetPhaseMarker | null {
    let cursor = fromOffset;
    while (true) {
        const searchText = cursor > 0 ? text.slice(cursor) : text;
        const match = searchText.match(PHASE_REGEX);
        if (!match) return null;
        const matchIndex = (match.index ?? 0) + cursor;
        const matchLength = match[0].length;
        if (isInsideMarkdownCodeContext(text, matchIndex)) {
            cursor = matchIndex + 1;
            continue;
        }
        const phase = match[1] as AssetAgentPhase;
        if (!VALID_PHASES.has(phase)) return null;
        return { phase, index: matchIndex, length: matchLength };
    }
}

export function detectAssetCreatedMarker(
    text: string,
    fromOffset = 0,
): ParsedAssetCreatedMarker | null {
    let cursor = fromOffset;
    while (true) {
        const searchText = cursor > 0 ? text.slice(cursor) : text;
        const match = searchText.match(CREATED_REGEX);
        if (!match) return null;
        const matchIndex = (match.index ?? 0) + cursor;
        const matchLength = match[0].length;
        if (isInsideMarkdownCodeContext(text, matchIndex)) {
            cursor = matchIndex + 1;
            continue;
        }
        return {
            assetId: match[1],
            index: matchIndex,
            length: matchLength,
        };
    }
}

/**
 * Extract every ` ```asset-proposal ` JSON block in the stream that hasn't been
 * consumed yet. Each block is the LLM's structured "this is what I'm about to
 * create — please confirm" card; the agent emits one SSE per block so the UI
 * can render a confirmation prompt, and the [ASSET_PHASE:creating] transition
 * is gated on the user replying with confirmation.
 *
 * The fenced-block shape (rather than inline `[ASSET_PROPOSAL:...]`) is
 * deliberate: JSON payloads carrying `]` would break a bracket regex, and the
 * fenced blocks keep the proposal readable and avoid fragile inline JSON parsing.
 */
export function extractAssetProposalBlocks(
    text: string,
    fromOffset = 0,
): { blocks: string[]; lastOffset: number } {
    const marker = '```asset-proposal';
    const blocks: string[] = [];
    let searchFrom = fromOffset;
    let lastOffset = fromOffset;

    while (true) {
        const start = text.indexOf(marker, searchFrom);
        if (start === -1) break;
        const contentStart = start + marker.length;
        const newlineIdx = text.indexOf('\n', contentStart);
        if (newlineIdx === -1) break;
        const bodyStart = newlineIdx + 1;
        const end = text.indexOf('\n```', bodyStart);
        if (end === -1) break;
        blocks.push(text.slice(bodyStart, end));
        searchFrom = end + 4;
        lastOffset = searchFrom;
    }

    return { blocks, lastOffset };
}

import { metaCheckSubset } from '@/shared/json-schema/subset-validator';

export interface AssetProposalCapabilities {
    tools?: string[];
    skills?: string[];
    mcpServers?: string[];
    planning?: boolean;
    goalTracking?: boolean;
}

export interface AssetProposal {
    category: 'agent' | 'tool' | 'skill' | 'mcp' | 'code';
    name: string;
    visibility: 'public' | 'private';
    description?: string;
    /** Only meaningful when category='agent' */
    agentKind?: 'tool' | 'application' | 'agentic';
    scaffoldTemplate?: string;
    summary?: string;
    /**
     * Required when category='agent' && agentKind ∈ {tool, agentic} — see docs/specs/agent-contract.md §6.3.
     * Must be a JSON Schema subset (see `metaCheckSubset`).
     */
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    /** Required when agentKind='agentic' — declares what the agentic container ships with. */
    capabilities?: AssetProposalCapabilities;
}

export interface AssetProposalParseResult {
    proposal: AssetProposal | null;
    /** Human-readable rejection reasons; non-empty when proposal is null OR partially malformed. */
    issues: string[];
}

const VALID_PROPOSAL_CATEGORIES = new Set<AssetProposal['category']>(['agent', 'tool', 'skill', 'mcp', 'code']);
const VALID_AGENT_KINDS = new Set<NonNullable<AssetProposal['agentKind']>>(['tool', 'application', 'agentic']);
const CONTRACT_REQUIRED_KINDS = new Set<NonNullable<AssetProposal['agentKind']>>(['tool', 'agentic']);

/**
 * Parse + validate a raw ```asset-proposal block body.
 *
 * Returns `null` on malformed input. Use `parseAssetProposalDetailed` when you
 * need access to specific rejection reasons (for surfacing to the LLM so it
 * can correct the proposal on the next turn).
 */
export function parseAssetProposal(raw: string): AssetProposal | null {
    return parseAssetProposalDetailed(raw).proposal;
}

export function parseAssetProposalDetailed(raw: string): AssetProposalParseResult {
    const issues: string[] = [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        issues.push('asset-proposal body is not valid JSON');
        return { proposal: null, issues };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        issues.push('asset-proposal must be a JSON object');
        return { proposal: null, issues };
    }
    const obj = parsed as Record<string, unknown>;
    const category = obj.category;
    if (typeof category !== 'string' || !VALID_PROPOSAL_CATEGORIES.has(category as AssetProposal['category'])) {
        issues.push(`category must be one of ${[...VALID_PROPOSAL_CATEGORIES].join(', ')}`);
        return { proposal: null, issues };
    }
    const name = obj.name;
    if (typeof name !== 'string' || !name.trim()) {
        issues.push('name must be a non-empty string');
        return { proposal: null, issues };
    }
    const visibility = obj.visibility;
    if (visibility !== 'public' && visibility !== 'private') {
        issues.push('visibility must be "public" or "private"');
        return { proposal: null, issues };
    }

    const agentKindRaw = obj.agentKind;
    const agentKind =
        typeof agentKindRaw === 'string' && VALID_AGENT_KINDS.has(agentKindRaw as AssetProposal['agentKind'] & string)
            ? (agentKindRaw as AssetProposal['agentKind'])
            : undefined;
    if (category === 'agent' && !agentKind) {
        issues.push(`agent proposals must specify agentKind ∈ {tool, application, agentic}`);
        return { proposal: null, issues };
    }

    const proposal: AssetProposal = {
        category: category as AssetProposal['category'],
        name: name.trim(),
        visibility,
        description: typeof obj.description === 'string' ? obj.description : undefined,
        agentKind: category === 'agent' ? agentKind : undefined,
        scaffoldTemplate: typeof obj.scaffoldTemplate === 'string' ? obj.scaffoldTemplate : undefined,
        summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    };

    if (category === 'agent' && agentKind && CONTRACT_REQUIRED_KINDS.has(agentKind)) {
        const inputSchema = recordValue(obj.inputSchema);
        const outputSchema = recordValue(obj.outputSchema);
        if (!inputSchema) {
            issues.push(`${agentKind} agent proposals must include "inputSchema" (JSON Schema subset)`);
        } else {
            const check = metaCheckSubset(inputSchema);
            if (!check.valid) {
                for (const err of check.errors) issues.push(`inputSchema: ${err}`);
            } else {
                proposal.inputSchema = inputSchema;
            }
        }
        if (!outputSchema) {
            issues.push(`${agentKind} agent proposals must include "outputSchema" (JSON Schema subset)`);
        } else {
            const check = metaCheckSubset(outputSchema);
            if (!check.valid) {
                for (const err of check.errors) issues.push(`outputSchema: ${err}`);
            } else {
                proposal.outputSchema = outputSchema;
            }
        }

        if (agentKind === 'agentic') {
            const capabilities = parseProposalCapabilities(obj.capabilities, issues);
            if (capabilities) proposal.capabilities = capabilities;
        }
    }

    if (issues.length > 0) {
        return { proposal: null, issues };
    }
    return { proposal, issues };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function parseProposalCapabilities(value: unknown, issues: string[]): AssetProposalCapabilities | undefined {
    const record = recordValue(value);
    if (!record) {
        issues.push('agentic proposals must include "capabilities" object declaring tools/skills');
        return undefined;
    }
    const capabilities: AssetProposalCapabilities = {};
    const stringArrayFields: Array<keyof AssetProposalCapabilities> = ['tools', 'skills', 'mcpServers'];
    for (const field of stringArrayFields) {
        const raw = record[field];
        if (raw === undefined) continue;
        if (!Array.isArray(raw) || raw.some(v => typeof v !== 'string')) {
            issues.push(`capabilities.${field} must be an array of strings`);
        } else {
            (capabilities[field] as string[]) = raw as string[];
        }
    }
    const booleanFields: Array<keyof AssetProposalCapabilities> = ['planning', 'goalTracking'];
    for (const field of booleanFields) {
        const raw = record[field];
        if (raw === undefined) continue;
        if (typeof raw !== 'boolean') {
            issues.push(`capabilities.${field} must be a boolean`);
        } else {
            (capabilities[field] as boolean) = raw;
        }
    }
    return capabilities;
}
