import { genericKnowledgeIdentifierCandidates } from "./knowledge-grounding-planner";
import {
    isKnowledgeContinuationState,
    type KnowledgeCoverageReceipt,
    knowledgeContinuationFromCoverage,
} from "./knowledge-retrieval-coverage";

const STABLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/u;
const EXPLICIT_RECORD_IDENTIFIER =
    /(?:记录\s*(?:ID|编号|号)|\brecord(?:[\s_-]*id)?)\s*[：:#]?\s*([A-Za-z0-9][A-Za-z0-9_-]{0,159})/giu;
const LOCAL_INTENT_BOUNDARY = /[，,;；。.!?！？\r\n]+|\b(?:but|instead)\b|(?:但是|但|而是|改为|转而)/giu;
const LOCAL_NEGATIVE_OUTPUT_DIRECTIVE =
    /(?:请\s*)?(?:(?:不要|不得|无需|不必|禁止|请勿|勿)(?:再\s*)?(?:提及|提到|输出|列出|包含|展示|保留|写出|返回|报告|引用|复述|呈现)|(?:省略|排除|忽略|跳过))(?:\s|[：:])*$|(?:please\s+)?(?:(?:do\s+not|don't|dont|never)\s+(?:mention|output|include|list|show|retain|repeat|return|report|cite)|(?:omit|exclude|skip))(?:\s|[：:])*$/iu;
const REQUIRE_PRESERVATION_DIRECTIVE =
    /(?:请\s*)?(?:不要|不得|请勿|勿)(?:再\s*)?(?:省略|排除|忽略|跳过)(?:\s|[：:])*$|(?:please\s+)?(?:do\s+not|don't|dont|never)\s+(?:omit|exclude|skip)(?:\s|[：:])*$/iu;

function normalizedIdentifier(value: string): string {
    return value.normalize("NFKC").trim();
}

function escapedPattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifierPattern(identifier: string, global = false): RegExp {
    return new RegExp(
        `(^|[^\\p{L}\\p{N}_-])(${escapedPattern(identifier)})(?=$|[^\\p{L}\\p{N}_-])`,
        global ? "giu" : "iu",
    );
}

function containsIdentifier(value: string, identifier: string): boolean {
    return identifierPattern(identifier).test(value.normalize("NFKC"));
}

function explicitRecordIdentifiers(value: string): Set<string> {
    const identifiers = new Set<string>();
    for (const match of value.matchAll(EXPLICIT_RECORD_IDENTIFIER)) {
        const identifier = normalizedIdentifier(match[1] ?? "");
        if (identifier && STABLE_IDENTIFIER.test(identifier)) identifiers.add(identifier.toLowerCase());
    }
    return identifiers;
}

function explicitIdentifierCandidates(value: string): string[] {
    const candidates: string[] = [];
    for (const match of value.matchAll(/`([^`\r\n]+)`/gu)) {
        const candidate = normalizedIdentifier(match[1] ?? "");
        if (STABLE_IDENTIFIER.test(candidate) && /[-_]/u.test(candidate) && !/\.[A-Za-z0-9]{1,12}$/u.test(candidate)) {
            candidates.push(candidate);
        }
    }
    for (const match of value.matchAll(EXPLICIT_RECORD_IDENTIFIER)) {
        const candidate = normalizedIdentifier(match[1] ?? "");
        if (candidate && STABLE_IDENTIFIER.test(candidate)) candidates.push(candidate);
    }
    return candidates;
}

function occurrenceIsFilename(value: string, identifier: string): boolean {
    const normalized = value.normalize("NFKC");
    const pattern = identifierPattern(identifier, true);
    let sawOccurrence = false;
    for (const match of normalized.matchAll(pattern)) {
        sawOccurrence = true;
        const candidateStart = (match.index ?? 0) + (match[1]?.length ?? 0);
        const candidateEnd = candidateStart + (match[2]?.length ?? 0);
        if (!/^\.[A-Za-z0-9]{1,12}(?=$|[^\p{L}\p{N}_-])/u.test(normalized.slice(candidateEnd))) return false;
    }
    return sawOccurrence;
}

function localIntentClauses(value: string): string[] {
    return value
        .normalize("NFKC")
        .split(LOCAL_INTENT_BOUNDARY)
        .map((clause) => clause.trim())
        .filter(Boolean);
}

function occurrenceIsLocallyNegated(clause: string, identifier: string): boolean {
    const pattern = identifierPattern(identifier, true);
    for (const match of clause.matchAll(pattern)) {
        const prefix = clause.slice(0, match.index ?? 0).trim();
        if (REQUIRE_PRESERVATION_DIRECTIVE.test(prefix) || !LOCAL_NEGATIVE_OUTPUT_DIRECTIVE.test(prefix)) {
            return false;
        }
    }
    return true;
}

function isOnlyLocallyNegated(value: string, identifier: string): boolean {
    const containingClauses = localIntentClauses(value).filter((clause) => containsIdentifier(clause, identifier));
    return (
        containingClauses.length > 0 &&
        containingClauses.every((clause) => occurrenceIsLocallyNegated(clause, identifier))
    );
}

function requiredKnowledgeIdentifiers(userText: string): string[] {
    const normalizedUserText = userText.normalize("NFKC");
    const explicitlyNumeric = explicitRecordIdentifiers(normalizedUserText);
    const seen = new Set<string>();
    const identifiers: string[] = [];

    for (const rawCandidate of [
        ...explicitIdentifierCandidates(normalizedUserText),
        ...genericKnowledgeIdentifierCandidates(normalizedUserText),
    ]) {
        const candidate = normalizedIdentifier(rawCandidate);
        const key = candidate.toLowerCase();
        if (
            !STABLE_IDENTIFIER.test(candidate) ||
            seen.has(key) ||
            (!/[A-Za-z]/u.test(candidate) && !explicitlyNumeric.has(key)) ||
            occurrenceIsFilename(normalizedUserText, candidate) ||
            isOnlyLocallyNegated(normalizedUserText, candidate)
        ) {
            continue;
        }
        seen.add(key);
        identifiers.push(candidate);
    }

    return identifiers;
}

interface GroundedTable {
    headers: string[];
    rows: string[][];
}

interface TrustedTableRelation {
    sourceColumn: string;
    targetPath: string;
    targetColumn: string;
    confidence: "declared" | "high";
}

interface TrustedRestrictiveTable extends GroundedTable {
    assetId: string;
    path: string;
    revision: string;
    primaryKey: string;
    relations: TrustedTableRelation[];
    /** The source schema is bound, but its row-level PK contract is invalid. */
    sourceInvalid: boolean;
}

interface RestrictiveStateAnalysis {
    identifiers: string[];
    unresolvedEvidence: boolean;
}

const EMPTY_RESTRICTIVE_STATE_ANALYSIS: RestrictiveStateAnalysis = {
    identifiers: [],
    unresolvedEvidence: false,
};

function csvRows(content: string): GroundedTable | null {
    const lines = content.split(/\r?\n/u).filter((line) => line.trim());
    if (lines.length < 2 || !lines[0]?.includes(",")) return null;
    const parse = (line: string): string[] | null => {
        const values: string[] = [];
        let value = "";
        let quoted = false;
        for (let index = 0; index < line.length; index += 1) {
            const character = line[index] ?? "";
            if (character === '"') {
                if (quoted && line[index + 1] === '"') {
                    value += '"';
                    index += 1;
                } else quoted = !quoted;
            } else if (character === "," && !quoted) {
                values.push(value.trim());
                value = "";
            } else value += character;
        }
        if (quoted) return null;
        values.push(value.trim());
        return values;
    };
    const parsedHeaders = parse(lines[0] ?? "");
    if (!parsedHeaders) return null;
    const headers = parsedHeaders.map((header) => header.toLowerCase());
    if (headers.length < 2 || headers.some((header) => !header) || new Set(headers).size !== headers.length)
        return null;
    const rows = lines.slice(1).map(parse);
    if (rows.some((row) => !row || row.length !== headers.length)) return null;
    return {
        headers,
        rows: rows as string[][],
    };
}

function groundedTables(grounding: string | undefined): GroundedTable[] {
    if (!grounding) return [];
    try {
        const payload = JSON.parse(grounding) as Record<string, unknown>;
        const reads = Array.isArray(payload.reads) ? payload.reads : [];
        return reads.flatMap((read) => {
            if (!read || typeof read !== "object" || Array.isArray(read)) return [];
            const content = (read as Record<string, unknown>).content;
            if (typeof content !== "string") return [];
            const table = csvRows(content);
            return table ? [table] : [];
        });
    } catch {
        return [];
    }
}

const MAX_RESTRICTIVE_STATE_ROWS = 512;
const MAX_RESTRICTIVE_STATE_IDENTIFIERS = 16;
const KNOWLEDGE_READ_TRUNCATION_NOTICE = "[Knowledge read truncated by the grounding byte budget.]";
const RESTRICTIVE_STATE =
    /^(?:blocked|closed|denied|disabled|unavailable|unsafe|restricted|prohibited|不可|禁止|封锁|关闭|禁用|受限|不安全)$/iu;
const STATE_REEVALUATION_INTENT =
    /(?:更新(?:时间线|状态|结论)?|重算|重新(?:计算|评估|评估结论)|复核|核对当前|哪些?(?:结论)?(?:改变|变化|不变)|update(?:\s+(?:the\s+)?timeline)?|recompute|recalculate|re-?evaluate|reassess|current\s+(?:status|state)|what\s+changed|what\s+remains?\s+unchanged)/iu;
const STATE_TRANSITION_CLAIM =
    /(?:重新开放|恢复|解除|开放|可用|不可用|封锁|关闭|受限|状态|blocked|closed|restricted|unavailable|available|reopen(?:ed)?|restor(?:e|ed)|clear(?:ed)?|state|status)/iu;

function normalizedEvidencePath(value: unknown): string {
    return typeof value === "string"
        ? value
              .normalize("NFKC")
              .trim()
              .replace(/^source:/u, "")
              .replace(/#\d+$/u, "")
        : "";
}

function parsedGroundingPayload(grounding: string | undefined): Record<string, unknown> | null {
    if (!grounding) return null;
    try {
        const parsed = JSON.parse(grounding);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const payload = parsed as Record<string, unknown>;
        return String(payload.status ?? "ok")
            .trim()
            .toLowerCase() === "error"
            ? null
            : payload;
    } catch {
        return null;
    }
}

function revisionBindingMatches(value: unknown, assetId: string, expected: string): boolean {
    if (typeof value !== "string" || !value.trim() || !assetId || !expected) return false;
    const revision = value.trim();
    if (revision === expected || revision === `${assetId}:${expected}`) return true;
    const matching = revision
        .split("|")
        .filter((item) => item.startsWith(`${assetId}:`))
        .map((item) => item.slice(assetId.length + 1));
    return matching.length === 1 && matching[0] === expected;
}

function coverageHasRevisionFailure(payload: Record<string, unknown>): boolean {
    const coverage =
        payload.coverage && typeof payload.coverage === "object" && !Array.isArray(payload.coverage)
            ? (payload.coverage as Record<string, unknown>)
            : null;
    if (!coverage) return true;
    const revisionFailed = (value: unknown): boolean => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const record = value as Record<string, unknown>;
        return (
            record.revisionChanged === true ||
            String(record.status ?? "")
                .trim()
                .toLowerCase() === "stale" ||
            String(record.reason ?? "")
                .trim()
                .toLowerCase() === "revision_changed"
        );
    };
    if (revisionFailed(coverage)) return true;
    for (const key of ["facets", "unresolved"] as const) {
        if (Array.isArray(coverage[key]) && coverage[key].some(revisionFailed)) return true;
    }
    const accumulator =
        coverage.accumulator && typeof coverage.accumulator === "object" && !Array.isArray(coverage.accumulator)
            ? (coverage.accumulator as Record<string, unknown>)
            : null;
    return revisionFailed(accumulator);
}

function trustedRevision(payload: Record<string, unknown>, record: Record<string, unknown>, assetId: string): string {
    const expected =
        typeof record.__knowledgeExpectedRevision === "string" ? record.__knowledgeExpectedRevision.trim() : "";
    const hasSnapshot = record.indexSnapshot !== undefined;
    const snapshot =
        record.indexSnapshot && typeof record.indexSnapshot === "object" && !Array.isArray(record.indexSnapshot)
            ? (record.indexSnapshot as Record<string, unknown>)
            : null;
    const observed = typeof snapshot?.revision === "string" ? snapshot.revision.trim() : "";
    const coverage =
        payload.coverage && typeof payload.coverage === "object" && !Array.isArray(payload.coverage)
            ? (payload.coverage as Record<string, unknown>)
            : null;
    const coverageRevision = typeof coverage?.indexRevision === "string" ? coverage.indexRevision.trim() : "";
    // compactKnowledgeRead intentionally removes the raw snapshot after the
    // runtime has already executed knowledge_read with expectedRevision. The
    // reserved annotation plus the application-owned coverage revision remain
    // the binding proof. If a snapshot survives compaction, it must still
    // agree exactly; a malformed or mismatched surviving snapshot is stale.
    if (
        !expected ||
        (hasSnapshot && (!observed || expected !== observed)) ||
        !revisionBindingMatches(coverageRevision, assetId, expected)
    ) {
        return "";
    }
    return expected;
}

function resourceMatchesTable(value: unknown, assetId: string, path: string): boolean {
    if (typeof value !== "string") return false;
    return value.normalize("NFKC").trim() === `asset://${assetId}/${path}`;
}

function trustedTableRelations(value: unknown): TrustedTableRelation[] {
    if (!Array.isArray(value) || value.length > 24) return [];
    return value.flatMap((relation) => {
        if (!relation || typeof relation !== "object" || Array.isArray(relation)) return [];
        const candidate = relation as Record<string, unknown>;
        const confidence = candidate.confidence;
        if (confidence !== "declared" && confidence !== "high") return [];
        const sourceColumn = String(candidate.sourceColumn ?? "")
            .trim()
            .toLowerCase();
        const targetPath = normalizedEvidencePath(candidate.targetPath);
        const targetColumn = String(candidate.targetColumn ?? "")
            .trim()
            .toLowerCase();
        return sourceColumn && targetPath && targetColumn
            ? [{ sourceColumn, targetPath, targetColumn, confidence }]
            : [];
    });
}

function matchingCatalogSummary(
    payload: Record<string, unknown>,
    assetId: string,
    path: string,
    revision: string,
): Record<string, unknown> | null {
    const search =
        payload.search && typeof payload.search === "object" && !Array.isArray(payload.search)
            ? (payload.search as Record<string, unknown>)
            : null;
    const coverage =
        payload.coverage && typeof payload.coverage === "object" && !Array.isArray(payload.coverage)
            ? (payload.coverage as Record<string, unknown>)
            : null;
    const accumulator =
        coverage?.accumulator && typeof coverage.accumulator === "object" && !Array.isArray(coverage.accumulator)
            ? (coverage.accumulator as Record<string, unknown>)
            : null;
    const accumulatorRevisionMatches = revisionBindingMatches(accumulator?.indexRevision, assetId, revision);
    const summaries = [
        ...(Array.isArray(search?.tableSummaries) ? search.tableSummaries : []),
        ...(accumulatorRevisionMatches && Array.isArray(accumulator?.trustedTableSummaries)
            ? accumulator.trustedTableSummaries
            : []),
    ];
    const matches = summaries.filter((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const summary = value as Record<string, unknown>;
        return (
            summary.assetId === assetId &&
            normalizedEvidencePath(summary.path) === path &&
            resourceMatchesTable(summary.resource, assetId, path)
        );
    });
    const first = matches[0] as Record<string, unknown> | undefined;
    if (!first) return null;
    const firstPrimaryKey = String(first.primaryKey ?? "")
        .trim()
        .toLowerCase();
    const firstColumns = Array.isArray(first.columns)
        ? first.columns.map((column) => String(column).normalize("NFKC").trim().toLowerCase())
        : [];
    if (
        matches.some((value) => {
            const summary = value as Record<string, unknown>;
            const columns = Array.isArray(summary.columns)
                ? summary.columns.map((column) => String(column).normalize("NFKC").trim().toLowerCase())
                : [];
            return (
                String(summary.primaryKey ?? "")
                    .trim()
                    .toLowerCase() !== firstPrimaryKey ||
                columns.length !== firstColumns.length ||
                columns.some((column, index) => column !== firstColumns[index])
            );
        })
    ) {
        return null;
    }
    const relationsBySourceColumn = new Map<string, Map<string, TrustedTableRelation>>();
    for (const relation of matches.flatMap((value) =>
        trustedTableRelations((value as Record<string, unknown>).relations),
    )) {
        const targetIdentity = JSON.stringify([relation.targetPath, relation.targetColumn]);
        const targets = relationsBySourceColumn.get(relation.sourceColumn) ?? new Map<string, TrustedTableRelation>();
        const prior = targets.get(targetIdentity);
        targets.set(targetIdentity, {
            ...relation,
            // A declared relationship is the stronger form of the same exact
            // contract. It may safely subsume a duplicate high-confidence copy.
            confidence: prior?.confidence === "declared" || relation.confidence === "declared" ? "declared" : "high",
        });
        relationsBySourceColumn.set(relation.sourceColumn, targets);
    }
    if (Array.from(relationsBySourceColumn.values()).some((targets) => targets.size !== 1)) return null;
    const relations = Array.from(relationsBySourceColumn.values()).flatMap((targets) => Array.from(targets.values()));
    return { ...first, ...(relations.length > 0 ? { relations } : {}) };
}

function mergeTrustedRestrictiveTables(tables: TrustedRestrictiveTable[]): TrustedRestrictiveTable[] {
    const merged = new Map<
        string,
        {
            table: TrustedRestrictiveTable;
            rows: Map<string, string[]>;
            evidenceRows: string[][];
            conflicting: boolean;
        }
    >();
    for (const table of tables) {
        const identity = `${table.assetId}\u0000${table.path}\u0000${table.revision}`;
        const current = merged.get(identity);
        if (!current) {
            const rows = new Map<string, string[]>();
            const primaryIndex = table.headers.indexOf(table.primaryKey);
            let conflicting = primaryIndex < 0;
            for (const row of table.rows) {
                const key = normalizedIdentifier(row[primaryIndex] ?? "").toLowerCase();
                const prior = rows.get(key);
                // A primary key is a uniqueness contract inside one CSV
                // receipt. Even byte-equivalent duplicate rows violate that
                // source-local contract; do not let row order or deduplication
                // hide malformed source data. Separate selector receipts may
                // still overlap and are reconciled below.
                if (!key || prior) conflicting = true;
                else if (!prior) rows.set(key, row);
            }
            merged.set(identity, { table, rows, evidenceRows: [...table.rows], conflicting });
            continue;
        }
        current.evidenceRows.push(...table.rows);
        if (
            current.table.primaryKey !== table.primaryKey ||
            current.table.headers.length !== table.headers.length ||
            current.table.headers.some((header, index) => header !== table.headers[index])
        ) {
            current.conflicting = true;
            continue;
        }
        const primaryIndex = table.headers.indexOf(table.primaryKey);
        for (const row of table.rows) {
            const key = normalizedIdentifier(row[primaryIndex] ?? "").toLowerCase();
            const prior = current.rows.get(key);
            if (!key || (prior && prior.some((value, index) => value !== row[index]))) current.conflicting = true;
            else if (!prior) current.rows.set(key, row);
        }
        current.table.relations = Array.from(
            new Map(
                [...current.table.relations, ...table.relations].map((relation) => [
                    `${relation.sourceColumn}:${relation.targetPath}:${relation.targetColumn}:${relation.confidence}`,
                    relation,
                ]),
            ).values(),
        );
    }
    return Array.from(merged.values()).map(({ table, rows, evidenceRows, conflicting }) => {
        const sourceInvalid = conflicting || rows.size === 0 || rows.size > MAX_RESTRICTIVE_STATE_ROWS;
        return {
            ...table,
            // Retain bounded rows only for detecting that malformed evidence
            // intersects the user's requested endpoint. They are never used
            // as positive relation evidence while sourceInvalid is true.
            rows: sourceInvalid ? evidenceRows : Array.from(rows.values()),
            sourceInvalid,
        };
    });
}

function trustedRestrictiveTables(grounding: string | undefined): TrustedRestrictiveTable[] {
    const payload = parsedGroundingPayload(grounding);
    if (!payload || coverageHasRevisionFailure(payload) || !Array.isArray(payload.reads)) return [];
    const tables = payload.reads.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const record = value as Record<string, unknown>;
        const content = typeof record.content === "string" ? record.content : "";
        if (
            !content ||
            content.normalize("NFKC").trimEnd().endsWith(KNOWLEDGE_READ_TRUNCATION_NOTICE) ||
            String(record.status ?? "ok")
                .trim()
                .toLowerCase() === "error" ||
            record.__knowledgeReadFailed === true ||
            record.__knowledgeReadTruncated === true ||
            record.__knowledgeContentTruncated === true ||
            record.__knowledgeRevisionChanged === true
        ) {
            return [];
        }
        const assetId = typeof record.assetId === "string" ? record.assetId.normalize("NFKC").trim() : "";
        const path = normalizedEvidencePath(record.__knowledgePath ?? record.path);
        if (
            !assetId ||
            assetId.length > 512 ||
            !path ||
            path.length > 4_096 ||
            normalizedEvidencePath(record.path) !== path
        ) {
            return [];
        }
        const revision = trustedRevision(payload, record, assetId);
        if (!revision || revision.length > 2_048 || !resourceMatchesTable(record.resource, assetId, path)) return [];
        const summary =
            record.tableSummary && typeof record.tableSummary === "object" && !Array.isArray(record.tableSummary)
                ? (record.tableSummary as Record<string, unknown>)
                : null;
        if (!summary || normalizedEvidencePath(summary.path) !== path) return [];
        if (summary.assetId !== undefined && summary.assetId !== assetId) return [];
        if (!resourceMatchesTable(summary.resource, assetId, path)) return [];
        const table = csvRows(content);
        if (!table || table.rows.length === 0 || table.rows.length > MAX_RESTRICTIVE_STATE_ROWS) return [];
        const summaryColumns = Array.isArray(summary.columns)
            ? summary.columns.map((column) => String(column).normalize("NFKC").trim().toLowerCase())
            : [];
        if (
            summaryColumns.length !== table.headers.length ||
            summaryColumns.some((column, index) => column !== table.headers[index])
        ) {
            return [];
        }
        const primaryKey = typeof summary.primaryKey === "string" ? summary.primaryKey.trim().toLowerCase() : "";
        if (!primaryKey || table.headers.filter((header) => header === primaryKey).length !== 1) return [];
        const catalogSummary = matchingCatalogSummary(payload, assetId, path, revision);
        if (!catalogSummary) return [];
        const catalogColumns = Array.isArray(catalogSummary.columns)
            ? catalogSummary.columns.map((column) => String(column).normalize("NFKC").trim().toLowerCase())
            : [];
        if (
            String(catalogSummary.primaryKey ?? "")
                .trim()
                .toLowerCase() !== primaryKey ||
            catalogColumns.length !== table.headers.length ||
            catalogColumns.some((column, index) => column !== table.headers[index])
        ) {
            return [];
        }
        // A read proves row data and its compact schema, never its own joins.
        // Only the application-owned, revision-pinned catalog may authorize a
        // declared/high relation contract for completeness correction.
        const relations = trustedTableRelations(catalogSummary.relations);
        return [{ ...table, assetId, path, revision, primaryKey, relations, sourceInvalid: false }];
    });
    return mergeTrustedRestrictiveTables(tables);
}

interface TrustedVerifiedHistoryScope {
    values: Set<string>;
    invalid: boolean;
}

function isTrustedCompleteCoverageReceipt(value: Record<string, unknown>): boolean {
    const facets = Array.isArray(value.facets) ? value.facets : [];
    const accumulator =
        value.accumulator && typeof value.accumulator === "object" && !Array.isArray(value.accumulator)
            ? (value.accumulator as Record<string, unknown>)
            : null;
    const boundedStrings = (candidate: unknown, maxItems: number, maxLength: number): candidate is string[] =>
        Array.isArray(candidate) &&
        candidate.length <= maxItems &&
        candidate.every(
            (item) => typeof item === "string" && item === item.trim() && item.length > 0 && item.length <= maxLength,
        );
    if (
        value.version !== 1 ||
        value.protocolVersion !== undefined ||
        value.unresolved !== undefined ||
        typeof value.query !== "string" ||
        value.query !== value.query.trim() ||
        value.query.length === 0 ||
        value.query.length > 16_384 ||
        value.mode !== "complete" ||
        value.status !== "complete" ||
        value.hasMore !== false ||
        !accumulator ||
        facets.length === 0 ||
        facets.length > 24 ||
        !boundedStrings(value.requestedIdentifiers, 64, 512) ||
        !boundedStrings(value.matchedIdentifiers, 64, 512) ||
        !Array.isArray(value.missingIdentifiers) ||
        value.missingIdentifiers.length !== 0 ||
        value.required !== facets.length ||
        value.verified !== facets.length ||
        value.missing !== 0 ||
        typeof value.supplementalPasses !== "number" ||
        !Number.isInteger(value.supplementalPasses) ||
        value.supplementalPasses < 0 ||
        value.supplementalPasses > 1 ||
        typeof value.indexRevision !== "string" ||
        value.indexRevision !== value.indexRevision.trim() ||
        value.indexRevision.length === 0 ||
        value.indexRevision.length > 4_096 ||
        accumulator.indexRevision !== value.indexRevision ||
        accumulator.evidenceTruncated !== undefined ||
        [
            "nextSearchCursor",
            "pendingSearchPages",
            "nextCatalogCursor",
            "nextStructuredCursor",
            "searchOffset",
            "catalogOffset",
            "resultTruncated",
            "catalogTruncated",
            "recordIdsTruncated",
            "evidenceTruncated",
        ].some((key) => value[key] !== undefined)
    ) {
        return false;
    }
    const facetIds = new Set<string>();
    for (const candidate of facets) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
        const facet = candidate as Record<string, unknown>;
        if (
            typeof facet.id !== "string" ||
            !facet.id.trim() ||
            facet.id.length > 256 ||
            facetIds.has(facet.id) ||
            typeof facet.query !== "string" ||
            !facet.query.trim() ||
            facet.query.length > 16_384 ||
            facet.status !== "covered" ||
            !boundedStrings(facet.selectedPaths ?? [], 3, 4_096)
        ) {
            return false;
        }
        facetIds.add(facet.id);
    }
    if (!facetIds.has("verified-history-locators")) return false;
    const continuation = knowledgeContinuationFromCoverage(value as unknown as KnowledgeCoverageReceipt);
    return Boolean(continuation && isKnowledgeContinuationState(continuation));
}

function trustedVerifiedHistoryScope(
    payload: Record<string, unknown> | null,
    owner: TrustedRestrictiveTable,
): TrustedVerifiedHistoryScope {
    const empty = (): TrustedVerifiedHistoryScope => ({ values: new Set<string>(), invalid: false });
    if (!payload) return empty();
    const coverage =
        payload.coverage && typeof payload.coverage === "object" && !Array.isArray(payload.coverage)
            ? (payload.coverage as Record<string, unknown>)
            : null;
    const accumulator =
        coverage?.accumulator && typeof coverage.accumulator === "object" && !Array.isArray(coverage.accumulator)
            ? (coverage.accumulator as Record<string, unknown>)
            : null;
    if (!coverage || !accumulator || !Array.isArray(accumulator.facets)) return empty();
    const facets = accumulator.facets.filter(
        (value): value is Record<string, unknown> =>
            Boolean(value) &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            (value as Record<string, unknown>).id === "verified-history-locators",
    );
    if (facets.length === 0) return empty();
    if (facets.length !== 1) return { values: new Set<string>(), invalid: true };
    const facet = facets[0];
    const facetLocators = Array.isArray(facet?.verifiedHistoryLocators) ? facet.verifiedHistoryLocators : [];
    const targetLocators = facetLocators.filter((value): value is Record<string, unknown> => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const locator = value as Record<string, unknown>;
        return (
            locator.kind === "record" &&
            locator.assetId === owner.assetId &&
            normalizedEvidencePath(locator.path) === owner.path
        );
    });
    if (targetLocators.length === 0) return empty();
    if (
        !isTrustedCompleteCoverageReceipt(coverage) ||
        facet?.completion !== "all_sources_verified" ||
        !revisionBindingMatches(accumulator.indexRevision, owner.assetId, owner.revision) ||
        !Array.isArray(accumulator.trustedEvidence)
    ) {
        return { values: new Set<string>(), invalid: true };
    }
    const expectedValueList = targetLocators.map((locator) =>
        normalizedIdentifier(String(locator.value ?? "")).toLowerCase(),
    );
    const expectedValues = new Set(expectedValueList);
    if (
        expectedValueList.some((value) => !STABLE_IDENTIFIER.test(value)) ||
        expectedValueList.length !== expectedValues.size
    ) {
        return { values: new Set<string>(), invalid: true };
    }
    const provenValues = new Set<string>();
    for (const value of accumulator.trustedEvidence) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const pointer = value as Record<string, unknown>;
        const obligationIds = Array.isArray(pointer.obligationIds) ? pointer.obligationIds : [];
        const locators = Array.isArray(pointer.verifiedHistoryLocators) ? pointer.verifiedHistoryLocators : [];
        const pointerLocators = locators.filter((candidate): candidate is Record<string, unknown> => {
            if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
            const locator = candidate as Record<string, unknown>;
            return (
                locator.kind === "record" &&
                locator.assetId === owner.assetId &&
                normalizedEvidencePath(locator.path) === owner.path
            );
        });
        if (pointerLocators.length === 0) continue;
        let selector: Record<string, unknown> | null = null;
        try {
            const parsed = JSON.parse(String(pointer.selectorSignature ?? ""));
            selector = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
        } catch {
            selector = null;
        }
        const locatorValues = pointerLocators.map((locator) =>
            normalizedIdentifier(String(locator.value ?? "")).toLowerCase(),
        );
        const pointerIdentifiers = Array.isArray(pointer.identifiers)
            ? pointer.identifiers.map((identifier) => normalizedIdentifier(String(identifier)).toLowerCase())
            : [];
        const selectorIdentifiers = Array.isArray(selector?.identifiers)
            ? selector.identifiers.map((identifier) => normalizedIdentifier(String(identifier)).toLowerCase())
            : [];
        const sameValues = (left: string[], right: string[]): boolean => {
            const leftSet = new Set(left);
            const rightSet = new Set(right);
            return (
                left.length === leftSet.size &&
                right.length === rightSet.size &&
                leftSet.size === rightSet.size &&
                Array.from(leftSet).every((item) => rightSet.has(item))
            );
        };
        const pointerAssetId = String(pointer.assetId ?? "").trim();
        const pointerKey = String(pointer.key ?? "").trim();
        const pointerKeyPrefix = `${pointerAssetId}:`;
        const pointerSearchGroups = pointer.searchGroups as number[];
        if (
            !obligationIds.includes("verified-history-locators") ||
            obligationIds.length !== new Set(obligationIds).size ||
            (pointerSearchGroups.length === 0 &&
                (obligationIds.length !== 1 || obligationIds[0] !== "verified-history-locators")) ||
            locators.length !== pointerLocators.length ||
            pointerAssetId !== owner.assetId ||
            !pointerKey.startsWith(pointerKeyPrefix) ||
            normalizedEvidencePath(pointerKey.slice(pointerKeyPrefix.length)) !== owner.path ||
            normalizedEvidencePath(pointer.path) !== owner.path ||
            pointer.expectedRevision !== owner.revision ||
            pointerSearchGroups.length !== new Set(pointerSearchGroups).size ||
            pointer.filters !== undefined ||
            selector?.kind !== "exact" ||
            selector.assetId !== owner.assetId ||
            normalizedEvidencePath(selector.path) !== owner.path ||
            selector.filters !== undefined ||
            locatorValues.length === 0 ||
            locatorValues.some((identifier) => !STABLE_IDENTIFIER.test(identifier)) ||
            !sameValues(locatorValues, pointerIdentifiers) ||
            !sameValues(locatorValues, selectorIdentifiers) ||
            locatorValues.some((identifier) => !expectedValues.has(identifier))
        ) {
            return { values: new Set<string>(), invalid: true };
        }
        for (const identifier of locatorValues) provenValues.add(identifier);
    }
    return expectedValues.size === provenValues.size &&
        Array.from(expectedValues).every((value) => provenValues.has(value))
        ? { values: provenValues, invalid: false }
        : { values: new Set<string>(), invalid: true };
}

