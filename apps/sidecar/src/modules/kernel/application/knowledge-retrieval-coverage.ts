import type {
    KnowledgeRetrievalObligation,
    KnowledgeRetrievalObligationKind,
    KnowledgeRouteScopeBinding,
    KnowledgeRouteScopeContract,
    KnowledgeRouteScopeResolution,
} from "./knowledge-grounding-planner";
import {
    isKnowledgeTrustedStructuredEvidence,
    type KnowledgeTrustedStructuredEvidence,
} from "./knowledge-structured-pagination";

export type KnowledgeCoverageStatus = "covered" | "partial" | "uncovered" | "stale";

export interface KnowledgeVerifiedHistoryLocator {
    assetId: string;
    path: string;
    kind: "source" | "record" | "section" | "chunk";
    value: string;
}

export type KnowledgeCoverageReason =
    | "no_hit"
    | "source_limit"
    | "byte_limit"
    | "read_error"
    | "index_incomplete"
    | "result_truncated"
    | "evidence_truncated"
    | "structured_query_unavailable"
    | "structured_query_failed"
    | "structured_query_invalid"
    | "structured_query_truncated"
    | "structured_projection_truncated"
    | "structured_exhaustive_pagination_not_supported"
    | "cursor_inconsistent"
    | "revision_changed"
    | "scope_unresolved"
    | "missing_identifier";

export interface KnowledgeCoverageFacetPlan {
    id: string;
    query: string;
    searchGroup: number;
    hitCount: number;
    kind?: KnowledgeRetrievalObligationKind;
    completion?: KnowledgeRetrievalObligation["completion"];
    identifiers?: string[];
    sourcePaths?: string[];
    /** Catalog-bound source identities (`assetId:path`). */
    sourceKeys?: string[];
    /** Catalog-proven exact relation filters required for this source-bound read. */
    filters?: NonNullable<KnowledgeRetrievalObligation["filters"]>;
    /** Two-stage scope contract, including the runner's verified resolution receipt. */
    routeScope?: KnowledgeRouteScopeContract;
    /**
     * Persisted, previously verified source locators that an explicit bounded
     * history review must re-read against the current revision. These remain
     * structured so equal locator values from different sources cannot credit
     * one another.
     */
    verifiedHistoryLocators?: KnowledgeVerifiedHistoryLocator[];
    /** Every independently returned candidate that complete mode must verify. */
    candidateKeys?: string[];
    /** This facet has another authenticated search page. */
    searchTruncated?: boolean;
}

export interface KnowledgePendingSearchPage {
    id: "primary" | `facet-${number}`;
    searchGroup: number;
    query: string;
    limit: number;
    nextSearchCursor: string;
    searchOffset: number;
}

export interface KnowledgeCoveragePlan {
    version: 1;
    query: string;
    mode: "fast" | "complete";
    facets: KnowledgeCoverageFacetPlan[];
    identifiers: string[];
    indexRevision?: string;
    indexIncomplete?: boolean;
    resultTruncated?: boolean;
    facetSearchFailed?: boolean;
    /** A non-primary facet could not be advanced by an authenticated cursor. */
    facetSearchTruncated?: boolean;
    supplementalPasses: number;
    catalogCovered?: boolean;
    catalogTruncated?: boolean;
    catalogOmittedCount?: number;
    catalogUnretrievableCount?: number;
    recordIdsTruncated?: boolean;
    nextSearchCursor?: string;
    pendingSearchPages?: KnowledgePendingSearchPage[];
    nextCatalogCursor?: string;
    searchOffset?: number;
    catalogOffset?: number;
    /** Cumulative, tool-derived evidence carried between authenticated pages. */
    trustedEvidence?: KnowledgeTrustedEvidencePointer[];
    trustedTableSummaries?: KnowledgeTrustedTableSummary[];
    /** Number of accumulated coverage receipts/user turns, not internal signed search pages. */
    pageCount?: number;
    evidenceTruncated?: boolean;
    revisionChanged?: boolean;
    /** Independent status for a deterministic structured-query obligation. */
    structuredQuery?: {
        status: "covered" | "partial" | "uncovered";
        /** The deterministic query fully satisfies this request; text search is supporting evidence only. */
        authoritative?: boolean;
        /** The structured sub-result left another prose obligation whose supporting search must remain fail-closed. */
        supportingSearchRequired?: boolean;
        reason?: Extract<
            KnowledgeCoverageReason,
            | "structured_query_unavailable"
            | "structured_query_failed"
            | "structured_query_invalid"
            | "structured_query_truncated"
            | "structured_projection_truncated"
            | "structured_exhaustive_pagination_not_supported"
        >;
        /** A signed continuation returned by the revision-pinned structured query. */
        nextCursor?: string;
        /** The structured obligation asks for every matching row. */
        exhaustive?: boolean;
        /** Typed obligations independently discharged by this bound result. */
        completedObligationIds?: string[];
    };
    /** Bounded, revision/request-bound rows retained for a structured continuation. */
    structuredEvidence?: KnowledgeTrustedStructuredEvidence;
}

export interface KnowledgeTrustedEvidencePointer {
    key: string;
    path: string;
    searchGroups: number[];
    assetId?: string;
    expectedRevision?: string;
    identifiers?: string[];
    filters?: Array<{ column: string; op: "eq" | "in"; value: string | string[] }>;
    selectorSignature?: string;
    obligationIds?: string[];
    verifiedHistoryLocators?: KnowledgeVerifiedHistoryLocator[];
}

export interface KnowledgeTrustedTableSummary {
    assetId?: string;
    path: string;
    title?: string;
    mime?: string;
    columns?: string[];
    primaryKey?: string;
    recordCount?: number;
    recordIds?: string[];
    recordIdsTruncated?: boolean;
    resource?: string;
    aliases?: string[];
    relations?: KnowledgeTrustedTableRelation[];
}

export interface KnowledgeTrustedTableRelation {
    sourceColumn: string;
    targetPath: string;
    targetColumn: string;
    confidence: "declared" | "high" | "medium";
    reason?: "schema" | "column_identity" | "column_entity_match";
}

export interface KnowledgeCoverageAccumulator {
    protocolVersion: 1;
    query: string;
    mode: "fast" | "complete";
    /** Number of accumulated coverage receipts/user turns, not internal signed search pages. */
    pageCount: number;
    facets: KnowledgeCoverageFacetPlan[];
    identifiers: string[];
    trustedEvidence: KnowledgeTrustedEvidencePointer[];
    trustedTableSummaries: KnowledgeTrustedTableSummary[];
    structuredEvidence?: KnowledgeTrustedStructuredEvidence;
    indexRevision?: string;
    evidenceTruncated?: boolean;
}

export interface KnowledgeCoverageFacet {
    id: string;
    query: string;
    status: KnowledgeCoverageStatus;
    selectedPaths: string[];
    reason?: KnowledgeCoverageReason;
}

export interface KnowledgeCoverageReceipt {
    version: 1;
    query: string;
    mode: "fast" | "complete";
    status: "complete" | "partial" | "blocked";
    facets: KnowledgeCoverageFacet[];
    requestedIdentifiers: string[];
    matchedIdentifiers: string[];
    missingIdentifiers: string[];
    required: number;
    verified: number;
    missing: number;
    hasMore: boolean;
    indexRevision?: string;
    supplementalPasses: number;
    resultTruncated?: boolean;
    catalogTruncated?: boolean;
    catalogOmittedCount?: number;
    catalogUnretrievableCount?: number;
    recordIdsTruncated?: boolean;
    nextSearchCursor?: string;
    pendingSearchPages?: KnowledgePendingSearchPage[];
    nextCatalogCursor?: string;
    nextStructuredCursor?: string;
    searchOffset?: number;
    catalogOffset?: number;
    accumulator?: KnowledgeCoverageAccumulator;
}

export interface KnowledgeContinuationState {
    protocolVersion: 1;
    query: string;
    mode: "fast" | "complete";
    status: "complete" | "partial" | "blocked";
    unresolved: Array<{
        id: string;
        query: string;
        status: "partial" | "uncovered" | "stale";
        reason?: KnowledgeCoverageReason;
        selectedPaths: string[];
    }>;
    missingIdentifiers: string[];
    resultTruncated?: boolean;
    catalogOmittedCount?: number;
    nextSearchCursor?: string;
    pendingSearchPages?: KnowledgePendingSearchPage[];
    nextCatalogCursor?: string;
    nextStructuredCursor?: string;
    searchOffset?: number;
    catalogOffset?: number;
    indexRevision?: string;
    hasMore: boolean;
    accumulator?: KnowledgeCoverageAccumulator;
}

interface ReadEvidence {
    path: string;
    readPath: string;
    groups: number[];
    searchGroupsInvalid: boolean;
    searchIndependentMetadataInvalid: boolean;
    truncated: boolean;
    failed: boolean;
    stale: boolean;
    matchedIdentifiers: string[];
    missingIdentifiers: string[];
    key?: string;
    assetId?: string;
    expectedRevision?: string;
    identifiers: string[];
    filters: Array<{ column: string; op: "eq" | "in"; value: string | string[] }>;
    selectorSignature?: string;
    obligationIds: string[];
    verifiedHistoryLocators: KnowledgeVerifiedHistoryLocator[];
    selectorMetadataInvalid: boolean;
    content: string;
}

const MAX_ACCUMULATED_FACETS = 16;
const MAX_ACCUMULATED_CANDIDATE_KEYS = 256;
const MAX_ACCUMULATED_EVIDENCE = 32;
const MAX_ACCUMULATED_TABLE_SUMMARIES = 32;
const MAX_ACCUMULATOR_BYTES = 128 * 1024;

const stringArray = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];

function validKnowledgeSelectorSignature(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > 8_192) return false;
    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.v !== 1) return false;
        if (!["full", "exact", "filter", "semantic"].includes(String(parsed.kind))) return false;
        if (typeof parsed.assetId !== "string" || parsed.assetId.length > 512) return false;
        if (typeof parsed.path !== "string" || !parsed.path.trim() || parsed.path.length > 4_096) return false;
        if (!boundedStrings(parsed.identifiers ?? [], 64, 512)) return false;
        if (parsed.filters !== undefined) {
            if (!Array.isArray(parsed.filters) || parsed.filters.length > 16) return false;
            for (const filter of parsed.filters) {
                if (!filter || typeof filter !== "object" || Array.isArray(filter)) return false;
                const record = filter as Record<string, unknown>;
                if (!boundedString(record.column, 160) || (record.op !== "eq" && record.op !== "in")) return false;
                if (!boundedStrings(record.value, 64, 512)) return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

function safeVerifiedHistoryPath(value: unknown): value is string {
    if (typeof value !== "string" || value !== value.trim() || value.length === 0 || value.length > 4_096) {
        return false;
    }
    if (/^[\\/]|\\|[\p{Cc}\p{Co}:?#]/u.test(value) || /%2e|%2f|%5c/iu.test(value)) return false;
    return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function safeVerifiedHistoryLocatorValue(value: unknown): value is string {
    if (typeof value !== "string" || value !== value.trim() || value.length === 0 || value.length > 512) return false;
    if (/[\p{Cc}\p{Co}]/u.test(value) || /(?:asset|file|https?):\/{1,2}/iu.test(value)) return false;
    if (/\b(?:bearer|api[_ -]?key|secret|token|credential)\b/iu.test(value)) return false;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) && !value.startsWith("source:")) return false;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) return false;
    return true;
}

function isKnowledgeVerifiedHistoryLocator(value: unknown): value is KnowledgeVerifiedHistoryLocator {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (
        typeof record.assetId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/u.test(record.assetId) ||
        !safeVerifiedHistoryPath(record.path) ||
        (record.kind !== "source" &&
            record.kind !== "record" &&
            record.kind !== "section" &&
            record.kind !== "chunk") ||
        !safeVerifiedHistoryLocatorValue(record.value)
    ) {
        return false;
    }
    if (record.kind === "source") return record.value === `source:${record.path}`;
    return (
        record.kind !== "chunk" ||
        record.value === `source:${record.path}#${/^source:.*#(\d+)$/u.exec(record.value)?.[1] ?? ""}`
    );
}

function boundedVerifiedHistoryLocators(value: unknown): value is KnowledgeVerifiedHistoryLocator[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false;
    const identities = new Set<string>();
    for (const locator of value) {
        if (!isKnowledgeVerifiedHistoryLocator(locator)) return false;
        const identity = `${locator.assetId}\u0000${locator.path}\u0000${locator.kind}\u0000${locator.value}`;
        if (identities.has(identity)) return false;
        identities.add(identity);
    }
    return true;
}

function normalizedReadFilters(value: unknown): ReadEvidence["filters"] {
    if (!Array.isArray(value) || value.length > 16) return [];
    const filters: ReadEvidence["filters"] = [];
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        if (!boundedString(record.column, 160) || (record.op !== "eq" && record.op !== "in")) return [];
        const values = Array.isArray(record.value) ? record.value : [record.value];
        if (!boundedStrings(values, 64, 512)) return [];
        filters.push({
            column: record.column,
            op: record.op,
            value: record.op === "eq" && values.length === 1 ? values[0] : values,
        });
    }
    return filters;
}

const KNOWLEDGE_READ_TRUNCATION_NOTICE = "[Knowledge read truncated by the grounding byte budget.]";

export function isKnowledgeReadReceiptTruncated(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (record.__knowledgeReadTruncated === true || record.__knowledgeContentTruncated === true) return true;
    const content =
        typeof record.content === "string" ? record.content : typeof record.body === "string" ? record.body : "";
    return content.normalize("NFKC").trimEnd().endsWith(KNOWLEDGE_READ_TRUNCATION_NOTICE);
}

export function isKnowledgeReadReceiptFailed(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        record.__knowledgeReadFailed === true ||
        (typeof record.status === "string" && record.status.normalize("NFKC").trim().toLowerCase() === "error")
    );
}

