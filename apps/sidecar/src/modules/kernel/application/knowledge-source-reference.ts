export type KnowledgeSourceEvidence = "read" | "search" | "catalog";

import { isPublicKnowledgeSourcePath } from "@/modules/assets/domain/knowledge/knowledge-source-path.policy";

export interface KnowledgeSourceLocator {
    kind: "record" | "section" | "chunk";
    value: string;
    label?: string;
}

export interface KnowledgeSourceReference {
    protocolVersion: 1;
    ref: string;
    assetId: string;
    relativePath: string;
    title: string;
    resource: string;
    evidence: KnowledgeSourceEvidence;
    locators: KnowledgeSourceLocator[];
}

export interface FinalizedKnowledgeAnswer {
    text: string;
    sources: KnowledgeSourceReference[];
    unverifiedCitationCount: number;
    rejectedCitations: RejectedKnowledgeCitation[];
}

export type RejectedKnowledgeCitationReason =
    | "unknown_source_handle"
    | "unsupported_locator"
    | "ambiguous_locator_suffix"
    | "locator_required"
    | "source_filename_conflict"
    | "unknown_or_ambiguous_filename"
    | "malformed_handle"
    | "unverified_resource";

/** Safe, structured input for an application-owned one-shot evidence retry. */
export interface RejectedKnowledgeCitation {
    citation: string;
    locator?: string;
    sourcePath?: string;
    reason: RejectedKnowledgeCitationReason;
}

/**
 * One current-turn ceiling shared by catalog compaction and the verified
 * citation registry. Keeping this at 32 allows every catalog entry exposed to
 * the model to receive an opaque K handle while bounding prompt/card growth.
 */
export const MAX_KNOWLEDGE_SOURCE_REFERENCES = 32;

interface RegistrySource extends KnowledgeSourceReference {
    allowedLocators: Set<string>;
    /** Exact locators derived from a current-turn full read, excluding search-only evidence. */
    readAllowedLocators: Set<string>;
    searchableContent: string;
    /** A non-negative count copied only from search.tableSummaries. */
    catalogRecordCount?: number;
}

interface ProtectedKnowledgeCitationReceipt {
    citation: string;
    source: RegistrySource;
    locators: KnowledgeSourceLocator[];
}

const ASSET_TOKEN = /asset:\/{1,2}[^\s\])}>'"`）】》〉，。；：！？“”‘’、]+/gu;
const MODEL_AUTHORED_ASSET_MARKDOWN_LINK =
    /\[[^\]\n]{1,240}\]\(\s*asset:\/{1,2}[^\s\])}>'"`）】》〉，。；：！？“”‘’、]+\s*\)/giu;
const SOURCE_HANDLE = /\[\[K(\d+)(?:[:：]([^\]\n]{1,240}))?\]\]/gu;
const EXTRA_OPENING_SOURCE_HANDLE = /(?<!\[)\[\[K(\d+)(?:[:：]([^\]\n]{1,240}))?\](?!\])(?=[ \t]*(?:\r?\n|$))/gu;
const EXTRA_OPENING_SOURCE_HANDLE_EXACT = new RegExp(`^(?:${EXTRA_OPENING_SOURCE_HANDLE.source})$`, "u");
const HASH_SUFFIX_SOURCE_HANDLE = /\[\[K(\d+)(#[\p{L}\p{N}._/-]{1,80})\]\]/gu;
const FULLWIDTH_SOURCE_HANDLE = /［K(\d+)(?:[:：]([^］\n]{1,240}))?］/gu;
const DOUBLE_CLOSING_SOURCE_HANDLE = /(?<!\[)\[K(\d+)(?:[:：]([^\]\n]{1,240}))?\]\](?!\])/gu;
const SINGLE_BRACKET_SOURCE_HANDLE = /(?<!\[)\[K(\d+)(?:[:：]([^\]\n]{1,240}))?\](?!\])/gu;
const MIXED_DOUBLE_SOURCE_HANDLE =
    /(?<![\[［])([\[［]{2})K(\d+)(?:[:：]([^\[\]［］\r\n]{1,240}))?([\]］]{2})(?![\]］])/gu;