function stateReevaluationRequested(userText: string): boolean {
    const normalized = userText.normalize("NFKC");
    return STATE_REEVALUATION_INTENT.test(normalized) && STATE_TRANSITION_CLAIM.test(normalized);
}

function uniqueHeaderIndex(headers: string[], predicate: (header: string) => boolean): number {
    const matches = headers.flatMap((header, index) => (predicate(header) ? [index] : []));
    return matches.length === 1 ? (matches[0] ?? -1) : -1;
}

function topologyEndpointIndexes(table: TrustedRestrictiveTable): { from: number; to: number } | null {
    const from = uniqueHeaderIndex(table.headers, (header) =>
        /^(?:from|source|start|origin)(?:_?(?:node|location|endpoint))?(?:_?id)?$/iu.test(header),
    );
    const to = uniqueHeaderIndex(table.headers, (header) =>
        /^(?:to|target|end|destination)(?:_?(?:node|location|endpoint))?(?:_?id)?$/iu.test(header),
    );
    return from >= 0 && to >= 0 && from !== to ? { from, to } : null;
}

function stateColumnIndexes(table: TrustedRestrictiveTable): number[] {
    return table.headers.flatMap((header, index) => (/(?:^|_)(?:status|state)$/iu.test(header) ? [index] : []));
}