function readEvidence(value: unknown): ReadEvidence | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const content =
        typeof record.content === "string" ? record.content : typeof record.body === "string" ? record.body : "";
    const rawGroups = record.__knowledgeSearchGroups;
    const groups = Array.isArray(rawGroups)
        ? rawGroups.filter(
              (item): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 8,
          )
        : [];
    const rawIdentifiers = record.__knowledgeReadIdentifiers;
    const identifiers = stringArray(rawIdentifiers);
    const normalizedRawIdentifiers = identifiers.map((item) => item.normalize("NFKC").trim().toLowerCase());
    const path = record.path ?? record.__knowledgePath ?? "";
    const readPath = record.__knowledgePath ?? record.path ?? "";
    const rawKey = record.__knowledgeHitKey;
    const rawAssetId = record.assetId;
    const rawExpectedRevision = record.__knowledgeExpectedRevision;
    return {
        path: String(path),
        readPath: String(readPath),
        groups,
        searchGroupsInvalid:
            !Array.isArray(rawGroups) ||
            rawGroups.length > 9 ||
            groups.length !== rawGroups.length ||
            groups.length !== new Set(groups).size,
        searchIndependentMetadataInvalid:
            typeof path !== "string" ||
            path !== path.trim() ||
            path.length === 0 ||
            path.length > 4_096 ||
            typeof readPath !== "string" ||
            readPath !== readPath.trim() ||
            readPath.length === 0 ||
            readPath.length > 4_096 ||
            typeof rawKey !== "string" ||
            rawKey !== rawKey.trim() ||
            rawKey.length === 0 ||
            rawKey.length > 2_048 ||
            typeof rawAssetId !== "string" ||
            rawAssetId !== rawAssetId.trim() ||
            rawAssetId.length === 0 ||
            rawAssetId.length > 512 ||
            typeof rawExpectedRevision !== "string" ||
            rawExpectedRevision !== rawExpectedRevision.trim() ||
            rawExpectedRevision.length === 0 ||
            rawExpectedRevision.length > 2_048 ||
            (rawIdentifiers !== undefined &&
                (!Array.isArray(rawIdentifiers) ||
                    rawIdentifiers.length > 64 ||
                    identifiers.length !== rawIdentifiers.length ||
                    identifiers.some((item) => item !== item.trim() || item.length > 512) ||
                    normalizedRawIdentifiers.length !== new Set(normalizedRawIdentifiers).size)) ||
            record.__knowledgeReadFilters !== undefined,
        truncated: isKnowledgeReadReceiptTruncated(record),
        failed: isKnowledgeReadReceiptFailed(record),
        stale: record.__knowledgeRevisionChanged === true,
        matchedIdentifiers: stringArray(record.matchedIdentifiers),
        missingIdentifiers: stringArray(record.missingIdentifiers),
        key: typeof record.__knowledgeHitKey === "string" ? record.__knowledgeHitKey : undefined,
        assetId: typeof record.assetId === "string" && record.assetId.trim() ? record.assetId.trim() : undefined,
        expectedRevision:
            typeof record.__knowledgeExpectedRevision === "string" && record.__knowledgeExpectedRevision.trim()
                ? record.__knowledgeExpectedRevision.trim()
                : undefined,
        identifiers: identifiers.slice(0, 64),
        filters: normalizedReadFilters(record.__knowledgeReadFilters),
        selectorSignature: validKnowledgeSelectorSignature(record.__knowledgeSelectorSignature)
            ? record.__knowledgeSelectorSignature
            : undefined,
        obligationIds: boundedStrings(record.__knowledgeObligationIds ?? [], 32, 256)
            ? stringArray(record.__knowledgeObligationIds).slice(0, 32)
            : [],
        verifiedHistoryLocators: boundedVerifiedHistoryLocators(record.__knowledgeVerifiedHistoryLocators)
            ? record.__knowledgeVerifiedHistoryLocators
            : [],
        selectorMetadataInvalid:
            (record.__knowledgeSelectorSignature !== undefined &&
                !validKnowledgeSelectorSignature(record.__knowledgeSelectorSignature)) ||
            (record.__knowledgeObligationIds !== undefined &&
                !boundedStrings(record.__knowledgeObligationIds, 32, 256)) ||
            (record.__knowledgeVerifiedHistoryLocators !== undefined &&
                !boundedVerifiedHistoryLocators(record.__knowledgeVerifiedHistoryLocators)),
        content,
    };
}

function unique(values: string[], max = 64): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, max);
}

function sameNormalizedIdentifierSet(left: string[], right: string[]): boolean {
    const normalize = (value: string): string => value.normalize("NFKC").trim().toLowerCase();
    const normalizedLeft = left.map(normalize);
    const normalizedRight = right.map(normalize);
    const leftSet = new Set(normalizedLeft);
    const rightSet = new Set(normalizedRight);
    return (
        normalizedLeft.every(Boolean) &&
        normalizedRight.every(Boolean) &&
        normalizedLeft.length === leftSet.size &&
        normalizedRight.length === rightSet.size &&
        leftSet.size === rightSet.size &&
        Array.from(leftSet).every((value) => rightSet.has(value))
    );
}

function isSearchIndependentVerifiedHistoryPointer(
    pointer: KnowledgeTrustedEvidencePointer,
    context: Pick<KnowledgeCoveragePlan, "facets" | "indexRevision">,
): boolean {
    if (
        pointer.searchGroups.length !== 0 ||
        !pointer.assetId ||
        pointer.assetId !== pointer.assetId.trim() ||
        !pointer.expectedRevision ||
        pointer.expectedRevision !== pointer.expectedRevision.trim() ||
        pointer.filters !== undefined ||
        pointer.obligationIds?.length !== 1 ||
        pointer.obligationIds[0] !== "verified-history-locators" ||
        !boundedVerifiedHistoryLocators(pointer.verifiedHistoryLocators)
    ) {
        return false;
    }
    const historyFacets = context.facets.filter((facet) => facet.id === "verified-history-locators");
    if (historyFacets.length !== 1) return false;
    const facet = historyFacets[0];
    if (
        facet.searchGroup !== 0 ||
        facet.completion !== "all_sources_verified" ||
        !boundedVerifiedHistoryLocators(facet.verifiedHistoryLocators)
    ) {
        return false;
    }
    const locators = pointer.verifiedHistoryLocators;
    const first = locators[0];
    if (!first) return false;
    const assetId = pointer.assetId;
    const path = first.path;
    const kind = first.kind;
    if (
        locators.some((locator) => locator.assetId !== assetId || locator.path !== path || locator.kind !== kind) ||
        !(facet.sourcePaths ?? []).some((candidate) => normalizedEvidencePath(candidate) === path) ||
        !(facet.sourceKeys ?? []).some((candidate) => normalizedSourceKey(candidate) === `${assetId}:${path}`)
    ) {
        return false;
    }
    const facetLocators = facet.verifiedHistoryLocators.filter(
        (locator) => locator.assetId === assetId && locator.path === path && locator.kind === kind,
    );
    if (
        facetLocators.length !== locators.length ||
        !locators.every((locator) => facetLocators.some((candidate) => sameVerifiedHistoryLocator(candidate, locator)))
    ) {
        return false;
    }
    const expectedRevision = revisionForBoundAsset(context.indexRevision, assetId);
    if (!expectedRevision || pointer.expectedRevision !== expectedRevision) return false;
    const keyPrefix = `${assetId}:`;
    if (
        pointer.key !== pointer.key.trim() ||
        !pointer.key.startsWith(keyPrefix) ||
        normalizedEvidencePath(pointer.key.slice(keyPrefix.length)) !== path
    ) {
        return false;
    }
    const expectedReadPath = kind === "chunk" ? first.value : path;
    if (pointer.path !== expectedReadPath) return false;
    const selector = parsedKnowledgeSelectorSignature(pointer.selectorSignature);
    if (
        !selector ||
        selector.hasFilters ||
        selector.assetId !== assetId ||
        selector.path !== path ||
        selector.kind !== (kind === "source" ? "full" : "exact")
    ) {
        return false;
    }
    const pointerIdentifiers = pointer.identifiers ?? [];
    if (pointerIdentifiers.some((identifier) => identifier !== identifier.trim())) return false;
    if (kind === "source") {
        return locators.length === 1 && pointerIdentifiers.length === 0 && selector.identifiers.length === 0;
    }
    const locatorValues = locators.map((locator) => locator.value);
    return (
        sameNormalizedIdentifierSet(locatorValues, pointerIdentifiers) &&
        sameNormalizedIdentifierSet(locatorValues, selector.identifiers)
    );
}

function pointerFromEvidence(
    evidence: ReadEvidence,
    plan: Pick<KnowledgeCoveragePlan, "facets" | "indexRevision">,
): KnowledgeTrustedEvidencePointer | null {
    if (
        evidence.failed ||
        evidence.truncated ||
        evidence.stale ||
        evidence.searchGroupsInvalid ||
        evidence.selectorMetadataInvalid ||
        !evidence.key?.trim() ||
        !evidence.readPath.trim()
    ) {
        return null;
    }
    const pointer: KnowledgeTrustedEvidencePointer = {
        key: evidence.key.trim().slice(0, 2_048),
        path: evidence.readPath.trim().slice(0, 4_096),
        searchGroups: Array.from(new Set(evidence.groups)).slice(0, 9),
        ...(evidence.assetId ? { assetId: evidence.assetId.slice(0, 512) } : {}),
        ...(evidence.expectedRevision ? { expectedRevision: evidence.expectedRevision.slice(0, 2_048) } : {}),
        ...(evidence.identifiers.length > 0 ? { identifiers: unique(evidence.identifiers, 64) } : {}),
        ...(evidence.filters.length > 0 ? { filters: evidence.filters } : {}),
        ...(evidence.selectorSignature ? { selectorSignature: evidence.selectorSignature } : {}),
        ...(evidence.obligationIds.length > 0 ? { obligationIds: evidence.obligationIds.slice(0, 32) } : {}),
        ...(evidence.verifiedHistoryLocators.length > 0
            ? { verifiedHistoryLocators: evidence.verifiedHistoryLocators }
            : {}),
    };
    if (pointer.searchGroups.length > 0) return pointer;
    return !evidence.searchIndependentMetadataInvalid && isSearchIndependentVerifiedHistoryPointer(pointer, plan)
        ? pointer
        : null;
}

function trustedEvidencePointerIdentity(pointer: KnowledgeTrustedEvidencePointer): string {
    return pointer.selectorSignature ? `selector:${pointer.selectorSignature}` : `legacy:${pointer.key}`;
}

function tableSummaryIdentity(summary: KnowledgeTrustedTableSummary): string {
    return `${summary.assetId ?? ""}:${summary.path}`;
}

function tableRelationIdentity(relation: KnowledgeTrustedTableRelation): string {
    return [
        relation.sourceColumn,
        relation.targetPath,
        relation.targetColumn,
        relation.confidence,
        relation.reason ?? "",
    ].join(":");
}

