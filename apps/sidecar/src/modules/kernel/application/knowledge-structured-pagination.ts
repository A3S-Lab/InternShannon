import { createHash } from "node:crypto";

export interface KnowledgeStructuredPageMerge {
    record: Record<string, unknown>;
    pageCount: number;
    complete: boolean;
    nextCursor?: string;
}

export interface KnowledgeTrustedStructuredEvidence {
    protocolVersion: 1;
    requestFingerprint: string;
    assetId: string;
    from: string;
    indexRevision: string;
    record: Record<string, unknown>;
}

/**
 * The accumulator is persisted in assistant metadata and also appears in the
 * bounded grounding payload. Keep it well below the total grounding ceiling so
 * a continuation cannot evict every ordinary read merely by carrying old rows.
 */
export const MAX_ACCUMULATED_STRUCTURED_EVIDENCE_BYTES = 32 * 1024;
export const MAX_ACCUMULATED_STRUCTURED_EVIDENCE_ROWS = 512;

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function revision(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return nonEmptyString((value as Record<string, unknown>).revision);
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
        .join(",")}}`;
}

/** Bind persisted rows to the exact deterministic request and index revision. */
export function knowledgeStructuredRequestFingerprint(
    request: Record<string, unknown>,
    expectedRevision: string,
): string {
    return createHash("sha256").update(canonicalJson({ request, expectedRevision }), "utf8").digest("hex");
}

export function knowledgeTrustedStructuredEvidence(
    requestFingerprint: string,
    record: Record<string, unknown>,
): KnowledgeTrustedStructuredEvidence {
    const assetId = nonEmptyString(record.assetId);
    const from = nonEmptyString(record.from);
    const indexRevision = revision(record.indexSnapshot);
    if (!/^[a-f0-9]{64}$/u.test(requestFingerprint) || !assetId || !from || !indexRevision) {
        throw new Error("structured evidence is missing its request or revision binding");
    }
    const evidence: KnowledgeTrustedStructuredEvidence = {
        protocolVersion: 1,
        requestFingerprint,
        assetId,
        from,
        indexRevision,
        record,
    };
    if (!isKnowledgeTrustedStructuredEvidence(evidence)) {
        throw new Error("structured evidence exceeds its bounded accumulator contract");
    }
    return evidence;
}

export function isKnowledgeTrustedStructuredEvidence(value: unknown): value is KnowledgeTrustedStructuredEvidence {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const evidence = value as Record<string, unknown>;
    if (
        evidence.protocolVersion !== 1 ||
        typeof evidence.requestFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/u.test(evidence.requestFingerprint) ||
        typeof evidence.assetId !== "string" ||
        !evidence.assetId.trim() ||
        typeof evidence.from !== "string" ||
        !evidence.from.trim() ||
        typeof evidence.indexRevision !== "string" ||
        !evidence.indexRevision.trim() ||
        !evidence.record ||
        typeof evidence.record !== "object" ||
        Array.isArray(evidence.record)
    ) {
        return false;
    }
    const record = evidence.record as Record<string, unknown>;
    const rows = Array.isArray(record.rows) ? record.rows : null;
    const columns = Array.isArray(record.columns) ? record.columns : null;
    const resources = Array.isArray(record.resources) ? record.resources : null;
    const cursor = nonEmptyString(record.nextCursor);
    if (
        nonEmptyString(record.assetId) !== evidence.assetId ||
        nonEmptyString(record.from) !== evidence.from ||
        revision(record.indexSnapshot) !== evidence.indexRevision ||
        !rows ||
        rows.length > MAX_ACCUMULATED_STRUCTURED_EVIDENCE_ROWS ||
        !rows.every((row) => row && typeof row === "object" && !Array.isArray(row)) ||
        !columns ||
        columns.length > 64 ||
        !columns.every((column) => typeof column === "string") ||
        !Number.isSafeInteger(record.matchedRows) ||
        Number(record.matchedRows) < 0 ||
        record.returnedRows !== rows.length ||
        typeof record.truncated !== "boolean" ||
        (record.truncated === true) !== Boolean(cursor) ||
        !resources ||
        resources.length === 0 ||
        resources.length > 8 ||
        !resources.every(
            (resource) =>
                resource &&
                typeof resource === "object" &&
                !Array.isArray(resource) &&
                typeof (resource as Record<string, unknown>).path === "string" &&
                typeof (resource as Record<string, unknown>).resource === "string" &&
                String((resource as Record<string, unknown>).resource).startsWith(`asset://${evidence.assetId}/`),
        )
    ) {
        return false;
    }
    try {
        return Buffer.byteLength(JSON.stringify(evidence), "utf8") <= MAX_ACCUMULATED_STRUCTURED_EVIDENCE_BYTES;
    } catch {
        return false;
    }
}