function possibleTopologyEndpointIndexes(table: TrustedRestrictiveTable): { from: number[]; to: number[] } {
    return {
        from: table.headers.flatMap((header, index) =>
            /^(?:from|source|start|origin)(?:_?(?:node|location|endpoint))?(?:_?id)?$/iu.test(header) ? [index] : [],
        ),
        to: table.headers.flatMap((header, index) =>
            /^(?:to|target|end|destination)(?:_?(?:node|location|endpoint))?(?:_?id)?$/iu.test(header) ? [index] : [],
        ),
    };
}

function evidenceIntersectsRequestedEndpoint(input: {
    userText: string;
    stateTable: TrustedRestrictiveTable;
    stateIndexes: number[];
    relationIndex: number;
    topologyTables: TrustedRestrictiveTable[];
}): boolean {
    if (input.stateIndexes.length === 0 || input.relationIndex < 0) return false;
    for (const topology of input.topologyTables) {
        const topologyKeyIndex = uniqueHeaderIndex(topology.headers, (header) => header === topology.primaryKey);
        const endpointIndexes = possibleTopologyEndpointIndexes(topology);
        if (topologyKeyIndex < 0 || endpointIndexes.from.length === 0 || endpointIndexes.to.length === 0) continue;
        const endpointByKey = new Map<string, string[]>();
        for (const row of topology.rows) {
            const key = normalizedIdentifier(row[topologyKeyIndex] ?? "").toLowerCase();
            if (!STABLE_IDENTIFIER.test(key)) continue;
            const endpoints = [...endpointIndexes.from, ...endpointIndexes.to]
                .map((index) => normalizedIdentifier(row[index] ?? ""))
                .filter((endpoint) => STABLE_IDENTIFIER.test(endpoint));
            endpointByKey.set(key, [...(endpointByKey.get(key) ?? []), ...endpoints]);
        }
        if (
            input.stateTable.rows.some((row) => {
                if (
                    !input.stateIndexes.some((index) => RESTRICTIVE_STATE.test(normalizedIdentifier(row[index] ?? "")))
                ) {
                    return false;
                }
                const endpoints = endpointByKey.get(normalizedIdentifier(row[input.relationIndex] ?? "").toLowerCase());
                return Boolean(endpoints?.some((endpoint) => userReferencesEndpoint(input.userText, endpoint)));
            })
        ) {
            return true;
        }
    }
    return false;
}