const DOUBLE_CLOSING_HASH_SUFFIX_SOURCE_HANDLE = /(?<!\[)\[K(\d+)(#[\p{L}\p{N}._/-]{1,80})\]\](?!\])/gu;
const SINGLE_BRACKET_HASH_SUFFIX_SOURCE_HANDLE = /(?<!\[)\[K(\d+)(#[\p{L}\p{N}._/-]{1,80})\](?!\])/gu;
const FULLWIDTH_LABELED_SOURCE_HANDLE = /［([^［］：:\n]{1,160})[：:]\s*([^［］｜|\n]{1,240})\s*[｜|]\s*K(\d+)］/gu;
const SINGLE_LABELED_SOURCE_HANDLE = /(?<!\[)\[([^\[\]:\n]{1,160})[：:]\s*([^\[\]|\n]{1,240})\s*\|\s*K(\d+)\](?!\])/gu;
const DOUBLE_CLOSING_LABELED_SOURCE_HANDLE =
    /(?<!\[)\[([^\[\]:\n]{1,160})[：:]\s*([^\[\]|\n]{1,240})\s*\|\s*K(\d+)\]\](?!\])/gu;
const DOUBLE_CLOSING_SOURCE_HANDLE_EXACT = new RegExp(`^(?:${DOUBLE_CLOSING_SOURCE_HANDLE.source})$`, "u");
const DOUBLE_CLOSING_HASH_SUFFIX_SOURCE_HANDLE_EXACT = new RegExp(
    `^(?:${DOUBLE_CLOSING_HASH_SUFFIX_SOURCE_HANDLE.source})$`,
    "u",
);
const DOUBLE_CLOSING_LABELED_SOURCE_HANDLE_EXACT = new RegExp(
    `^(?:${DOUBLE_CLOSING_LABELED_SOURCE_HANDLE.source})$`,
    "u",
);
const FULLWIDTH_FILENAME_SOURCE_HANDLE = /［([^［］｜|\n]{1,160}\.[\p{L}\p{N}]{1,10})\s*[｜|]\s*K(\d+)］/gu;
const DOUBLE_FILENAME_SOURCE_HANDLE = /\[\[([^\[\]|\n]{1,160}\.[\p{L}\p{N}]{1,10})\s*\|\s*K(\d+)\]\]/gu;
const SINGLE_FILENAME_SOURCE_HANDLE = /(?<!\[)\[([^\[\]|\n]{1,160}\.[\p{L}\p{N}]{1,10})\s*\|\s*K(\d+)\](?!\])/gu;
const NATURAL_LOCATOR_LABEL = "(?:记录\\s*ID|record\\s*ID|ID|定位|locator|section|chunk)";
const PARENTHESIZED_EXPLICIT_LOCATOR_TAIL = new RegExp(
    String.raw`^\s*(?:摘录|excerpt)?\s*[，,：:]\s*${NATURAL_LOCATOR_LABEL}\s*[：:]\s*[^)）\n]{1,240}$`,
    "iu",
);
const EXACT_FILENAME_CITATION = new RegExp(
    String.raw`[\[［(（【]([^\[\]［］()（）【】\n]{1,160}\.[\p{L}\p{N}]{1,10})(?:\s*(?:摘录|excerpt))?(?:\s*[，,：:]\s*(?:${NATURAL_LOCATOR_LABEL}\s*[：:]\s*)?([^\]］)）】\n]{1,240}))?[\]］)）】](?!\s*\()`,
    "giu",
);
const EXACT_FILENAME_CITATION_FULL = new RegExp(`^(?:${EXACT_FILENAME_CITATION.source})$`, "iu");
const EXACT_FILENAME_CITATION_PREFIX = new RegExp(`^(?:${EXACT_FILENAME_CITATION.source})`, "iu");
// Some providers serialize two or more verified citations as one JSON-like
// array, for example `[[K1:ROW-1],[K2:SECTION-2]]`. The scanner below applies
// this grammar only to a complete outermost square-bracket span; a valid inner
// substring can therefore never hide an untrusted sibling in a larger wrapper.
const COMPOUND_SOURCE_HANDLE_ARRAY_EXACT =
    /^\[\[K\d{1,6}(?:[:：][^\[\]［］()（）【】\r\n]{1,240})?\](?:[ \t]{0,16}[,，][ \t]{0,16}\[K\d{1,6}(?:[:：][^\[\]［］()（）【】\r\n]{1,240})?\]){1,31}\]$/u;
const COMPOUND_SOURCE_HANDLE_ARRAY_PREFIX =
    /^\[\[K\d{1,6}(?:[:：][^\[\]［］()（）【】\r\n]{1,240})?\](?:[ \t]{0,16}[,，][ \t]{0,16}\[K\d{1,6}(?:[:：][^\[\]［］()（）【】\r\n]{1,240})?\]){1,31}\]/u;
const ASCII_SOURCE_HANDLE_EXACT = /^\[\[K\d{1,6}(?:[:：][^\[\]［］()（）【】\r\n]{1,240})?\]\]$/u;
const ASCII_SOURCE_HANDLE_PREFIX = /^\[\[K\d{1,6}(?:[:：][^\[\]［］()（）【】\r\n]{1,240})?\]\]/u;
const FULLWIDTH_WRAPPED_ASCII_SOURCE_HANDLE = /［([^［］\r\n]{1,8192})］/gu;
const SOLITARY_FULLWIDTH_OPENING_BEFORE_KNOWLEDGE_CITATION = /［(?=\[)/gu;
const COMPOUND_SOURCE_HANDLE_MEMBER = /\[K(\d{1,6})(?:[:：]([^\[\]［］()（）【】\r\n]{1,240}))?\]/gu;
const MAX_COMPOUND_SOURCE_HANDLE_ARRAY_LENGTH = 8_192;
const NESTED_ASCII_SOURCE_HANDLE_EXACT = /^\[K(\d+)(?:[:：]([^\]\n]{1,240}))?\]$/u;
const NESTED_FULLWIDTH_SOURCE_HANDLE_EXACT = /^［K(\d+)(?:[:：]([^］\n]{1,240}))?］$/u;
// A provider can collapse `[[K#]] [filename]` into the malformed pair
// `[[K#],[filename]`. Consume the complete pair before either the handle or
// filename fallback gets a chance to validate only its trustworthy-looking
// inner fragment.
const MALFORMED_HANDLE_FILENAME_PAIR = /\[\[K(\d+)\]\s*[,，]\s*\[([^\[\]\n]{1,160}\.[\p{L}\p{N}]{1,10})\]/gu;
const MALFORMED_HANDLE_FILENAME_PAIR_EXACT =
    /^\[\[K\d{1,6}\][ \t]{0,16}[,，][ \t]{0,16}\[[^\[\]\r\n]{1,160}\.[\p{L}\p{N}]{1,10}\]$/u;
const RESIDUAL_SOURCE_HANDLE =
    /(?:[\[［]{1,2}\s*K\d+(?:(?::|#)[^\s\[\]［］，,。；;！？!?()（）【】]{0,160})?(?:\s*[\]］]{1,2})?|(?<![\p{L}\p{N}_])K\d+(?:(?::|#)[^\s\[\]［］，,。；;！？!?()（）【】]{0,160})?(?:\s*[\]］]{1,2})?(?![\p{L}\p{N}_]))/gu;
const RAW_SOURCE_HANDLE_SIGNAL = /(?:[\[［]{1,2}\s*K\d+|(?<![\p{L}\p{N}_])K\d+(?![\p{L}\p{N}_]))/u;
const PROTECTED_KNOWLEDGE_REFERENCE = /\uE000KREF\d+\uE001/gu;
const PROTECTED_KNOWLEDGE_REFERENCE_PREFIX = "\uE000KREF";
const REDUNDANT_OPENING_BEFORE_PROTECTED_REFERENCE = /[\[［](?=\s*\uE000KREF\d+\uE001)/gu;
const ADJACENT_SOURCE_DISPLAY_GAP_CHARACTERS = new Set([" ", "\t", ",", "，", ";", "；", "、", "|"]);
// The private-use delimiter pair belongs exclusively to this finalizer. The
// complete namespace is deliberately length-independent: a model must not be
// able to bypass cleanup merely by extending an internal token beyond a
// diagnostic/display bound. The one-sided patterns consume the rest of the
// affected line so malformed token fragments cannot leave a visible KREF stem.
const PRIVATE_KNOWLEDGE_REFERENCE_NAMESPACE = /\uE000[^\uE000\uE001]*\uE001/gu;
const PRIVATE_KNOWLEDGE_REFERENCE_LEFT_FRAGMENT = /\uE000[^\r\n\uE000\uE001]*/gu;
const PRIVATE_KNOWLEDGE_REFERENCE_DELIMITER = /[\uE000\uE001]/gu;
const UNWRAPPED_NATURAL_FILENAME_CITATION = new RegExp(
    String.raw`(?:(?:文件|来源|source|file)\s*[：:]\s*)?[\p{L}\p{N}][^\[\]［］()（）【】\n]{0,159}\.[\p{L}\p{N}]{1,10}\s*(?:\+|，|,)?\s*${NATURAL_LOCATOR_LABEL}\s*[：:]\s*[^\n；;。)）\]］]{1,240}`,
    "giu",
);
const UNWRAPPED_NATURAL_FILENAME_CITATION_FULL = new RegExp(
    `^(?:${UNWRAPPED_NATURAL_FILENAME_CITATION.source})$`,
    "iu",
);
const TRUSTED_GROUNDING_SOURCE_CONTAINERS = new Set([
    "reads",
    "search",
    "hits",
    "tableSummaries",
    "catalog",
    "entries",
    "structuredQuery",
    "resources",
    "sources",
    "currentTurnToolEvidence",
    "result",
    "results",
    "data",
    "items",
    // Knowledge tool envelopes carry a JSON-decoded result in content/text.
    "content",
    "text",
]);
const MAX_SOURCE_LOCATORS = 256;
const MAX_EXPANDED_LOCATOR_PATTERN_MATCHES = 32;
const MIN_LOCATOR_PATTERN_PREFIX_LENGTH = 3;
const MODEL_GROUNDING_FIELD_PRIORITY = new Map([
    ["catalogFacts", 0],
    ["reads", 1],
    ["structuredQuery", 2],
    ["status", 3],
    ["coverage", 4],
    ["search", 5],
    ["catalog", 6],
]);
const MODEL_COVERAGE_SUMMARY_FIELDS = new Set([
    "version",
    "protocolVersion",
    "query",
    "mode",
    "status",
    "reason",
    "unresolved",
    "requestedIdentifiers",
    "matchedIdentifiers",
    "missingIdentifiers",
    "required",
    "verified",
    "missing",
    "hasMore",
    "indexRevision",
    "supplementalPasses",
    "resultTruncated",
    "catalogTruncated",
    "catalogOmittedCount",
    "catalogUnretrievableCount",
    "recordIdsTruncated",
]);
const MAX_SOURCE_GUIDE_LOCATORS = 48;
const MAX_SOURCE_GUIDE_LOCATOR_CHARACTERS = 2_048;
const KNOWLEDGE_READ_TRUNCATION_NOTICE = "[Knowledge read truncated by the grounding byte budget.]";

interface CompoundSourceHandleMember {
    rawIndex: string;
    rawLocator?: string;
    citation: string;
}

function isExecutableExactFilenameCitation(
    candidate: string,
    rawName: string,
    rawLocator: string | undefined,
): boolean {
    const parenthesized = candidate.startsWith("(") || candidate.startsWith("（");
    // Parentheses are common prose. A comma after a filename is not enough to
    // make the whole aside a citation; require an explicit locator label
    // immediately after the captured filename rather than later prose.
    const locatorTail = candidate.slice(1 + rawName.length, -1);
    return (
        !parenthesized ||
        Boolean(rawLocator?.trim() && PARENTHESIZED_EXPLICIT_LOCATOR_TAIL.test(locatorTail))
    );
}

interface MarkdownLinkContext {
    definitionLabels: Set<string>;
    nextNonWhitespace: Int32Array;
    nextReferenceClosingBracket: Int32Array;
    referenceContainerDepthAt: Uint32Array;
    escapedByBackslash: Uint8Array;
    insideCodeSpan: Uint8Array;
    insideHtmlInline: Uint8Array;
}

function markdownReferenceContainerDepthForLine(source: string, lineStart: number, lineEnd: number): number {
    let cursor = lineStart;
    let depth = 0;
    let consumedContainer = false;
    while (cursor < lineEnd) {
        let indentation = 0;
        while (
            cursor < lineEnd &&
            (source[cursor] === " " || source[cursor] === "\t") &&
            (!consumedContainer || indentation < 3)
        ) {
            cursor += 1;
            indentation += 1;
        }
        if (source[cursor] === ">") {
            depth += 1;
            consumedContainer = true;
            cursor += 1;
            if (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
            continue;
        }

        const unorderedListMarker = /[-+*]/u.test(source[cursor] ?? "");
        let markerEnd = cursor;
        if (unorderedListMarker) {
            markerEnd += 1;
        } else {
            let digits = 0;
            while (digits < 9 && /[0-9]/u.test(source[markerEnd] ?? "")) {
                markerEnd += 1;
                digits += 1;
            }
            if (digits === 0 || (source[markerEnd] !== "." && source[markerEnd] !== ")")) break;
            markerEnd += 1;
        }
        if (source[markerEnd] !== " " && source[markerEnd] !== "\t") break;
        let paddingEnd = markerEnd;
        while (paddingEnd < lineEnd && (source[paddingEnd] === " " || source[paddingEnd] === "\t")) {
            paddingEnd += 1;
        }
        const padding = paddingEnd - markerEnd;
        cursor = markerEnd + (padding <= 4 ? padding : 1);
        consumedContainer = true;
    }
    return depth;
}

function stripMarkdownReferenceContinuationContainers(value: string, depth: number): string {
    if (depth <= 0) return value;
    const segments: string[] = [];
    let copiedUntil = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== "\r" && value[index] !== "\n") continue;
        const lineEnd = value[index] === "\r" && value[index + 1] === "\n" ? index + 2 : index + 1;
        let cursor = lineEnd;
        while (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
        let matched = true;
        for (let marker = 0; marker < depth; marker += 1) {
            if (value[cursor] !== ">") {
                matched = false;
                break;
            }
            cursor += 1;
            if (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
            if (marker + 1 < depth) {
                let indentation = 0;
                while (indentation < 3 && (value[cursor] === " " || value[cursor] === "\t")) {
                    cursor += 1;
                    indentation += 1;
                }
            }
        }
        if (!matched) {
            index = lineEnd - 1;
            continue;
        }
        segments.push(value.slice(copiedUntil, index), " ");
        copiedUntil = cursor;
        index = cursor - 1;
    }
    if (segments.length === 0) return value;
    segments.push(value.slice(copiedUntil));
    return segments.join("");
}

function markdownReferenceContinuationDepths(value: string): number[] {
    const depths = new Set<number>();
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== "\r" && value[index] !== "\n") continue;
        const lineEnd = value[index] === "\r" && value[index + 1] === "\n" ? index + 2 : index + 1;
        let cursor = lineEnd;
        while (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
        let depth = 0;
        while (value[cursor] === ">") {
            depth += 1;
            cursor += 1;
            if (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
            let indentation = 0;
            while (indentation < 3 && (value[cursor] === " " || value[cursor] === "\t")) {
                cursor += 1;
                indentation += 1;
            }
        }
        if (depth > 0) depths.add(depth);
        index = lineEnd - 1;
    }
    return Array.from(depths);
}

function stripObservedMarkdownReferenceContinuationContainers(value: string): string {
    const segments: string[] = [];
    let copiedUntil = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== "\r" && value[index] !== "\n") continue;
        const lineEnd = value[index] === "\r" && value[index + 1] === "\n" ? index + 2 : index + 1;
        let cursor = lineEnd;
        while (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
        let depth = 0;
        while (value[cursor] === ">") {
            depth += 1;
            cursor += 1;
            if (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
            let indentation = 0;
            while (indentation < 3 && (value[cursor] === " " || value[cursor] === "\t")) {
                cursor += 1;
                indentation += 1;
            }
        }
        if (depth === 0) {
            index = lineEnd - 1;
            continue;
        }
        segments.push(value.slice(copiedUntil, index), " ");
        copiedUntil = cursor;
        index = cursor - 1;
    }
    if (segments.length === 0) return value;
    segments.push(value.slice(copiedUntil));
    return segments.join("");
}

function unescapeMarkdownReferenceLabel(value: string): string {
    let unescaped = "";
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index] ?? "";
        const next = value[index + 1] ?? "";
        const nextCode = next.charCodeAt(0);
        const escapablePunctuation =
            (nextCode >= 0x21 && nextCode <= 0x2f) ||
            (nextCode >= 0x3a && nextCode <= 0x40) ||
            (nextCode >= 0x5b && nextCode <= 0x60) ||
            (nextCode >= 0x7b && nextCode <= 0x7e);
        if (character === "\\" && escapablePunctuation) {
            unescaped += next;
            index += 1;
        } else {
            unescaped += character;
        }
    }
    return unescaped;
}

function normalizedMarkdownReferenceLabels(value: string, containerDepths: readonly number[] = []): string[] {
    const normalize = (candidate: string): string =>
        candidate.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase().toUpperCase();
    const candidates = [
        normalize(unescapeMarkdownReferenceLabel(value)),
        normalize(unescapeMarkdownReferenceLabel(stripObservedMarkdownReferenceContinuationContainers(value))),
    ];
    for (const depth of new Set(containerDepths)) {
        if (depth <= 0) continue;
        candidates.push(
            normalize(unescapeMarkdownReferenceLabel(stripMarkdownReferenceContinuationContainers(value, depth))),
        );
    }
    return Array.from(new Set(candidates)).filter(Boolean);
}

function markdownLinkContext(value: string): MarkdownLinkContext {
    const escapedByBackslash = new Uint8Array(value.length);
    let backslashRun = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === "\\") {
            backslashRun += 1;
            continue;
        }
        escapedByBackslash[index] = backslashRun % 2;
        backslashRun = 0;
    }
    const backtickRuns: Array<{ start: number; end: number; length: number; nextSame: number }> = [];
    for (let index = 0; index < value.length; ) {
        if (value[index] !== "`" || escapedByBackslash[index] !== 0) {
            index += 1;
            continue;
        }
        const start = index;
        while (index < value.length && value[index] === "`" && escapedByBackslash[index] === 0) index += 1;
        backtickRuns.push({ start, end: index, length: index - start, nextSame: -1 });
    }
    const nextRunByLength = new Map<number, number>();
    for (let index = backtickRuns.length - 1; index >= 0; index -= 1) {
        const run = backtickRuns[index];
        if (!run) continue;
        run.nextSame = nextRunByLength.get(run.length) ?? -1;
        nextRunByLength.set(run.length, index);
    }
    const codeSpanDelta = new Int32Array(value.length + 1);
    for (let index = 0; index < backtickRuns.length; ) {
        const opening = backtickRuns[index];
        const closing = opening && opening.nextSame >= 0 ? backtickRuns[opening.nextSame] : undefined;
        if (!opening || !closing) {
            index += 1;
            continue;
        }
        codeSpanDelta[opening.start] += 1;
        codeSpanDelta[closing.end] -= 1;
        index = opening.nextSame + 1;
    }
    const insideCodeSpan = new Uint8Array(value.length);
    let activeCodeSpans = 0;
    for (let index = 0; index < value.length; index += 1) {
        activeCodeSpans += codeSpanDelta[index] ?? 0;
        if (activeCodeSpans > 0) insideCodeSpan[index] = 1;
    }
    const htmlInlineDelta = new Int32Array(value.length + 1);
    const markHtmlInline = (start: number, end: number) => {
        htmlInlineDelta[start] += 1;
        htmlInlineDelta[end] -= 1;
    };
    const nextSingleQuote = new Int32Array(value.length + 1);
    const nextDoubleQuote = new Int32Array(value.length + 1);
    const nextOpeningAngle = new Int32Array(value.length + 1);
    const nextGreaterThan = new Int32Array(value.length + 1);
    const nextCommentTerminator = new Int32Array(value.length + 1);
    const nextCdataTerminator = new Int32Array(value.length + 1);
    const nextProcessingTerminator = new Int32Array(value.length + 1);
    nextSingleQuote.fill(-1);
    nextDoubleQuote.fill(-1);
    nextOpeningAngle.fill(-1);
    nextGreaterThan.fill(-1);
    nextCommentTerminator.fill(-1);
    nextCdataTerminator.fill(-1);
    nextProcessingTerminator.fill(-1);
    let singleQuote = -1;
    let doubleQuote = -1;
    let openingAngle = -1;
    let greaterThan = -1;
    let commentTerminator = -1;
    let cdataTerminator = -1;
    let processingTerminator = -1;
    for (let index = value.length - 1; index >= 0; index -= 1) {
        if (value[index] === "'") singleQuote = index;
        if (value[index] === '"') doubleQuote = index;
        if (value[index] === "<") openingAngle = index;
        if (value[index] === ">") greaterThan = index;
        if (value.startsWith("-->", index)) commentTerminator = index;
        if (value.startsWith("]]>", index)) cdataTerminator = index;
        if (value.startsWith("?>", index)) processingTerminator = index;
        nextSingleQuote[index] = singleQuote;
        nextDoubleQuote[index] = doubleQuote;
        nextOpeningAngle[index] = openingAngle;
        nextGreaterThan[index] = greaterThan;
        nextCommentTerminator[index] = commentTerminator;
        nextCdataTerminator[index] = cdataTerminator;
        nextProcessingTerminator[index] = processingTerminator;
    }
    const isLineEnding = (character: string): boolean => character === "\r" || character === "\n";
    const lineEndingEnd = (index: number): number =>
        value[index] === "\r" && value[index + 1] === "\n" ? index + 2 : index + 1;
    const paragraphBreakAt = new Uint8Array(value.length);
    for (let index = 0; index < value.length; ) {
        if (!isLineEnding(value[index] ?? "")) {
            index += 1;
            continue;
        }
        const end = lineEndingEnd(index);
        let cursor = end;
        while (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
        while (value[cursor] === ">") {
            cursor += 1;
            while (value[cursor] === " " || value[cursor] === "\t") cursor += 1;
        }
        if (isLineEnding(value[cursor] ?? "")) paragraphBreakAt[cursor] = 1;
        index = end;
    }
    const paragraphBreakPrefix = new Uint32Array(value.length + 1);
    for (let index = 0; index < value.length; index += 1) {
        paragraphBreakPrefix[index + 1] = (paragraphBreakPrefix[index] ?? 0) + (paragraphBreakAt[index] ?? 0);
    }
    const crossesParagraphBreak = (start: number, end: number): boolean =>
        (paragraphBreakPrefix[end] ?? 0) > (paragraphBreakPrefix[start] ?? 0);
    const isAsciiAlpha = (character: string): boolean => {
        const code = character.charCodeAt(0);
        return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    };
    const isAsciiAlphanumeric = (character: string): boolean => {
        const code = character.charCodeAt(0);
        return isAsciiAlpha(character) || (code >= 0x30 && code <= 0x39);
    };
    const isMarkdownTagWhitespace = (character: string): boolean =>
        character === " " || character === "\t" || character === "\r" || character === "\n";
    const isTagNameCharacter = (character: string): boolean => character === "-" || isAsciiAlphanumeric(character);
    const isAttributeNameStart = (character: string): boolean =>
        character === ":" || character === "_" || isAsciiAlpha(character);
    const isAttributeNameCharacter = (character: string): boolean =>
        character === "-" ||
        character === "." ||
        character === ":" ||
        character === "_" ||
        isAsciiAlphanumeric(character);
    const strictHtmlTagEnd = (start: number): { end: number; resume: number } => {
        let cursor = start + 1;
        const closing = value[cursor] === "/";
        if (closing) cursor += 1;
        if (!isAsciiAlpha(value[cursor] ?? "")) {
            return { end: -1, resume: nextOpeningAngle[start + 1] ?? value.length };
        }
        cursor += 1;
        while (cursor < value.length && isTagNameCharacter(value[cursor] ?? "")) cursor += 1;

        let nestedOpening = value.length;
        const noteNestedOpening = (from: number, to: number) => {
            const nested = nextOpeningAngle[from] ?? -1;
            if (nested >= 0 && nested < to) nestedOpening = Math.min(nestedOpening, nested);
        };
        const failure = (from: number): { end: number; resume: number } => {
            const next = nextOpeningAngle[Math.max(start + 1, Math.min(from, value.length))] ?? -1;
            const resume = next >= 0 ? Math.min(nestedOpening, next) : nestedOpening;
            return { end: -1, resume };
        };
        const success = (end: number): { end: number; resume: number } =>
            crossesParagraphBreak(start, end) ? failure(end) : { end, resume: end };

        if (closing) {
            while (cursor < value.length && isMarkdownTagWhitespace(value[cursor] ?? "")) cursor += 1;
            if (crossesParagraphBreak(start, cursor)) return failure(cursor);
            return value[cursor] === ">" ? success(cursor + 1) : failure(cursor);
        }

        let attributeAllowed = false;
        while (cursor < value.length) {
            const character = value[cursor] ?? "";
            if (character === ">") return success(cursor + 1);
            if (character === "/") {
                return value[cursor + 1] === ">" ? success(cursor + 2) : failure(cursor + 1);
            }
            if (isMarkdownTagWhitespace(character)) {
                do {
                    cursor += 1;
                } while (cursor < value.length && isMarkdownTagWhitespace(value[cursor] ?? ""));
                if (crossesParagraphBreak(start, cursor)) return failure(cursor);
                attributeAllowed = true;
                continue;
            }
            if (!attributeAllowed || !isAttributeNameStart(character)) return failure(cursor);

            cursor += 1;
            while (cursor < value.length && isAttributeNameCharacter(value[cursor] ?? "")) cursor += 1;
            const whitespaceStart = cursor;
            while (cursor < value.length && isMarkdownTagWhitespace(value[cursor] ?? "")) cursor += 1;
            if (crossesParagraphBreak(start, cursor)) return failure(cursor);
            if (value[cursor] !== "=") {
                attributeAllowed = cursor > whitespaceStart;
                continue;
            }

            cursor += 1;
            while (cursor < value.length && isMarkdownTagWhitespace(value[cursor] ?? "")) cursor += 1;
            if (crossesParagraphBreak(start, cursor)) return failure(cursor);
            const valueStart = value[cursor] ?? "";
            if (!valueStart || valueStart === "<" || valueStart === "=" || valueStart === ">" || valueStart === "`") {
                return failure(cursor);
            }
            if (valueStart === '"' || valueStart === "'") {
                const quoteEnd =
                    valueStart === '"' ? (nextDoubleQuote[cursor + 1] ?? -1) : (nextSingleQuote[cursor + 1] ?? -1);
                if (quoteEnd < 0) {
                    noteNestedOpening(cursor + 1, value.length);
                    return failure(value.length);
                }
                noteNestedOpening(cursor + 1, quoteEnd);
                if (crossesParagraphBreak(start, quoteEnd + 1)) return failure(quoteEnd + 1);
                cursor = quoteEnd + 1;
            } else {
                cursor += 1;
                while (cursor < value.length) {
                    const unquoted = value[cursor] ?? "";
                    if (
                        unquoted === '"' ||
                        unquoted === "'" ||
                        unquoted === "<" ||
                        unquoted === "=" ||
                        unquoted === "`"
                    ) {
                        return failure(cursor);
                    }
                    if (unquoted === "/" || unquoted === ">" || isMarkdownTagWhitespace(unquoted)) {
                        break;
                    }
                    cursor += 1;
                }
            }
            attributeAllowed = false;
        }
        return failure(value.length);
    };

    for (let index = 0; index < value.length; ) {
        if (value[index] !== "<" || escapedByBackslash[index] !== 0 || insideCodeSpan[index] !== 0) {
            index += 1;
            continue;
        }
        if (value.startsWith("<!--", index)) {
            const terminator = nextCommentTerminator[index + 2] ?? -1;
            const end = terminator >= 0 ? terminator + "-->".length : -1;
            if (end >= 0 && !crossesParagraphBreak(index, end)) {
                markHtmlInline(index, end);
                index = end;
            } else {
                index += 1;
            }
            continue;
        }
        if (value.startsWith("<![CDATA[", index)) {
            const terminator = nextCdataTerminator[index + "<![CDATA[".length] ?? -1;
            const end = terminator >= 0 ? terminator + "]]>".length : -1;
            if (end >= 0 && !crossesParagraphBreak(index, end)) {
                markHtmlInline(index, end);
                index = end;
            } else {
                index += 1;
            }
            continue;
        }
        if (value.startsWith("<?", index)) {
            const terminator = nextProcessingTerminator[index + "<?".length] ?? -1;
            const end = terminator >= 0 ? terminator + "?>".length : -1;
            if (end >= 0 && !crossesParagraphBreak(index, end)) {
                markHtmlInline(index, end);
                index = end;
            } else {
                index += 1;
            }
            continue;
        }

        if (value[index + 1] === "!" && isAsciiAlpha(value[index + 2] ?? "")) {
            const declarationEnd = nextGreaterThan[index + 3] ?? -1;
            if (declarationEnd >= 0 && !crossesParagraphBreak(index, declarationEnd + 1)) {
                markHtmlInline(index, declarationEnd + 1);
                index = declarationEnd + 1;
            } else {
                index += 1;
            }
            continue;
        }
        const tag = strictHtmlTagEnd(index);
        if (tag.end >= 0) {
            markHtmlInline(index, tag.end);
            index = tag.end;
        } else {
            index = Math.max(index + 1, tag.resume);
        }
    }
    const insideHtmlInline = new Uint8Array(value.length);
    let activeHtmlInline = 0;
    for (let index = 0; index < value.length; index += 1) {
        activeHtmlInline += htmlInlineDelta[index] ?? 0;
        if (activeHtmlInline > 0) insideHtmlInline[index] = 1;
    }
    const nextNonWhitespace = new Int32Array(value.length + 1);
    const nextReferenceClosingBracket = new Int32Array(value.length + 1);
    nextNonWhitespace.fill(value.length);
    nextReferenceClosingBracket.fill(-1);
    let closingBracket = -1;
    for (let index = value.length - 1; index >= 0; index -= 1) {
        if (value[index] === "]" && escapedByBackslash[index] === 0) {
            closingBracket = index;
        }
        nextNonWhitespace[index] =
            (value[index] ?? "").trim().length === 0 ? (nextNonWhitespace[index + 1] ?? value.length) : index;
        nextReferenceClosingBracket[index] = closingBracket;
    }

    const referenceOpeningPrefix = new Uint32Array(value.length + 1);
    for (let index = 0; index < value.length; index += 1) {
        referenceOpeningPrefix[index + 1] =
            (referenceOpeningPrefix[index] ?? 0) + (value[index] === "[" && escapedByBackslash[index] === 0 ? 1 : 0);
    }
    const referenceContainerDepthAt = new Uint32Array(value.length + 1);
    for (let lineStart = 0; lineStart < value.length; ) {
        let lineEnd = lineStart;
        while (lineEnd < value.length && !isLineEnding(value[lineEnd] ?? "")) lineEnd += 1;
        const depth = markdownReferenceContainerDepthForLine(value, lineStart, lineEnd);
        referenceContainerDepthAt.fill(depth, lineStart, lineEnd);
        lineStart = lineEnd < value.length ? lineEndingEnd(lineEnd) : value.length;
    }
    const definitionLabels = new Set<string>();
    for (let opening = 0; opening < value.length; opening += 1) {
        if (value[opening] !== "[" || escapedByBackslash[opening] !== 0) {
            continue;
        }
        const closing = nextReferenceClosingBracket[opening + 1] ?? -1;
        if (
            closing <= opening + 1 ||
            closing - opening > 1_000 ||
            (referenceOpeningPrefix[closing] ?? 0) !== (referenceOpeningPrefix[opening + 1] ?? 0)
        ) {
            continue;
        }
        let colon = closing + 1;
        while (colon < value.length && (value[colon] === " " || value[colon] === "\t")) colon += 1;
        if (value[colon] !== ":") continue;
        const rawLabel = value.slice(opening + 1, closing);
        for (const label of normalizedMarkdownReferenceLabels(rawLabel, [
            referenceContainerDepthAt[opening] ?? 0,
            ...markdownReferenceContinuationDepths(rawLabel),
        ])) {
            definitionLabels.add(label);
        }
    }
    return {
        definitionLabels,
        nextNonWhitespace,
        nextReferenceClosingBracket,
        referenceContainerDepthAt,
        escapedByBackslash,
        insideCodeSpan,
        insideHtmlInline,
    };
}

/**
 * A verified display must never be created inside a model-authored Markdown
 * link label. Besides inline links, this covers full/collapsed references and
 * shortcut definitions, including cases where normalizing a citation would
 * create a label that was not present verbatim in the model output.
 */
function hasMarkdownLinkLabelContext(
    value: string,
    candidateEnd: number,
    candidateLabels: readonly string[],
    context: MarkdownLinkContext,
): boolean {
    const labels = candidateLabels.flatMap((label) => normalizedMarkdownReferenceLabels(label));
    const next = context.nextNonWhitespace[candidateEnd] ?? value.length;
    if (
        value[next] === "(" &&
        context.escapedByBackslash[next] === 0 &&
        context.insideCodeSpan[next] === 0 &&
        context.insideHtmlInline[next] === 0
    ) {
        return true;
    }
    if (value[next] === "[" && context.escapedByBackslash[next] === 0) {
        const suffixEnd = context.nextReferenceClosingBracket[next + 1] ?? -1;
        if (suffixEnd >= 0 && suffixEnd - next <= 1_000) {
            let nestedOpening = false;
            for (let index = next + 1; index < suffixEnd; index += 1) {
                if (value[index] === "[" && context.escapedByBackslash[index] === 0) {
                    nestedOpening = true;
                    break;
                }
            }
            if (nestedOpening) return labels.some((label) => context.definitionLabels.has(label));
            const rawSuffixLabel = value.slice(next + 1, suffixEnd);
            const suffixLabels = normalizedMarkdownReferenceLabels(rawSuffixLabel, [
                context.referenceContainerDepthAt[next] ?? 0,
                ...markdownReferenceContinuationDepths(rawSuffixLabel),
            ]);
            if (
                suffixLabels.length > 0
                    ? suffixLabels.some((label) => context.definitionLabels.has(label))
                    : labels.some((label) => context.definitionLabels.has(label))
            ) {
                return true;
            }
        }
    }
    return labels.some((label) => context.definitionLabels.has(label));
}

function publicCitationLabel(citation: string): string {
    return citation.length >= 2 ? citation.slice(1, -1) : citation;
}

function isAcceptedDoubleClosingSourceHandle(candidate: string): boolean {
    return (
        DOUBLE_CLOSING_SOURCE_HANDLE_EXACT.test(candidate) ||
        DOUBLE_CLOSING_HASH_SUFFIX_SOURCE_HANDLE_EXACT.test(candidate) ||
        DOUBLE_CLOSING_LABELED_SOURCE_HANDLE_EXACT.test(candidate)
    );
}

/** Recognition is deliberately broader than the accepted grammar. */
function hasCompoundSourceHandleSequence(value: string): boolean {
    const handleClosingByOpening = new Map([
        ["[", "]"],
        ["［", "］"],
    ]);
    const memberClosingByOpening = new Map([...handleClosingByOpening, ["【", "】"], ["(", ")"], ["（", "）"]]);
    const memberOpeningByClosing = new Map(
        Array.from(memberClosingByOpening, ([opening, closing]) => [closing, opening]),
    );
    const memberOpening = /[\[［【(（]/u;
    const parentOpeningByIndex = new Map<number, number>();
    {
        const stack: Array<{ opening: string; index: number }> = [];
        for (let cursor = 0; cursor < value.length; cursor += 1) {
            const character = value[cursor] ?? "";
            if (memberClosingByOpening.has(character)) {
                const parent = stack.at(-1);
                if (parent) parentOpeningByIndex.set(cursor, parent.index);
                stack.push({ opening: character, index: cursor });
                continue;
            }
            const expectedOpening = memberOpeningByClosing.get(character);
            if (!expectedOpening) continue;
            if (stack.at(-1)?.opening === expectedOpening) stack.pop();
            else stack.length = 0;
        }
    }
    const wrappingClosersBefore = (openingIndex: number): string[] | null => {
        const closers: string[] = [];
        let parentIndex = parentOpeningByIndex.get(openingIndex);
        while (parentIndex !== undefined) {
            const closing = memberClosingByOpening.get(value[parentIndex] ?? "");
            if (!closing) return null;
            closers.push(closing);
            if (closers.length > 32) return null;
            parentIndex = parentOpeningByIndex.get(parentIndex);
        }
        return closers;
    };
    const compoundMarkdownContext = markdownLinkContext(value);
    const { nextNonWhitespace } = compoundMarkdownContext;
    const previousNonWhitespace = new Int32Array(value.length + 1);
    previousNonWhitespace.fill(-1);
    let previousNonWhitespaceIndex = -1;
    for (let index = 0; index <= value.length; index += 1) {
        previousNonWhitespace[index] = previousNonWhitespaceIndex;
        if (index < value.length && (value[index] ?? "").trim().length > 0) previousNonWhitespaceIndex = index;
    }
    const digitRunStart = new Int32Array(value.length);
    digitRunStart.fill(-1);
    let currentDigitRunStart = -1;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index] ?? "";
        if (character >= "0" && character <= "9") {
            if (currentDigitRunStart < 0) currentDigitRunStart = index;
            digitRunStart[index] = currentDigitRunStart;
        } else {
            currentDigitRunStart = -1;
        }
    }
    const handleClosingIndexByOpening = new Map<number, number>();
    let nextAsciiHandleClosing = -1;
    let nextFullwidthHandleClosing = -1;
    for (let index = value.length - 1; index >= 0; index -= 1) {
        const character = value[index] ?? "";
        if (character === "]") nextAsciiHandleClosing = index;
        else if (character === "］") nextFullwidthHandleClosing = index;
        else if (character === "[" && nextAsciiHandleClosing >= 0) {
            handleClosingIndexByOpening.set(index, nextAsciiHandleClosing);
        } else if (character === "［" && nextFullwidthHandleClosing >= 0) {
            handleClosingIndexByOpening.set(index, nextFullwidthHandleClosing);
        }
    }
    const handleLikeOpenings = new Set<number>();
    const nestedHandleLikeOpenings = new Set<number>();
    for (const [openingIndex, closingIndex] of handleClosingIndexByOpening) {
        const bodyStart = nextNonWhitespace[openingIndex + 1] ?? value.length;
        if (bodyStart >= closingIndex) continue;
        const nextBodyCharacter = value[bodyStart + 1] ?? "";
        const startsWithHandle = value[bodyStart] === "K" && nextBodyCharacter >= "0" && nextBodyCharacter <= "9";
        const bodyEnd = previousNonWhitespace[closingIndex] ?? -1;
        const locatorDigitStart = bodyEnd >= bodyStart ? (digitRunStart[bodyEnd] ?? -1) : -1;
        const locatorKIndex = locatorDigitStart - 1;
        const locatorSeparatorIndex = locatorKIndex >= bodyStart ? (previousNonWhitespace[locatorKIndex] ?? -1) : -1;
        const endsWithLabeledHandle =
            locatorDigitStart >= bodyStart &&
            value[locatorKIndex] === "K" &&
            locatorSeparatorIndex >= bodyStart &&
            (value[locatorSeparatorIndex] === "|" || value[locatorSeparatorIndex] === "｜");
        if (!startsWithHandle && !endsWithLabeledHandle) continue;
        handleLikeOpenings.add(openingIndex);
        if (!memberOpening.test(value[bodyStart] ?? "")) nestedHandleLikeOpenings.add(openingIndex);
    }
    const nestedHandlePrefix = new Uint32Array(value.length + 1);
    for (let index = 0; index < value.length; index += 1) {
        nestedHandlePrefix[index + 1] =
            (nestedHandlePrefix[index] ?? 0) + (nestedHandleLikeOpenings.has(index) ? 1 : 0);
    }
    const balancedMemberEnd = (openingIndex: number): number => {
        if (!memberClosingByOpening.has(value[openingIndex] ?? "")) return -1;
        const stack: string[] = [value[openingIndex] ?? ""];
        const limit = Math.min(value.length, openingIndex + 2_048);
        for (let cursor = openingIndex + 1; cursor < limit; cursor += 1) {
            const character = value[cursor] ?? "";
            if (memberClosingByOpening.has(character)) {
                stack.push(character);
                continue;
            }
            const expectedOpening = memberOpeningByClosing.get(character);
            if (!expectedOpening) continue;
            if (stack.at(-1) !== expectedOpening) return -1;
            stack.pop();
            if (stack.length === 0) return cursor + 1;
        }
        return -1;
    };
    const startsSourceLikeMember = (openingIndex: number): boolean => {
        const rootEnd = balancedMemberEnd(openingIndex);
        if (rootEnd < 0) return true;
        const stack: Array<{ opening: string; start: number }> = [];
        const spans: Array<{ start: number; end: number }> = [];
        for (let cursor = openingIndex; cursor < rootEnd; cursor += 1) {
            const character = value[cursor] ?? "";
            if (memberClosingByOpening.has(character)) {
                stack.push({ opening: character, start: cursor });
                if (stack.length > 32) return true;
                continue;
            }
            const expectedOpening = memberOpeningByClosing.get(character);
            if (!expectedOpening) continue;
            const current = stack.at(-1);
            if (!current || current.opening !== expectedOpening) return true;
            stack.pop();
            spans.push({ start: current.start, end: cursor + 1 });
            if (spans.length > 256) return true;
        }
        if (stack.length > 0) return true;

        for (const { start, end } of spans) {
            const candidate = value.slice(start, end);
            const body = value
                .slice(start + 1, end - 1)
                .normalize("NFKC")
                .trim();
            const exactFilenameMatch = EXACT_FILENAME_CITATION_FULL.exec(candidate);
            const markdownLinkLabel = hasMarkdownLinkLabelContext(value, end, [body], compoundMarkdownContext);
            if (
                /^K\d/u.test(body) ||
                /[|｜]\s*K\d+\s*$/u.test(body) ||
                /asset:\/{1,2}/iu.test(body) ||
                Boolean(
                    exactFilenameMatch &&
                        !markdownLinkLabel &&
                        isExecutableExactFilenameCitation(
                            candidate,
                            exactFilenameMatch[1] ?? "",
                            exactFilenameMatch[2],
                        ),
                ) ||
                UNWRAPPED_NATURAL_FILENAME_CITATION_FULL.test(body)
            ) {
                return true;
            }
        }
        return false;
    };
    for (let index = 0; index < value.length; index += 1) {
        const closing = handleClosingByOpening.get(value[index] ?? "");
        if (!closing) continue;
        const closingIndex = handleClosingIndexByOpening.get(index);
        if (closingIndex === undefined || !handleLikeOpenings.has(index)) continue;
        const bodyStart = nextNonWhitespace[index + 1] ?? value.length;
        if (memberOpening.test(value[bodyStart] ?? "")) continue;
        if ((nestedHandlePrefix[closingIndex] ?? 0) > (nestedHandlePrefix[bodyStart] ?? 0)) return true;
        let cursor = closingIndex + 1;
        let skippedWrapperClosers = 0;
        const wrappingClosers = wrappingClosersBefore(index);
        if (!wrappingClosers) return true;
        for (const wrapperClosing of wrappingClosers) {
            let closingCursor = cursor;
            while (closingCursor < value.length && (value[closingCursor] ?? "").trim().length === 0) {
                closingCursor += 1;
            }
            if (value[closingCursor] !== wrapperClosing) break;
            cursor = closingCursor + 1;
            skippedWrapperClosers += 1;
        }
        const closesDoubleClosingVariant =
            skippedWrapperClosers === 0 &&
            closing === "]" &&
            value[cursor] === "]" &&
            value[cursor + 1] !== "]" &&
            isAcceptedDoubleClosingSourceHandle(value.slice(index, cursor + 1));
        if (closesDoubleClosingVariant) cursor += 1;
        while (cursor < value.length && (value[cursor] ?? "").trim().length === 0) cursor += 1;
        if (value[cursor] !== "," && value[cursor] !== "，") continue;
        cursor += 1;
        while (cursor < value.length && (value[cursor] ?? "").trim().length === 0) cursor += 1;
        if (memberOpening.test(value[cursor] ?? "") && startsSourceLikeMember(cursor)) return true;
    }
    return false;
}

/**
 * Remove only one redundant fullwidth wrapper around a complete ASCII opaque
 * handle or structurally exact filename citation, or one unmatched fullwidth
 * opener immediately before such a citation. The handle, filename and locator
 * remain untrusted here and still pass through the ordinary per-turn resolver.
 *
 * A paired wrapper is removed only when its entire body is one handle or one
 * exact compound handle array. An unmatched opener is removed only when no
 * fullwidth closer appears before the next fullwidth opener. This keeps prose,
 * cross-line wrappers, Markdown filename labels and sibling material outside
 * the compatibility rule.
 */
function normalizeRedundantFullwidthKnowledgeCitationWrappers(value: string): string {
    const pairedNormalized = value.replace(FULLWIDTH_WRAPPED_ASCII_SOURCE_HANDLE, (candidate, body: string) =>
        ASCII_SOURCE_HANDLE_EXACT.test(body) ||
        COMPOUND_SOURCE_HANDLE_ARRAY_EXACT.test(body) ||
        EXACT_FILENAME_CITATION_FULL.test(body)
            ? body
            : candidate,
    );
    if (!SOLITARY_FULLWIDTH_OPENING_BEFORE_KNOWLEDGE_CITATION.test(pairedNormalized)) return pairedNormalized;
    SOLITARY_FULLWIDTH_OPENING_BEFORE_KNOWLEDGE_CITATION.lastIndex = 0;

    const nextOpening = new Int32Array(pairedNormalized.length + 1);
    const nextClosing = new Int32Array(pairedNormalized.length + 1);
    nextOpening.fill(-1);
    nextClosing.fill(-1);
    for (let index = pairedNormalized.length - 1; index >= 0; index -= 1) {
        nextOpening[index] = pairedNormalized[index] === "［" ? index : (nextOpening[index + 1] ?? -1);
        nextClosing[index] = pairedNormalized[index] === "］" ? index : (nextClosing[index + 1] ?? -1);
    }

    return pairedNormalized.replace(SOLITARY_FULLWIDTH_OPENING_BEFORE_KNOWLEDGE_CITATION, (opening, offset: number) => {
        const suffix = pairedNormalized.slice(
            offset + 1,
            Math.min(pairedNormalized.length, offset + 1 + MAX_COMPOUND_SOURCE_HANDLE_ARRAY_LENGTH),
        );
        if (
            !ASCII_SOURCE_HANDLE_PREFIX.test(suffix) &&
            !COMPOUND_SOURCE_HANDLE_ARRAY_PREFIX.test(suffix) &&
            !EXACT_FILENAME_CITATION_PREFIX.test(suffix)
        ) {
            return opening;
        }
        const followingOpening = nextOpening[offset + 1] ?? -1;
        const followingClosing = nextClosing[offset + 1] ?? -1;
        return followingClosing >= 0 && (followingOpening < 0 || followingClosing < followingOpening) ? opening : "";
    });
}

/**
 * Resolve only a complete outermost ASCII square-bracket container. Invalid
 * compound-looking spans are rejected before any ordinary handle pass can
 * protect a trustworthy-looking inner substring and hide its siblings.
 */
function replaceCompoundSourceHandleArrays(
    value: string,
    resolve: (members: CompoundSourceHandleMember[], citation: string) => string,
    reject: (citation: string) => string,
): string {
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    const closingByOpening = new Map([
        ["[", "]"],
        ["［", "］"],
        ["【", "】"],
        ["(", ")"],
        ["（", "）"],
    ]);
    const openingByClosing = new Map(Array.from(closingByOpening, ([opening, closing]) => [closing, opening]));
    const stack: Array<{ opening: string; closer: string; start: number }> = [];
    let outerStart = -1;
    let ignoredAtomicCloser = -1;

    const inspect = (start: number, balancedEnd: number, balanced: boolean) => {
        let end = balancedEnd;
        if (balanced) {
            // A third closing bracket is part of the malformed compound token,
            // not harmless answer punctuation beside a valid inner array.
            while (value[end] === "]") end += 1;
        }
        const citation = value.slice(start, end);
        // Preserve the pre-existing, source-conflict-checked compatibility
        // shape only when it occupies this whole top-level unmatched span.
        // Any surrounding group or sibling makes the span malformed below.
        if (
            !balanced &&
            (MALFORMED_HANDLE_FILENAME_PAIR_EXACT.test(citation) || EXTRA_OPENING_SOURCE_HANDLE_EXACT.test(citation))
        )
            return;
        if (!hasCompoundSourceHandleSequence(citation)) return;

        const exactCitation = value.slice(start, balancedEnd);
        const exact =
            balanced &&
            end === balancedEnd &&
            exactCitation.length <= MAX_COMPOUND_SOURCE_HANDLE_ARRAY_LENGTH &&
            COMPOUND_SOURCE_HANDLE_ARRAY_EXACT.test(exactCitation);
        if (!exact) {
            replacements.push({ start, end, replacement: reject(citation) });
            return;
        }

        const members = Array.from(exactCitation.matchAll(COMPOUND_SOURCE_HANDLE_MEMBER), (member) => ({
            rawIndex: member[1] ?? "",
            ...(member[2] === undefined ? {} : { rawLocator: member[2] }),
            citation: member[0],
        }));
        if (members.length < 2 || members.length > 32) {
            replacements.push({ start, end, replacement: reject(citation) });
            return;
        }
        replacements.push({ start, end, replacement: resolve(members, citation) });
    };

    for (let index = 0; index < value.length; index += 1) {
        if (index === ignoredAtomicCloser) continue;
        const character = value[index] ?? "";
        if (character === "\n" || character === "\r") {
            if (stack.length > 0 && outerStart >= 0) inspect(outerStart, index, false);
            stack.length = 0;
            outerStart = -1;
            continue;
        }
        const closer = closingByOpening.get(character);
        if (closer) {
            if (stack.length === 0) outerStart = index;
            stack.push({ opening: character, closer, start: index });
            continue;
        }
        const expectedOpening = openingByClosing.get(character);
        if (!expectedOpening || stack.length === 0) continue;
        const current = stack.at(-1);
        if (!current || current.opening !== expectedOpening) {
            if (outerStart >= 0) inspect(outerStart, index + 1, false);
            stack.length = 0;
            outerStart = -1;
            continue;
        }
        stack.pop();
        const parent = stack.at(-1);
        const doubleClosingCandidate =
            character === "]" &&
            value[index + 1] === "]" &&
            value[index + 2] !== "]" &&
            current.opening === "[" &&
            value[current.start - 1] !== "[";
        const compoundCandidateLength = parent ? index + 2 - parent.start : 0;
        const closesExactCompoundArray =
            doubleClosingCandidate &&
            parent?.opening === "[" &&
            compoundCandidateLength <= MAX_COMPOUND_SOURCE_HANDLE_ARRAY_LENGTH &&
            COMPOUND_SOURCE_HANDLE_ARRAY_EXACT.test(value.slice(parent.start, index + 2));
        const doubleClosingHandleLength = index + 2 - current.start;
        if (
            doubleClosingCandidate &&
            !closesExactCompoundArray &&
            doubleClosingHandleLength <= MAX_COMPOUND_SOURCE_HANDLE_ARRAY_LENGTH &&
            isAcceptedDoubleClosingSourceHandle(value.slice(current.start, index + 2))
        ) {
            ignoredAtomicCloser = index + 1;
        }
        if (stack.length === 0 && outerStart >= 0) {
            inspect(outerStart, index + 1, true);
            outerStart = -1;
        }
    }
    if (stack.length > 0 && outerStart >= 0) inspect(outerStart, value.length, false);
    if (replacements.length === 0) return value;

    const segments: string[] = [];
    let copiedUntil = 0;
    for (const replacement of replacements) {
        segments.push(value.slice(copiedUntil, replacement.start), replacement.replacement);
        copiedUntil = replacement.end;
    }
    segments.push(value.slice(copiedUntil));
    return segments.join("");
}

/**
 * Canonicalize an exact single-bracket handle only when it is structurally nested
 * in a balanced, labelled outer container. Providers sometimes emit
 * `[Sources: [K1:ROW-1] [K2:ROW-2]]]`; the final member then looks like an
 * ambiguous double/triple-closing handle to the flat compatibility regexes.
 *
 * Compound arrays have already been handled transactionally before this pass.
 * Requiring a balanced parent plus non-empty material before the nested member
 * keeps bare over-closed handles and unterminated wrappers fail-closed.
 */
function replaceNestedSourceHandlesInBoundedContainers(value: string): string {
    const closingByOpening = new Map([
        ["[", "]"],
        ["［", "］"],
        ["【", "】"],
        ["(", ")"],
        ["（", "）"],
    ]);
    const openingByClosing = new Map(Array.from(closingByOpening, ([opening, closing]) => [closing, opening]));
    const nodes: Array<{
        opening: string;
        start: number;
        end?: number;
        parent?: number;
    }> = [];
    const stack: number[] = [];
    const nonWhitespacePrefix = new Uint32Array(value.length + 1);
    for (let index = 0; index < value.length; index += 1) {
        nonWhitespacePrefix[index + 1] =
            (nonWhitespacePrefix[index] ?? 0) + ((value[index] ?? "").trim().length > 0 ? 1 : 0);
    }

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index] ?? "";
        if (closingByOpening.has(character)) {
            const parent = stack.at(-1);
            const nodeIndex =
                nodes.push({
                    opening: character,
                    start: index,
                    ...(parent === undefined ? {} : { parent }),
                }) - 1;
            stack.push(nodeIndex);
            continue;
        }
        const expectedOpening = openingByClosing.get(character);
        if (!expectedOpening) continue;
        const currentIndex = stack.at(-1);
        const current = currentIndex === undefined ? undefined : nodes[currentIndex];
        if (!current || current.opening !== expectedOpening) {
            stack.length = 0;
            continue;
        }
        current.end = index + 1;
        stack.pop();
    }

    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    for (const node of nodes) {
        if (node.end === undefined || node.parent === undefined || (node.opening !== "[" && node.opening !== "［")) {
            continue;
        }
        const parent = nodes[node.parent];
        if (!parent?.end || (nonWhitespacePrefix[node.start] ?? 0) === (nonWhitespacePrefix[parent.start + 1] ?? 0)) {
            continue;
        }
        const citation = value.slice(node.start, node.end);
        const match =
            node.opening === "["
                ? NESTED_ASCII_SOURCE_HANDLE_EXACT.exec(citation)
                : NESTED_FULLWIDTH_SOURCE_HANDLE_EXACT.exec(citation);
        const rawIndex = match?.[1];
        if (!rawIndex) continue;
        const rawLocator = match?.[2];
        replacements.push({
            start: node.start,
            end: node.end,
            replacement: rawLocator === undefined ? `[[K${rawIndex}]]` : `[[K${rawIndex}:${rawLocator}]]`,
        });
    }
    if (replacements.length === 0) return value;

    replacements.sort((left, right) => left.start - right.start);
    const segments: string[] = [];
    let copiedUntil = 0;
    for (const replacement of replacements) {
        if (replacement.start < copiedUntil) continue;
        segments.push(value.slice(copiedUntil, replacement.start), replacement.replacement);
        copiedUntil = replacement.end;
    }
    segments.push(value.slice(copiedUntil));
    return segments.join("");
}

/**
 * Recover only a repeated, top-level bare K handle after the same source has
 * already appeared through an explicit verified handle earlier in the answer.
 * This is deliberately narrower than RESIDUAL_SOURCE_HANDLE: half brackets,
 * containers, locators, leading-zero aliases and unknown handles remain for
 * the fail-closed residual pass.
 */
function replaceRepeatedTopLevelBareSourceHandles(
    value: string,
    protectedReceipts: ProtectedKnowledgeCitationReceipt[],
    resolve: (rawIndex: string, citation: string) => string,
): string {
    const closingByOpening = new Map([
        ["[", "]"],
        ["［", "］"],
        ["【", "】"],
        ["(", ")"],
        ["（", "）"],
        ["{", "}"],
        ["｛", "｝"],
        ["<", ">"],
        ["〈", "〉"],
        ["《", "》"],
    ]);
    const openingByClosing = new Map(Array.from(closingByOpening, ([opening, closing]) => [closing, opening]));
    const stack: string[] = [];
    const previouslyVerifiedRefs = new Set<string>();
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    let malformedContainer = false;

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index] ?? "";
        if (character === "\n" || character === "\r") {
            continue;
        }
        if (malformedContainer) continue;
        if (character === "\uE000") {
            const token = /^\uE000KREF(\d+)\uE001/u.exec(value.slice(index, Math.min(value.length, index + 48)));
            if (token) {
                if (stack.length === 0 && !malformedContainer) {
                    const receipt = protectedReceipts[Number(token[1])];
                    if (receipt) previouslyVerifiedRefs.add(receipt.source.ref);
                }
                index += token[0].length - 1;
                continue;
            }
        }
        const closer = closingByOpening.get(character);
        if (closer) {
            if (stack.length >= 32) {
                stack.length = 0;
                malformedContainer = true;
            } else {
                stack.push(character);
            }
            continue;
        }
        const expectedOpening = openingByClosing.get(character);
        if (expectedOpening) {
            if (stack.at(-1) === expectedOpening) stack.pop();
            else {
                stack.length = 0;
                malformedContainer = true;
            }
            continue;
        }
        if (malformedContainer || stack.length > 0 || character !== "K") continue;

        let end = index + 1;
        while (end < value.length && /[0-9]/u.test(value[end] ?? "")) end += 1;
        if (end === index + 1) continue;
        const citation = value.slice(index, end);
        if (!previouslyVerifiedRefs.has(citation)) continue;
        const before = index > 0 ? (value[index - 1] ?? "") : "";
        const after = end < value.length ? (value[end] ?? "") : "";
        if ((before && before.trim().length > 0) || (after && after.trim().length > 0)) continue;

        replacements.push({
            start: index,
            end,
            replacement: resolve(citation.slice(1), citation),
        });
        index = end - 1;
    }
    if (replacements.length === 0) return value;

    const segments: string[] = [];
    let copiedUntil = 0;
    for (const replacement of replacements) {
        segments.push(value.slice(copiedUntil, replacement.start), replacement.replacement);
        copiedUntil = replacement.end;
    }
    segments.push(value.slice(copiedUntil));
    return segments.join("");
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

function isErrorGroundingRecord(record: Record<string, unknown>): boolean {
    return typeof record.status === "string" && record.status.trim().toLowerCase() === "error";
}

function knowledgeReadContent(record: Record<string, unknown>): string | null {
    return typeof record.content === "string" ? record.content : typeof record.body === "string" ? record.body : null;
}

function hasKnowledgeReadTruncationSuffix(content: string): boolean {
    return content.normalize("NFKC").trimEnd().endsWith(KNOWLEDGE_READ_TRUNCATION_NOTICE);
}

function isInvalidKnowledgeReadRecord(record: Record<string, unknown>): boolean {
    const content = knowledgeReadContent(record);
    return (
        content !== null &&
        (isErrorGroundingRecord(record) ||
            record.__knowledgeReadFailed === true ||
            record.__knowledgeReadTruncated === true ||
            record.__knowledgeContentTruncated === true ||
            record.__knowledgeRevisionChanged === true ||
            hasKnowledgeReadTruncationSuffix(content))
    );
}

function trustedGroundingPayload(grounding: string | undefined): Record<string, unknown> | null {
    const payload = grounding ? parseJsonRecord(grounding) : null;
    return payload && !isErrorGroundingRecord(payload) ? payload : null;
}

function replacePrivateKnowledgeReferenceFragments(
    value: string,
    replaceFragment: (fragment: string) => string,
): string {
    const withoutCompleteOrLeftFragments = value
        .replace(PRIVATE_KNOWLEDGE_REFERENCE_NAMESPACE, (fragment) => replaceFragment(fragment))
        .replace(PRIVATE_KNOWLEDGE_REFERENCE_LEFT_FRAGMENT, (fragment) => replaceFragment(fragment));
    const segments: string[] = [];
    let copiedUntil = 0;
    let fragmentStart = 0;
    let foundRightFragment = false;
    for (let index = 0; index < withoutCompleteOrLeftFragments.length; index += 1) {
        const character = withoutCompleteOrLeftFragments[index] ?? "";
        if (character === "\r" || character === "\n" || character === "\uE000") {
            fragmentStart = index + 1;
            continue;
        }
        if (character !== "\uE001") continue;
        foundRightFragment = true;
        segments.push(
            withoutCompleteOrLeftFragments.slice(copiedUntil, fragmentStart),
            replaceFragment(withoutCompleteOrLeftFragments.slice(fragmentStart, index + 1)),
        );
        copiedUntil = index + 1;
        fragmentStart = copiedUntil;
    }
    const withoutRightFragments = foundRightFragment
        ? `${segments.join("")}${withoutCompleteOrLeftFragments.slice(copiedUntil)}`
        : withoutCompleteOrLeftFragments;
    return withoutRightFragments.replace(PRIVATE_KNOWLEDGE_REFERENCE_DELIMITER, (fragment) =>
        replaceFragment(fragment),
    );
}

function stripPrivateKnowledgeReferenceFragments(value: string): string {
    return replacePrivateKnowledgeReferenceFragments(value, () => " ");
}

function containsPrivateKnowledgeReferenceDelimiter(value: string): boolean {
    return /[\uE000\uE001]/u.test(value);
}

function canonicalResource(value: unknown): string | null {
    if (typeof value !== "string" || !value.startsWith("asset://")) return null;
    const suffix = value.slice("asset://".length);
    const separator = suffix.indexOf("/");
    if (separator <= 0 || separator === suffix.length - 1) return null;
    const assetId = suffix.slice(0, separator);
    const relativePath = suffix.slice(separator + 1);
    if (
        assetId.includes("…") ||
        assetId.includes("...") ||
        containsPrivateKnowledgeReferenceDelimiter(value) ||
        relativePath.includes("..") ||
        relativePath.includes("\\") ||
        !isPublicKnowledgeSourcePath(relativePath)
    ) {
        return null;
    }
    return value;
}

function parseResource(value: string): { assetId: string; relativePath: string } {
    const suffix = value.slice("asset://".length);
    const separator = suffix.indexOf("/");
    return { assetId: suffix.slice(0, separator), relativePath: suffix.slice(separator + 1) };
}

function sourceChunkLocatorPath(value: string): string | undefined {
    const match = /^source:(.+)#\d+$/u.exec(value.normalize("NFKC").trim());
    return match?.[1]?.trim() || undefined;
}

function locatorKind(path: string, value: string): KnowledgeSourceLocator["kind"] {
    // An index concept ID remains a chunk locator even when its backing source
    // is CSV. Calling `source:path.csv#N` a record ID lets an internal chunk
    // address masquerade as a primary-key value and poison persisted history.
    if (sourceChunkLocatorPath(value)) return "chunk";
    if (path.toLowerCase().endsWith(".csv")) return "record";
    return "section";
}

function firstField(line: string): string {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith("#")) return "";
    if (trimmed.startsWith('"')) {
        const end = trimmed.indexOf('"', 1);
        return end > 0 ? trimmed.slice(1, end).replace(/""/g, '"') : "";
    }
    return (trimmed.split(/[,\t;]/u, 1)[0] ?? "").trim();
}

function collectLocators(record: Record<string, unknown>, path: string): Set<string> {
    const values = new Set<string>();
    const csv = path.toLowerCase().endsWith(".csv");
    for (const id of Array.isArray(record.matchedRecordIds) ? record.matchedRecordIds : []) {
        if (typeof id === "string" && id.trim() && !containsPrivateKnowledgeReferenceDelimiter(id)) {
            const normalized = id.trim();
            if (!csv || !sourceChunkLocatorPath(normalized)) values.add(normalized);
        }
    }
    const conceptId = typeof record.conceptId === "string" ? record.conceptId.trim() : "";
    // CSV claims should cite rows read this turn. The index chunk identity is
    // transport/search provenance, not a table primary key, so keep it out of
    // both the allow-list and the model's short locator preview.
    if (!csv && conceptId.includes("#") && !containsPrivateKnowledgeReferenceDelimiter(conceptId)) {
        values.add(conceptId);
    }
    const content =
        typeof record.content === "string" ? record.content : typeof record.body === "string" ? record.body : "";
    if (csv && content) {
        for (const line of content.split(/\r?\n/u).slice(1)) {
            const id = firstField(line);
            if (id && !sourceChunkLocatorPath(id) && !containsPrivateKnowledgeReferenceDelimiter(id)) values.add(id);
            if (values.size >= MAX_SOURCE_LOCATORS) break;
        }
    }
    return values;
}

function trustedCatalogRecordCounts(payload: Record<string, unknown>): Map<string, number> {
    const search =
        payload.search && typeof payload.search === "object" && !Array.isArray(payload.search)
            ? (payload.search as Record<string, unknown>)
            : null;
    const summaries = Array.isArray(search?.tableSummaries) ? search.tableSummaries : [];
    const counts = new Map<string, number | null>();
    for (const value of summaries) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const summary = value as Record<string, unknown>;
        const resource = canonicalResource(summary.resource);
        const count = summary.recordCount;
        if (!resource || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) continue;
        const current = counts.get(resource);
        if (current === undefined) counts.set(resource, count);
        else if (current !== count) counts.set(resource, null);
    }
    return new Map(Array.from(counts.entries()).filter((entry): entry is [string, number] => entry[1] !== null));
}

export function buildKnowledgeSourceRegistry(grounding: string | undefined): RegistrySource[] {
    const payload = trustedGroundingPayload(grounding);
    if (!payload) return [];
    const catalogRecordCounts = trustedCatalogRecordCounts(payload);
    const byResource = new Map<
        string,
        {
            title: string;
            evidence: KnowledgeSourceEvidence;
            allowedLocators: Set<string>;
            readAllowedLocators: Set<string>;
            searchableContent: string;
            catalogRecordCount?: number;
        }
    >();
    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (isErrorGroundingRecord(record)) return;
        if (isInvalidKnowledgeReadRecord(record)) return;
        const directResources = [record.resource, ...(Array.isArray(record.citations) ? record.citations : [])]
            .map(canonicalResource)
            .filter((item): item is string => Boolean(item));
        for (const resource of directResources) {
            const { relativePath } = parseResource(resource);
            const title =
                typeof record.title === "string" &&
                record.title.trim() &&
                !containsPrivateKnowledgeReferenceDelimiter(record.title)
                    ? record.title.trim()
                    : (relativePath.split("/").at(-1) ?? relativePath);
            const content =
                typeof record.content === "string"
                    ? record.content
                    : typeof record.body === "string"
                      ? record.body
                      : typeof record.snippet === "string"
                        ? record.snippet
                        : "";
            const evidence: KnowledgeSourceEvidence =
                typeof record.content === "string" || typeof record.body === "string"
                    ? "read"
                    : typeof record.snippet === "string"
                      ? "search"
                      : "catalog";
            const current = byResource.get(resource);
            // Catalog metadata can establish a file-level count, never a row or
            // section locator. In particular, recordIds/matchedRecordIds present
            // on a table summary must not become admissible citations.
            const locators = evidence === "catalog" ? new Set<string>() : collectLocators(record, relativePath);
            const readLocators = evidence === "read" ? new Set(locators) : new Set<string>();
            const catalogRecordCount = catalogRecordCounts.get(resource);
            if (current) {
                for (const locator of locators) current.allowedLocators.add(locator);
                for (const locator of readLocators) current.readAllowedLocators.add(locator);
                if (evidence === "read" || (evidence === "search" && current.evidence === "catalog")) {
                    current.evidence = evidence;
                }
                if (content.length > current.searchableContent.length) current.searchableContent = content;
                if (catalogRecordCount !== undefined) current.catalogRecordCount = catalogRecordCount;
            } else {
                byResource.set(resource, {
                    title,
                    evidence,
                    allowedLocators: locators,
                    readAllowedLocators: readLocators,
                    searchableContent: content,
                    ...(catalogRecordCount !== undefined ? { catalogRecordCount } : {}),
                });
            }
        }
        for (const [key, nested] of Object.entries(record)) {
            if (TRUSTED_GROUNDING_SOURCE_CONTAINERS.has(key)) visit(nested);
        }
    };
    visit(payload);
    return Array.from(byResource.entries())
        .slice(0, MAX_KNOWLEDGE_SOURCE_REFERENCES)
        .map(([resource, value], index) => {
            const { assetId, relativePath } = parseResource(resource);
            return {
                protocolVersion: 1,
                ref: `K${index + 1}`,
                assetId,
                relativePath,
                title: value.title,
                resource,
                evidence: value.evidence,
                locators: [],
                allowedLocators: value.allowedLocators,
                readAllowedLocators: value.readAllowedLocators,
                searchableContent: value.searchableContent,
                ...(value.catalogRecordCount !== undefined ? { catalogRecordCount: value.catalogRecordCount } : {}),
            };
        });
}

/**
 * Resolve only exact locators that were present in one current-turn full read.
 * This is used by the answer-completeness finalizer to append a bounded,
 * application-owned identifier receipt without guessing a source or trusting
 * a search-only hit. Ambiguous and unverified identifiers remain unresolved.
 */
export function verifiedKnowledgeReadLocatorCitations(
    grounding: string | undefined,
    locators: string[],
): Array<{ locator: string; citation: string }> {
    const registry = buildKnowledgeSourceRegistry(grounding);
    const seen = new Set<string>();
    const resolved: Array<{ locator: string; citation: string }> = [];
    for (const rawLocator of locators) {
        const requested = rawLocator.normalize("NFKC").trim();
        const key = requested.toLowerCase();
        if (!requested || requested.length > 160 || seen.has(key) || sourceChunkLocatorPath(requested)) continue;
        seen.add(key);
        const matches = registry.flatMap((source) =>
            Array.from(source.readAllowedLocators).flatMap((allowed) =>
                allowed.normalize("NFKC").trim().toLowerCase() === key ? [{ source, allowed }] : [],
            ),
        );
        const unique = Array.from(
            new Map(matches.map((match) => [`${match.source.resource}\u0000${match.allowed}`, match])).values(),
        );
        if (unique.length !== 1) continue;
        const match = unique[0];
        resolved.push({ locator: requested, citation: `[[${match.source.ref}:${match.allowed}]]` });
    }
    return resolved;
}

/**
 * Whether a grounding payload contains at least one current-turn source that
 * the citation finalizer can resolve. Error payloads are never trusted even if
 * an upstream transport accidentally left stale resource-shaped data in them.
 */
export function hasTrustedKnowledgeGrounding(grounding: string | undefined): boolean {
    const payload = trustedGroundingPayload(grounding);
    if (!payload) return false;
    return buildKnowledgeSourceRegistry(grounding).length > 0;
}

function verifiedSourceGuide(registry: RegistrySource[]): string[] {
    let remainingLocators = MAX_SOURCE_GUIDE_LOCATORS;
    let remainingCharacters = MAX_SOURCE_GUIDE_LOCATOR_CHARACTERS;
    return registry.map((source) => {
        const preview: string[] = [];
        for (const rawLocator of source.allowedLocators) {
            if (remainingLocators <= 0 || remainingCharacters <= 0 || preview.length >= 4) break;
            const locator = rawLocator
                .normalize("NFKC")
                .replace(/[\u0000-\u001f\u007f]/gu, " ")
                .trim();
            if (!locator || locator.length > 160 || /asset:\/{1,2}/iu.test(locator)) continue;
            const encoded = JSON.stringify(locator);
            if (encoded.length > remainingCharacters) break;
            preview.push(encoded);
            remainingLocators -= 1;
            remainingCharacters -= encoded.length;
        }
        const countGuide =
            source.catalogRecordCount !== undefined ? `; verifiedRecordCount=${source.catalogRecordCount}` : "";
        const locatorGuide = preview.length > 0 ? `; exactLocators=[${preview.join(", ")}]` : "";
        return `${source.ref}: ${source.title} (${source.relativePath}; evidence=${source.evidence}${countGuide}${locatorGuide})`;
    });
}

function catalogFactsForModel(
    payload: Record<string, unknown>,
    sourceByResource: ReadonlyMap<string, RegistrySource>,
): Array<{ resource: string; title: string; recordCount: number }> {
    const facts: Array<{ resource: string; title: string; recordCount: number }> = [];
    for (const [resource, recordCount] of trustedCatalogRecordCounts(payload)) {
        const source = sourceByResource.get(resource);
        if (!source) continue;
        facts.push({ resource: source.resource, title: source.title, recordCount });
    }
    return facts;
}

function modelGroundingEntries(record: Record<string, unknown>): [string, unknown][] {
    return Object.entries(record)
        .map(([key, value], index) => ({ key, value, index }))
        .sort((left, right) => {
            const priority =
                (MODEL_GROUNDING_FIELD_PRIORITY.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
                (MODEL_GROUNDING_FIELD_PRIORITY.get(right.key) ?? Number.MAX_SAFE_INTEGER);
            return priority || left.index - right.index;
        })
        .map(({ key, value }) => [key, value]);
}

function coverageSummaryForModel(value: unknown, sourceByResource: ReadonlyMap<string, RegistrySource>): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const [key, nested] of modelGroundingEntries(record)) {
        if (!MODEL_COVERAGE_SUMMARY_FIELDS.has(key)) continue;
        summary[key] = safeGroundingPayload(nested, sourceByResource);
    }
    if (summary.unresolved === undefined && Array.isArray(record.facets)) {
        summary.unresolved = record.facets
            .filter((facet): facet is Record<string, unknown> => {
                return (
                    Boolean(facet) && typeof facet === "object" && !Array.isArray(facet) && facet.status !== "covered"
                );
            })
            .map((facet) => {
                const unresolved: Record<string, unknown> = {};
                for (const key of ["id", "query", "status", "reason"]) {
                    if (facet[key] !== undefined) unresolved[key] = safeGroundingPayload(facet[key], sourceByResource);
                }
                return unresolved;
            });
    }
    return summary;
}

function safeGroundingPayload(value: unknown, sourceByResource: ReadonlyMap<string, RegistrySource>): unknown {
    if (Array.isArray(value)) {
        return value.flatMap((item) => {
            const safe = safeGroundingPayload(item, sourceByResource);
            return safe === undefined ? [] : [safe];
        });
    }
    if (typeof value === "string") return stripPrivateKnowledgeReferenceFragments(value);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (isErrorGroundingRecord(record) || isInvalidKnowledgeReadRecord(record)) return undefined;
    const enclosingResource = [record.resource, ...(Array.isArray(record.citations) ? record.citations : [])]
        .map(canonicalResource)
        .find((item): item is string => Boolean(item));
    const enclosingPath = enclosingResource ? parseResource(enclosingResource).relativePath : "";
    const result: Record<string, unknown> = {};
    let sourceRef: string | undefined;
    for (const [key, nested] of modelGroundingEntries(record)) {
        if (key === "sourceRef") continue;
        if (key === "coverage") {
            result[key] = coverageSummaryForModel(nested, sourceByResource);
            continue;
        }
        if (key === "assetId" || key === "resource" || key === "citations") {
            if (key === "resource") {
                const resource = canonicalResource(nested);
                if (resource) sourceRef = sourceByResource.get(resource)?.ref;
            }
            if (key === "citations" && Array.isArray(nested)) {
                const resource = nested.map(canonicalResource).find((item): item is string => Boolean(item));
                if (resource) sourceRef = sourceByResource.get(resource)?.ref;
            }
            continue;
        }
        if (enclosingPath.toLowerCase().endsWith(".csv")) {
            if (
                (key === "conceptId" || key === "__knowledgePath" || key === "path") &&
                typeof nested === "string" &&
                sourceChunkLocatorPath(nested)
            ) {
                continue;
            }
            if (key === "__knowledgeHitKey" && typeof nested === "string" && /:source:.+#\d+$/u.test(nested)) {
                continue;
            }
            if ((key === "matchedRecordIds" || key === "matchedIdentifiers") && Array.isArray(nested)) {
                result[key] = safeGroundingPayload(
                    nested.filter((item) => typeof item !== "string" || !sourceChunkLocatorPath(item)),
                    sourceByResource,
                );
                continue;
            }
        }
        result[key] = safeGroundingPayload(nested, sourceByResource);
    }
    if (sourceRef) result.sourceRef = sourceRef;
    return result;
}

function normalizedProjectedEvidenceText(value: string): string {
    return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function projectedReadContentBySourceRef(value: unknown): Map<string, string[]> {
    const contentBySourceRef = new Map<string, string[]>();
    if (!Array.isArray(value)) return contentBySourceRef;
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const sourceRef = typeof record.sourceRef === "string" ? record.sourceRef : "";
        const content =
            typeof record.content === "string" ? record.content : typeof record.body === "string" ? record.body : "";
        const normalizedContent = normalizedProjectedEvidenceText(content);
        if (sourceRef && normalizedContent) {
            const existing = contentBySourceRef.get(sourceRef) ?? [];
            existing.push(normalizedContent);
            contentBySourceRef.set(sourceRef, existing);
        }
    }
    return contentBySourceRef;
}

function withoutCoveredProjectedSearchSnippets(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const payload = value as Record<string, unknown>;
    if (!Array.isArray(payload.reads) || !payload.search || typeof payload.search !== "object") return value;
    const search = payload.search as Record<string, unknown>;
    if (!Array.isArray(search.hits)) return value;
    if (
        payload.reads.length > MAX_KNOWLEDGE_SOURCE_REFERENCES ||
        search.hits.length > MAX_KNOWLEDGE_SOURCE_REFERENCES
    ) {
        return value;
    }
    const readContentBySourceRef = projectedReadContentBySourceRef(payload.reads);
    const hits = search.hits.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const hit = item as Record<string, unknown>;
        const sourceRef = typeof hit.sourceRef === "string" ? hit.sourceRef : "";
        const normalizedSnippet = typeof hit.snippet === "string" ? normalizedProjectedEvidenceText(hit.snippet) : "";
        const covered =
            sourceRef &&
            normalizedSnippet &&
            (readContentBySourceRef.get(sourceRef) ?? []).some((content) => content.includes(normalizedSnippet));
        if (!covered) return item;
        const projectedHit = { ...hit };
        delete projectedHit.snippet;
        return projectedHit;
    });
    return { ...payload, search: { ...search, hits } };
}

export function knowledgeGroundingForModel(grounding: string): { grounding: string; sourceGuide: string } {
    const registry = buildKnowledgeSourceRegistry(grounding);
    const payload = parseJsonRecord(grounding);
    const byResource = new Map(registry.map((source) => [source.resource, source] as const));
    let projectionPayload = payload;
    if (payload) {
        // Never trust or forward a caller-provided catalogFacts field. Rebuild
        // this compact, high-priority projection solely from verified
        // search.tableSummaries record counts and current-turn K handles.
        projectionPayload = { ...payload };
        delete projectionPayload.catalogFacts;
        const catalogFacts = catalogFactsForModel(payload, byResource);
        if (catalogFacts.length > 0) projectionPayload.catalogFacts = catalogFacts;
    }
    const safePayload = projectionPayload ? safeGroundingPayload(projectionPayload, byResource) : grounding;
    const compactPayload = withoutCoveredProjectedSearchSnippets(safePayload);
    const sourceGuide = registry.length
        ? [
              "Verified citation protocol (fail-closed):",
              "- Cite a source only as [[K#]] or [[K#:exact-locator]].",
              "- Repeat the complete bracketed handle for every citation; never write a bare K# alias in prose.",
              "- Copy an exact locator from the verified grounding; never invent a locator or emit an asset URI.",
              "- Use [[K#]] without a locator only for a source-level claim backed by a full read or a verified catalog/structured source result; search snippets require an exact locator.",
              ...verifiedSourceGuide(registry),
          ].join("\n")
        : "(no verified source handles)";
    return {
        grounding:
            typeof compactPayload === "string"
                ? stripPrivateKnowledgeReferenceFragments(compactPayload)
                : (JSON.stringify(compactPayload ?? {}) ?? "{}"),
        sourceGuide,
    };
}

function publicSource(source: RegistrySource, locators: KnowledgeSourceLocator[]): KnowledgeSourceReference {
    return {
        protocolVersion: 1,
        ref: source.ref,
        assetId: source.assetId,
        relativePath: source.relativePath,
        title: source.title,
        resource: source.resource,
        evidence: source.evidence,
        locators,
    };
}

function parsedLocatorValues(value: string | undefined): { values: string[]; discarded: boolean } {
    if (!value) return { values: [], discarded: false };
    const rawItems = value.split(/[|、,，;；]/u);
    const items = rawItems.map((item) => item.trim()).filter((item) => item.length > 0);
    const boundedItems = items.filter((item) => item.length <= 160);
    const uniqueValues = Array.from(new Set(boundedItems));
    const normalizedValues = new Set(boundedItems.map((item) => normalizedLocatorValue(item)));
    return {
        values: uniqueValues.slice(0, 32),
        discarded:
            items.length !== rawItems.length ||
            boundedItems.length !== items.length ||
            items.length > 32 ||
            uniqueValues.length > 32 ||
            normalizedValues.size !== boundedItems.length,
    };
}

function normalizedLocatorValue(value: string): string {
    return value.normalize("NFKC").trim().toLowerCase();
}

function markdownHeadingSupportsLocator(content: string, locator: string): boolean {
    const target = normalizedLocatorValue(locator);
    const lines = content.normalize("NFKC").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const atxHeading = line.match(/^\s{0,3}#{1,6}(?:[ \t]+|$)(.*?)(?:[ \t]+#+)?[ \t]*$/u)?.[1];
        if (atxHeading !== undefined && normalizedLocatorValue(atxHeading) === target) return true;

        // Preserve ordinary Markdown Setext headings without treating their
        // surrounding prose as valid locators.
        const underline = lines[index + 1] ?? "";
        if (/^\s{0,3}(?:=+|-+)\s*$/u.test(underline) && normalizedLocatorValue(line) === target) return true;
    }
    return false;
}

function isStableInBodyLocator(value: string): boolean {
    if (value.length < 3 || value.length > 160) return false;
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._:/#-]*$/u.test(value)) return false;
    // A structural separator or a mixed letter/number token distinguishes a
    // stable ID/section key from an arbitrary prose word or short number.
    return /[._:/#-]/u.test(value) || (/\p{L}/u.test(value) && /\p{N}/u.test(value));
}

function searchableContentSupportsStableLocator(content: string, locator: string): boolean {
    const normalizedLocator = locator.normalize("NFKC").trim();
    if (!isStableInBodyLocator(normalizedLocator)) return false;
    const tokens = content.normalize("NFKC").match(/[\p{L}\p{N}._:/#-]+/gu) ?? [];
    const target = normalizedLocator.toLowerCase();
    return tokens.some((token) => token.toLowerCase() === target);
}

function validLocator(source: RegistrySource, value: string): boolean {
    // A catalog source is file-level evidence only. Even if an upstream object
    // unexpectedly carries identifier-shaped metadata, it can never verify a
    // row or section locator without a search snippet or read body.
    if (source.evidence === "catalog") return false;
    const normalized = normalizedLocatorValue(value);
    if (Array.from(source.allowedLocators).some((item) => normalizedLocatorValue(item) === normalized)) return true;
    // A Markdown read can carry a chunk locator (for example source:...#1)
    // while exposing additional stable section IDs in the same verified body.
    // Do not let the chunk locator suppress those exact in-body citations.
    // CSV reads already enumerate their first-column record IDs, so keep their
    // stricter exact-ID check to avoid accepting an ID mentioned in another cell.
    if (source.relativePath.toLowerCase().endsWith(".csv")) return false;
    return (
        markdownHeadingSupportsLocator(source.searchableContent, value) ||
        searchableContentSupportsStableLocator(source.searchableContent, value)
    );
}

/**
 * Expand one bounded terminal-prefix shorthand only inside exact row IDs from
 * a CSV read performed in this turn. The pattern itself never becomes trusted
 * evidence: callers receive the finite allowlisted IDs or no expansion.
 */
function expandVerifiedCsvReadLocatorPattern(source: RegistrySource, value: string): string[] | null {
    if (source.evidence !== "read" || !source.relativePath.toLowerCase().endsWith(".csv")) return null;
    const normalized = normalizedLocatorValue(value);
    if (normalized.length > 160 || /asset:\/{1,2}/iu.test(normalized)) return null;
    const pattern = normalized.match(/^([\p{L}\p{N}][\p{L}\p{N}._:/#-]{2,})\*$/u);
    const prefix = pattern?.[1];
    if (!prefix || prefix.length < MIN_LOCATOR_PATTERN_PREFIX_LENGTH) return null;

    const matches = new Map<string, string>();
    for (const locator of source.readAllowedLocators) {
        const normalizedLocator = normalizedLocatorValue(locator);
        if (
            normalizedLocator.length === 0 ||
            normalizedLocator.length > 160 ||
            normalizedLocator.includes("*") ||
            /asset:\/{1,2}/iu.test(normalizedLocator) ||
            /[\u0000-\u001f\u007f]/u.test(locator) ||
            !normalizedLocator.startsWith(prefix)
        ) {
            continue;
        }
        matches.set(normalizedLocator, locator);
        if (matches.size > MAX_EXPANDED_LOCATOR_PATTERN_MATCHES) return null;
    }
    return matches.size > 0 ? Array.from(matches.values()) : null;
}

function resolveLocatorValues(source: RegistrySource, values: string[]): { valid: string[]; invalid: string[] } {
    const resolved = new Map<string, string>();
    const invalid: string[] = [];
    for (const value of values) {
        if (!value.includes("*")) {
            if (validLocator(source, value)) resolved.set(normalizedLocatorValue(value), value);
            else invalid.push(value);
            continue;
        }
        const expanded = expandVerifiedCsvReadLocatorPattern(source, value);
        if (!expanded) {
            invalid.push(value);
            continue;
        }
        const additions = expanded.filter((locator) => !resolved.has(normalizedLocatorValue(locator)));
        if (resolved.size + additions.length > MAX_EXPANDED_LOCATOR_PATTERN_MATCHES) {
            invalid.push(value);
            continue;
        }
        for (const locator of additions) resolved.set(normalizedLocatorValue(locator), locator);
    }
    return { valid: Array.from(resolved.values()), invalid };
}

function resolveLocatorValuesPreservingMultiplicity(
    source: RegistrySource,
    values: string[],
): { valid: string[]; invalid: string[] } {
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const value of values) {
        if (!value.includes("*")) {
            if (validLocator(source, value)) valid.push(value);
            else invalid.push(value);
            continue;
        }
        const expanded = expandVerifiedCsvReadLocatorPattern(source, value);
        if (expanded) valid.push(...expanded);
        else invalid.push(value);
    }
    return { valid, invalid };
}

/**
 * Whether one exact locator is supported by current-turn verified grounding.
 * CSV values remain restricted to first-column locators collected from the
 * read body; a value appearing only in another cell can never satisfy this
 * helper. Markdown/text sources may additionally support an exact in-body
 * section identifier, matching the citation finalizer's established policy.
 */
export function knowledgeGroundingSupportsLocator(grounding: string | undefined, locator: string): boolean {
    const normalized = locator.normalize("NFKC").trim();
    if (!normalized || normalized.length > 160 || /asset:\/{1,2}/iu.test(normalized)) return false;
    return buildKnowledgeSourceRegistry(grounding).some((source) => validLocator(source, normalized));
}

function canonicalDisplayFilename(value: string): string {
    return value
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/^(?:(?:来源|文件|source|file)\s*[：:]\s*)+/iu, "")
        .replace(/\s*(?:摘录|excerpt)\s*$/iu, "")
        .replace(/[\s_-]+/gu, "_");
}

function uniqueVerifiedSourcesByName(
    registry: RegistrySource[],
    includeCatalog = false,
): Map<string, RegistrySource | null> {
    const byName = new Map<string, RegistrySource | null>();
    for (const source of registry) {
        // A valid tableSummary recordCount is verified file-level evidence even
        // in a mixed read + catalog turn. Other catalog-only resources remain
        // restricted to an explicit catalog-only inventory response.
        if (source.evidence === "catalog" && !includeCatalog && source.catalogRecordCount === undefined) continue;
        const names = new Set([
            source.title,
            source.relativePath,
            source.relativePath.split("/").at(-1) ?? source.relativePath,
        ]);
        for (const name of names) {
            const key = name.trim().toLowerCase();
            if (!key) continue;
            const current = byName.get(key);
            if (current && current.resource !== source.resource) byName.set(key, null);
            else if (current === undefined) byName.set(key, source);
        }
    }
    return byName;
}

function uniqueVerifiedSourcesByCanonicalName(
    registry: RegistrySource[],
    includeCatalog = false,
): Map<string, RegistrySource | null> {
    const byName = new Map<string, RegistrySource | null>();
    for (const source of registry) {
        if (source.evidence === "catalog" && !includeCatalog && source.catalogRecordCount === undefined) continue;
        const names = new Set([
            source.title,
            source.relativePath,
            source.relativePath.split("/").at(-1) ?? source.relativePath,
        ]);
        for (const name of names) {
            const key = canonicalDisplayFilename(name);
            if (!key) continue;
            const current = byName.get(key);
            if (current && current.resource !== source.resource) byName.set(key, null);
            else if (current === undefined) byName.set(key, source);
        }
    }
    return byName;
}

function isCatalogOnlyInventoryGrounding(grounding: string | undefined): boolean {
    const payload = grounding ? parseJsonRecord(grounding) : null;
    if (!payload || (Array.isArray(payload.reads) && payload.reads.length > 0)) return false;
    const search =
        payload.search && typeof payload.search === "object" && !Array.isArray(payload.search)
            ? (payload.search as Record<string, unknown>)
            : null;
    return (
        Boolean(search) &&
        (!Array.isArray(search?.hits) || search.hits.length === 0) &&
        Array.isArray(search?.tableSummaries) &&
        search.tableSummaries.length > 0
    );
}

function escapedPattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flexibleFilenamePattern(value: string): string {
    return value
        .split(/[\s_-]+/gu)
        .map(escapedPattern)
        .join("[\\s_-]+");
}

/**
 * Strip only bounded, correctly paired natural-language containers around
 * invocation-owned citation tokens. The opaque tokens themselves are retained
 * for the later transactional restoration pass. Mismatched or overlong input is
 * left untouched, so it cannot consume an unrelated citation or answer text.
 */
function retainProtectedReferencesFromBoundedContainers(value: string): string {
    const closingByOpening = new Map([
        ["[", "]"],
        ["［", "］"],
        ["【", "】"],
        ["(", ")"],
        ["（", "）"],
    ]);
    const openingByClosing = new Map(Array.from(closingByOpening, ([opening, closing]) => [closing, opening]));
    const stack: Array<{ opening: string; start: number }> = [];
    const outermostSpans: Array<{ start: number; end: number }> = [];
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index] ?? "";
        if (closingByOpening.has(character)) {
            stack.push({ opening: character, start: index });
            continue;
        }
        const expectedOpening = openingByClosing.get(character);
        if (!expectedOpening) continue;
        const current = stack.at(-1);
        if (!current || current.opening !== expectedOpening) {
            // Do not let one malformed delimiter bridge otherwise unrelated
            // answer text. Any protected token remains available for restoration.
            stack.length = 0;
            continue;
        }
        stack.pop();
        const end = index + 1;
        if (end - current.start > 2_048) continue;
        const candidate = value.slice(current.start, end);
        const unprotected = candidate.replace(PROTECTED_KNOWLEDGE_REFERENCE, "");
        if (
            /\uE000KREF\d+\uE001/u.test(candidate) &&
            !RAW_SOURCE_HANDLE_SIGNAL.test(unprotected) &&
            !unprotected.includes("[来源引用未验证]") &&
            !/asset:\/{1,2}/iu.test(unprotected)
        ) {
            let retainedEnd = end;
            if (stack.length === 0) {
                const redundantCloser = closingByOpening.get(current.opening);
                if (redundantCloser) {
                    let cursor = end;
                    while (cursor - end < 32 && value[cursor] === redundantCloser) cursor += 1;
                    if (value[cursor] !== redundantCloser) retainedEnd = cursor;
                }
            }
            while (outermostSpans.length > 0) {
                const previous = outermostSpans.at(-1);
                if (!previous || previous.end <= current.start) break;
                if (current.start <= previous.start && retainedEnd >= previous.end) {
                    outermostSpans.pop();
                    continue;
                }
                break;
            }
            outermostSpans.push({ start: current.start, end: retainedEnd });
        }
    }
    if (outermostSpans.length === 0) return value;

    const segments: string[] = [];
    let copiedUntil = 0;
    for (const span of outermostSpans) {
        const tokens = value.slice(span.start, span.end).match(PROTECTED_KNOWLEDGE_REFERENCE) ?? [];
        segments.push(value.slice(copiedUntil, span.start), Array.from(new Set(tokens)).join(" "));
        copiedUntil = span.end;
    }
    segments.push(value.slice(copiedUntil));
    return segments.join("");
}

const NATURAL_SOURCE_DISPLAY_LABEL =
    /^(?:data\s+sources?|sources?|references?|citations?|source\s+references?|\u6765\u6e90|\u5f15\u7528|\u53c2\u8003\u6765\u6e90|\u8d44\u6599\u6765\u6e90|\u6570\u636e\u6765\u6e90)\s*[：:]/iu;
const MAX_NATURAL_SOURCE_DISPLAY_LENGTH = 2_048;
const MAX_REJECTED_SOURCE_DISPLAY_DIAGNOSTIC_LENGTH = 512;
const SINGLE_WORD_NATURAL_SOURCE_DISPLAY_LABELS = new Set([
    "source",
    "sources",
    "reference",
    "references",
    "citation",
    "citations",
    "来源",
    "引用",
    "参考来源",
    "资料来源",
    "数据来源",
]);
const NATURAL_SOURCE_DISPLAY_FILENAME =
    /[\p{L}\p{N}][\p{L}\p{N}\p{M} _/-]{0,159}\.[\p{L}\p{N}]{1,10}(?=$|[\s,，;；、:：#)）])/u;
const NATURAL_SOURCE_DISPLAY_CHARACTERS = /^[\p{L}\p{N}\p{M}\p{Zs}\t._\-/:#,+，;；、|()（）*]+$/u;

function naturalSourceDisplay(
    candidate: string,
): { body: string; allowLocatorFreeProjection: boolean; rejectOnMismatch: boolean } | null {
    if (candidate.length < 3) return null;
    const bodyWithLabel = candidate.slice(1, -1).normalize("NFKC").trim();
    const label = bodyWithLabel.match(NATURAL_SOURCE_DISPLAY_LABEL)?.[0];
    if (label) {
        return {
            body: bodyWithLabel.slice(label.length).trim(),
            allowLocatorFreeProjection: true,
            rejectOnMismatch: true,
        };
    }
    // A provider can repeat the public citation rendered in an earlier turn
    // immediately beside the current invocation's opaque handles. Recognize
    // only the same bounded citation-only grammar used below; authority still
    // comes exclusively from the adjacent protected receipts.
    return isCitationOnlyNaturalSourceDisplay(bodyWithLabel)
        ? { body: bodyWithLabel, allowLocatorFreeProjection: false, rejectOnMismatch: false }
        : null;
}

function naturalSourceDisplayLabelWord(
    value: string,
    start: number,
    end: number,
): { word: string; end: number } | null {
    let cursor = start;
    while (cursor < end && (value[cursor] ?? "").trim().length > 0) {
        if (cursor - start >= 32) return null;
        const character = (value[cursor] ?? "").normalize("NFKC");
        if (character === ":") break;
        cursor += 1;
    }
    if (cursor === start) return null;
    return {
        word: value.slice(start, cursor).normalize("NFKC").toLowerCase(),
        end: cursor,
    };
}

function hasNaturalSourceDisplayLabel(
    value: string,
    contentStart: number,
    end: number,
    nextNonWhitespace: Int32Array,
): boolean {
    const contentEnd = end - 1;
    if (contentStart >= contentEnd) return false;
    const first = naturalSourceDisplayLabelWord(value, contentStart, contentEnd);
    if (!first) return false;
    const hasColonAfter = (start: number): boolean => {
        const colon = nextNonWhitespace[start] ?? value.length;
        return colon < contentEnd && (value[colon] ?? "").normalize("NFKC") === ":";
    };

    if (first.word === "data" || first.word === "source") {
        const secondStart = nextNonWhitespace[first.end] ?? value.length;
        if (secondStart > first.end && secondStart < contentEnd) {
            const second = naturalSourceDisplayLabelWord(value, secondStart, contentEnd);
            const acceptsSecond =
                first.word === "data"
                    ? second?.word === "source" || second?.word === "sources"
                    : second?.word === "reference" || second?.word === "references";
            if (second && acceptsSecond && hasColonAfter(second.end)) return true;
        }
        if (first.word === "data") return false;
    }
    return SINGLE_WORD_NATURAL_SOURCE_DISPLAY_LABELS.has(first.word) && hasColonAfter(first.end);
}

/**
 * This deliberately recognizes only source-list display metadata, never prose.
 * The wrapper is untrusted and cannot resolve a source: a current-invocation
 * protected handle immediately beside it remains the sole source of authority.
 */
function isCitationOnlyNaturalSourceDisplay(body: string): boolean {
    if (!body || /[\r\n\u0000-\u001f\u007f]/u.test(body)) return false;
    if (/asset:\/{1,2}|(?:https?|file):\/\//iu.test(body)) return false;
    if (/[`"'<>={}!?！？。]/u.test(body) || /\.(?:\s|$)/u.test(body)) return false;
    return NATURAL_SOURCE_DISPLAY_FILENAME.test(body) && NATURAL_SOURCE_DISPLAY_CHARACTERS.test(body);
}

const NATURAL_SOURCE_DISPLAY_ITEM_SEPARATOR = /[;；]/u;
const NATURAL_SOURCE_DISPLAY_LOCATOR_SEPARATOR = /[|、,，]/u;
const NATURAL_SOURCE_DISPLAY_LOCATOR_LABEL =
    /^(?:(?:records?\s*)?IDs?|record\s*IDs?|locators?|sections?|chunks?|记录\s*IDs?|记录编号|记录号|定位符?|章节|片段|块)(?=\s|[：:])\s*[：:]?\s*/iu;
const PROTECTED_KNOWLEDGE_REFERENCE_INDEX = /\uE000KREF(\d+)\uE001/gu;

function normalizedNaturalDisplayLocator(value: string): string | null {
    const normalized = value.normalize("NFKC").trim().toLowerCase();
    if (
        !normalized ||
        normalized.length > 160 ||
        /[\r\n\u0000-\u001f\u007f]/u.test(normalized) ||
        /asset:\/{1,2}|(?:https?|file):\/\//iu.test(normalized)
    ) {
        return null;
    }
    return normalized;
}

function naturalDisplaySourceMatch(
    item: string,
    knownSources: readonly RegistrySource[],
): { source: RegistrySource; suffix: string } | null {
    const matches = new Map<string, { source: RegistrySource; suffix: string; aliasLength: number }>();
    for (const source of knownSources) {
        for (const alias of new Set([
            source.title,
            source.relativePath,
            source.relativePath.split("/").at(-1) ?? source.relativePath,
        ])) {
            const match = item.match(
                new RegExp(`^${flexibleFilenamePattern(alias)}(?=$|[\\s,，:：#+|、()（）])`, "iu"),
            );
            if (!match) continue;
            const existing = matches.get(source.resource);
            if (!existing || match[0].length > existing.aliasLength) {
                matches.set(source.resource, {
                    source,
                    suffix: item.slice(match[0].length),
                    aliasLength: match[0].length,
                });
            }
        }
    }
    if (matches.size !== 1) return null;
    const [{ source, suffix }] = matches.values();
    return { source, suffix };
}

function sourceDisplayAtom(source: RegistrySource, locator: string | null): string {
    // Grouping is presentation-only: one item with three locators and three
    // one-locator receipts describe the same three atoms. Null is an explicit
    // file-level sentinel, so it can never alias a located claim.
    return JSON.stringify([source.resource, locator]);
}

function naturalDisplayItemAtoms(
    rawItem: string,
    knownSources: readonly RegistrySource[],
): { sourceResource: string; locatorFree: boolean; atoms: string[] } | null {
    const item = rawItem.normalize("NFKC").trim();
    if (!item) return null;
    const sourceMatch = naturalDisplaySourceMatch(item, knownSources);
    if (!sourceMatch) return null;

    let suffix = sourceMatch.suffix.trim();
    const hadSuffix = suffix.length > 0;
    if ((suffix.startsWith("(") && suffix.endsWith(")")) || (suffix.startsWith("（") && suffix.endsWith("）"))) {
        suffix = suffix.slice(1, -1).trim();
    } else if (/[()（）]/u.test(suffix)) {
        return null;
    }
    suffix = suffix
        .replace(/^[,，:：#+|、]+\s*/u, "")
        .replace(NATURAL_SOURCE_DISPLAY_LOCATOR_LABEL, "")
        .trim();
    if (hadSuffix && !suffix) return null;

    const locators: string[] = [];
    if (suffix) {
        const values = suffix.split(NATURAL_SOURCE_DISPLAY_LOCATOR_SEPARATOR);
        if (values.length > 32) return null;
        for (const value of values) {
            const normalized = normalizedNaturalDisplayLocator(value);
            if (!normalized) return null;
            locators.push(normalized);
        }
    }
    return {
        sourceResource: sourceMatch.source.resource,
        locatorFree: locators.length === 0,
        atoms:
            locators.length > 0
                ? locators.map((locator) => sourceDisplayAtom(sourceMatch.source, locator))
                : [sourceDisplayAtom(sourceMatch.source, null)],
    };
}

function protectedReceiptAtoms(receipt: ProtectedKnowledgeCitationReceipt): string[] {
    return receipt.locators.length > 0
        ? receipt.locators.map((locator) => sourceDisplayAtom(receipt.source, normalizedLocatorValue(locator.value)))
        : [sourceDisplayAtom(receipt.source, null)];
}

function multiset(values: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
}

function equalMultisets(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const leftCounts = multiset(left);
    const rightCounts = multiset(right);
    if (leftCounts.size !== rightCounts.size) return false;
    return Array.from(leftCounts).every(([key, count]) => rightCounts.get(key) === count);
}

function protectedReceiptsForTokenRuns(
    tokenRuns: readonly string[],
    receipts: readonly ProtectedKnowledgeCitationReceipt[],
): ProtectedKnowledgeCitationReceipt[] | null {
    const selected: ProtectedKnowledgeCitationReceipt[] = [];
    for (const tokenRun of tokenRuns) {
        for (const match of tokenRun.matchAll(PROTECTED_KNOWLEDGE_REFERENCE_INDEX)) {
            const receipt = receipts[Number(match[1])];
            if (!receipt) return null;
            selected.push(receipt);
        }
    }
    return selected.length > 0 ? selected : null;
}

/**
 * A protected receipt can itself appear inside an arbitrarily long Markdown
 * label. Neutralize only the active outer ASCII delimiters before restoring
 * the receipt, so trusted source text cannot inherit a model-authored target.
 * The scan is linear; projected shortcut labels are computed only for spans
 * within Markdown's bounded reference-label size.
 */
function neutralizeMarkdownLabelsContainingProtectedReferences(
    value: string,
    receipts: readonly ProtectedKnowledgeCitationReceipt[],
): string {
    const tokens = Array.from(value.matchAll(PROTECTED_KNOWLEDGE_REFERENCE_INDEX), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
        citation: receipts[Number(match[1])]?.citation ?? "",
    }));
    if (tokens.length === 0) return value;

    const tokenStarts = new Uint32Array(value.length + 1);
    for (const token of tokens) tokenStarts[token.start] += 1;
    for (let index = 0; index < value.length; index += 1) {
        tokenStarts[index + 1] = (tokenStarts[index + 1] ?? 0) + (tokenStarts[index] ?? 0);
    }
    const firstTokenIndexAtOrAfter = new Uint32Array(value.length + 1);
    let firstTokenIndex = tokens.length;
    for (let index = value.length; index >= 0; index -= 1) {
        while (firstTokenIndex > 0 && (tokens[firstTokenIndex - 1]?.start ?? -1) >= index) {
            firstTokenIndex -= 1;
        }
        firstTokenIndexAtOrAfter[index] = firstTokenIndex;
    }
    const projectedLabel = (start: number, end: number): string => {
        const segments: string[] = [];
        let copiedUntil = start + 1;
        for (let index = firstTokenIndexAtOrAfter[copiedUntil] ?? tokens.length; index < tokens.length; index += 1) {
            const token = tokens[index];
            if (!token || token.start >= end - 1) break;
            segments.push(value.slice(copiedUntil, token.start), token.citation);
            copiedUntil = token.end;
        }
        segments.push(value.slice(copiedUntil, end - 1));
        return segments.join("");
    };

    const context = markdownLinkContext(value);
    const stack: number[] = [];
    const neutralized = new Map<number, string>();
    for (let index = 0; index < value.length; index += 1) {
        if (
            value[index] === "[" &&
            context.escapedByBackslash[index] === 0 &&
            context.insideCodeSpan[index] === 0 &&
            context.insideHtmlInline[index] === 0
        ) {
            stack.push(index);
            continue;
        }
        if (
            value[index] !== "]" ||
            context.escapedByBackslash[index] !== 0 ||
            context.insideCodeSpan[index] !== 0 ||
            context.insideHtmlInline[index] !== 0
        ) {
            continue;
        }
        const start = stack.pop();
        if (start === undefined || (tokenStarts[index] ?? 0) === (tokenStarts[start + 1] ?? 0)) continue;
        const end = index + 1;
        const labels = end - start <= 1_002 ? [projectedLabel(start, end)] : [];
        if (!hasMarkdownLinkLabelContext(value, end, labels, context)) continue;
        neutralized.set(start, "［");
        neutralized.set(index, "］");
    }
    if (neutralized.size === 0) return value;

    const segments: string[] = [];
    let copiedUntil = 0;
    for (let index = 0; index < value.length; index += 1) {
        const replacement = neutralized.get(index);
        if (!replacement) continue;
        segments.push(value.slice(copiedUntil, index), replacement);
        copiedUntil = index + 1;
    }
    segments.push(value.slice(copiedUntil));
    return segments.join("");
}

function naturalSourceDisplayMatchesProtectedReceipts(
    body: string,
    receipts: readonly ProtectedKnowledgeCitationReceipt[],
    knownSources: readonly RegistrySource[],
    allowLocatorFreeProjection = true,
): boolean {
    if (!isCitationOnlyNaturalSourceDisplay(body)) return false;
    const rawItems = body.split(NATURAL_SOURCE_DISPLAY_ITEM_SEPARATOR);
    const displayItems: Array<{ sourceResource: string; locatorFree: boolean; atoms: string[] }> = [];
    const displayAtoms: string[] = [];
    for (const item of rawItems) {
        const parsed = naturalDisplayItemAtoms(item, knownSources);
        if (!parsed) return false;
        displayItems.push(parsed);
        displayAtoms.push(...parsed.atoms);
    }
    const receiptAtoms = receipts.flatMap(protectedReceiptAtoms);
    if (equalMultisets(displayAtoms, receiptAtoms)) return true;
    // The established labelled `Sources:` projection may use one filename as
    // presentation shorthand for located receipts of that exact source. An
    // unlabelled historical citation gets no such privilege: it must name the
    // exact source+locator multiset or remain fail-closed.
    if (!allowLocatorFreeProjection) return false;

    const displayItemsBySource = new Map<string, typeof displayItems>();
    for (const item of displayItems) {
        const group = displayItemsBySource.get(item.sourceResource) ?? [];
        group.push(item);
        displayItemsBySource.set(item.sourceResource, group);
    }
    const receiptAtomsBySource = new Map<string, string[]>();
    const receiptHasFileLevelBySource = new Map<string, boolean>();
    for (const receipt of receipts) {
        const group = receiptAtomsBySource.get(receipt.source.resource) ?? [];
        group.push(...protectedReceiptAtoms(receipt));
        receiptAtomsBySource.set(receipt.source.resource, group);
        if (receipt.locators.length === 0) receiptHasFileLevelBySource.set(receipt.source.resource, true);
    }
    if (
        displayItemsBySource.size !== receiptAtomsBySource.size ||
        Array.from(displayItemsBySource.keys()).some((resource) => !receiptAtomsBySource.has(resource))
    ) {
        return false;
    }
    for (const [resource, items] of displayItemsBySource) {
        const expectedAtoms = receiptAtomsBySource.get(resource);
        if (!expectedAtoms) return false;
        const locatorFreeItems = items.filter((item) => item.locatorFree);
        if (locatorFreeItems.length > 0) {
            // A single redundant file label may defer only to one or more
            // located receipts for that exact, uniquely resolved source. It
            // cannot erase an explicit display locator, hide another source,
            // or collapse duplicate/mixed display items.
            if (
                items.length !== 1 ||
                locatorFreeItems.length !== 1 ||
                receiptHasFileLevelBySource.get(resource) === true
            ) {
                return false;
            }
            continue;
        }
        if (
            !equalMultisets(
                items.flatMap((item) => item.atoms),
                expectedAtoms,
            )
        )
            return false;
    }
    return true;
}

function protectedReferenceEndAt(value: string, start: number): number | null {
    if (!value.startsWith(PROTECTED_KNOWLEDGE_REFERENCE_PREFIX, start)) return null;
    let cursor = start + PROTECTED_KNOWLEDGE_REFERENCE_PREFIX.length;
    const digitStart = cursor;
    while (cursor < value.length && /[0-9]/u.test(value[cursor] ?? "")) cursor += 1;
    if (cursor === digitStart || value[cursor] !== "\uE001") return null;
    return cursor + 1;
}

function protectedReferenceStartEndingAt(value: string, end: number): number | null {
    if (end <= 0 || value[end - 1] !== "\uE001") return null;
    let cursor = end - 2;
    const digitEnd = cursor;
    while (cursor >= 0 && /[0-9]/u.test(value[cursor] ?? "")) cursor -= 1;
    if (cursor === digitEnd) return null;
    const start = cursor - PROTECTED_KNOWLEDGE_REFERENCE_PREFIX.length + 1;
    return start >= 0 && value.startsWith(PROTECTED_KNOWLEDGE_REFERENCE_PREFIX, start) ? start : null;
}

function adjacentProtectedReferencesAfter(value: string, start: number): { gap: string; tokenRun: string } | null {
    let cursor = start;
    let gapLength = 0;
    while (gapLength < 32 && cursor < value.length && ADJACENT_SOURCE_DISPLAY_GAP_CHARACTERS.has(value[cursor] ?? "")) {
        cursor += 1;
        gapLength += 1;
    }
    const tokenRunStart = cursor;
    let tokenEnd = protectedReferenceEndAt(value, cursor);
    if (tokenEnd === null) return null;
    cursor = tokenEnd;

    while (cursor < value.length) {
        let nextTokenStart = cursor;
        let nextGapLength = 0;
        while (
            nextGapLength < 32 &&
            nextTokenStart < value.length &&
            ADJACENT_SOURCE_DISPLAY_GAP_CHARACTERS.has(value[nextTokenStart] ?? "")
        ) {
            nextTokenStart += 1;
            nextGapLength += 1;
        }
        tokenEnd = protectedReferenceEndAt(value, nextTokenStart);
        if (tokenEnd === null) break;
        cursor = tokenEnd;
    }
    return {
        gap: value.slice(start, tokenRunStart),
        tokenRun: value.slice(tokenRunStart, cursor),
    };
}

function adjacentProtectedReferencesBefore(value: string, end: number): { gap: string; tokenRun: string } | null {
    let cursor = end;
    let gapLength = 0;
    while (gapLength < 32 && cursor > 0 && ADJACENT_SOURCE_DISPLAY_GAP_CHARACTERS.has(value[cursor - 1] ?? "")) {
        cursor -= 1;
        gapLength += 1;
    }
    const tokenRunEnd = cursor;
    let tokenStart = protectedReferenceStartEndingAt(value, cursor);
    if (tokenStart === null) return null;
    cursor = tokenStart;

    while (cursor > 0) {
        let previousTokenEnd = cursor;
        let previousGapLength = 0;
        while (
            previousGapLength < 32 &&
            previousTokenEnd > 0 &&
            ADJACENT_SOURCE_DISPLAY_GAP_CHARACTERS.has(value[previousTokenEnd - 1] ?? "")
        ) {
            previousTokenEnd -= 1;
            previousGapLength += 1;
        }
        tokenStart = protectedReferenceStartEndingAt(value, previousTokenEnd);
        if (tokenStart === null) break;
        cursor = tokenStart;
    }
    return {
        gap: value.slice(tokenRunEnd, end),
        tokenRun: value.slice(cursor, tokenRunEnd),
    };
}

/**
 * Some providers emit a redundant natural source list or a public citation
 * copied from history as a sibling of the verified handles rather than as
 * their outer container:
 * `[Sources: a.csv, A-1; b.md, RULE-1][[K1:A-1]][[K2:RULE-1]]`.
 * `[a.csv, record ID: A-1][[K1:A-1]]`.
 *
 * Remove only a bounded, citation-only display wrapper that directly neighbours
 * an invocation-owned protected token. Invalid or overlong source-labelled
 * siblings are rejected instead of silently disappearing. Neither path uses the
 * display filename or locator to register a source card.
 */
function retainProtectedReferencesAdjacentToSourceDisplays(
    value: string,
    protectedReceipts: readonly ProtectedKnowledgeCitationReceipt[],
    knownSources: readonly RegistrySource[],
    rejectDisplay: (candidate: string) => string,
): string {
    const closingByOpening = new Map([
        ["[", "]"],
        ["［", "］"],
        ["【", "】"],
        ["(", ")"],
        ["（", "）"],
    ]);
    const openingByClosing = new Map(Array.from(closingByOpening, ([opening, closing]) => [closing, opening]));
    const stack: Array<{ opening: string; start: number }> = [];
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    const adjacentMarkdownContext = markdownLinkContext(value);
    const { nextNonWhitespace } = adjacentMarkdownContext;
    const firstNonWhitespaceAtOrAfter = (start: number): number => nextNonWhitespace[start] ?? value.length;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index] ?? "";
        if (closingByOpening.has(character)) {
            stack.push({ opening: character, start: index });
            continue;
        }
        const expectedOpening = openingByClosing.get(character);
        if (!expectedOpening) continue;
        const current = stack.at(-1);
        if (!current || current.opening !== expectedOpening) {
            stack.length = 0;
            continue;
        }
        stack.pop();
        const end = index + 1;
        const bounded = end - current.start <= MAX_NATURAL_SOURCE_DISPLAY_LENGTH;
        const candidate = value.slice(
            current.start,
            bounded ? end : Math.min(end, current.start + MAX_REJECTED_SOURCE_DISPLAY_DIAGNOSTIC_LENGTH),
        );
        let display: {
            body: string;
            allowLocatorFreeProjection: boolean;
            rejectOnMismatch: boolean;
        } | null;
        if (bounded) {
            display = naturalSourceDisplay(candidate);
        } else {
            const contentStart = firstNonWhitespaceAtOrAfter(current.start + 1);
            display = hasNaturalSourceDisplayLabel(value, contentStart, end, nextNonWhitespace)
                ? { body: "", allowLocatorFreeProjection: false, rejectOnMismatch: true }
                : null;
        }
        if (display === null) continue;

        const after = adjacentProtectedReferencesAfter(value, end);
        const before = adjacentProtectedReferencesBefore(value, current.start);
        if (!after && !before) continue;

        const tokenRuns = [before?.tokenRun, after?.tokenRun].filter((tokenRun): tokenRun is string =>
            Boolean(tokenRun),
        );
        const adjacentReceipts = protectedReceiptsForTokenRuns(tokenRuns, protectedReceipts);
        if (
            hasMarkdownLinkLabelContext(
                value,
                end,
                [display.body, ...(adjacentReceipts?.map((receipt) => publicCitationLabel(receipt.citation)) ?? [])],
                adjacentMarkdownContext,
            )
        ) {
            continue;
        }
        const equivalent =
            bounded &&
            adjacentReceipts !== null &&
            naturalSourceDisplayMatchesProtectedReceipts(
                display.body,
                adjacentReceipts,
                knownSources,
                display.allowLocatorFreeProjection,
            );
        if (!equivalent && !display.rejectOnMismatch) continue;
        const trailingGap = after?.gap ?? "";
        const leadingGap = before?.gap ?? "";
        const replacement = {
            start: current.start - leadingGap.length,
            end: end + trailingGap.length,
            replacement: equivalent ? "" : rejectDisplay(candidate),
        };
        while (replacements.length > 0) {
            const previous = replacements.at(-1);
            if (!previous || previous.end <= replacement.start) break;
            if (replacement.start <= previous.start && replacement.end >= previous.end) {
                replacements.pop();
                continue;
            }
            break;
        }
        replacements.push(replacement);
    }
    if (replacements.length === 0) return value;

    const segments: string[] = [];
    let copiedUntil = 0;
    for (const replacement of replacements) {
        segments.push(value.slice(copiedUntil, replacement.start), replacement.replacement);
        copiedUntil = replacement.end;
    }
    segments.push(value.slice(copiedUntil));
    return segments.join("");
}

function safeRejectedCitation(value: string): string {
    if (/asset:\/{1,2}/iu.test(value)) return "asset-reference";
    return stripPrivateKnowledgeReferenceFragments(value)
        .replace(/[\u0000-\u001f\u007f]/gu, " ")
        .trim()
        .slice(0, 240);
}

export function containsProtectedKnowledgeReference(value: unknown): boolean {
    return typeof value === "string" && containsPrivateKnowledgeReferenceDelimiter(value);
}

function knowledgeLocatorParsingView(
    value: string | undefined,
    stripRedundantProtectedOpening = false,
): string | undefined {
    const parsingValue = stripRedundantProtectedOpening
        ? value?.replace(REDUNDANT_OPENING_BEFORE_PROTECTED_REFERENCE, "")
        : value;
    return parsingValue?.replace(PROTECTED_KNOWLEDGE_REFERENCE, "");
}

function canDowngradeToReadFileCitation(source: RegistrySource, locators: string[]): boolean {
    if (source.evidence !== "read" || !/\.(?:md|markdown|txt)$/iu.test(source.relativePath) || locators.length === 0) {
        return false;
    }
    // Only a stale chunk locator that names this exact read file may degrade to
    // the already-verified file level. Arbitrary words, IDs, another file's
    // chunk, URI-shaped text, and controls remain explicit failures.
    const expectedPath = source.relativePath.normalize("NFKC").toLowerCase();
    return locators.every((locator) => {
        if (/asset:\/{1,2}/iu.test(locator) || /[\u0000-\u001f\u007f]/u.test(locator) || locator.length > 160) {
            return false;
        }
        const chunk = locator.normalize("NFKC").match(/^source:(.+)#\d+$/iu);
        return chunk?.[1]?.toLowerCase() === expectedPath;
    });
}

/** Finalize one answer without trusting any model-generated URI. */
export function finalizeKnowledgeAnswer(text: string, grounding: string | undefined): FinalizedKnowledgeAnswer {
    if (!text) return { text, sources: [], unverifiedCitationCount: 0, rejectedCitations: [] };
    const registry = buildKnowledgeSourceRegistry(grounding);
    if (registry.length === 0) {
        let unverifiedCitationCount = 0;
        const rejectedCitations: RejectedKnowledgeCitation[] = [];
        const reject = (rawCitation: string, reason: RejectedKnowledgeCitationReason) => {
            unverifiedCitationCount += 1;
            rejectedCitations.push({ citation: safeRejectedCitation(rawCitation), reason });
            return "[来源引用未验证]";
        };
        const rejectUnknownHandle = (rawCitation: string) => reject(rawCitation, "unknown_source_handle");
        const rejectMalformedHandle = (rawCitation: string) => reject(rawCitation, "malformed_handle");
        let sanitized = replacePrivateKnowledgeReferenceFragments(text, rejectMalformedHandle).replace(
            MODEL_AUTHORED_ASSET_MARKDOWN_LINK,
            (rawCitation) => reject(rawCitation, "unverified_resource"),
        );
        sanitized = normalizeRedundantFullwidthKnowledgeCitationWrappers(sanitized);
        sanitized = replaceCompoundSourceHandleArrays(
            sanitized,
            (_members, citation) => rejectUnknownHandle(citation),
            rejectMalformedHandle,
        );
        sanitized = sanitized
            .replace(MALFORMED_HANDLE_FILENAME_PAIR, rejectMalformedHandle)
            .replace(FULLWIDTH_FILENAME_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(DOUBLE_FILENAME_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(SINGLE_FILENAME_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(FULLWIDTH_LABELED_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(DOUBLE_CLOSING_LABELED_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(SINGLE_LABELED_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(HASH_SUFFIX_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(DOUBLE_CLOSING_HASH_SUFFIX_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(SINGLE_BRACKET_HASH_SUFFIX_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(MIXED_DOUBLE_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(FULLWIDTH_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(DOUBLE_CLOSING_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(SINGLE_BRACKET_SOURCE_HANDLE, rejectUnknownHandle)
            .replace(SOURCE_HANDLE, rejectUnknownHandle);
        const untrustedMarkdownContext = markdownLinkContext(sanitized);
        sanitized = sanitized
            .replace(
                EXACT_FILENAME_CITATION,
                (rawCitation, rawName: string, rawLocator: string | undefined, offset: number) =>
                    hasMarkdownLinkLabelContext(
                        sanitized,
                        offset + rawCitation.length,
                        [publicCitationLabel(rawCitation)],
                        untrustedMarkdownContext,
                    ) || !isExecutableExactFilenameCitation(rawCitation, rawName, rawLocator)
                        ? rawCitation
                        : reject(rawCitation, "unknown_or_ambiguous_filename"),
            )
            .replace(UNWRAPPED_NATURAL_FILENAME_CITATION, (rawCitation) =>
                reject(rawCitation, "unknown_or_ambiguous_filename"),
            )
            .replace(ASSET_TOKEN, (rawCitation) => {
                unverifiedCitationCount += 1;
                rejectedCitations.push({
                    citation: safeRejectedCitation(rawCitation),
                    reason: "unverified_resource",
                });
                return "";
            })
            .replace(RESIDUAL_SOURCE_HANDLE, rejectMalformedHandle);
        const privateSafeSanitized = replacePrivateKnowledgeReferenceFragments(sanitized, rejectMalformedHandle);
        return {
            text: privateSafeSanitized.replace(/[ \t]+([，。；：！？])/gu, "$1"),
            sources: [],
            unverifiedCitationCount,
            rejectedCitations,
        };
    }
    const byRef = new Map(registry.map((source) => [source.ref, source] as const));
    const byResource = new Map(registry.map((source) => [source.resource, source] as const));
    const catalogOnlyInventory = isCatalogOnlyInventoryGrounding(grounding);
    const verifiedSourceByName = uniqueVerifiedSourcesByName(registry, catalogOnlyInventory);
    const verifiedSourceByCanonicalName = uniqueVerifiedSourcesByCanonicalName(registry, catalogOnlyInventory);
    const used = new Map<string, KnowledgeSourceReference>();
    const usedSourceOrder = new Map<string, number>();
    const usedLocatorOrder = new Map<string, Map<string, { order: number; index: number }>>();
    let nextCitationOrder = 0;
    const reserveCitationOrder = (): number => {
        const order = nextCitationOrder;
        nextCitationOrder += 1;
        return order;
    };
    const protectedHandleCitations: Array<{
        citation: string;
        source: RegistrySource;
        locators: KnowledgeSourceLocator[];
        order: number;
    }> = [];
    let unverifiedCitationCount = 0;
    const rejectedCitations: RejectedKnowledgeCitation[] = [];
    const rejectCitation = ({
        citation,
        reason,
        locator,
        source,
    }: {
        citation: string;
        reason: RejectedKnowledgeCitationReason;
        locator?: string;
        source?: RegistrySource;
    }) => {
        unverifiedCitationCount += 1;
        const safeLocator = locator ? safeRejectedCitation(locator) : undefined;
        rejectedCitations.push({
            citation: safeRejectedCitation(citation),
            ...(safeLocator && safeLocator !== "asset-reference" ? { locator: safeLocator } : {}),
            ...(source ? { sourcePath: source.relativePath } : {}),
            reason,
        });
    };
    const use = (source: RegistrySource, locators: KnowledgeSourceLocator[] = [], order = reserveCitationOrder()) => {
        const current = used.get(source.resource);
        const currentSourceOrder = usedSourceOrder.get(source.resource);
        if (currentSourceOrder === undefined || order < currentSourceOrder) usedSourceOrder.set(source.resource, order);
        let locatorOrder = usedLocatorOrder.get(source.resource);
        if (!locatorOrder) {
            locatorOrder = new Map();
            usedLocatorOrder.set(source.resource, locatorOrder);
        }
        for (const [index, locator] of locators.entries()) {
            const key = `${locator.kind}:${locator.value}`;
            const previous = locatorOrder.get(key);
            if (!previous || order < previous.order || (order === previous.order && index < previous.index)) {
                locatorOrder.set(key, { order, index });
            }
        }
        const merged = new Map(
            [...(current?.locators ?? []), ...locators].map((locator) => [`${locator.kind}:${locator.value}`, locator]),
        );
        const orderedLocators = Array.from(merged.entries())
            .sort(([leftKey], [rightKey]) => {
                const left = locatorOrder?.get(leftKey) ?? { order: Number.MAX_SAFE_INTEGER, index: 0 };
                const right = locatorOrder?.get(rightKey) ?? { order: Number.MAX_SAFE_INTEGER, index: 0 };
                return left.order - right.order || left.index - right.index;
            })
            .map(([, locator]) => locator);
        used.set(source.resource, publicSource(source, orderedLocators));
    };
    const protectHandleCitation = (
        citation: string,
        source: RegistrySource,
        locators: KnowledgeSourceLocator[] = [],
        order = reserveCitationOrder(),
    ): string => {
        const index = protectedHandleCitations.push({ citation, source, locators, order }) - 1;
        return `\uE000KREF${index}\uE001`;
    };

    const resolveHandle = (rawIndex: string, rawLocator?: string, rawCitation = `K${rawIndex}`) => {
        const source = byRef.get(`K${Number(rawIndex)}`);
        if (!source) {
            rejectCitation({ citation: rawCitation, reason: "unknown_source_handle" });
            return "[来源引用未验证]";
        }
        const parsedLocators = parsedLocatorValues(rawLocator);
        const values = parsedLocators.values;
        if (rawLocator !== undefined && (parsedLocators.discarded || values.length === 0)) {
            rejectCitation({ citation: rawCitation, locator: rawLocator, reason: "unsupported_locator", source });
            return "[来源引用未验证]";
        }
        if (values.length === 0 && source.evidence === "search") {
            rejectCitation({ citation: rawCitation, reason: "locator_required", source });
            return "[来源引用未验证]";
        }
        const { valid, invalid } = resolveLocatorValues(source, values);
        if (invalid.length > 0 && canDowngradeToReadFileCitation(source, values)) {
            // The whole text file was read this turn, so the file remains valid
            // evidence even when a model copied a stale/unknown chunk locator.
            // Drop the locator rather than exposing it as verified.
            return protectHandleCitation(`[${source.title}]`, source);
        }
        const locators = valid.map((value) => ({
            kind: locatorKind(source.relativePath, value),
            value,
        }));
        for (const locator of invalid) {
            rejectCitation({ citation: rawCitation, locator, reason: "unsupported_locator", source });
        }
        if (valid.length === 0 && values.length > 0) {
            return "[来源引用未验证]";
        }
        if (valid.length === 0) return protectHandleCitation(`[${source.title}]`, source);
        const label = source.relativePath.toLowerCase().endsWith(".csv") ? "记录 ID" : "定位";
        return protectHandleCitation(`[${source.title}，${label}：${valid.join("、")}]`, source, locators);
    };
    const resolveHashSuffixHandle = (rawIndex: string, rawSuffix: string, rawCitation: string) => {
        const source = byRef.get(`K${Number(rawIndex)}`);
        if (!source) {
            rejectCitation({ citation: rawCitation, reason: "unknown_source_handle" });
            return "[来源引用未验证]";
        }
        const normalizedSuffix = rawSuffix.toLowerCase();
        const matches = new Map<string, string>();
        for (const locator of source.allowedLocators) {
            const normalizedLocator = locator.toLowerCase();
            if (normalizedLocator.endsWith(normalizedSuffix)) matches.set(normalizedLocator, locator);
        }
        if (matches.size !== 1) {
            rejectCitation({
                citation: rawCitation,
                locator: rawSuffix,
                reason: matches.size === 0 ? "unsupported_locator" : "ambiguous_locator_suffix",
                source,
            });
            return "[来源引用未验证]";
        }
        return resolveHandle(rawIndex, matches.values().next().value, rawCitation);
    };

    const resolveMalformedHandleFilenamePair = (rawIndex: string, rawName: string, rawCitation: string) => {
        const handleSource = byRef.get(`K${Number(rawIndex)}`);
        const exactNameMatch = verifiedSourceByName.get(rawName.trim().toLowerCase());
        const filenameSource =
            exactNameMatch !== undefined
                ? exactNameMatch
                : verifiedSourceByCanonicalName.get(canonicalDisplayFilename(rawName));
        if (!handleSource) {
            rejectCitation({ citation: rawCitation, reason: "unknown_source_handle" });
            return "[来源引用未验证]";
        }
        if (!filenameSource) {
            rejectCitation({ citation: rawCitation, reason: "unknown_or_ambiguous_filename" });
            return "[来源引用未验证]";
        }
        if (handleSource.resource !== filenameSource.resource) {
            rejectCitation({ citation: rawCitation, reason: "source_filename_conflict" });
            return "[来源引用未验证]";
        }
        return resolveHandle(rawIndex, undefined, rawCitation);
    };
    const resolveFilenameHandle = (rawName: string, rawIndex: string, rawCitation: string) => {
        const handleSource = byRef.get(`K${Number(rawIndex)}`);
        const exactNameMatch = verifiedSourceByName.get(rawName.trim().toLowerCase());
        const filenameSource =
            exactNameMatch !== undefined
                ? exactNameMatch
                : verifiedSourceByCanonicalName.get(canonicalDisplayFilename(rawName));
        if (!handleSource) {
            rejectCitation({ citation: rawCitation, reason: "unknown_source_handle" });
            return "[来源引用未验证]";
        }
        if (!filenameSource) {
            rejectCitation({ citation: rawCitation, reason: "unknown_or_ambiguous_filename" });
            return "[来源引用未验证]";
        }
        if (handleSource.resource !== filenameSource.resource) {
            rejectCitation({ citation: rawCitation, reason: "source_filename_conflict" });
            return "[来源引用未验证]";
        }
        return resolveHandle(rawIndex, undefined, rawCitation);
    };

    // Normalize model formatting variants for every provider. The human label is
    // never used to resolve a file; only the per-turn K handle and verified locator matter.
    let finalized = replacePrivateKnowledgeReferenceFragments(text, (citation) => {
        // The placeholder namespace belongs exclusively to this finalizer. A
        // model-authored token must be rejected before valid handles allocate
        // their own indices, otherwise an injected KREF0 could alias the first
        // verified citation during the restore pass below.
        rejectCitation({ citation, reason: "malformed_handle" });
        return "[来源引用未验证]";
    }).replace(MODEL_AUTHORED_ASSET_MARKDOWN_LINK, (citation) => {
        rejectCitation({ citation, reason: "unverified_resource" });
        return "[来源引用未验证]";
    });
    finalized = normalizeRedundantFullwidthKnowledgeCitationWrappers(finalized);
    finalized = replaceCompoundSourceHandleArrays(
        finalized,
        (members) => {
            const resolved = members.map((member) =>
                resolveHandle(member.rawIndex, member.rawLocator, member.citation),
            );
            return resolved.some((citation) => citation === "[来源引用未验证]")
                ? "[来源引用未验证]"
                : resolved.join(" ");
        },
        (citation) => {
            rejectCitation({ citation, reason: "malformed_handle" });
            return "[来源引用未验证]";
        },
    );
    finalized = replaceNestedSourceHandlesInBoundedContainers(finalized);
    finalized = finalized
        .replace(MALFORMED_HANDLE_FILENAME_PAIR, (match, rawIndex: string, rawName: string) =>
            resolveMalformedHandleFilenamePair(rawIndex, rawName, match),
        )
        .replace(EXTRA_OPENING_SOURCE_HANDLE, (match, rawIndex: string, rawLocator?: string) =>
            resolveHandle(rawIndex, rawLocator, match),
        )
        .replace(FULLWIDTH_FILENAME_SOURCE_HANDLE, (match, rawName: string, rawIndex: string) =>
            resolveFilenameHandle(rawName, rawIndex, match),
        )
        .replace(DOUBLE_FILENAME_SOURCE_HANDLE, (match, rawName: string, rawIndex: string) =>
            resolveFilenameHandle(rawName, rawIndex, match),
        )
        .replace(SINGLE_FILENAME_SOURCE_HANDLE, (match, rawName: string, rawIndex: string) =>
            resolveFilenameHandle(rawName, rawIndex, match),
        )
        .replace(FULLWIDTH_LABELED_SOURCE_HANDLE, (match, _label: string, rawLocator: string, rawIndex: string) =>
            resolveHandle(rawIndex, rawLocator, match),
        )
        .replace(DOUBLE_CLOSING_LABELED_SOURCE_HANDLE, (match, _label: string, rawLocator: string, rawIndex: string) =>
            resolveHandle(rawIndex, rawLocator, match),
        )
        .replace(SINGLE_LABELED_SOURCE_HANDLE, (match, _label: string, rawLocator: string, rawIndex: string) =>
            resolveHandle(rawIndex, rawLocator, match),
        )
        .replace(HASH_SUFFIX_SOURCE_HANDLE, (match, rawIndex: string, rawSuffix: string) =>
            resolveHashSuffixHandle(rawIndex, rawSuffix, match),
        )
        .replace(DOUBLE_CLOSING_HASH_SUFFIX_SOURCE_HANDLE, (match, rawIndex: string, rawSuffix: string) =>
            resolveHashSuffixHandle(rawIndex, rawSuffix, match),
        )
        .replace(SINGLE_BRACKET_HASH_SUFFIX_SOURCE_HANDLE, (match, rawIndex: string, rawSuffix: string) =>
            resolveHashSuffixHandle(rawIndex, rawSuffix, match),
        )
        .replace(
            MIXED_DOUBLE_SOURCE_HANDLE,
            (match, _opening: string, rawIndex: string, rawLocator: string | undefined) =>
                resolveHandle(rawIndex, rawLocator, match),
        )
        // Resolve non-ASCII and single-bracket variants before strict [[K...]]
        // handles so a nested ASCII-looking fragment cannot be consumed first.
        .replace(FULLWIDTH_SOURCE_HANDLE, (match, rawIndex: string, rawLocator?: string) =>
            resolveHandle(rawIndex, rawLocator, match),
        )
        .replace(DOUBLE_CLOSING_SOURCE_HANDLE, (match, rawIndex: string, rawLocator?: string) =>
            resolveHandle(rawIndex, rawLocator, match),
        )
        .replace(SINGLE_BRACKET_SOURCE_HANDLE, (match, rawIndex: string, rawLocator?: string) =>
            resolveHandle(rawIndex, rawLocator, match),
        )
        .replace(SOURCE_HANDLE, (match, rawIndex: string, rawLocator?: string) =>
            resolveHandle(rawIndex, rawLocator, match),
        );

    finalized = replaceRepeatedTopLevelBareSourceHandles(finalized, protectedHandleCitations, (rawIndex, citation) =>
        resolveHandle(rawIndex, undefined, citation),
    );

    // Some providers redundantly wrap one or more valid opaque handles in a
    // natural-language source container, for example
    // `[Source: a.csv, A-1[[K1:A-1]]; b.csv, B-1[[K2:B-1]]]`.
    // Treat every filename/locator outside the handles as an untrusted display
    // label and discard it. Only the already resolved, invocation-owned tokens
    // survive, so a wrong outer filename can never bless a source or locator.
    finalized = retainProtectedReferencesFromBoundedContainers(finalized);
    finalized = retainProtectedReferencesAdjacentToSourceDisplays(
        finalized,
        protectedHandleCitations,
        registry,
        (citation) => {
            rejectCitation({ citation, reason: "unknown_or_ambiguous_filename" });
            return "[来源引用未验证]";
        },
    );

    // A model may ignore the opaque K-handle syntax and emit a natural filename
    // citation. Recover common bracket/parenthesis and language variants only
    // when the filename is exact and unique in this turn. Any supplied locator
    // must still independently validate; a locator-free citation still requires
    // a full read. A Markdown link target is deliberately excluded so a model-
    // authored URI can never be used to resolve or bless a source.
    const exactMarkdownContext = markdownLinkContext(finalized);
    finalized = finalized.replace(
        EXACT_FILENAME_CITATION,
        (original, rawName: string, rawLocator: string | undefined, offset: number) => {
            if (!isExecutableExactFilenameCitation(original, rawName, rawLocator)) return original;
            const rawEmbeddedTokens = original.match(PROTECTED_KNOWLEDGE_REFERENCE) ?? [];
            const embeddedTokens = Array.from(new Set(rawEmbeddedTokens));
            const embeddedReceipt =
                rawEmbeddedTokens.length === 1
                    ? protectedReceiptsForTokenRuns(rawEmbeddedTokens, protectedHandleCitations)?.[0]
                    : undefined;
            const preserveEmbeddedTokens = (replacement: string): string =>
                embeddedTokens.length > 0 ? `${replacement}${embeddedTokens.join(" ")}` : replacement;
            if (
                hasMarkdownLinkLabelContext(
                    finalized,
                    offset + original.length,
                    [
                        publicCitationLabel(original.replace(PROTECTED_KNOWLEDGE_REFERENCE, "")),
                        ...(embeddedReceipt ? [publicCitationLabel(embeddedReceipt.citation)] : []),
                    ],
                    exactMarkdownContext,
                )
            ) {
                if (embeddedTokens.length === 0) return original;
                const unprotectedDisplay = original.replace(PROTECTED_KNOWLEDGE_REFERENCE, "").trim();
                return `${embeddedTokens.join(" ")}${unprotectedDisplay ? ` ${unprotectedDisplay}` : ""}`;
            }
            const source =
                verifiedSourceByName.get(rawName.trim().toLowerCase()) ??
                verifiedSourceByCanonicalName.get(canonicalDisplayFilename(rawName));
            if (!source) {
                rejectCitation({
                    citation: original,
                    reason: /asset:\/{1,2}/iu.test(original) ? "unverified_resource" : "unknown_or_ambiguous_filename",
                });
                return preserveEmbeddedTokens("[来源引用未验证]");
            }
            if (rawEmbeddedTokens.length > 0 && !embeddedReceipt) {
                rejectCitation({ citation: original, reason: "malformed_handle", source });
                return preserveEmbeddedTokens("[来源引用未验证]");
            }
            const locatorView = knowledgeLocatorParsingView(rawLocator, Boolean(embeddedReceipt));
            const parsedLocators = parsedLocatorValues(locatorView);
            const values = parsedLocators.values;
            if (parsedLocators.discarded) {
                rejectCitation({ citation: original, locator: rawLocator, reason: "unsupported_locator", source });
                return preserveEmbeddedTokens("[来源引用未验证]");
            }
            if (locatorView?.trim() && values.length === 0) {
                rejectCitation({ citation: original, locator: rawLocator, reason: "unsupported_locator", source });
                return preserveEmbeddedTokens("[来源引用未验证]");
            }
            const { valid, invalid } = embeddedReceipt
                ? resolveLocatorValuesPreservingMultiplicity(source, values)
                : resolveLocatorValues(source, values);
            if (invalid.length > 0) {
                if (embeddedReceipt) {
                    for (const locator of invalid) {
                        rejectCitation({ citation: original, locator, reason: "unsupported_locator", source });
                    }
                    return preserveEmbeddedTokens("[来源引用未验证]");
                }
                if (canDowngradeToReadFileCitation(source, values)) {
                    const publicCitation = `[${source.title}]`;
                    if (
                        hasMarkdownLinkLabelContext(
                            finalized,
                            offset + original.length,
                            [publicCitationLabel(publicCitation)],
                            exactMarkdownContext,
                        )
                    ) {
                        return original;
                    }
                    const order = reserveCitationOrder();
                    use(source, [], order);
                    return protectHandleCitation(publicCitation, source, [], order);
                }
                for (const locator of invalid) {
                    rejectCitation({ citation: original, locator, reason: "unsupported_locator", source });
                }
                return "[来源引用未验证]";
            }
            if (embeddedReceipt) {
                const displayAtoms =
                    valid.length > 0
                        ? valid.map((locator) => sourceDisplayAtom(source, normalizedLocatorValue(locator)))
                        : [sourceDisplayAtom(source, null)];
                if (!equalMultisets(displayAtoms, protectedReceiptAtoms(embeddedReceipt))) {
                    rejectCitation({
                        citation: original,
                        ...(valid.length > 0 ? { locator: valid[0] } : {}),
                        reason:
                            embeddedReceipt.source.resource === source.resource
                                ? "unsupported_locator"
                                : "source_filename_conflict",
                        source,
                    });
                    return preserveEmbeddedTokens("[来源引用未验证]");
                }
                return embeddedTokens[0] ?? "[来源引用未验证]";
            }
            if (
                values.length === 0 &&
                source.evidence !== "read" &&
                source.catalogRecordCount === undefined &&
                !(catalogOnlyInventory && source.evidence === "catalog")
            ) {
                rejectCitation({ citation: original, reason: "locator_required", source });
                return "[来源引用未验证]";
            }
            const locators = valid.map((value) => ({
                kind: locatorKind(source.relativePath, value),
                value,
            }));
            const label = source.relativePath.toLowerCase().endsWith(".csv") ? "记录 ID" : "定位";
            const publicCitation =
                valid.length === 0 ? `[${source.title}]` : `[${source.title}，${label}：${valid.join("、")}]`;
            if (
                hasMarkdownLinkLabelContext(
                    finalized,
                    offset + original.length,
                    [publicCitationLabel(publicCitation)],
                    exactMarkdownContext,
                )
            ) {
                return original;
            }
            const order = reserveCitationOrder();
            use(source, locators, order);
            return protectHandleCitation(publicCitation, source, locators, order);
        },
    );

    // Normalize unwrapped "exact filename + locator label" citations. Longer
    // names run first so one filename cannot be consumed as a suffix of
    // another. Invalid locators are replaced, rather than leaving a plausible-
    // looking but unsupported source claim in the answer.
    const exactReadNames = Array.from(verifiedSourceByName.entries())
        .filter((entry): entry is [string, RegistrySource] => Boolean(entry[1]))
        .sort((left, right) => right[0].length - left[0].length);
    for (const [name, source] of exactReadNames) {
        if (verifiedSourceByCanonicalName.get(canonicalDisplayFilename(name)) !== source) continue;
        const citation = new RegExp(
            `(?:文件\\s*[：:]\\s*)?${flexibleFilenamePattern(name)}\\s*(?:\\+|，|,)?\\s*[\\[［(（]?\\s*${NATURAL_LOCATOR_LABEL}\\s*[：:]\\s*([^\\n；;。)）\\]］]{1,240})[\\]］)）]?`,
            "giu",
        );
        const unwrappedInput = finalized;
        const unwrappedMarkdownContext = markdownLinkContext(unwrappedInput);
        finalized = unwrappedInput.replace(citation, (original, rawLocator: string, offset: number) => {
            if (
                hasMarkdownLinkLabelContext(
                    unwrappedInput,
                    offset + original.length,
                    [original.replace(/[\]］)）]$/u, "")],
                    unwrappedMarkdownContext,
                )
            ) {
                return original;
            }
            const locatorView = knowledgeLocatorParsingView(rawLocator);
            const parsedLocators = parsedLocatorValues(locatorView);
            const values = parsedLocators.values;
            if (parsedLocators.discarded) {
                rejectCitation({ citation: original, locator: rawLocator, reason: "unsupported_locator", source });
                return "[来源引用未验证]";
            }
            const { valid, invalid } = resolveLocatorValues(source, values);
            if (values.length === 0 || invalid.length > 0) {
                if (canDowngradeToReadFileCitation(source, values)) {
                    const publicCitation = `[${source.title}]`;
                    if (
                        hasMarkdownLinkLabelContext(
                            unwrappedInput,
                            offset + original.length,
                            [publicCitationLabel(publicCitation)],
                            unwrappedMarkdownContext,
                        )
                    ) {
                        return original;
                    }
                    use(source);
                    return publicCitation;
                }
                rejectCitation({
                    citation: original,
                    ...(values.length > 0 ? { locator: invalid[0] } : {}),
                    reason: values.length > 0 ? "unsupported_locator" : "locator_required",
                    source,
                });
                return "[来源引用未验证]";
            }
            const label = source.relativePath.toLowerCase().endsWith(".csv") ? "记录 ID" : "定位";
            const publicCitation = `[${source.title}，${label}：${valid.join("、")}]`;
            if (
                hasMarkdownLinkLabelContext(
                    unwrappedInput,
                    offset + original.length,
                    [publicCitationLabel(publicCitation)],
                    unwrappedMarkdownContext,
                )
            ) {
                return original;
            }
            use(
                source,
                valid.map((value) => ({
                    kind: locatorKind(source.relativePath, value),
                    value,
                })),
            );
            return publicCitation;
        });
    }

    finalized = finalized.replace(ASSET_TOKEN, (citation) => {
        const source = byResource.get(citation);
        if (source) use(source);
        else rejectCitation({ citation, reason: "unverified_resource" });
        return "";
    });

    // No opaque handle syntax may escape into the user-visible answer. This is
    // intentionally last among model-authored citation passes: valid variants
    // have already been resolved and protected, while every remaining complete
    // or partial K token is untrusted as a whole.
    finalized = finalized.replace(RESIDUAL_SOURCE_HANDLE, (citation) => {
        const rawIndex = citation.match(/K(\d+)/u)?.[1];
        const source = rawIndex ? byRef.get(`K${Number(rawIndex)}`) : undefined;
        rejectCitation({ citation, reason: "malformed_handle", source });
        return "[来源引用未验证]";
    });

    // Exact-filename recovery runs after opaque-handle resolution. Keep the
    // application-generated readable citation out of that fallback pass, or a
    // valid catalog/search handle such as [[K1]] would be mistaken for a new
    // model-authored bare filename and counted as unverified a second time.
    finalized = neutralizeMarkdownLabelsContainingProtectedReferences(finalized, protectedHandleCitations);
    const restorationMarkdownContext = markdownLinkContext(finalized);
    finalized = finalized.replace(PROTECTED_KNOWLEDGE_REFERENCE, (token, offset: number) => {
        const rawIndex = token.slice("\uE000KREF".length, -"\uE001".length);
        const index = Number(rawIndex);
        const receipt =
            Number.isSafeInteger(index) && index >= 0 && rawIndex === String(index)
                ? protectedHandleCitations[index]
                : undefined;
        if (!receipt) {
            rejectCitation({ citation: token, reason: "malformed_handle" });
            return "[来源引用未验证]";
        }
        use(receipt.source, receipt.locators, receipt.order);
        return hasMarkdownLinkLabelContext(
            finalized,
            offset + token.length,
            [publicCitationLabel(receipt.citation)],
            restorationMarkdownContext,
        )
            ? `［${publicCitationLabel(receipt.citation)}］`
            : receipt.citation;
    });

    // Defense in depth: no private placeholder may reach a persisted message,
    // a WebSocket terminal frame, or observability diagnostics. Every token
    // generated in this invocation was restored above; anything left is an
    // internal-state violation and remains fail-closed.
    finalized = replacePrivateKnowledgeReferenceFragments(finalized, (citation) => {
        rejectCitation({ citation, reason: "malformed_handle" });
        return "[来源引用未验证]";
    });

    const readable = finalized
        .replace(/[ \t]+([，。；：！？])/gu, "$1")
        .replace(/[ \t]+\n/gu, "\n")
        .split("\n")
        .filter((line) => !/^[ \t]*[\]\[()（）【】;；,，。]+[ \t]*$/u.test(line))
        .join("\n")
        .replace(/\n{3,}/gu, "\n\n");
    return {
        text: readable,
        sources: Array.from(used.entries())
            .sort(
                ([leftResource], [rightResource]) =>
                    (usedSourceOrder.get(leftResource) ?? Number.MAX_SAFE_INTEGER) -
                    (usedSourceOrder.get(rightResource) ?? Number.MAX_SAFE_INTEGER),
            )
            .map(([, source]) => source),
        unverifiedCitationCount,
        rejectedCitations,
    };
}