function mergeResources(pages: Record<string, unknown>[]): Array<Record<string, unknown>> {
    const merged = new Map<string, Record<string, unknown>>();
    for (const page of pages) {
        for (const value of Array.isArray(page.resources) ? page.resources : []) {
            if (!value || typeof value !== "object" || Array.isArray(value)) continue;
            const resource = value as Record<string, unknown>;
            const path = nonEmptyString(resource.path);
            if (!path) continue;
            const previous = merged.get(path);
            const recordIds = Array.from(
                new Set(
                    [
                        ...(Array.isArray(previous?.matchedRecordIds) ? previous.matchedRecordIds : []),
                        ...(Array.isArray(resource.matchedRecordIds) ? resource.matchedRecordIds : []),
                    ].filter((item): item is string => typeof item === "string" && item.trim().length > 0),
                ),
            ).slice(0, 256);
            merged.set(path, {
                ...(previous ?? {}),
                ...resource,
                matchedRecordIds: recordIds,
                matchedRecordIdsTruncated:
                    previous?.matchedRecordIdsTruncated === true ||
                    resource.matchedRecordIdsTruncated === true ||
                    recordIds.length >= 256,
            });
        }
    }
    return Array.from(merged.values()).slice(0, 8);
}

/** Merge revision-pinned structured pages without weakening cursor semantics. */
export function mergeKnowledgeStructuredPages(pages: Record<string, unknown>[]): KnowledgeStructuredPageMerge {
    if (pages.length === 0) throw new Error("structured pagination requires at least one page");
    const first = pages[0];
    const assetId = nonEmptyString(first.assetId);
    const from = nonEmptyString(first.from);
    const indexRevision = revision(first.indexSnapshot);
    const columns = Array.isArray(first.columns) ? first.columns : [];
    const matchedRows = Number(first.matchedRows);
    if (!assetId || !from || !indexRevision || !Number.isSafeInteger(matchedRows) || matchedRows < 0) {
        throw new Error("structured pagination page is missing its identity or revision binding");
    }
    const seenRecordIds = new Set<string>();
    for (const [index, page] of pages.entries()) {
        if (
            nonEmptyString(page.assetId) !== assetId ||
            nonEmptyString(page.from) !== from ||
            revision(page.indexSnapshot) !== indexRevision ||
            JSON.stringify(Array.isArray(page.columns) ? page.columns : []) !== JSON.stringify(columns) ||
            Number(page.matchedRows) !== matchedRows
        ) {
            throw new Error(`structured pagination page ${index + 1} changed query identity or revision`);
        }
        const rows = Array.isArray(page.rows) ? page.rows : [];
        if (Number(page.returnedRows) !== rows.length) {
            throw new Error(`structured pagination page ${index + 1} returnedRows does not match rows`);
        }
        if (rows.length > matchedRows) {
            throw new Error(`structured pagination page ${index + 1} exceeds the bound match count`);
        }
        const pageRecordIds = Array.isArray(page.matchedRecordIds)
            ? page.matchedRecordIds.filter(
                  (value): value is string => typeof value === "string" && value.trim().length > 0,
              )
            : [];
        for (const recordId of new Set(pageRecordIds)) {
            if (seenRecordIds.has(recordId)) {
                throw new Error(`structured pagination repeated record id ${recordId} across pages`);
            }
            seenRecordIds.add(recordId);
        }
        const cursor = nonEmptyString(page.nextCursor);
        if ((page.truncated === true) !== Boolean(cursor)) {
            throw new Error(`structured pagination page ${index + 1} has inconsistent truncation cursor`);
        }
        if (index < pages.length - 1 && !cursor) {
            throw new Error(`structured pagination page ${index + 1} is terminal before the final page`);
        }
    }

    const last = pages.at(-1)!;
    const nextCursor = nonEmptyString(last.nextCursor);
    const rows = pages.flatMap((page) => (Array.isArray(page.rows) ? page.rows : []));
    if (rows.length > matchedRows) {
        throw new Error(`structured pagination returned ${rows.length} rows for only ${matchedRows} matched rows`);
    }
    const matchedRecordIds = Array.from(
        new Set(
            pages
                .flatMap((page) => (Array.isArray(page.matchedRecordIds) ? page.matchedRecordIds : []))
                .filter((item): item is string => typeof item === "string" && item.trim().length > 0),
        ),
    ).slice(0, 256);
    const pageCount = pages.reduce((sum, page) => {
        const count = Number(page.structuredPageCount);
        return sum + (Number.isSafeInteger(count) && count > 0 ? count : 1);
    }, 0);
    return {
        pageCount,
        complete: !nextCursor,
        ...(nextCursor ? { nextCursor } : {}),
        record: {
            ...first,
            rows,
            returnedRows: rows.length,
            truncated: Boolean(nextCursor),
            nextCursor,
            matchedRecordIds,
            matchedRecordIdsTruncated:
                pages.some((page) => page.matchedRecordIdsTruncated === true) || matchedRecordIds.length >= 256,
            resources: mergeResources(pages),
            structuredPageCount: pageCount,
        },
    };
}