function userReferencesEndpoint(userText: string, endpoint: string): boolean {
    if (containsIdentifier(userText, endpoint)) return true;
    for (const segment of endpoint.normalize("NFKC").split(/[-_]/u)) {
        // Short aliases are admitted only when the catalog endpoint itself
        // proves a mixed letter/digit segment (for example Z2). Ordinary words
        // and one-character compass labels remain too ambiguous.
        if (
            segment.length >= 2 &&
            segment.length <= 32 &&
            /[A-Za-z]/u.test(segment) &&
            /\d/u.test(segment) &&
            containsIdentifier(userText, segment)
        ) {
            return true;
        }
    }
    return false;
}

function analyzeRestrictiveStateIdentifiers(userText: string, grounding: string | undefined): RestrictiveStateAnalysis {
    if (!stateReevaluationRequested(userText)) return EMPTY_RESTRICTIVE_STATE_ANALYSIS;
    const payload = parsedGroundingPayload(grounding);
    const tables = trustedRestrictiveTables(grounding);
    const candidates: Array<{ identifier: string; scope: string }> = [];
    let unresolvedEvidence = false;

    for (const stateTable of tables) {
        const stateIndexes = stateColumnIndexes(stateTable);
        const stateIndex = stateIndexes.length === 1 ? (stateIndexes[0] ?? -1) : -1;
        const primaryIndex = uniqueHeaderIndex(stateTable.headers, (header) => header === stateTable.primaryKey);
        if (stateIndexes.length === 0 || primaryIndex < 0) continue;
        for (const relation of stateTable.relations) {
            const relationIndex = uniqueHeaderIndex(stateTable.headers, (header) => header === relation.sourceColumn);
            if (relationIndex < 0 || relation.sourceColumn === stateTable.primaryKey) continue;
            const topologyCandidates = tables.filter(
                (table) =>
                    table.assetId === stateTable.assetId &&
                    table.revision === stateTable.revision &&
                    table.path === relation.targetPath &&
                    table.primaryKey === relation.targetColumn,
            );
            if (topologyCandidates.length === 0) continue;
            const topologyTables = topologyCandidates.filter(
                (table) => !table.sourceInvalid && topologyEndpointIndexes(table),
            );
            if (stateIndex < 0 || topologyTables.length !== 1) {
                if (
                    evidenceIntersectsRequestedEndpoint({
                        userText,
                        stateTable,
                        stateIndexes,
                        relationIndex,
                        topologyTables: topologyCandidates,
                    })
                ) {
                    unresolvedEvidence = true;
                }
                continue;
            }
            const topology = topologyTables[0];
            const endpoints = topologyEndpointIndexes(topology);
            if (!topology || !endpoints) continue;
            const topologyKeyIndex = uniqueHeaderIndex(topology.headers, (header) => header === topology.primaryKey);
            if (topologyKeyIndex < 0) continue;
            const endpointByKey = new Map<string, Set<string>>();
            for (const row of topology.rows) {
                const key = normalizedIdentifier(row[topologyKeyIndex] ?? "").toLowerCase();
                const from = normalizedIdentifier(row[endpoints.from] ?? "");
                const to = normalizedIdentifier(row[endpoints.to] ?? "");
                if (!STABLE_IDENTIFIER.test(key) || !STABLE_IDENTIFIER.test(from) || !STABLE_IDENTIFIER.test(to)) {
                    continue;
                }
                const existing = endpointByKey.get(key) ?? new Set<string>();
                existing.add(from);
                existing.add(to);
                endpointByKey.set(key, existing);
            }
            let matchingRows = stateTable.rows.filter((row) => {
                if (!RESTRICTIVE_STATE.test(normalizedIdentifier(row[stateIndex] ?? ""))) return false;
                const endpointsForRow = endpointByKey.get(normalizedIdentifier(row[relationIndex] ?? "").toLowerCase());
                return Boolean(
                    endpointsForRow &&
                        Array.from(endpointsForRow).some((endpoint) => userReferencesEndpoint(userText, endpoint)),
                );
            });
            if (matchingRows.length === 0) continue;

            const requiredScopeRelations = stateTable.relations.filter(
                (candidate) =>
                    candidate.sourceColumn !== relation.sourceColumn &&
                    candidate.sourceColumn !== stateTable.primaryKey,
            );
            const scopeColumns: Array<{
                index: number;
                identity: string;
                ownerValues: Set<string>;
                owner: TrustedRestrictiveTable;
            }> = [];
            let scopeBindingsValid = requiredScopeRelations.length > 0;
            for (const candidate of requiredScopeRelations) {
                const index = uniqueHeaderIndex(stateTable.headers, (header) => header === candidate.sourceColumn);
                const owners = tables.filter(
                    (table) =>
                        !table.sourceInvalid &&
                        table.assetId === stateTable.assetId &&
                        table.revision === stateTable.revision &&
                        table.path === candidate.targetPath &&
                        table.primaryKey === candidate.targetColumn,
                );
                const owner = owners.length === 1 ? owners[0] : undefined;
                const ownerKeyIndex = owner
                    ? uniqueHeaderIndex(owner.headers, (header) => header === owner.primaryKey)
                    : -1;
                const rawOwnerValues =
                    owner && ownerKeyIndex >= 0
                        ? owner.rows.map((row) => normalizedIdentifier(row[ownerKeyIndex] ?? ""))
                        : [];
                if (
                    index < 0 ||
                    !owner ||
                    ownerKeyIndex < 0 ||
                    rawOwnerValues.length === 0 ||
                    rawOwnerValues.some((value) => !STABLE_IDENTIFIER.test(value))
                ) {
                    scopeBindingsValid = false;
                    continue;
                }
                scopeColumns.push({
                    index,
                    identity: `${candidate.sourceColumn}:${candidate.targetPath}:${candidate.targetColumn}`,
                    ownerValues: new Set(rawOwnerValues.map((value) => value.toLowerCase())),
                    owner,
                });
            }
            scopeColumns.sort((left, right) => left.identity.localeCompare(right.identity));
            if (
                stateTable.sourceInvalid ||
                !scopeBindingsValid ||
                scopeColumns.length !== requiredScopeRelations.length
            ) {
                unresolvedEvidence = true;
                continue;
            }

            const verifiedHistoryConstraints: Array<{ index: number; value: string }> = [];
            for (const scope of scopeColumns) {
                const historyScope = trustedVerifiedHistoryScope(payload, scope.owner);
                if (historyScope.invalid || historyScope.values.size > 1) {
                    scopeBindingsValid = false;
                    break;
                }
                const selected = Array.from(historyScope.values)[0];
                if (!selected) continue;
                const rowScopeValues = new Set(
                    matchingRows.map((row) => normalizedIdentifier(row[scope.index] ?? "").toLowerCase()),
                );
                const explicitOwnerValues = Array.from(scope.ownerValues).filter((value) =>
                    containsIdentifier(userText, value),
                );
                if (
                    !scope.ownerValues.has(selected) ||
                    !rowScopeValues.has(selected) ||
                    (explicitOwnerValues.length > 0 &&
                        (explicitOwnerValues.length !== 1 || explicitOwnerValues[0] !== selected))
                ) {
                    scopeBindingsValid = false;
                    break;
                }
                verifiedHistoryConstraints.push({ index: scope.index, value: selected });
            }
            if (!scopeBindingsValid) {
                unresolvedEvidence = true;
                continue;
            }
            if (verifiedHistoryConstraints.length > 0) {
                matchingRows = matchingRows.filter((row) =>
                    verifiedHistoryConstraints.every(
                        (constraint) =>
                            normalizedIdentifier(row[constraint.index] ?? "").toLowerCase() === constraint.value,
                    ),
                );
                if (matchingRows.length === 0) {
                    unresolvedEvidence = true;
                    continue;
                }
            }

            for (const row of matchingRows) {
                const identifier = normalizedIdentifier(row[primaryIndex] ?? "");
                const scopeValues = scopeColumns.map((scope) => normalizedIdentifier(row[scope.index] ?? ""));
                if (
                    !STABLE_IDENTIFIER.test(identifier) ||
                    !/[-_]/u.test(identifier) ||
                    scopeValues.some(
                        (value, index) =>
                            !value || !scopeColumns[index]?.ownerValues.has(value.normalize("NFKC").toLowerCase()),
                    )
                ) {
                    unresolvedEvidence = true;
                    continue;
                }
                candidates.push({
                    identifier,
                    scope: [
                        stateTable.assetId,
                        ...scopeColumns.map(
                            (scope, index) => `${scope.identity}:${scopeValues[index]?.toLowerCase() ?? ""}`,
                        ),
                    ].join("\u0000"),
                });
            }
        }
    }

    if (unresolvedEvidence) return { identifiers: [], unresolvedEvidence: true };
    if (candidates.length === 0) return EMPTY_RESTRICTIVE_STATE_ANALYSIS;
    const scopes = new Set(candidates.map((candidate) => candidate.scope));
    if (scopes.size !== 1) return { identifiers: [], unresolvedEvidence: true };
    const identifiers = Array.from(
        new Map(candidates.map((candidate) => [candidate.identifier.toLowerCase(), candidate.identifier])).values(),
    );
    return identifiers.length <= MAX_RESTRICTIVE_STATE_IDENTIFIERS
        ? { identifiers, unresolvedEvidence: false }
        : { identifiers: [], unresolvedEvidence: true };
}

