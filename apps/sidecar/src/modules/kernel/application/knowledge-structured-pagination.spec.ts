import {
    isKnowledgeTrustedStructuredEvidence,
    knowledgeStructuredRequestFingerprint,
    knowledgeTrustedStructuredEvidence,
    mergeKnowledgeStructuredPages,
} from "./knowledge-structured-pagination";

function page(offset: number, count: number, nextCursor?: string): Record<string, unknown> {
    const rows = Array.from({ length: count }, (_, index) => ({ id: `R-${offset + index + 1}` }));
    return {
        assetId: "asset-1",
        from: "raw/sources/items.csv",
        indexSnapshot: { revision: "rev-1" },
        columns: ["id"],
        rows,
        returnedRows: rows.length,
        matchedRows: 3,
        truncated: Boolean(nextCursor),
        nextCursor,
        matchedRecordIds: rows.map((row) => row.id),
        resources: [
            {
                path: "raw/sources/items.csv",
                resource: "asset://asset-1/raw/sources/items.csv",
                matchedRecordIds: rows.map((row) => row.id),
            },
        ],
    };
}

describe("knowledge structured pagination", () => {
    it("merges authenticated pages and closes only after cursor exhaustion", () => {
        const partial = mergeKnowledgeStructuredPages([page(0, 2, "page-2")]);
        expect(partial).toMatchObject({ complete: false, nextCursor: "page-2", pageCount: 1 });

        const complete = mergeKnowledgeStructuredPages([page(0, 2, "page-2"), page(2, 1)]);
        expect(complete).toMatchObject({ complete: true, pageCount: 2 });
        expect(complete.record).toMatchObject({ returnedRows: 3, structuredPageCount: 2, truncated: false });
        expect(complete.record.rows).toHaveLength(3);
        expect(complete.record.matchedRecordIds).toEqual(["R-1", "R-2", "R-3"]);
    });

    it("fails closed on revision drift or inconsistent cursor state", () => {
        expect(() =>
            mergeKnowledgeStructuredPages([
                page(0, 2, "page-2"),
                { ...page(2, 1), indexSnapshot: { revision: "rev-2" } },
            ]),
        ).toThrow(/revision/u);
        expect(() => mergeKnowledgeStructuredPages([{ ...page(0, 2, "page-2"), truncated: false }])).toThrow(/cursor/u);
    });

    it("rejects cumulative pages that return more rows than the bound match count", () => {
        expect(() =>
            mergeKnowledgeStructuredPages([
                { ...page(0, 1, "page-2"), matchedRows: 1 },
                { ...page(1, 1), matchedRows: 1 },
            ]),
        ).toThrow(/2 rows for only 1 matched row/u);
    });

    it("rejects a record repeated across two cursor pages", () => {
        expect(() =>
            mergeKnowledgeStructuredPages([
                { ...page(0, 1, "page-2"), matchedRows: 2 },
                { ...page(0, 1), matchedRows: 2 },
            ]),
        ).toThrow(/repeated record id R-1/u);
    });

    it("binds accumulated rows to a canonical request fingerprint and record revision", () => {
        const left = knowledgeStructuredRequestFingerprint(
            { from: "raw/sources/items.csv", select: ["id"], limit: 25 },
            "rev-1",
        );
        const reordered = knowledgeStructuredRequestFingerprint(
            { limit: 25, select: ["id"], from: "raw/sources/items.csv" },
            "rev-1",
        );
        expect(reordered).toBe(left);
        expect(
            knowledgeStructuredRequestFingerprint(
                { from: "raw/sources/items.csv", select: ["id"], limit: 20 },
                "rev-1",
            ),
        ).not.toBe(left);
        expect(
            knowledgeStructuredRequestFingerprint(
                { from: "raw/sources/items.csv", select: ["id"], limit: 25 },
                "rev-2",
            ),
        ).not.toBe(left);

        const evidence = knowledgeTrustedStructuredEvidence(left, page(0, 2, "page-2"));
        expect(isKnowledgeTrustedStructuredEvidence(evidence)).toBe(true);
        expect(
            isKnowledgeTrustedStructuredEvidence({
                ...evidence,
                indexRevision: "rev-2",
            }),
        ).toBe(false);
    });
});
