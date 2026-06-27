import type { OrchestrationPhase } from '../orchestration-timeline.service';
import { isInsideMarkdownCodeContext } from './markdown-context.util';

export interface ParsedPhaseMarker {
    phase: OrchestrationPhase;
    index: number;
    /** Length of the full matched marker (e.g. `[PHASE:design]`). `index + length` points to the first char after the marker. */
    length: number;
}

const VALID_PHASES = new Set<string>(['requirement_collection', 'design', 'refinement', 'complete']);

export function detectPhaseMarker(text: string, fromOffset = 0): ParsedPhaseMarker | null {
    let cursor = fromOffset;
    while (true) {
        const searchText = cursor > 0 ? text.slice(cursor) : text;
        const match = searchText.match(/\[PHASE:(requirement_collection|design|refinement|complete)\]/);
        if (!match) return null;
        const matchIndex = (match.index ?? 0) + cursor;
        const matchLength = match[0].length;
        if (isInsideMarkdownCodeContext(text, matchIndex)) {
            // Skip this match: model quoted it from untrusted content.
            cursor = matchIndex + 1;
            continue;
        }
        const phase = match[1] as OrchestrationPhase;
        if (!VALID_PHASES.has(phase)) return null;
        return { phase, index: matchIndex, length: matchLength };
    }
}

export function extractWorkflowBlocks(text: string, fromOffset = 0): { blocks: string[]; lastOffset: number } {
    return extractFencedJsonBlocks(text, '```workflow-json', fromOffset);
}

export function extractWorkflowDeltaBlocks(text: string, fromOffset = 0): { blocks: string[]; lastOffset: number } {
    return extractFencedJsonBlocks(text, '```workflow-delta', fromOffset);
}

function extractFencedJsonBlocks(
    text: string,
    marker: '```workflow-json' | '```workflow-delta',
    fromOffset = 0,
): { blocks: string[]; lastOffset: number } {
    const blocks: string[] = [];
    let searchFrom = fromOffset;
    let lastOffset = fromOffset;

    while (true) {
        const start = text.indexOf(marker, searchFrom);
        if (start === -1) break;

        const contentStart = start + marker.length;
        const newlineIdx = text.indexOf('\n', contentStart);
        if (newlineIdx === -1) break;

        const jsonStart = newlineIdx + 1;
        const end = findClosingFence(text, jsonStart);
        if (end === -1) break;

        blocks.push(text.slice(jsonStart, end));
        searchFrom = end + 3;
        lastOffset = searchFrom;
    }

    return { blocks, lastOffset };
}

export type PlannerMarkerKind = 'generate' | 'repair' | 'apply';

export interface ParsedPlannerMarker {
    kind: PlannerMarkerKind;
    index: number;
    /** Length of the full matched marker. `index + length` points to the first char after the marker. */
    length: number;
    /** Trailing payload after `:` for markers that carry a message (apply). */
    payload?: string;
}

export function detectPlannerMarker(text: string, fromOffset = 0): ParsedPlannerMarker | null {
    let cursor = fromOffset;
    while (true) {
        const searchText = cursor > 0 ? text.slice(cursor) : text;
        const match = searchText.match(/\[PLAN:(generate|repair|apply)(?::([^\]]*))?\]/);
        if (!match) return null;
        const matchIndex = (match.index ?? 0) + cursor;
        const matchLength = match[0].length;
        if (isInsideMarkdownCodeContext(text, matchIndex)) {
            cursor = matchIndex + 1;
            continue;
        }
        const kind = match[1] as PlannerMarkerKind;
        const payload = match[2]?.trim();
        const result: ParsedPlannerMarker = {
            kind,
            index: matchIndex,
            length: matchLength,
        };
        if (payload) result.payload = payload;
        return result;
    }
}

export function findClosingFence(text: string, from: number): number {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = from; i < text.length; i++) {
        const ch = text[i];

        if (escape) {
            escape = false;
            continue;
        }

        if (ch === '\\' && inString) {
            escape = true;
            continue;
        }

        if (ch === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (ch === '{' || ch === '[') {
            depth++;
        } else if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) {
                // JSON has closed. Only whitespace is allowed between the
                // JSON's outermost `}`/`]` and the closing fence. If we find
                // non-whitespace prose before the fence the block is
                // malformed — surface as not-found so the caller skips it
                // instead of feeding mixed content to JSON.parse.
                return findFenceAfterWhitespace(text, i + 1);
            }
        }

        // Empty-block guard: when the fenced section contains no JSON at
        // all (depth never went above zero), the very first triple
        // backtick is the close. Return its position so the caller's slice
        // is empty and JSON.parse can fail loudly.
        if (depth === 0 && ch === '`' && text.slice(i, i + 3) === '```') {
            return i;
        }
    }

    return -1;
}

function findFenceAfterWhitespace(text: string, from: number): number {
    for (let i = from; i < text.length; i++) {
        const ch = text[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
        if (ch === '`' && text.slice(i, i + 3) === '```') return i;
        // Non-whitespace, non-fence character between JSON close and fence
        // open means the block is malformed (or the fence is not yet in
        // the stream). Caller will treat this as "no close yet".
        return -1;
    }
    return -1;
}