function stableCellIdentifiers(value: string): string[] {
    return value
        .split(/[|、;；\s]+/u)
        .map(normalizedIdentifier)
        .filter((item) => STABLE_IDENTIFIER.test(item) && /[-_]/u.test(item));
}

const MAX_ROUTE_PATH_DEPTH = 16;
const MAX_ROUTE_PATHS = 64;
const MAX_ROUTE_CORE_IDENTIFIERS = 6;

function explicitBidirectionalValue(value: string): boolean {
    return /^(?:1|true|yes|y|on|是|双向)$/iu.test(value.normalize("NFKC").trim());
}

function sameRouteNode(left: string | undefined, right: string | undefined): boolean {
    return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function verifiedGraphIdentifiersInAnswer(answerText: string, graphNodes: Map<string, string>): string[] {
    const normalizedAnswer = answerText.normalize("NFKC");
    return Array.from(graphNodes.entries())
        .flatMap(([normalized, display]) => {
            if (!containsIdentifier(normalizedAnswer, display)) return [];
            const match = identifierPattern(display).exec(normalizedAnswer);
            if (!match) return [];
            return [{ identifier: normalized, index: (match.index ?? 0) + (match[1]?.length ?? 0) }];
        })
        .sort((left, right) => left.index - right.index || left.identifier.localeCompare(right.identifier))
        .map(({ identifier }) => identifier);
}

function routeGoalPriority(value: string): number {
    const normalized = value.normalize("NFKC").trim();
    if (
        /(?:^|[_\-\s/])(?:assembly|destination|safe[_\-\s]?zone)(?:$|[_\-\s/])|集合(?:点|区)?|目的地|安全区/iu.test(
            normalized,
        )
    ) {
        return 2;
    }
    return /(?:^|[_\-\s/])(?:exit|egress)(?:$|[_\-\s/])|出口/iu.test(normalized) ? 1 : 0;
}

function descriptorLexemes(value: string): string[] {
    const normalized = value.normalize("NFKC").toLowerCase();
    const lexemes = new Set<string>();
    for (const token of normalized.match(/[a-z0-9][a-z0-9_-]{1,63}/gu) ?? []) lexemes.add(token);
    for (const sequence of normalized.match(/\p{Script=Han}{2,64}/gu) ?? []) {
        for (const width of [2, 3]) {
            for (let index = 0; index + width <= sequence.length; index += 1) {
                lexemes.add(sequence.slice(index, index + width));
            }
        }
    }
    return Array.from(lexemes).slice(0, 128);
}

function queryToNodeDescriptorScore(
    query: string,
    descriptorLexemeSet: Set<string>,
    sharedLexemes: Set<string>,
): number {
    const queryLexemes = new Set(descriptorLexemes(query));
    if (queryLexemes.size === 0) return 0;
    return Array.from(queryLexemes).reduce(
        (score, lexeme) =>
            score + (descriptorLexemeSet.has(lexeme) && !sharedLexemes.has(lexeme) ? Math.min(lexeme.length, 8) : 0),
        0,
    );
}

function shortestVerifiedGoalPaths(
    starts: Set<string>,
    outgoing: Map<string, Array<{ to: string; edge: string }>>,
    goals: Set<string>,
): { paths: string[][]; truncated: boolean } {
    const distance = new Map<string, number>();
    const display = new Map<string, string>();
    const predecessors = new Map<string, Set<string>>();
    const queue: string[] = [];
    for (const start of starts) {
        const normalized = start.toLowerCase();
        if (distance.has(normalized)) continue;
        distance.set(normalized, 0);
        display.set(normalized, start);
        queue.push(normalized);
    }

    let shortestGoalDepth: number | undefined;
    let truncated = false;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor] ?? "";
        const currentDepth = distance.get(current) ?? 0;
        if (shortestGoalDepth !== undefined && currentDepth >= shortestGoalDepth) continue;
        const next = outgoing.get(current) ?? [];
        if (currentDepth >= MAX_ROUTE_PATH_DEPTH - 1) {
            if (next.length > 0) truncated = true;
            continue;
        }
        for (const edge of next) {
            const target = edge.to.toLowerCase();
            const targetDepth = currentDepth + 1;
            const knownDepth = distance.get(target);
            if (knownDepth === undefined) {
                distance.set(target, targetDepth);
                display.set(target, edge.to);
                predecessors.set(target, new Set([current]));
                queue.push(target);
            } else if (knownDepth === targetDepth) {
                predecessors.get(target)?.add(current);
            } else {
                continue;
            }
            if (goals.has(target) && (shortestGoalDepth === undefined || targetDepth < shortestGoalDepth)) {
                shortestGoalDepth = targetDepth;
            }
        }
    }
    if (shortestGoalDepth === undefined) return { paths: [], truncated };

    const goalNodes = Array.from(goals).filter((goal) => distance.get(goal) === shortestGoalDepth);
    const paths: string[][] = [];
    const build = (node: string, suffix: string[]) => {
        if (paths.length >= MAX_ROUTE_PATHS) {
            truncated = true;
            return;
        }
        const prior = predecessors.get(node);
        if (!prior || prior.size === 0) {
            paths.push([display.get(node) ?? node, ...suffix]);
            return;
        }
        for (const predecessor of prior) build(predecessor, [display.get(node) ?? node, ...suffix]);
    };
    for (const goal of goalNodes) build(goal, []);
    return { paths, truncated };
}