function mergeTrustedTableSummary(
    prior: KnowledgeTrustedTableSummary,
    current: KnowledgeTrustedTableSummary,
): KnowledgeTrustedTableSummary {
    const relations = Array.from(
        new Map(
            [...(prior.relations ?? []), ...(current.relations ?? [])].map(
                (relation) => [tableRelationIdentity(relation), relation] as const,
            ),
        ).values(),
    ).slice(0, 24);
    return {
        ...prior,
        ...current,
        columns: Array.from(new Set([...(prior.columns ?? []), ...(current.columns ?? [])])).slice(0, 64),
        recordIds: Array.from(new Set([...(prior.recordIds ?? []), ...(current.recordIds ?? [])])).slice(0, 256),
        recordIdsTruncated:
            prior.recordIdsTruncated === true ||
            current.recordIdsTruncated === true ||
            (prior.recordIds?.length ?? 0) + (current.recordIds?.length ?? 0) > 256,
        aliases: Array.from(new Set([...(prior.aliases ?? []), ...(current.aliases ?? [])])).slice(0, 16),
        ...(relations.length > 0 ? { relations } : {}),
    };
}

function mergeTableSummaries(values: KnowledgeTrustedTableSummary[]): {
    values: KnowledgeTrustedTableSummary[];
    truncated: boolean;
} {
    const byIdentity = new Map<string, KnowledgeTrustedTableSummary>();
    for (const summary of values.filter((item) => item.path.trim())) {
        const identity = tableSummaryIdentity(summary);
        const prior = byIdentity.get(identity);
        byIdentity.set(identity, prior ? mergeTrustedTableSummary(prior, summary) : summary);
    }
    const merged = Array.from(byIdentity.values());
    return {
        values: merged.slice(0, MAX_ACCUMULATED_TABLE_SUMMARIES),
        truncated: merged.length > MAX_ACCUMULATED_TABLE_SUMMARIES,
    };
}

interface NormalizedContinuationCursors {
    pendingSearchPages: KnowledgePendingSearchPage[];
    nextSearchCursor?: string;
    searchOffset?: number;
    nextStructuredCursor?: string;
    inconsistent: boolean;
}

function normalizeContinuationCursors(plan: KnowledgeCoveragePlan): NormalizedContinuationCursors {
    const rawPages = plan.pendingSearchPages;
    let inconsistent =
        rawPages !== undefined &&
        !(Array.isArray(rawPages) && rawPages.length === 0) &&
        !isKnowledgePendingSearchPages(rawPages);
    let pendingSearchPages = inconsistent ? [] : (rawPages ?? []).slice(0, 9);
    const primaryPage = pendingSearchPages.find((page) => page.searchGroup === 0);
    const explicitSearchCursor =
        typeof plan.nextSearchCursor === "string" && plan.nextSearchCursor.trim()
            ? plan.nextSearchCursor.trim()
            : undefined;
    const explicitSearchOffset =
        typeof plan.searchOffset === "number" && Number.isSafeInteger(plan.searchOffset) && plan.searchOffset >= 0
            ? plan.searchOffset
            : undefined;
    if (plan.nextSearchCursor !== undefined && !explicitSearchCursor) inconsistent = true;
    if (plan.searchOffset !== undefined && explicitSearchOffset === undefined) inconsistent = true;
    if (
        primaryPage &&
        ((explicitSearchCursor && explicitSearchCursor !== primaryPage.nextSearchCursor) ||
            (explicitSearchOffset !== undefined && explicitSearchOffset !== primaryPage.searchOffset))
    ) {
        inconsistent = true;
        pendingSearchPages = pendingSearchPages.filter((page) => page.searchGroup !== 0);
    }
    const retainedPrimary = pendingSearchPages.find((page) => page.searchGroup === 0);
    const nextSearchCursor = retainedPrimary?.nextSearchCursor ?? (!primaryPage ? explicitSearchCursor : undefined);
    const searchOffset = retainedPrimary?.searchOffset ?? (!primaryPage ? explicitSearchOffset : undefined);

    const structuredCursor = plan.structuredQuery?.nextCursor;
    const nextStructuredCursor =
        typeof structuredCursor === "string" && structuredCursor.trim() ? structuredCursor.trim() : undefined;
    if (structuredCursor !== undefined && !nextStructuredCursor) inconsistent = true;
    if (nextStructuredCursor && plan.structuredQuery?.status !== "partial") inconsistent = true;
    return {
        pendingSearchPages,
        ...(nextSearchCursor ? { nextSearchCursor } : {}),
        ...(searchOffset !== undefined ? { searchOffset } : {}),
        ...(nextStructuredCursor && plan.structuredQuery?.status === "partial" ? { nextStructuredCursor } : {}),
        inconsistent,
    };
}

/**
 * Merge the current authenticated page with the prior receipt. Pagination
 * flags intentionally come only from the current page; cumulative candidate
 * obligations and trusted read pointers survive until the query is exhausted.
 */
export function accumulateKnowledgeCoveragePlan(
    current: KnowledgeCoveragePlan,
    previous: KnowledgeCoverageAccumulator | undefined,
): KnowledgeCoveragePlan {
    if (!previous) return current;
    if (previous.query !== current.query || previous.mode !== current.mode) {
        return { ...current, revisionChanged: true };
    }

    const previousFacetCount = previous.facets.length;
    const newFacetCount = current.facets.filter(
        (facet) => !previous.facets.some((prior) => prior.id === facet.id),
    ).length;
    let candidateKeysTruncated = false;
    const facets = new Map<string, KnowledgeCoverageFacetPlan>(
        previous.facets.map((facet) => [facet.id, { ...facet, searchTruncated: false }]),
    );
    for (const facet of current.facets) {
        const prior = facets.get(facet.id);
        const candidateKeys = [...(prior?.candidateKeys ?? []), ...(facet.candidateKeys ?? [])];
        if (new Set(candidateKeys).size > MAX_ACCUMULATED_CANDIDATE_KEYS) candidateKeysTruncated = true;
        facets.set(facet.id, {
            ...facet,
            hitCount: (prior?.hitCount ?? 0) + facet.hitCount,
            candidateKeys: unique(candidateKeys, MAX_ACCUMULATED_CANDIDATE_KEYS),
        });
    }
    const tableSummaries = mergeTableSummaries([
        ...previous.trustedTableSummaries,
        ...(current.trustedTableSummaries ?? []),
    ]);
    const previousStructuredEvidence = previous.structuredEvidence;
    const currentStructuredEvidence = current.structuredEvidence;
    const structuredEvidenceChanged = Boolean(
        previousStructuredEvidence &&
            currentStructuredEvidence &&
            (previousStructuredEvidence.requestFingerprint !== currentStructuredEvidence.requestFingerprint ||
                previousStructuredEvidence.assetId !== currentStructuredEvidence.assetId ||
                previousStructuredEvidence.from !== currentStructuredEvidence.from ||
                previousStructuredEvidence.indexRevision !== currentStructuredEvidence.indexRevision),
    );
    const revisionChanged = Boolean(
        current.revisionChanged ||
            (previous.indexRevision && current.indexRevision && previous.indexRevision !== current.indexRevision) ||
            structuredEvidenceChanged,
    );
    return {
        ...current,
        facets: Array.from(facets.values()).slice(0, MAX_ACCUMULATED_FACETS),
        identifiers: unique([...previous.identifiers, ...current.identifiers]),
        indexRevision: current.indexRevision ?? previous.indexRevision,
        indexIncomplete: current.indexIncomplete,
        trustedEvidence: previous.trustedEvidence.slice(0, MAX_ACCUMULATED_EVIDENCE),
        trustedTableSummaries: tableSummaries.values,
        ...(currentStructuredEvidence ? { structuredEvidence: currentStructuredEvidence } : {}),
        pageCount: Math.min(64, previous.pageCount + 1),
        evidenceTruncated:
            previous.evidenceTruncated === true ||
            current.evidenceTruncated === true ||
            candidateKeysTruncated ||
            previousFacetCount + newFacetCount > MAX_ACCUMULATED_FACETS ||
            tableSummaries.truncated,
        revisionChanged,
    };
}

function normalizedEvidencePath(value: string): string {
    return value
        .trim()
        .replace(/^source:/u, "")
        .replace(/#\d+$/u, "");
}

function normalizedSourceKey(value: string): string {
    const separator = value.indexOf(":");
    if (separator <= 0) return "";
    const assetId = value.slice(0, separator).trim();
    const path = normalizedEvidencePath(value.slice(separator + 1));
    return assetId && path ? `${assetId}:${path}` : "";
}

function evidenceSourceKey(item: Pick<ReadEvidence, "assetId" | "path" | "readPath">): string {
    if (!item.assetId) return "";
    const path = normalizedEvidencePath(item.readPath || item.path);
    return path ? `${item.assetId}:${path}` : "";
}

function isChunkQualifiedRead(item: Pick<ReadEvidence, "readPath">): boolean {
    return /#\d+$/u.test(item.readPath.trim());
}

function sameIdentifier(left: string, right: string): boolean {
    return left.normalize("NFKC").trim().toLowerCase() === right.normalize("NFKC").trim().toLowerCase();
}

function evidenceMatchesFacetFilters(item: ReadEvidence, facet: KnowledgeCoverageFacetPlan): boolean {
    const expected = facet.filters ?? [];
    if (expected.length === 0) return true;
    return expected.every((filter) =>
        item.filters.some((actual) => {
            if (actual.column.normalize("NFKC").trim() !== filter.column.normalize("NFKC").trim()) return false;
            const values = Array.isArray(actual.value) ? actual.value : [actual.value];
            return values.some((value) => sameIdentifier(value, filter.value));
        }),
    );
}

function evidenceExactlyMatchesFacetFilters(item: ReadEvidence, facet: KnowledgeCoverageFacetPlan): boolean {
    const expected = facet.filters ?? [];
    if (expected.length === 0) return item.filters.length === 0 && item.identifiers.length === 0;
    const expectedByColumn = new Map<string, Set<string>>();
    for (const filter of expected) {
        const column = normalizedSchemaColumn(filter.column);
        const values = expectedByColumn.get(column) ?? new Set<string>();
        values.add(filter.value.normalize("NFKC").trim().toLowerCase());
        expectedByColumn.set(column, values);
    }
    if (item.identifiers.length > 0 || item.filters.length !== expectedByColumn.size) return false;
    for (const [column, expectedValues] of expectedByColumn) {
        const actual = item.filters.find((filter) => normalizedSchemaColumn(filter.column) === column);
        if (!actual) return false;
        const actualValues = (Array.isArray(actual.value) ? actual.value : [actual.value]).map((value) =>
            value.normalize("NFKC").trim().toLowerCase(),
        );
        // A single exact relation value must remain a scalar equality. An `in`
        // selector containing that value plus another scope is broader evidence
        // and cannot prove the requested bounded result. Conversely, multiple
        // expected values on the same column are one exact-set `in` selector.
        if (expectedValues.size === 1) {
            if (actual.op !== "eq" || Array.isArray(actual.value)) return false;
        } else if (actual.op !== "in" || !Array.isArray(actual.value)) {
            return false;
        }
        if (actualValues.length !== expectedValues.size || actualValues.some((value) => !expectedValues.has(value))) {
            return false;
        }
    }
    return true;
}

function selectorFiltersIdentity(filters: ReadEvidence["filters"]): string {
    return JSON.stringify(
        filters
            .map((filter) => ({
                column: normalizedSchemaColumn(filter.column),
                op: filter.op,
                value: (Array.isArray(filter.value) ? filter.value : [filter.value])
                    .map((value) => value.normalize("NFKC").trim().toLowerCase())
                    .sort((left, right) => left.localeCompare(right)),
            }))
            .sort((left, right) =>
                `${left.column}:${left.op}:${left.value.join("\u0000")}`.localeCompare(
                    `${right.column}:${right.op}:${right.value.join("\u0000")}`,
                ),
            ),
    );
}

function evidenceHasMatchingFilterSelector(item: ReadEvidence): boolean {
    if (!item.selectorSignature) return false;
    try {
        const selector = JSON.parse(item.selectorSignature) as Record<string, unknown>;
        if (selector.kind !== "filter" || stringArray(selector.identifiers).length > 0) return false;
        if (String(selector.assetId ?? "").trim() !== (item.assetId ?? "")) return false;
        if (normalizedEvidencePath(String(selector.path ?? "")) !== normalizedEvidencePath(item.readPath)) return false;
        const selectorFilters = normalizedReadFilters(selector.filters);
        return (
            selectorFilters.length > 0 &&
            selectorFiltersIdentity(selectorFilters) === selectorFiltersIdentity(item.filters)
        );
    } catch {
        return false;
    }
}

function revisionForBoundAsset(indexRevision: string | undefined, assetId: string): string | null {
    const revision = indexRevision?.trim();
    if (!revision || !assetId) return null;
    const prefix = `${assetId}:`;
    if (revision.includes("|")) {
        const matches = revision
            .split("|")
            .filter((candidate) => candidate.startsWith(prefix))
            .map((candidate) => candidate.slice(prefix.length))
            .filter(Boolean);
        return matches.length === 1 ? matches[0] : null;
    }
    if (revision.startsWith(prefix)) return revision.slice(prefix.length) || null;
    return revision;
}

function exactFilteredRelationEvidence(
    item: ReadEvidence,
    facet: KnowledgeCoverageFacetPlan,
    plan: KnowledgeCoveragePlan,
): boolean {
    const sourceKeys = unique((facet.sourceKeys ?? []).map(normalizedSourceKey).filter(Boolean), 2);
    const sourcePaths = unique((facet.sourcePaths ?? []).map(normalizedEvidencePath).filter(Boolean), 2);
    if (sourceKeys.length !== 1 || sourcePaths.length !== 1 || isChunkQualifiedRead(item)) return false;
    if (evidenceSourceKey(item) !== sourceKeys[0]) return false;
    if (normalizedEvidencePath(item.readPath) !== sourcePaths[0]) return false;
    const assetId = sourceKeys[0].slice(0, sourceKeys[0].indexOf(":"));
    const expectedRevision = revisionForBoundAsset(plan.indexRevision, assetId);
    if (!expectedRevision || item.expectedRevision !== expectedRevision) return false;
    if (!item.obligationIds.includes(facet.id) || !evidenceHasMatchingFilterSelector(item)) return false;
    return evidenceExactlyMatchesFacetFilters(item, facet);
}

function evidenceForFacet(evidence: ReadEvidence[], facet: KnowledgeCoverageFacetPlan): ReadEvidence[] {
    const sourcePaths = new Set((facet.sourcePaths ?? []).map(normalizedEvidencePath));
    const sourceKeys = new Set((facet.sourceKeys ?? []).map(normalizedSourceKey).filter(Boolean));
    const identifiers = facet.identifiers ?? [];
    return evidence.filter((item) => {
        if (item.selectorMetadataInvalid) return false;
        const pathMatches =
            sourcePaths.size > 0 &&
            (sourcePaths.has(normalizedEvidencePath(item.path)) ||
                sourcePaths.has(normalizedEvidencePath(item.readPath)));
        const sourceKeyMatches = sourceKeys.size > 0 && sourceKeys.has(evidenceSourceKey(item));
        const identifierMatches = identifiers.some((identifier) =>
            item.matchedIdentifiers.some((matched) => sameIdentifier(identifier, matched)),
        );
        // Selector-aware receipts bind a read (including a failed or truncated
        // read) to the exact typed obligations that scheduled it. This prevents
        // a failed filtered read from poisoning a successful full read on the
        // same source, while legacy receipts without the annotation retain the
        // prior source/group matching rules for stored continuations.
        if (item.obligationIds.length > 0 && !item.obligationIds.includes(facet.id)) return false;

        // Exact-record and declared-relation obligations are bound to their
        // catalog-resolved owner tables. A broad primary search group also
        // contains unrelated CSV reads; allowing one of those reads to report
        // an identifier as absent used to poison a successful owner-table
        // match. Keep group provenance for semantic/exhaustive facets, but
        // require typed record evidence to come from its bound source (or an
        // independently verified matching record when no owner is known).
        if (
            facet.kind === "exact_identifier" ||
            facet.kind === "foreign_key_filter" ||
            facet.kind === "route_topology" ||
            facet.kind === "route_support"
        ) {
            if (sourceKeys.size > 0) return sourceKeyMatches;
            if (sourcePaths.size > 0) return pathMatches;
            // An unbound topology obligation records that the catalog could not
            // prove a graph source. Unrelated evidence in the same search group
            // must never turn that absence into a complete topology claim.
            return facet.kind === "route_topology" || facet.kind === "route_support" ? false : identifierMatches;
        }
        if (facet.kind === "exhaustive_list" && sourceKeys.size > 0) return sourceKeyMatches;
        if (item.groups.includes(facet.searchGroup)) return true;
        return sourceKeys.size > 0 ? sourceKeyMatches : pathMatches;
    });
}

function parsedKnowledgeSelectorSignature(value: string | undefined): {
    assetId: string;
    path: string;
    kind: string;
    identifiers: string[];
    hasFilters: boolean;
} | null {
    if (!validKnowledgeSelectorSignature(value)) return null;
    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        return {
            assetId: String(parsed.assetId ?? "").trim(),
            path: String(parsed.path ?? "").trim(),
            kind: String(parsed.kind ?? ""),
            identifiers: stringArray(parsed.identifiers),
            hasFilters: Object.prototype.hasOwnProperty.call(parsed, "filters"),
        };
    } catch {
        return null;
    }
}