function orderedCommonRouteNodes(paths: string[][]): string[] {
    const first = paths[0];
    if (!first || first.length < 2) return [];
    if (paths.some((path) => !sameRouteNode(path[0], first[0]) || !sameRouteNode(path.at(-1), first.at(-1)))) {
        return [];
    }

    const common = first.filter((node) =>
        paths.every((path) => path.some((candidate) => sameRouteNode(candidate, node))),
    );
    const commonIsOrdered = paths.every((path) => {
        let prior = -1;
        for (const node of common) {
            const index = path.findIndex(
                (candidate, candidateIndex) => candidateIndex > prior && sameRouteNode(candidate, node),
            );
            if (index < 0) return false;
            prior = index;
        }
        return true;
    });
    return commonIsOrdered ? common : [];
}

function boundedRouteCore(paths: string[][]): string[] {
    const first = paths[0];
    if (!first || first.length < 2) return [];
    const common = orderedCommonRouteNodes(paths);
    // Equal-ranked routes with only a shared start/destination are genuinely
    // ambiguous. Do not let the draft itself choose a branch and turn that
    // choice into a completeness requirement.
    if (common.length === 0 || (paths.length > 1 && common.length <= 2)) return [];

    const selected: string[] = [];
    const add = (node: string | undefined) => {
        if (!node || selected.some((candidate) => sameRouteNode(candidate, node))) return;
        selected.push(node);
    };
    add(first[0]);
    if (paths.every((path) => sameRouteNode(path[1], first[1]))) add(first[1]);
    if (paths.every((path) => sameRouteNode(path[2], first[2]))) add(first[2]);

    const interiorCommon = common.slice(1, -1);
    if (interiorCommon.length > 0) add(interiorCommon[Math.floor(interiorCommon.length / 2)]);
    if (paths.every((path) => sameRouteNode(path.at(-2), first.at(-2)))) add(first.at(-2));
    add(first.at(-1));
    return selected.slice(0, MAX_ROUTE_CORE_IDENTIFIERS);
}

interface VerifiedRouteAnalysis {
    coreIdentifiers: string[];
    /** Conservative verified route nodes which are safe equipment relation seeds. */
    equipmentTraversalIdentifiers: string[];
    hasVerifiedGraph: boolean;
}

const EMPTY_ROUTE_ANALYSIS: VerifiedRouteAnalysis = {
    coreIdentifiers: [],
    equipmentTraversalIdentifiers: [],
    hasVerifiedGraph: false,
};

function directEquipmentIdentifiers(
    userText: string,
    answerText: string,
    tables: GroundedTable[],
    route: VerifiedRouteAnalysis,
): string[] {
    if (!/(?:设备|器材|工具|物资|轮椅|座椅|equipment|device|chair|tool|resource|supply|material)/iu.test(userText)) {
        return [];
    }
    const seeds = new Set(requiredKnowledgeIdentifiers(userText).map((item) => item.toLowerCase()));
    // With a verified route graph, only answer nodes on its conservative
    // traversal may relate equipment rows. The generic answer scanner remains
    // available for non-route evidence, but must never let a draft select an
    // ambiguous branch or an unrelated graph node.
    for (const identifier of route.hasVerifiedGraph
        ? route.equipmentTraversalIdentifiers
        : genericKnowledgeIdentifierCandidates(answerText).map((item) => item.toLowerCase())) {
        seeds.add(identifier);
    }
    const required = new Set<string>();
    for (const table of tables) {
        const equipmentColumns = table.headers.flatMap((header, index) =>
            /(?:device|equipment|tool|chair|resource|supply|material|设备|器材|工具|物资).*(?:id|identifier|code|key|编号)/iu.test(
                header,
            )
                ? [index]
                : [],
        );
        if (equipmentColumns.length === 0) continue;
        for (const row of table.rows) {
            const related = row.some((cell) => seeds.has(cell.normalize("NFKC").trim().toLowerCase()));
            if (!related) continue;
            for (const index of equipmentColumns) {
                for (const identifier of stableCellIdentifiers(row[index] ?? "")) required.add(identifier);
            }
        }
    }
    return Array.from(required).slice(0, 8);
}