function sameVerifiedHistoryLocator(
    left: KnowledgeVerifiedHistoryLocator,
    right: KnowledgeVerifiedHistoryLocator,
): boolean {
    return (
        left.assetId === right.assetId &&
        left.path === right.path &&
        left.kind === right.kind &&
        left.value.normalize("NFKC") === right.value.normalize("NFKC")
    );
}

function markdownHeadingSupportsHistorySection(content: string, section: string): boolean {
    const target = section.normalize("NFKC").trim().toLowerCase();
    const lines = content.normalize("NFKC").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const atx = line.match(/^\s{0,3}#{1,6}(?:[ \t]+|$)(.*?)(?:[ \t]+#+)?[ \t]*$/u)?.[1];
        if (atx !== undefined && atx.trim().toLowerCase() === target) return true;
        const underline = lines[index + 1] ?? "";
        if (/^\s{0,3}(?:=+|-+)\s*$/u.test(underline) && line.trim().toLowerCase() === target) return true;
    }
    return false;
}

function searchableContentSupportsHistorySection(content: string, section: string): boolean {
    const normalized = section.normalize("NFKC").trim();
    if (
        normalized.length < 3 ||
        normalized.length > 160 ||
        !/^[\p{L}\p{N}][\p{L}\p{N}._:/#-]*$/u.test(normalized) ||
        (!/[._:/#-]/u.test(normalized) && !(/\p{L}/u.test(normalized) && /\p{N}/u.test(normalized)))
    ) {
        return false;
    }
    const target = normalized.toLowerCase();
    return (content.normalize("NFKC").match(/[\p{L}\p{N}._:/#-]+/gu) ?? []).some(
        (token) => token.toLowerCase() === target,
    );
}

function evidenceMatchesVerifiedHistoryLocator(
    item: ReadEvidence,
    locator: KnowledgeVerifiedHistoryLocator,
    facet: KnowledgeCoverageFacetPlan,
    plan: KnowledgeCoveragePlan,
): boolean {
    if (
        item.failed ||
        item.truncated ||
        item.stale ||
        item.selectorMetadataInvalid ||
        item.assetId !== locator.assetId ||
        !item.obligationIds.includes(facet.id) ||
        !item.verifiedHistoryLocators.some((candidate) => sameVerifiedHistoryLocator(candidate, locator))
    ) {
        return false;
    }
    const expectedRevision = revisionForBoundAsset(plan.indexRevision, locator.assetId);
    if (!expectedRevision || item.expectedRevision !== expectedRevision) return false;
    const selector = parsedKnowledgeSelectorSignature(item.selectorSignature);
    if (
        !selector ||
        selector.kind !== (locator.kind === "source" ? "full" : "exact") ||
        selector.assetId !== locator.assetId ||
        normalizedEvidencePath(selector.path) !== locator.path ||
        (locator.kind === "source"
            ? selector.identifiers.length !== 0
            : !selector.identifiers.some((identifier) => sameIdentifier(identifier, locator.value))) ||
        normalizedEvidencePath(item.path) !== locator.path ||
        normalizedEvidencePath(item.readPath) !== locator.path
    ) {
        return false;
    }
    if (locator.kind === "source") return item.readPath === locator.path && item.content.trim().length > 0;
    if (locator.kind === "record") {
        return item.matchedIdentifiers.some((identifier) => sameIdentifier(identifier, locator.value));
    }
    if (locator.kind === "chunk") {
        return item.readPath === locator.value && item.content.trim().length > 0;
    }
    return (
        markdownHeadingSupportsHistorySection(item.content, locator.value) ||
        searchableContentSupportsHistorySection(item.content, locator.value)
    );
}

function normalizedSchemaColumn(value: string): string {
    return value
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "_")
        .replace(/^_+|_+$/gu, "");
}

function routeEndpointRole(value: string): "from" | "to" | null {
    const normalized = normalizedSchemaColumn(value);
    if (/^(?:from|source|origin)(?:_|$)|^(?:起点|始点|来源|源)(?:_|$)/u.test(normalized)) return "from";
    if (/^(?:to|target|destination)(?:_|$)|^(?:终点|目标|目的地)(?:_|$)/u.test(normalized)) return "to";
    return null;
}

interface CsvTable {
    headers: string[];
    rows: string[][];
}

function parseBoundedCsv(content: string): CsvTable | null {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    const pushCell = () => {
        row.push(cell);
        cell = "";
    };
    const pushRow = () => {
        pushCell();
        if (row.some((value) => value.trim())) rows.push(row.slice(0, 64));
        row = [];
    };
    let index = 0;
    for (; index < content.length && rows.length < 257; index += 1) {
        const character = content[index] ?? "";
        if (character === '"') {
            if (quoted && content[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else quoted = !quoted;
        } else if (character === "," && !quoted) pushCell();
        else if ((character === "\n" || character === "\r") && !quoted) {
            if (character === "\r" && content[index + 1] === "\n") index += 1;
            pushRow();
        } else cell += character;
    }
    // Scope uniqueness cannot be proven from a silently truncated table. The
    // caller must remain unresolved when the bounded parser did not consume the
    // complete source, even if the visible prefix appears unique.
    if (index < content.length) return null;
    if (cell || row.length > 0) pushRow();
    const headers = (rows[0] ?? []).map(normalizedSchemaColumn);
    if (headers.length < 2) return null;
    return {
        headers,
        rows: rows.slice(1).filter((value) => value.length === headers.length),
    };
}

function scopeDescriptorLexemes(value: string): Set<string> {
    const normalized = value.normalize("NFKC").toLowerCase();
    const result = new Set<string>();
    for (const token of normalized.match(/[a-z0-9][a-z0-9_-]{1,63}/gu) ?? []) {
        result.add(token);
        for (const part of token.split(/[-_]+/u)) if (part.length >= 2) result.add(part);
    }
    for (const sequence of normalized.match(/\p{Script=Han}{2,64}/gu) ?? []) {
        for (const width of [2, 3]) {
            for (let index = 0; index + width <= sequence.length; index += 1) {
                result.add(sequence.slice(index, index + width));
            }
        }
    }
    return result;
}

function queryContainsScopeId(query: string, identifier: string): boolean {
    const normalizedQuery = query.normalize("NFKC").toLowerCase();
    const normalizedId = identifier.normalize("NFKC").trim().toLowerCase();
    if (!normalizedId) return false;
    const index = normalizedQuery.indexOf(normalizedId);
    if (index < 0) return false;
    const word = /[\p{L}\p{N}_]/u;
    return (
        !word.test(normalizedQuery[index - 1] ?? "") && !word.test(normalizedQuery[index + normalizedId.length] ?? "")
    );
}

function uniquelyResolvedScope(
    query: string,
    table: CsvTable,
    idColumn: string,
    descriptorColumns: string[],
): string | undefined {
    const idIndex = table.headers.indexOf(normalizedSchemaColumn(idColumn));
    if (idIndex < 0 || table.rows.length === 0) return undefined;
    const descriptorIndexes = descriptorColumns
        .map((column) => table.headers.indexOf(normalizedSchemaColumn(column)))
        .filter((index) => index >= 0 && index !== idIndex);
    if (descriptorIndexes.length === 0) return undefined;
    const queryLexemes = scopeDescriptorLexemes(query);
    const rows = table.rows.map((row) => ({
        id: (row[idIndex] ?? "").normalize("NFKC").trim(),
        lexemes: scopeDescriptorLexemes(descriptorIndexes.map((index) => row[index] ?? "").join(" ")),
    }));
    const counts = new Map<string, number>();
    for (const row of rows) {
        for (const lexeme of row.lexemes) counts.set(lexeme, (counts.get(lexeme) ?? 0) + 1);
    }
    const ranked = rows
        .filter((row) => row.id)
        .map((row) => ({
            id: row.id,
            exact: queryContainsScopeId(query, row.id),
            score: Array.from(queryLexemes).reduce(
                (score, lexeme) =>
                    score + (row.lexemes.has(lexeme) && counts.get(lexeme) === 1 ? Math.min(8, lexeme.length) : 0),
                0,
            ),
        }))
        .sort(
            (left, right) =>
                Number(right.exact) - Number(left.exact) || right.score - left.score || left.id.localeCompare(right.id),
        );
    const first = ranked[0];
    const second = ranked[1];
    if (!first || (!first.exact && first.score <= 0)) return undefined;
    if (second && first.exact === second.exact && first.score === second.score) return undefined;
    return first.id;
}

export interface KnowledgeRouteScopeResolverEvidence {
    ownerContents: string[];
    selectorContents?: Array<{ sourcePath: string; sourceKey?: string; content: string }>;
}

/**
 * Pure scope resolver shared by the runner and coverage verifier. Callers are
 * responsible for supplying only trusted, full-source owner/selector reads;
 * this function performs no I/O and never treats an ambiguous match as a
 * resolution.
 */
export function resolveKnowledgeRouteScope(
    query: string,
    binding: KnowledgeRouteScopeBinding,
    bindingIndex: number,
    evidence: KnowledgeRouteScopeResolverEvidence,
): KnowledgeRouteScopeResolution | null {
    if (!Number.isInteger(bindingIndex) || bindingIndex < 0) return null;
    const ownerTables = evidence.ownerContents
        .map(parseBoundedCsv)
        .filter((table): table is CsvTable => Boolean(table));
    const ownerIds = new Set(
        ownerTables.flatMap((table) => {
            const idIndex = table.headers.indexOf(normalizedSchemaColumn(binding.ownerPrimaryKey));
            return idIndex < 0 ? [] : table.rows.map((row) => (row[idIndex] ?? "").trim()).filter(Boolean);
        }),
    );
    if (ownerIds.size === 0) return null;

    const relationValues = (binding.selectors ?? []).flatMap((selector) => {
        const matchingContents = (evidence.selectorContents ?? []).filter((candidate) => {
            if (selector.sourceKey && candidate.sourceKey) {
                return normalizedSourceKey(selector.sourceKey) === normalizedSourceKey(candidate.sourceKey);
            }
            return normalizedEvidencePath(selector.sourcePath) === normalizedEvidencePath(candidate.sourcePath);
        });
        return matchingContents.flatMap(({ content }) => {
            const table = parseBoundedCsv(content);
            if (!table) return [];
            const idIndex = table.headers.indexOf(normalizedSchemaColumn(selector.primaryKey));
            const scopeIndex = table.headers.indexOf(normalizedSchemaColumn(selector.scopeColumn));
            if (idIndex < 0 || scopeIndex < 0) return [];
            return table.rows.flatMap((row) =>
                sameIdentifier(row[idIndex] ?? "", selector.identifier) && (row[scopeIndex] ?? "").trim()
                    ? [(row[scopeIndex] ?? "").trim()]
                    : [],
            );
        });
    });
    const uniqueRelationValues = unique(relationValues, 64);
    if (
        uniqueRelationValues.length === 1 &&
        Array.from(ownerIds).some((ownerId) => sameIdentifier(ownerId, uniqueRelationValues[0]))
    ) {
        return { bindingIndex, value: uniqueRelationValues[0], method: "exact_relation" };
    }

    const descriptorValues = unique(
        ownerTables.flatMap((table) => {
            const value = uniquelyResolvedScope(query, table, binding.ownerPrimaryKey, binding.descriptorColumns);
            return value ? [value] : [];
        }),
        64,
    );
    if (descriptorValues.length !== 1) return null;
    return {
        bindingIndex,
        value: descriptorValues[0],
        method: queryContainsScopeId(query, descriptorValues[0]) ? "exact_identifier" : "unique_descriptor",
    };
}

function usableEvidenceForBoundSource(evidence: ReadEvidence[], path: string, sourceKey?: string): ReadEvidence[] {
    const expectedPath = normalizedEvidencePath(path);
    const expectedKey = sourceKey ? normalizedSourceKey(sourceKey) : "";
    return evidence.filter(
        (item) =>
            !item.failed &&
            !item.truncated &&
            !item.stale &&
            !isChunkQualifiedRead(item) &&
            normalizedEvidencePath(item.readPath || item.path) === expectedPath &&
            (!expectedKey || evidenceSourceKey(item) === expectedKey),
    );
}

/**
 * Validate the runner's two-stage scope receipt. The owner must have been read
 * in full, its descriptors must uniquely resolve the receipt value, and the
 * overlay read must carry an exact filter for that same value. Reading every
 * owner/overlay row can never close a natural-language scope by itself.
 */
function naturalRouteScopeResolved(
    plan: KnowledgeCoveragePlan,
    evidence: ReadEvidence[],
    facet: KnowledgeCoverageFacetPlan,
): boolean | null {
    const contract = facet.routeScope;
    if (contract?.role !== "state_overlay" || !contract.requiresUniqueResolution) return null;
    const resolution = contract.resolution;
    if (!resolution || !Number.isInteger(resolution.bindingIndex) || !resolution.value.trim()) return false;
    const binding = contract.bindings[resolution.bindingIndex];
    if (!binding) return false;

    const ownerReads = usableEvidenceForBoundSource(evidence, binding.ownerSourcePath, binding.ownerSourceKey).filter(
        (item) => item.filters.length === 0 && item.identifiers.length === 0,
    );
    const selectorContents = (binding.selectors ?? []).flatMap((selector) =>
        usableEvidenceForBoundSource(evidence, selector.sourcePath, selector.sourceKey)
            .filter(
                (item) =>
                    item.filters.length === 0 &&
                    item.identifiers.some((identifier) => sameIdentifier(identifier, selector.identifier)),
            )
            .map((item) => ({
                sourcePath: selector.sourcePath,
                ...(selector.sourceKey ? { sourceKey: selector.sourceKey } : {}),
                content: item.content,
            })),
    );
    const verifiedResolution = resolveKnowledgeRouteScope(plan.query, binding, resolution.bindingIndex, {
        ownerContents: ownerReads.map((item) => item.content),
        selectorContents,
    });
    if (
        !verifiedResolution ||
        verifiedResolution.bindingIndex !== resolution.bindingIndex ||
        verifiedResolution.method !== resolution.method ||
        !sameIdentifier(verifiedResolution.value, resolution.value)
    ) {
        return false;
    }

    const expectedColumn = normalizedSchemaColumn(binding.overlayScopeColumn);
    const expectedFilter = (facet.filters ?? []).some(
        (filter) =>
            normalizedSchemaColumn(filter.column) === expectedColumn && sameIdentifier(filter.value, resolution.value),
    );
    if (!expectedFilter) return false;
    const overlayReads = usableEvidenceForBoundSource(evidence, binding.overlaySourcePath, binding.overlaySourceKey);
    return overlayReads.some((item) => {
        const table = parseBoundedCsv(item.content);
        if (!table?.headers.includes(expectedColumn)) return false;
        return item.filters.some((filter) => {
            if (normalizedSchemaColumn(filter.column) !== expectedColumn) return false;
            const values = Array.isArray(filter.value) ? filter.value : [filter.value];
            return values.some((value) => sameIdentifier(value, resolution.value));
        });
    });
}

export function finalizeKnowledgeCoverage(plan: KnowledgeCoveragePlan, reads: unknown[]): KnowledgeCoverageReceipt {
    const parsedEvidence = reads.map(readEvidence).filter((item): item is ReadEvidence => Boolean(item));
    const lastSelectorReceipt = new Map<string, number>();
    parsedEvidence.forEach((item, index) => {
        if (item.selectorSignature) lastSelectorReceipt.set(item.selectorSignature, index);
    });
    // A replay failure can be followed by a fresh, revision-pinned retry in the
    // same turn. For one selector signature the last receipt is authoritative;
    // failures for a different mandatory signature remain independent blockers.
    const evidence = parsedEvidence.filter(
        (item, index) => !item.selectorSignature || lastSelectorReceipt.get(item.selectorSignature) === index,
    );
    const continuationCursors = normalizeContinuationCursors(plan);
    const structuredAuthoritative =
        plan.structuredQuery?.status === "covered" && plan.structuredQuery.authoritative === true;
    const structuredCompletedObligations = new Set(plan.structuredQuery?.completedObligationIds ?? []);
    const hasTypedFacets = plan.facets.some((facet) => Boolean(facet.completion));
    const structuredSubResultNeedsSupportingSearch = plan.structuredQuery?.supportingSearchRequired === true;
    const hasUntypedSearchObligation = plan.facets.length === 0 || plan.facets.some((facet) => !facet.completion);
    // `resultTruncated` describes the broad search transport, not a coverage
    // obligation by itself. Once typed facets own every requested fact, their
    // completion rules decide whether more evidence is needed: one readable
    // source closes a semantic facet, while exhaustive facets remain open via
    // their own `searchTruncated` cursor. A synthetic global facet is retained
    // only for legacy/untyped searches or when a structured sub-result reports
    // an independent prose duty which the structured operation did not consume.
    const hasUnmodeledGlobalSearchObligation = hasUntypedSearchObligation || structuredSubResultNeedsSupportingSearch;
    // A structured result may authoritatively discharge modeled query facets,
    // but it cannot prove that evidence omitted before a bounded planning
    // window was reviewed. Keep overflow sentinels explicit and impossible to
    // settle from a generic read or a claimed structured completion.
    const evaluatedPlanFacets = structuredAuthoritative
        ? plan.facets.filter((facet) => facet.id.startsWith("obligation-overflow:"))
        : plan.facets;
    const facets = evaluatedPlanFacets.map<KnowledgeCoverageFacet>((facet) => {
        const matching = evidenceForFacet(evidence, facet);
        const selectedPaths = unique(
            matching.map((item) => item.path),
            3,
        );
        if (facet.id.startsWith("obligation-overflow:")) {
            return { ...facet, status: "uncovered", selectedPaths: [], reason: "source_limit" };
        }
        if (facet.verifiedHistoryLocators?.length) {
            const attempts = evidence.filter((item) => item.obligationIds.includes(facet.id));
            const attemptPaths = unique(
                attempts.map((item) => item.path),
                3,
            );
            const missingRevision = facet.verifiedHistoryLocators.some(
                (locator) => !revisionForBoundAsset(plan.indexRevision, locator.assetId),
            );
            const receiptRevisionMismatch = attempts.some((item) => {
                const expected = revisionForBoundAsset(plan.indexRevision, item.assetId ?? "");
                return item.stale || !expected || item.expectedRevision !== expected;
            });
            if (missingRevision || receiptRevisionMismatch) {
                return {
                    ...facet,
                    status: "stale",
                    selectedPaths: attemptPaths,
                    reason: "revision_changed",
                };
            }
            if (attempts.some((item) => item.failed)) {
                return { ...facet, status: "uncovered", selectedPaths: attemptPaths, reason: "read_error" };
            }
            if (attempts.some((item) => item.truncated)) {
                return { ...facet, status: "partial", selectedPaths: attemptPaths, reason: "result_truncated" };
            }
            const verifiedLocators = facet.verifiedHistoryLocators.filter((locator) =>
                attempts.some((item) => evidenceMatchesVerifiedHistoryLocator(item, locator, facet, plan)),
            );
            if (verifiedLocators.length === facet.verifiedHistoryLocators.length) {
                return { ...facet, status: "covered", selectedPaths: attemptPaths };
            }
            return {
                ...facet,
                status: attempts.length > 0 ? "partial" : "uncovered",
                selectedPaths: attemptPaths,
                reason: attempts.length > 0 ? "missing_identifier" : "source_limit",
            };
        }
        if (matching.some((item) => item.stale)) {
            return { ...facet, status: "stale", selectedPaths, reason: "revision_changed" };
        }
        if (matching.some((item) => item.failed)) {
            return { ...facet, status: "uncovered", selectedPaths, reason: "read_error" };
        }
        const requiredKeys = unique(facet.candidateKeys ?? [], 256);
        const verifiedKeys = new Set(
            matching.filter((item) => !item.failed && !item.truncated).flatMap((item) => (item.key ? [item.key] : [])),
        );
        const usable = matching.filter((item) => !item.failed && !item.truncated && !item.stale);
        const completionUsable =
            facet.kind === "route_topology" && facet.completion === "all_sources_verified"
                ? usable.filter(
                      (item) => !isChunkQualifiedRead(item) && evidenceExactlyMatchesFacetFilters(item, facet),
                  )
                : facet.kind === "route_support" && facet.completion === "all_sources_verified"
                  ? usable.filter(
                        (item) =>
                            !isChunkQualifiedRead(item) && item.filters.length === 0 && item.identifiers.length === 0,
                    )
                  : facet.kind === "foreign_key_filter" && facet.completion === "all_sources_verified"
                    ? (facet.filters?.length ?? 0) > 0
                        ? usable.filter((item) => exactFilteredRelationEvidence(item, facet, plan))
                        : usable.filter((item) => evidenceMatchesFacetFilters(item, facet))
                    : usable;
        const requestedFacetIdentifiers = unique(facet.identifiers ?? []);
        // A successful all-related read is authoritative for the exact filters
        // executed against its catalog-bound source, including a valid empty
        // result. knowledge_read reports matched row identifiers (normally the
        // table primary key), so a foreign-key value is not necessarily repeated
        // in matchedIdentifiers. Count only the trusted, annotated filter values
        // for this all-sources completion rule; ordinary record verification
        // still requires an identifier found in readable row evidence.
        const verifiedFilterIdentifiers =
            facet.kind === "foreign_key_filter" && facet.completion === "all_sources_verified"
                ? completionUsable.flatMap((item) =>
                      item.filters.flatMap((filter) => (Array.isArray(filter.value) ? filter.value : [filter.value])),
                  )
                : [];
        const matchedFacetIdentifiers = unique([
            ...usable.flatMap((item) => item.matchedIdentifiers),
            ...verifiedFilterIdentifiers,
        ]);
        const missingFacetIdentifiers = requestedFacetIdentifiers.filter(
            (requested) => !matchedFacetIdentifiers.some((matched) => sameIdentifier(requested, matched)),
        );
        const structuredCompleted = structuredCompletedObligations.has(facet.id);

        if (facet.completion === "record_verified") {
            if (structuredCompleted) return { ...facet, status: "covered", selectedPaths };
            if (requestedFacetIdentifiers.length === 0 && usable.length > 0) {
                return { ...facet, status: "covered", selectedPaths };
            }
            if (requestedFacetIdentifiers.length > 0 && missingFacetIdentifiers.length === 0) {
                return { ...facet, status: "covered", selectedPaths };
            }
            if (matching.some((item) => item.truncated)) {
                return { ...facet, status: "partial", selectedPaths, reason: "result_truncated" };
            }
            return {
                ...facet,
                status: usable.length > 0 || matchedFacetIdentifiers.length > 0 ? "partial" : "uncovered",
                selectedPaths,
                reason: "missing_identifier",
            };
        }

        if (facet.completion === "all_sources_verified") {
            const requestedSourcePaths = unique((facet.sourcePaths ?? []).map(normalizedEvidencePath), 32);
            const requestedSourceKeys = unique((facet.sourceKeys ?? []).map(normalizedSourceKey).filter(Boolean), 32);
            const verifiedSourcePaths = requestedSourcePaths.filter((sourcePath) =>
                completionUsable.some(
                    (item) =>
                        normalizedEvidencePath(item.path) === sourcePath ||
                        normalizedEvidencePath(item.readPath) === sourcePath,
                ),
            );
            const verifiedSourceKeys = requestedSourceKeys.filter((sourceKey) =>
                completionUsable.some((item) => evidenceSourceKey(item) === sourceKey),
            );
            const identifiersVerified = requestedFacetIdentifiers.length === 0 || missingFacetIdentifiers.length === 0;
            const sourcesVerified =
                requestedSourceKeys.length > 0
                    ? verifiedSourceKeys.length === requestedSourceKeys.length
                    : requestedSourcePaths.length === 0 || verifiedSourcePaths.length === requestedSourcePaths.length;
            const naturalScopeResolved = naturalRouteScopeResolved(plan, evidence, facet);
            if (
                identifiersVerified &&
                sourcesVerified &&
                completionUsable.length > 0 &&
                naturalScopeResolved === false
            ) {
                return { ...facet, status: "partial", selectedPaths, reason: "scope_unresolved" };
            }
            if (identifiersVerified && sourcesVerified && completionUsable.length > 0) {
                return { ...facet, status: "covered", selectedPaths };
            }
            if (matching.some((item) => item.truncated)) {
                return { ...facet, status: "partial", selectedPaths, reason: "result_truncated" };
            }
            return {
                ...facet,
                status: completionUsable.length > 0 ? "partial" : "uncovered",
                reason: identifiersVerified ? "source_limit" : "missing_identifier",
                selectedPaths,
            };
        }

        if (facet.completion === "readable_evidence") {
            if (structuredCompleted || usable.length > 0) return { ...facet, status: "covered", selectedPaths };
            if (matching.some((item) => item.truncated)) {
                return { ...facet, status: "partial", selectedPaths, reason: "result_truncated" };
            }
            return {
                ...facet,
                status: "uncovered",
                selectedPaths,
                reason: facet.hitCount > 0 ? "source_limit" : "no_hit",
            };
        }

        if (facet.completion === "cursor_exhausted") {
            if (structuredCompleted) return { ...facet, status: "covered", selectedPaths };
            // Cursor exhaustion belongs to the facet's own signed search
            // group. A different/global search page being truncated cannot
            // reopen an otherwise verified exhaustive obligation.
            if (facet.searchTruncated) {
                return { ...facet, status: "partial", selectedPaths, reason: "result_truncated" };
            }
            if (requiredKeys.length > 0 && !requiredKeys.every((key) => verifiedKeys.has(key))) {
                return {
                    ...facet,
                    status: usable.length > 0 ? "partial" : "uncovered",
                    selectedPaths,
                    reason: matching.some((item) => item.truncated) ? "result_truncated" : "source_limit",
                };
            }
            if (usable.length > 0) return { ...facet, status: "covered", selectedPaths };
            if (matching.some((item) => item.truncated)) {
                return { ...facet, status: "partial", selectedPaths, reason: "result_truncated" };
            }
            return { ...facet, status: "uncovered", selectedPaths, reason: "no_hit" };
        }

        if (
            plan.mode === "complete" &&
            requiredKeys.length > 0 &&
            !requiredKeys.every((key) => verifiedKeys.has(key))
        ) {
            return {
                ...facet,
                status: matching.some((item) => !item.failed && !item.truncated) ? "partial" : "uncovered",
                selectedPaths,
                reason: matching.some((item) => item.truncated) ? "result_truncated" : "source_limit",
            };
        }
        if (facet.searchTruncated) {
            return {
                ...facet,
                status: "partial",
                selectedPaths,
                reason: "result_truncated",
            };
        }
        if (matching.some((item) => !item.failed && !item.truncated)) {
            return { ...facet, status: "covered", selectedPaths };
        }
        if (matching.some((item) => item.truncated)) {
            return { ...facet, status: "partial", selectedPaths, reason: "result_truncated" };
        }
        return {
            ...facet,
            status: "uncovered",
            selectedPaths,
            reason: facet.hitCount > 0 ? "source_limit" : "no_hit",
        };
    });
    if (
        !structuredAuthoritative &&
        (plan.catalogTruncated || (plan.catalogUnretrievableCount ?? 0) > 0 || plan.recordIdsTruncated)
    ) {
        facets.push({
            id: "catalog-inventory",
            query: plan.query,
            status: "partial",
            selectedPaths: [],
            reason: "result_truncated",
        });
    } else if (!structuredAuthoritative && plan.catalogCovered) {
        facets.push({
            id: "catalog-inventory",
            query: plan.query,
            status: "covered",
            selectedPaths: [],
        });
    }

    if (!structuredAuthoritative && plan.resultTruncated && hasUnmodeledGlobalSearchObligation) {
        facets.push({
            id: "search-results",
            query: plan.query,
            status: "partial",
            selectedPaths: [],
            reason: "result_truncated",
        });
    }

    if (!structuredAuthoritative && plan.facetSearchFailed) {
        facets.push({
            id: "facet-search",
            query: plan.query,
            status: "uncovered",
            selectedPaths: [],
            reason: "read_error",
        });
    } else if (!structuredAuthoritative && plan.facetSearchTruncated && !hasTypedFacets) {
        facets.push({
            id: "facet-search",
            query: plan.query,
            status: "partial",
            selectedPaths: [],
            reason: "result_truncated",
        });
    }

    const requestedIdentifiers = unique(plan.identifiers);
    const typedExactIdentifierFacets = plan.facets.filter((facet) => facet.kind === "exact_identifier");
    const hasTypedExactIdentifierFacet = typedExactIdentifierFacets.length > 0;
    const identifierEvidence = hasTypedExactIdentifierFacet
        ? typedExactIdentifierFacets.flatMap((facet) => evidenceForFacet(evidence, facet))
        : evidence;
    const structuredMatchedIdentifiers = plan.facets
        .filter((facet) => facet.kind === "exact_identifier" && structuredCompletedObligations.has(facet.id))
        .flatMap((facet) => facet.identifiers ?? []);
    const verifiedRelationFilterIdentifiers = plan.facets
        .filter((facet) => facet.kind === "foreign_key_filter" && facet.completion === "all_sources_verified")
        .flatMap((facet) =>
            evidenceForFacet(evidence, facet)
                .filter((item) => !item.failed && !item.truncated && !item.stale)
                .flatMap((item) =>
                    item.filters.flatMap((filter) => (Array.isArray(filter.value) ? filter.value : [filter.value])),
                ),
        );
    const matchedIdentifiers = unique([
        ...identifierEvidence
            .filter((item) => !item.failed && !item.truncated && !item.stale)
            .flatMap((item) => item.matchedIdentifiers),
        ...structuredMatchedIdentifiers,
        ...verifiedRelationFilterIdentifiers,
    ]).filter((identifier) => requestedIdentifiers.some((requested) => sameIdentifier(requested, identifier)));
    const missingIdentifiers = requestedIdentifiers.filter(
        (requested) => !matchedIdentifiers.some((matched) => matched.toLowerCase() === requested.toLowerCase()),
    );
    if (
        !structuredAuthoritative &&
        !hasTypedExactIdentifierFacet &&
        requestedIdentifiers.length > 0 &&
        missingIdentifiers.length > 0
    ) {
        facets.push({
            id: "exact-identifiers",
            query: requestedIdentifiers.join("、"),
            status: matchedIdentifiers.length > 0 ? "partial" : "uncovered",
            selectedPaths: unique(
                evidence.filter((item) => item.matchedIdentifiers.length > 0).map((item) => item.path),
                3,
            ),
            reason: "missing_identifier",
        });
    }

    if (!structuredAuthoritative && plan.indexIncomplete && plan.mode === "complete") {
        facets.push({
            id: "index-completeness",
            query: "current knowledge index",
            status: "uncovered",
            selectedPaths: [],
            reason: "index_incomplete",
        });
    }

    if (plan.revisionChanged) {
        facets.push({
            id: "index-revision",
            query: plan.query,
            status: "stale",
            selectedPaths: [],
            reason: "revision_changed",
        });
    }

    if (plan.structuredQuery) {
        facets.push({
            id: "structured-query",
            query: plan.query,
            status: plan.structuredQuery.status,
            selectedPaths: [],
            ...(plan.structuredQuery.reason ? { reason: plan.structuredQuery.reason } : {}),
        });
    }

    if (continuationCursors.inconsistent) {
        facets.push({
            id: "continuation-cursor",
            query: plan.query,
            status: "uncovered",
            selectedPaths: [],
            reason: "cursor_inconsistent",
        });
    }

    const pointerCandidates = [
        ...(plan.trustedEvidence ?? []),
        ...evidence.flatMap((item) => {
            const pointer = pointerFromEvidence(item, plan);
            return pointer ? [pointer] : [];
        }),
    ];
    const trustedEvidence = Array.from(
        new Map(
            pointerCandidates.map((pointer) => [trustedEvidencePointerIdentity(pointer), pointer] as const),
        ).values(),
    );
    const structuredEvidenceValid =
        plan.structuredEvidence === undefined || isKnowledgeTrustedStructuredEvidence(plan.structuredEvidence);
    const evidenceTruncated =
        plan.evidenceTruncated === true ||
        trustedEvidence.length > MAX_ACCUMULATED_EVIDENCE ||
        !structuredEvidenceValid;
    const trustedTableSummaries = mergeTableSummaries(plan.trustedTableSummaries ?? []);
    if ((evidenceTruncated || trustedTableSummaries.truncated) && plan.mode === "complete") {
        facets.push({
            id: "accumulated-evidence",
            query: plan.query,
            status: "uncovered",
            selectedPaths: [],
            reason: "evidence_truncated",
        });
    }
    const required = facets.length;
    const verified = facets.filter((facet) => facet.status === "covered").length;
    const missing = required - verified;
    const stale = facets.some((facet) => facet.status === "stale");
    const catalogFacetRelevant = facets.some((facet) => facet.id === "catalog-inventory");
    const accumulator: KnowledgeCoverageAccumulator = {
        protocolVersion: 1,
        query: plan.query,
        mode: plan.mode,
        pageCount: Math.max(1, Math.min(64, Math.floor(plan.pageCount ?? 1))),
        facets: plan.facets.slice(0, MAX_ACCUMULATED_FACETS).map((facet) => ({
            ...facet,
            candidateKeys: unique(facet.candidateKeys ?? [], MAX_ACCUMULATED_CANDIDATE_KEYS),
        })),
        identifiers: unique(plan.identifiers),
        trustedEvidence: trustedEvidence.slice(0, MAX_ACCUMULATED_EVIDENCE),
        trustedTableSummaries: trustedTableSummaries.values,
        ...(structuredEvidenceValid && plan.structuredEvidence ? { structuredEvidence: plan.structuredEvidence } : {}),
        ...(plan.indexRevision ? { indexRevision: plan.indexRevision } : {}),
        ...(evidenceTruncated || trustedTableSummaries.truncated ? { evidenceTruncated: true } : {}),
    };
    const status =
        missing === 0 && !evidenceTruncated && !trustedTableSummaries.truncated
            ? "complete"
            : stale
              ? "blocked"
              : "partial";
    const unresolvedSearchGroups = new Set<number>();
    if (!structuredAuthoritative) {
        for (let index = 0; index < plan.facets.length; index += 1) {
            if (facets[index]?.status !== "covered") unresolvedSearchGroups.add(plan.facets[index].searchGroup);
        }
    }
    const primarySearchResultsUnresolved = facets.some(
        (facet) => facet.id === "search-results" && facet.status !== "covered",
    );
    const searchContinuationAllowed =
        status === "partial" &&
        !continuationCursors.inconsistent &&
        !evidenceTruncated &&
        !trustedTableSummaries.truncated;
    const pendingSearchPages = searchContinuationAllowed
        ? continuationCursors.pendingSearchPages.filter(
              (page) =>
                  unresolvedSearchGroups.has(page.searchGroup) ||
                  (page.searchGroup === 0 && primarySearchResultsUnresolved),
          )
        : [];
    const primarySearchUnresolved = unresolvedSearchGroups.has(0) || primarySearchResultsUnresolved;
    const retainedPrimaryPage = pendingSearchPages.find((page) => page.searchGroup === 0);
    const nextSearchCursor =
        retainedPrimaryPage?.nextSearchCursor ??
        (searchContinuationAllowed && primarySearchUnresolved ? continuationCursors.nextSearchCursor : undefined);
    const searchOffset = nextSearchCursor
        ? (retainedPrimaryPage?.searchOffset ?? continuationCursors.searchOffset)
        : undefined;
    const catalogResumable =
        status === "partial" &&
        facets.some(
            (facet) =>
                facet.id === "catalog-inventory" &&
                facet.status !== "covered" &&
                Boolean(plan.nextCatalogCursor) &&
                !plan.recordIdsTruncated &&
                (plan.catalogUnretrievableCount ?? 0) === 0,
        );
    const structuredResumable =
        status === "partial" &&
        facets.some(
            (facet) =>
                facet.id === "structured-query" &&
                facet.status !== "covered" &&
                Boolean(continuationCursors.nextStructuredCursor),
        );
    const resumableUnresolvedExists =
        Boolean(nextSearchCursor) || pendingSearchPages.length > 0 || catalogResumable || structuredResumable;
    return {
        version: 1,
        query: plan.query,
        mode: plan.mode,
        status,
        facets,
        requestedIdentifiers,
        matchedIdentifiers,
        missingIdentifiers,
        required,
        verified,
        missing,
        // `hasMore` means at least one unresolved typed obligation can advance
        // with a signed cursor. Independent blockers (for example an unrelated
        // incomplete source) remain visible, but must not hide an executable
        // page. Once that page is exhausted they naturally leave hasMore=false.
        hasMore:
            status === "partial" &&
            resumableUnresolvedExists &&
            !stale &&
            !evidenceTruncated &&
            !trustedTableSummaries.truncated,
        ...(plan.indexRevision ? { indexRevision: plan.indexRevision } : {}),
        supplementalPasses: plan.supplementalPasses,
        ...(status !== "complete" && plan.resultTruncated ? { resultTruncated: true } : {}),
        ...(catalogFacetRelevant && plan.catalogTruncated ? { catalogTruncated: true } : {}),
        ...(catalogFacetRelevant && typeof plan.catalogOmittedCount === "number"
            ? { catalogOmittedCount: Math.max(0, Math.floor(plan.catalogOmittedCount)) }
            : {}),
        ...(catalogFacetRelevant && typeof plan.catalogUnretrievableCount === "number"
            ? { catalogUnretrievableCount: Math.max(0, Math.floor(plan.catalogUnretrievableCount)) }
            : {}),
        ...(catalogFacetRelevant && plan.recordIdsTruncated ? { recordIdsTruncated: true } : {}),
        ...(nextSearchCursor ? { nextSearchCursor } : {}),
        ...(pendingSearchPages.length > 0 ? { pendingSearchPages } : {}),
        ...(catalogResumable && plan.nextCatalogCursor ? { nextCatalogCursor: plan.nextCatalogCursor } : {}),
        ...(structuredResumable && continuationCursors.nextStructuredCursor
            ? { nextStructuredCursor: continuationCursors.nextStructuredCursor }
            : {}),
        ...(searchOffset !== undefined ? { searchOffset } : {}),
        ...(catalogResumable && typeof plan.catalogOffset === "number"
            ? { catalogOffset: Math.max(0, Math.floor(plan.catalogOffset)) }
            : {}),
        accumulator,
    };
}

export function knowledgeContinuationFromCoverage(
    coverage: KnowledgeCoverageReceipt | undefined,
): KnowledgeContinuationState | undefined {
    if (!coverage) return undefined;
    const complete = coverage.status === "complete";
    return {
        protocolVersion: 1,
        query: coverage.query,
        mode: coverage.mode,
        status: coverage.status,
        unresolved: coverage.facets
            .filter(
                (facet): facet is KnowledgeCoverageFacet & { status: "partial" | "uncovered" | "stale" } =>
                    facet.status !== "covered",
            )
            .slice(0, 8)
            .map((facet) => ({
                id: facet.id,
                query: facet.query,
                status: facet.status,
                reason: facet.reason,
                selectedPaths: facet.selectedPaths.slice(0, 3),
            })),
        missingIdentifiers: coverage.missingIdentifiers.slice(0, 64),
        ...(!complete && (coverage.resultTruncated || coverage.catalogTruncated) ? { resultTruncated: true } : {}),
        ...(typeof coverage.catalogOmittedCount === "number"
            ? { catalogOmittedCount: coverage.catalogOmittedCount }
            : {}),
        ...(!complete && coverage.nextSearchCursor ? { nextSearchCursor: coverage.nextSearchCursor } : {}),
        ...(!complete && coverage.pendingSearchPages?.length
            ? { pendingSearchPages: coverage.pendingSearchPages.slice(0, 9) }
            : {}),
        ...(!complete && coverage.nextCatalogCursor ? { nextCatalogCursor: coverage.nextCatalogCursor } : {}),
        ...(!complete && coverage.nextStructuredCursor ? { nextStructuredCursor: coverage.nextStructuredCursor } : {}),
        ...(!complete && typeof coverage.searchOffset === "number" ? { searchOffset: coverage.searchOffset } : {}),
        ...(!complete && typeof coverage.catalogOffset === "number" ? { catalogOffset: coverage.catalogOffset } : {}),
        indexRevision: coverage.indexRevision,
        hasMore: complete ? false : coverage.hasMore,
        ...(coverage.accumulator ? { accumulator: coverage.accumulator } : {}),
    };
}

export function isKnowledgeContinuationState(value: unknown): value is KnowledgeContinuationState {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (record.protocolVersion !== 1 || typeof record.query !== "string" || typeof record.hasMore !== "boolean") {
        return false;
    }
    if (record.mode !== "fast" && record.mode !== "complete") return false;
    if (record.status !== "complete" && record.status !== "partial" && record.status !== "blocked") return false;
    for (const key of ["nextSearchCursor", "nextCatalogCursor", "nextStructuredCursor"] as const) {
        if (record[key] !== undefined && (typeof record[key] !== "string" || !record[key].trim())) return false;
    }
    for (const key of ["searchOffset", "catalogOffset"] as const) {
        if (
            record[key] !== undefined &&
            (typeof record[key] !== "number" || !Number.isInteger(record[key]) || record[key] < 0)
        ) {
            return false;
        }
    }
    if (!isKnowledgePendingSearchPages(record.pendingSearchPages)) return false;
    if (!isKnowledgeCoverageAccumulator(record.accumulator, record.query, record.mode)) return false;
    const pendingSearchPages = (record.pendingSearchPages ?? []) as KnowledgePendingSearchPage[];
    const primaryPage = pendingSearchPages.find((page) => page.searchGroup === 0);
    const hasSearchContinuation = pendingSearchPages.length > 0 || typeof record.nextSearchCursor === "string";
    const hasExecutableCursor =
        hasSearchContinuation ||
        typeof record.nextCatalogCursor === "string" ||
        typeof record.nextStructuredCursor === "string";
    const hasContinuationOffset = record.searchOffset !== undefined || record.catalogOffset !== undefined;
    if (record.status !== "partial" && (record.hasMore === true || hasExecutableCursor || hasContinuationOffset)) {
        return false;
    }
    if (record.status === "complete" && record.resultTruncated === true) return false;
    if (hasExecutableCursor && (record.status !== "partial" || record.hasMore !== true)) return false;
    if (record.searchOffset !== undefined && typeof record.nextSearchCursor !== "string") return false;
    if (record.catalogOffset !== undefined && typeof record.nextCatalogCursor !== "string") return false;
    if (
        primaryPage &&
        (record.nextSearchCursor !== primaryPage.nextSearchCursor ||
            (record.searchOffset !== undefined && record.searchOffset !== primaryPage.searchOffset))
    ) {
        return false;
    }
    if (
        record.hasMore === true &&
        pendingSearchPages.length === 0 &&
        typeof record.nextSearchCursor !== "string" &&
        typeof record.nextCatalogCursor !== "string" &&
        typeof record.nextStructuredCursor !== "string"
    ) {
        return false;
    }
    if (!Array.isArray(record.unresolved) || !Array.isArray(record.missingIdentifiers)) return false;
    if (
        typeof record.nextStructuredCursor === "string" &&
        !record.unresolved.some(
            (value) =>
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                (value as Record<string, unknown>).id === "structured-query" &&
                (value as Record<string, unknown>).status === "partial",
        )
    ) {
        return false;
    }
    if (
        typeof record.nextCatalogCursor === "string" &&
        !record.unresolved.some(
            (value) =>
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                (value as Record<string, unknown>).id === "catalog-inventory" &&
                (value as Record<string, unknown>).status === "partial",
        )
    ) {
        return false;
    }
    return true;
}

function boundedString(value: unknown, max: number): value is string {
    return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function boundedStrings(value: unknown, maxItems: number, maxLength: number): value is string[] {
    return Array.isArray(value) && value.length <= maxItems && value.every((item) => boundedString(item, maxLength));
}

function safeKnowledgeRelationTargetPath(value: unknown): value is string {
    if (!boundedString(value, 4_096) || value !== value.trim() || value.includes("\\")) return false;
    const segments = value.split("/");
    return (
        segments.length >= 3 &&
        segments[0] === "raw" &&
        segments[1] === "sources" &&
        segments.slice(2).every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    );
}

function isKnowledgeRouteScopeContract(value: unknown): value is KnowledgeRouteScopeContract {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (record.role !== "state_overlay" && record.role !== "descriptor_owner") return false;
    if (typeof record.requiresUniqueResolution !== "boolean") return false;
    if (!Array.isArray(record.bindings) || record.bindings.length === 0 || record.bindings.length > 8) return false;
    for (const bindingValue of record.bindings) {
        if (!bindingValue || typeof bindingValue !== "object" || Array.isArray(bindingValue)) return false;
        const binding = bindingValue as Record<string, unknown>;
        if (
            !boundedString(binding.overlaySourcePath, 4_096) ||
            (binding.overlaySourceKey !== undefined && !boundedString(binding.overlaySourceKey, 4_608)) ||
            !boundedString(binding.overlayScopeColumn, 160) ||
            !boundedString(binding.ownerSourcePath, 4_096) ||
            (binding.ownerSourceKey !== undefined && !boundedString(binding.ownerSourceKey, 4_608)) ||
            !boundedString(binding.ownerPrimaryKey, 160) ||
            !boundedStrings(binding.descriptorColumns, 16, 160) ||
            (binding.selectors !== undefined &&
                (!Array.isArray(binding.selectors) ||
                    binding.selectors.length > 8 ||
                    !binding.selectors.every((selectorValue) => {
                        if (!selectorValue || typeof selectorValue !== "object" || Array.isArray(selectorValue)) {
                            return false;
                        }
                        const selector = selectorValue as Record<string, unknown>;
                        return (
                            boundedString(selector.sourcePath, 4_096) &&
                            (selector.sourceKey === undefined || boundedString(selector.sourceKey, 4_608)) &&
                            boundedString(selector.primaryKey, 160) &&
                            boundedString(selector.scopeColumn, 160) &&
                            boundedString(selector.identifier, 512)
                        );
                    })))
        ) {
            return false;
        }
    }
    if (record.resolution !== undefined) {
        if (!record.resolution || typeof record.resolution !== "object" || Array.isArray(record.resolution)) {
            return false;
        }
        const resolution = record.resolution as Record<string, unknown>;
        if (
            typeof resolution.bindingIndex !== "number" ||
            !Number.isInteger(resolution.bindingIndex) ||
            resolution.bindingIndex < 0 ||
            resolution.bindingIndex >= record.bindings.length ||
            !boundedString(resolution.value, 512) ||
            !["exact_identifier", "exact_relation", "unique_descriptor"].includes(String(resolution.method))
        ) {
            return false;
        }
    }
    return true;
}

function isKnowledgeCoverageAccumulator(value: unknown, query: unknown, mode: unknown): boolean {
    if (value === undefined) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    let serialized: string;
    try {
        serialized = JSON.stringify(value);
    } catch {
        return false;
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_ACCUMULATOR_BYTES) return false;
    const record = value as Record<string, unknown>;
    if (
        record.protocolVersion !== 1 ||
        record.query !== query ||
        record.mode !== mode ||
        typeof record.pageCount !== "number" ||
        !Number.isInteger(record.pageCount) ||
        record.pageCount < 1 ||
        record.pageCount > 64 ||
        !boundedStrings(record.identifiers, 64, 512) ||
        !Array.isArray(record.facets) ||
        record.facets.length > MAX_ACCUMULATED_FACETS ||
        !Array.isArray(record.trustedEvidence) ||
        record.trustedEvidence.length > MAX_ACCUMULATED_EVIDENCE ||
        !Array.isArray(record.trustedTableSummaries) ||
        record.trustedTableSummaries.length > MAX_ACCUMULATED_TABLE_SUMMARIES ||
        (record.structuredEvidence !== undefined && !isKnowledgeTrustedStructuredEvidence(record.structuredEvidence)) ||
        (record.indexRevision !== undefined && !boundedString(record.indexRevision, 4_096)) ||
        (record.evidenceTruncated !== undefined && typeof record.evidenceTruncated !== "boolean")
    ) {
        return false;
    }
    const facetIds = new Set<string>();
    for (const value of record.facets) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const facet = value as Record<string, unknown>;
        if (
            !boundedString(facet.id, 256) ||
            !boundedString(facet.query, 16_384) ||
            typeof facet.searchGroup !== "number" ||
            !Number.isInteger(facet.searchGroup) ||
            facet.searchGroup < 0 ||
            facet.searchGroup > 8 ||
            typeof facet.hitCount !== "number" ||
            !Number.isInteger(facet.hitCount) ||
            facet.hitCount < 0 ||
            !boundedStrings(facet.candidateKeys ?? [], MAX_ACCUMULATED_CANDIDATE_KEYS, 2_048) ||
            !boundedStrings(facet.identifiers ?? [], 64, 512) ||
            !boundedStrings(facet.sourcePaths ?? [], 32, 4_096) ||
            !boundedStrings(facet.sourceKeys ?? [], 32, 4_608) ||
            (facet.filters !== undefined &&
                (!Array.isArray(facet.filters) ||
                    facet.filters.length > 16 ||
                    !facet.filters.every((filter) => {
                        if (!filter || typeof filter !== "object" || Array.isArray(filter)) return false;
                        const item = filter as Record<string, unknown>;
                        return (
                            boundedString(item.column, 160) &&
                            boundedString(item.value, 512) &&
                            (item.targetPath === undefined || boundedString(item.targetPath, 4_096)) &&
                            (item.targetColumn === undefined || boundedString(item.targetColumn, 160)) &&
                            ["primary_key", "declared", "high"].includes(String(item.confidence))
                        );
                    }))) ||
            (facet.kind !== undefined &&
                ![
                    "catalog_inventory",
                    "exact_identifier",
                    "foreign_key_filter",
                    "route_topology",
                    "route_support",
                    "exhaustive_list",
                    "semantic_facet",
                ].includes(String(facet.kind))) ||
            (facet.completion !== undefined &&
                ![
                    "catalog_verified",
                    "record_verified",
                    "all_sources_verified",
                    "cursor_exhausted",
                    "readable_evidence",
                ].includes(String(facet.completion))) ||
            (facet.verifiedHistoryLocators !== undefined &&
                !boundedVerifiedHistoryLocators(facet.verifiedHistoryLocators)) ||
            (facet.routeScope !== undefined && !isKnowledgeRouteScopeContract(facet.routeScope)) ||
            (facet.searchTruncated !== undefined && typeof facet.searchTruncated !== "boolean") ||
            facetIds.has(facet.id)
        ) {
            return false;
        }
        facetIds.add(facet.id);
    }
    const evidenceKeys = new Set<string>();
    for (const value of record.trustedEvidence) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const pointer = value as Record<string, unknown>;
        if (
            !boundedString(pointer.key, 2_048) ||
            !boundedString(pointer.path, 4_096) ||
            !Array.isArray(pointer.searchGroups) ||
            pointer.searchGroups.length > 9 ||
            !pointer.searchGroups.every(
                (group) => typeof group === "number" && Number.isInteger(group) && group >= 0 && group <= 8,
            ) ||
            pointer.searchGroups.length !== new Set(pointer.searchGroups).size ||
            (pointer.assetId !== undefined && !boundedString(pointer.assetId, 512)) ||
            (pointer.expectedRevision !== undefined && !boundedString(pointer.expectedRevision, 2_048)) ||
            !boundedStrings(pointer.identifiers ?? [], 64, 512) ||
            (pointer.filters !== undefined &&
                (!Array.isArray(pointer.filters) ||
                    pointer.filters.length > 16 ||
                    !pointer.filters.every((filter) => {
                        if (!filter || typeof filter !== "object" || Array.isArray(filter)) return false;
                        const item = filter as Record<string, unknown>;
                        const values = Array.isArray(item.value) ? item.value : [item.value];
                        return (
                            boundedString(item.column, 160) &&
                            (item.op === "eq" || item.op === "in") &&
                            boundedStrings(values, 64, 512)
                        );
                    }))) ||
            (pointer.selectorSignature !== undefined && !validKnowledgeSelectorSignature(pointer.selectorSignature)) ||
            !boundedStrings(pointer.obligationIds ?? [], 32, 256) ||
            (pointer.verifiedHistoryLocators !== undefined &&
                !boundedVerifiedHistoryLocators(pointer.verifiedHistoryLocators)) ||
            (pointer.searchGroups.length === 0 &&
                !isSearchIndependentVerifiedHistoryPointer(pointer as unknown as KnowledgeTrustedEvidencePointer, {
                    facets: record.facets as KnowledgeCoverageFacetPlan[],
                    indexRevision: typeof record.indexRevision === "string" ? record.indexRevision : undefined,
                })) ||
            evidenceKeys.has(
                pointer.selectorSignature ? `selector:${pointer.selectorSignature}` : `legacy:${pointer.key}`,
            )
        ) {
            return false;
        }
        evidenceKeys.add(pointer.selectorSignature ? `selector:${pointer.selectorSignature}` : `legacy:${pointer.key}`);
    }
    const tableKeys = new Set<string>();
    const tableSummaries = new Map<string, Record<string, unknown>>();
    for (const value of record.trustedTableSummaries) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const summary = value as Record<string, unknown>;
        const key = `${String(summary.assetId ?? "")}:${String(summary.path ?? "")}`;
        if (
            !boundedString(summary.path, 4_096) ||
            (summary.assetId !== undefined && !boundedString(summary.assetId, 512)) ||
            (summary.title !== undefined && !boundedString(summary.title, 1_024)) ||
            (summary.mime !== undefined && !boundedString(summary.mime, 256)) ||
            !boundedStrings(summary.columns ?? [], 64, 512) ||
            (summary.primaryKey !== undefined && !boundedString(summary.primaryKey, 512)) ||
            (summary.recordCount !== undefined &&
                (typeof summary.recordCount !== "number" ||
                    !Number.isSafeInteger(summary.recordCount) ||
                    summary.recordCount < 0)) ||
            !boundedStrings(summary.recordIds ?? [], 256, 512) ||
            (summary.recordIdsTruncated !== undefined && typeof summary.recordIdsTruncated !== "boolean") ||
            (summary.resource !== undefined && !boundedString(summary.resource, 8_192)) ||
            !boundedStrings(summary.aliases ?? [], 16, 512) ||
            (summary.relations !== undefined && (!Array.isArray(summary.relations) || summary.relations.length > 24)) ||
            tableKeys.has(key)
        ) {
            return false;
        }
        tableKeys.add(key);
        tableSummaries.set(key, summary);
    }
    for (const summary of tableSummaries.values()) {
        const sourceColumns = new Set((summary.columns as string[] | undefined) ?? []);
        const relationKeys = new Set<string>();
        for (const value of (summary.relations as unknown[] | undefined) ?? []) {
            if (!value || typeof value !== "object" || Array.isArray(value)) return false;
            const relation = value as Record<string, unknown>;
            if (
                !boundedString(relation.sourceColumn, 512) ||
                !sourceColumns.has(relation.sourceColumn) ||
                !safeKnowledgeRelationTargetPath(relation.targetPath) ||
                !boundedString(relation.targetColumn, 512) ||
                !["declared", "high", "medium"].includes(String(relation.confidence)) ||
                (relation.reason !== undefined &&
                    !["schema", "column_identity", "column_entity_match"].includes(String(relation.reason)))
            ) {
                return false;
            }
            const targetKey = `${String(summary.assetId ?? "")}:${relation.targetPath}`;
            const target = tableSummaries.get(targetKey);
            const targetColumns = new Set((target?.columns as string[] | undefined) ?? []);
            const relationKey = [
                relation.sourceColumn,
                relation.targetPath,
                relation.targetColumn,
                relation.confidence,
                relation.reason ?? "",
            ].join(":");
            if (!target || !targetColumns.has(relation.targetColumn as string) || relationKeys.has(relationKey)) {
                return false;
            }
            relationKeys.add(relationKey);
        }
    }
    return true;
}

function isKnowledgePendingSearchPages(value: unknown): boolean {
    if (value === undefined) return true;
    if (!Array.isArray(value) || value.length === 0 || value.length > 9) return false;
    const groups = new Set<number>();
    const ids = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const page = item as Record<string, unknown>;
        if (
            typeof page.searchGroup !== "number" ||
            !Number.isInteger(page.searchGroup) ||
            page.searchGroup < 0 ||
            page.searchGroup > 8 ||
            typeof page.id !== "string" ||
            page.id !== (page.searchGroup === 0 ? "primary" : `facet-${page.searchGroup}`) ||
            typeof page.query !== "string" ||
            !page.query.trim() ||
            page.query.length > 16_384 ||
            typeof page.nextSearchCursor !== "string" ||
            !page.nextSearchCursor.trim() ||
            page.nextSearchCursor.length > 32_768 ||
            typeof page.limit !== "number" ||
            !Number.isInteger(page.limit) ||
            page.limit < 1 ||
            page.limit > 50 ||
            typeof page.searchOffset !== "number" ||
            !Number.isSafeInteger(page.searchOffset) ||
            page.searchOffset < 0 ||
            groups.has(page.searchGroup) ||
            ids.has(page.id)
        ) {
            return false;
        }
        groups.add(page.searchGroup);
        ids.add(page.id);
    }
    return true;
}

export function parseKnowledgeCoverage(grounding: string | undefined): KnowledgeCoverageReceipt | undefined {
    if (!grounding) return undefined;
    try {
        const parsed = JSON.parse(grounding) as Record<string, unknown>;
        const coverage = parsed.coverage;
        if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return undefined;
        const record = coverage as Record<string, unknown>;
        if (record.version !== 1 || !Array.isArray(record.facets)) return undefined;
        return coverage as KnowledgeCoverageReceipt;
    } catch {
        return undefined;
    }
}