function verifiedRouteAnalysis(userText: string, answerText: string, tables: GroundedTable[]): VerifiedRouteAnalysis {
    if (!/(?:路线|路径|怎么(?:走|到|撤|出去)|(?:从|往)?哪里出去|route|path|way\s*out)/iu.test(userText)) {
        return EMPTY_ROUTE_ANALYSIS;
    }
    const negativeEdges = new Set<string>();
    for (const table of tables) {
        // Prefer a state value column, not an identifier such as state_id.
        // Qualified names such as edge_status remain supported.
        const stateIndex = table.headers.findIndex((header) => /(?:^|_)(?:status|state)$/iu.test(header));
        const edgeIndex = table.headers.findIndex((header) => /(?:^|_)(?:edge|link|segment)(?:_?id)?$/iu.test(header));
        if (stateIndex < 0 || edgeIndex < 0) continue;
        for (const row of table.rows) {
            if (
                /(?:blocked|closed|disabled|denied|unavailable|unsafe|restricted|不可|封锁|关闭|禁用)/iu.test(
                    row[stateIndex] ?? "",
                )
            ) {
                negativeEdges.add((row[edgeIndex] ?? "").toLowerCase());
            }
        }
    }

    const outgoing = new Map<string, Array<{ to: string; edge: string }>>();
    const graphNodes = new Map<string, string>();
    for (const table of tables) {
        const fromIndex = table.headers.findIndex((header) =>
            /^(?:from|source|start|origin)(?:_?(?:node|location))?(?:_?id)?$/iu.test(header),
        );
        const toIndex = table.headers.findIndex((header) =>
            /^(?:to|target|end|destination)(?:_?(?:node|location))?(?:_?id)?$/iu.test(header),
        );
        if (fromIndex < 0 || toIndex < 0) continue;
        const edgeIndex = table.headers.findIndex((header) => /(?:^|_)(?:edge|link|segment)(?:_?id)?$/iu.test(header));
        const bidirectionalIndex = table.headers.findIndex((header) =>
            /^(?:bidirectional|bi_directional|two_?way|undirected|双向)$/iu.test(header),
        );
        const addEdge = (from: string, to: string, edge: string) => {
            graphNodes.set(from.toLowerCase(), from);
            graphNodes.set(to.toLowerCase(), to);
            const key = from.toLowerCase();
            const existing = outgoing.get(key) ?? [];
            if (!existing.some((candidate) => sameRouteNode(candidate.to, to) && sameRouteNode(candidate.edge, edge))) {
                outgoing.set(key, [...existing, { to, edge }]);
            }
        };
        for (const row of table.rows) {
            const from = normalizedIdentifier(row[fromIndex] ?? "");
            const to = normalizedIdentifier(row[toIndex] ?? "");
            const edge = normalizedIdentifier(edgeIndex >= 0 ? (row[edgeIndex] ?? "") : "");
            if (!STABLE_IDENTIFIER.test(from) || !STABLE_IDENTIFIER.test(to) || negativeEdges.has(edge.toLowerCase()))
                continue;
            addEdge(from, to, edge);
            if (bidirectionalIndex >= 0 && explicitBidirectionalValue(row[bidirectionalIndex] ?? "")) {
                addEdge(to, from, edge);
            }
        }
    }
    if (graphNodes.size === 0) return EMPTY_ROUTE_ANALYSIS;

    const goalPriorities = new Map<string, number>();
    const nodeDescriptors = new Map<string, string[]>();
    for (const table of tables) {
        const idIndex = table.headers.findIndex((header) =>
            /^(?:id|node(?:_?id)?|location(?:_?id)?|vertex(?:_?id)?|point(?:_?id)?)$/iu.test(header),
        );
        const typeIndexes = table.headers.flatMap((header, index) =>
            /^(?:(?:node|location)_?)?(?:type|kind|role|category)$/iu.test(header) ? [index] : [],
        );
        const descriptorIndexes = table.headers.flatMap((header, index) =>
            /^(?:(?:node|location)_?)?(?:label|name|title|description|desc|notes?)$/iu.test(header) ? [index] : [],
        );
        if (idIndex < 0 || (typeIndexes.length === 0 && descriptorIndexes.length === 0)) continue;
        for (const row of table.rows) {
            const identifier = normalizedIdentifier(row[idIndex] ?? "");
            const normalized = identifier.toLowerCase();
            if (!graphNodes.has(normalized)) continue;
            const descriptors = descriptorIndexes
                .map((index) => normalizedIdentifier(row[index] ?? ""))
                .filter(Boolean)
                .slice(0, 8);
            if (descriptors.length > 0) {
                nodeDescriptors.set(
                    normalized,
                    Array.from(new Set([...(nodeDescriptors.get(normalized) ?? []), ...descriptors])).slice(0, 16),
                );
            }
            const priority = Math.max(0, ...typeIndexes.map((index) => routeGoalPriority(row[index] ?? "")));
            if (priority > (goalPriorities.get(normalized) ?? 0)) goalPriorities.set(normalized, priority);
        }
    }
    const maximumGoalPriority = Math.max(0, ...goalPriorities.values());
    const verifiedGoals = new Set(
        Array.from(goalPriorities.entries()).flatMap(([identifier, priority]) =>
            priority > 0 && priority === maximumGoalPriority ? [identifier] : [],
        ),
    );

    // Answer-side route hints must come from the already verified graph. The
    // generic scanner intentionally rejects ordinary alphabetic hyphenated
    // prose, but graph identifiers such as PLACE-START are unambiguous once
    // their exact boundary-delimited value occurs in a verified node catalog.
    // Preserve body order so CSV row order can never select the route premise.
    const orderedAnswerGraphIds = verifiedGraphIdentifiersInAnswer(answerText, graphNodes);
    const answerIds = new Set(orderedAnswerGraphIds);
    const userIds = new Set(requiredKnowledgeIdentifiers(userText).map((item) => item.toLowerCase()));
    const directStarts = new Set<string>();
    const relatedStarts = new Set<string>();
    for (const identifier of userIds) if (graphNodes.has(identifier)) directStarts.add(identifier);
    // An unquoted alphabetic graph ID can still be an explicit premise once it
    // is boundary-matched against this trusted graph. Keep the global generic
    // scanner conservative and select only the first outgoing, non-goal node
    // from user-text order when no already recognized explicit ID exists.
    if (directStarts.size === 0) {
        const verifiedUserStart = verifiedGraphIdentifiersInAnswer(userText, graphNodes).find(
            (identifier) => outgoing.has(identifier) && !verifiedGoals.has(identifier),
        );
        if (verifiedUserStart) directStarts.add(verifiedUserStart);
    }
    for (const table of tables) {
        const locationColumns = table.headers.flatMap((header, index) =>
            /^(?:location|position|origin|start)(?:_?(?:node|location))?(?:_?id)?$/iu.test(header) ? [index] : [],
        );
        for (const row of table.rows) {
            if (!row.some((cell) => userIds.has(cell.toLowerCase()))) continue;
            for (const index of locationColumns) {
                const candidate = (row[index] ?? "").toLowerCase();
                if (graphNodes.has(candidate)) relatedStarts.add(candidate);
            }
        }
    }

    const starts = new Set(directStarts);
    let hasVerifiedStartPremise = starts.size > 0;
    let unresolvedRelatedStartAmbiguity = false;
    if (starts.size === 0 && relatedStarts.size > 0) {
        const descriptorLexemesByStart = new Map(
            Array.from(relatedStarts).map((identifier) => [
                identifier,
                new Set((nodeDescriptors.get(identifier) ?? []).flatMap(descriptorLexemes)),
            ]),
        );
        const descriptorLexemeCounts = new Map<string, number>();
        for (const lexemes of descriptorLexemesByStart.values()) {
            for (const lexeme of lexemes)
                descriptorLexemeCounts.set(lexeme, (descriptorLexemeCounts.get(lexeme) ?? 0) + 1);
        }
        const sharedDescriptorLexemes = new Set(
            Array.from(descriptorLexemeCounts.entries()).flatMap(([lexeme, count]) => (count > 1 ? [lexeme] : [])),
        );
        const rankedRelatedStarts = Array.from(relatedStarts)
            .map((identifier) => ({
                identifier,
                score: queryToNodeDescriptorScore(
                    userText,
                    descriptorLexemesByStart.get(identifier) ?? new Set(),
                    sharedDescriptorLexemes,
                ),
            }))
            .sort((left, right) => right.score - left.score || left.identifier.localeCompare(right.identifier));
        const uniqueDescriptorMatch =
            rankedRelatedStarts[0] &&
            rankedRelatedStarts[0].score > 0 &&
            rankedRelatedStarts[0].score > (rankedRelatedStarts[1]?.score ?? 0)
                ? rankedRelatedStarts[0].identifier
                : undefined;
        if (uniqueDescriptorMatch) {
            starts.add(uniqueDescriptorMatch);
            hasVerifiedStartPremise = true;
        }
        // Multiple equally described related locations are genuinely
        // ambiguous. Retain the ambiguity explicitly; the draft must never
        // select its own premise through later answer-overlap ranking.
        else {
            for (const identifier of relatedStarts) starts.add(identifier);
            unresolvedRelatedStartAmbiguity = relatedStarts.size > 1;
            if (!unresolvedRelatedStartAmbiguity) hasVerifiedStartPremise = true;
        }
    }
    // Answer identifiers are only a final fallback start hint. Choosing the
    // first non-goal graph occurrence with an outgoing edge preserves answer
    // order and avoids treating a destination or dead-end mention as the route
    // premise. Explicit and relation-derived starts retain higher priority.
    if (starts.size === 0) {
        const claimedStart = orderedAnswerGraphIds.find(
            (identifier) => outgoing.has(identifier) && !verifiedGoals.has(identifier),
        );
        if (claimedStart) starts.add(claimedStart);
    }
    if (unresolvedRelatedStartAmbiguity) return { ...EMPTY_ROUTE_ANALYSIS, hasVerifiedGraph: true };

    let paths: string[][] = [];
    let pathEnumerationTruncated = false;
    if (verifiedGoals.size > 0) {
        const shortest = shortestVerifiedGoalPaths(
            new Set(Array.from(starts).map((start) => graphNodes.get(start) ?? start)),
            outgoing,
            verifiedGoals,
        );
        paths = shortest.paths;
        pathEnumerationTruncated = shortest.truncated;
    } else {
        const visit = (path: string[]) => {
            if (paths.length >= MAX_ROUTE_PATHS) {
                pathEnumerationTruncated = true;
                return;
            }
            const next = (outgoing.get(path.at(-1)?.toLowerCase() ?? "") ?? []).filter(
                (edge) => !path.some((node) => node.toLowerCase() === edge.to.toLowerCase()),
            );
            if (next.length === 0) {
                paths.push(path);
                return;
            }
            // Reaching the depth cap while unexplored edges remain is not proof
            // of a destination. Fail closed instead of inventing an endpoint.
            if (path.length >= MAX_ROUTE_PATH_DEPTH) {
                pathEnumerationTruncated = true;
                return;
            }
            for (const edge of next.slice(0, 8)) visit([...path, edge.to]);
            if (next.length > 8) pathEnumerationTruncated = true;
        };
        for (const start of starts) visit([graphNodes.get(start) ?? start]);
    }
    if (pathEnumerationTruncated) return { ...EMPTY_ROUTE_ANALYSIS, hasVerifiedGraph: true };
    const eligiblePaths = paths.filter((path) => path.length >= 3);
    const ranked = eligiblePaths
        .map((path) => ({ path, overlap: path.filter((node) => answerIds.has(node.toLowerCase())).length }))
        .sort((left, right) => right.overlap - left.overlap || left.path.length - right.path.length);
    if (ranked.length === 0) return { ...EMPTY_ROUTE_ANALYSIS, hasVerifiedGraph: true };
    const bestOverlap = ranked[0]?.overlap ?? 0;
    const equallyGrounded = ranked.filter((candidate) => candidate.overlap === bestOverlap).map(({ path }) => path);
    const conservativeTraversal =
        eligiblePaths.length === 1 ? (eligiblePaths[0] ?? []) : orderedCommonRouteNodes(eligiblePaths);
    const traversal = new Set(conservativeTraversal.map((identifier) => identifier.toLowerCase()));
    return {
        coreIdentifiers: boundedRouteCore(equallyGrounded),
        equipmentTraversalIdentifiers: hasVerifiedStartPremise
            ? Array.from(traversal)
            : orderedAnswerGraphIds.filter((identifier) => traversal.has(identifier)),
        hasVerifiedGraph: true,
    };
}

/**
 * Return stable identifiers which the final answer draft must preserve.
 * User-supplied identifiers are always included. A small set of relation and
 * route identifiers may additionally be derived from current-turn, trusted
 * CSV evidence when the request explicitly asks for those dimensions.
 */
export interface KnowledgeAnswerCompletenessAnalysis {
    missingIdentifiers: string[];
    /** Trusted evidence intersected the request but could not form a safe, complete identifier contract. */
    unresolvedEvidence: boolean;
}

export function analyzeKnowledgeAnswerCompleteness(input: {
    userText: string;
    answerText: string;
    grounding?: string;
}): KnowledgeAnswerCompletenessAnalysis {
    const normalizedAnswer = input.answerText.normalize("NFKC");
    const tables = groundedTables(input.grounding);
    const route = verifiedRouteAnalysis(input.userText, input.answerText, tables);
    const restrictiveState = analyzeRestrictiveStateIdentifiers(input.userText, input.grounding);
    const required = Array.from(
        new Set([
            ...requiredKnowledgeIdentifiers(input.userText),
            ...restrictiveState.identifiers,
            ...directEquipmentIdentifiers(input.userText, input.answerText, tables, route),
            ...route.coreIdentifiers,
        ]),
    );
    return {
        missingIdentifiers: required.filter((identifier) => !containsIdentifier(normalizedAnswer, identifier)),
        unresolvedEvidence: restrictiveState.unresolvedEvidence,
    };
}

/** Backward-compatible identifier-only view for callers that do not yet consume structured diagnostics. */
export function missingRequiredKnowledgeIdentifiers(input: {
    userText: string;
    answerText: string;
    grounding?: string;
}): string[] {
    return analyzeKnowledgeAnswerCompleteness(input).missingIdentifiers;
}
