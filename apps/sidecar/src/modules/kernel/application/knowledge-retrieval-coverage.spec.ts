import {
    accumulateKnowledgeCoveragePlan,
    finalizeKnowledgeCoverage,
    isKnowledgeContinuationState,
    type KnowledgeCoveragePlan,
    knowledgeContinuationFromCoverage,
    resolveKnowledgeRouteScope,
} from "./knowledge-retrieval-coverage";

const plan: KnowledgeCoveragePlan = {
    version: 1,
    query: "分别查设备和人员",
    mode: "complete",
    facets: [
        { id: "facet-1", query: "设备", searchGroup: 1, hitCount: 2 },
        { id: "facet-2", query: "人员", searchGroup: 2, hitCount: 1 },
    ],
    identifiers: ["DEV-01", "OG-01"],
    indexRevision: "rev-1",
    supplementalPasses: 1,
};

describe("knowledge retrieval coverage", () => {
    it("closes every facet only after readable evidence and exact identifiers survive", () => {
        const coverage = finalizeKnowledgeCoverage(plan, [
            {
                path: "raw/sources/devices.csv",
                __knowledgeSearchGroups: [1],
                matchedIdentifiers: ["DEV-01"],
                missingIdentifiers: [],
                content: "id,name\nDEV-01,chair",
            },
            {
                path: "raw/sources/occupants.csv",
                __knowledgeSearchGroups: [2],
                matchedIdentifiers: ["OG-01"],
                missingIdentifiers: [],
                content: "id,name\nOG-01,user",
            },
        ]);

        expect(coverage.status).toBe("complete");
        expect(coverage.required).toBe(coverage.verified + coverage.missing);
        expect(coverage.missingIdentifiers).toEqual([]);
        expect(knowledgeContinuationFromCoverage(coverage)?.hasMore).toBe(false);
    });

    it("never marks a byte-truncated or omitted facet as covered", () => {
        const coverage = finalizeKnowledgeCoverage(plan, [
            {
                path: "raw/sources/devices.csv",
                __knowledgeSearchGroups: [1],
                matchedIdentifiers: ["DEV-01"],
                missingIdentifiers: [],
                content: "partial\n[Knowledge read truncated by the grounding byte budget.]",
            },
        ]);

        expect(coverage.status).toBe("partial");
        expect(coverage.facets.find((facet) => facet.id === "facet-1")?.status).toBe("partial");
        expect(coverage.facets.find((facet) => facet.id === "facet-2")?.reason).toBe("source_limit");
        expect(coverage.missingIdentifiers).toContain("OG-01");
        expect(knowledgeContinuationFromCoverage(coverage)?.hasMore).toBe(false);
    });

    it("uses one strict read failure and truncation contract without rejecting an embedded notice literal", () => {
        const singleFacetPlan: KnowledgeCoveragePlan = {
            ...plan,
            identifiers: [],
            facets: [{ id: "facet-1", query: "device", searchGroup: 1, hitCount: 1 }],
        };
        const receipt = {
            path: "raw/sources/devices.csv",
            __knowledgeSearchGroups: [1],
            content: "id,status\nDEV-01,ready",
        };

        for (const truncated of [
            { ...receipt, __knowledgeContentTruncated: true },
            {
                ...receipt,
                content:
                    "id,status\nDEV-01,ready\n［Ｋｎｏｗｌｅｄｇｅ ｒｅａｄ ｔｒｕｎｃａｔｅｄ ｂｙ ｔｈｅ ｇｒｏｕｎｄｉｎｇ ｂｙｔｅ ｂｕｄｇｅｔ．］  ",
            },
        ]) {
            expect(finalizeKnowledgeCoverage(singleFacetPlan, [truncated]).facets[0]).toMatchObject({
                status: "partial",
                reason: "result_truncated",
            });
        }

        expect(finalizeKnowledgeCoverage(singleFacetPlan, [{ ...receipt, status: " ERROR " }]).facets[0]).toMatchObject(
            { status: "uncovered", reason: "read_error" },
        );
        expect(
            finalizeKnowledgeCoverage(singleFacetPlan, [
                {
                    ...receipt,
                    content:
                        "id,note\nDEV-01,The literal [Knowledge read truncated by the grounding byte budget.] is documentation\nDEV-02,ready",
                },
            ]).facets[0],
        ).toMatchObject({ status: "covered" });
    });

    it("blocks complete claims when the index snapshot is incomplete", () => {
        const coverage = finalizeKnowledgeCoverage({ ...plan, identifiers: [], indexIncomplete: true }, [
            { path: "raw/sources/devices.csv", __knowledgeSearchGroups: [1], content: "complete" },
            { path: "raw/sources/occupants.csv", __knowledgeSearchGroups: [2], content: "complete" },
        ]);

        expect(coverage.status).toBe("partial");
        expect(coverage.facets.at(-1)).toMatchObject({
            id: "index-completeness",
            reason: "index_incomplete",
        });
    });

    it("keeps structured-query failures and truncation independent from successful search/read coverage", () => {
        const reads = [
            { path: "raw/sources/devices.csv", __knowledgeSearchGroups: [1], content: "complete" },
            { path: "raw/sources/occupants.csv", __knowledgeSearchGroups: [2], content: "complete" },
        ];

        for (const structuredQuery of [
            { status: "uncovered" as const, reason: "structured_query_failed" as const },
            { status: "partial" as const, reason: "structured_query_truncated" as const },
            {
                status: "uncovered" as const,
                reason: "structured_exhaustive_pagination_not_supported" as const,
            },
        ]) {
            const coverage = finalizeKnowledgeCoverage({ ...plan, identifiers: [], structuredQuery }, reads);
            expect(coverage).toMatchObject({ status: "partial", hasMore: false });
            expect(coverage.facets).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: "structured-query",
                        status: structuredQuery.status,
                        reason: structuredQuery.reason,
                    }),
                ]),
            );
        }
    });

    it("allows a validated complete structured result to close its independent facet", () => {
        const coverage = finalizeKnowledgeCoverage(
            { ...plan, identifiers: [], structuredQuery: { status: "covered" } },
            [
                { path: "raw/sources/devices.csv", __knowledgeSearchGroups: [1], content: "complete" },
                { path: "raw/sources/occupants.csv", __knowledgeSearchGroups: [2], content: "complete" },
            ],
        );

        expect(coverage.status).toBe("complete");
        expect(coverage.facets.at(-1)).toMatchObject({ id: "structured-query", status: "covered" });
    });

    it("does not let an unrelated primary-group miss poison an exact owner-table match", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "exact:inv-42",
                        query: "INV-42",
                        searchGroup: 0,
                        hitCount: 2,
                        kind: "exact_identifier",
                        completion: "record_verified",
                        identifiers: ["INV-42"],
                        sourcePaths: ["raw/sources/inventory.csv"],
                    },
                ],
                identifiers: ["INV-42"],
                resultTruncated: true,
            },
            [
                {
                    path: "raw/sources/inventory.csv",
                    __knowledgeSearchGroups: [0],
                    matchedIdentifiers: ["INV-42"],
                    missingIdentifiers: [],
                    content: "inventory_id,name\nINV-42,verified",
                },
                {
                    path: "raw/sources/unrelated.csv",
                    __knowledgeSearchGroups: [0],
                    matchedIdentifiers: [],
                    missingIdentifiers: ["INV-42"],
                    content: "other_id,name",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "complete", hasMore: false, missingIdentifiers: [] });
        expect(coverage.facets).toEqual([expect.objectContaining({ id: "exact:inv-42", status: "covered" })]);
    });

    it("does not let the wrong asset satisfy an exact facet with the same relative path", () => {
        const boundPlan: KnowledgeCoveragePlan = {
            ...plan,
            facets: [
                {
                    id: "exact:rec-b2",
                    query: "REC-B2",
                    searchGroup: 0,
                    hitCount: 1,
                    kind: "exact_identifier",
                    completion: "record_verified",
                    identifiers: ["REC-B2"],
                    sourcePaths: ["raw/sources/shared.csv"],
                    sourceKeys: ["asset-b:raw/sources/shared.csv"],
                },
            ],
            identifiers: ["REC-B2"],
        };

        const wrongAsset = finalizeKnowledgeCoverage(boundPlan, [
            {
                assetId: "asset-a",
                path: "raw/sources/shared.csv",
                __knowledgeSearchGroups: [0],
                matchedIdentifiers: ["REC-B2"],
                content: "record_id,value\nREC-B2,wrong asset",
            },
        ]);
        expect(wrongAsset).toMatchObject({ status: "partial", missingIdentifiers: ["REC-B2"] });
        expect(wrongAsset.facets[0]).toMatchObject({ status: "uncovered", reason: "missing_identifier" });

        const boundAsset = finalizeKnowledgeCoverage(boundPlan, [
            {
                assetId: "asset-b",
                path: "raw/sources/shared.csv",
                __knowledgeSearchGroups: [0],
                matchedIdentifiers: ["REC-B2"],
                content: "record_id,value\nREC-B2,verified",
            },
        ]);
        expect(boundAsset).toMatchObject({ status: "complete", missingIdentifiers: [] });
    });

    it("keeps a bound foreign-key record partial until every schema-bound key is verified", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "relation:orders:customer",
                        query: "orders for CUSTOMER-42 in BATCH-7",
                        searchGroup: 1,
                        hitCount: 1,
                        kind: "foreign_key_filter",
                        completion: "record_verified",
                        identifiers: ["CUSTOMER-42", "BATCH-7"],
                        sourcePaths: ["raw/sources/orders.csv"],
                        sourceKeys: ["asset-orders:raw/sources/orders.csv"],
                    },
                ],
                identifiers: [],
                resultTruncated: true,
            },
            [
                {
                    assetId: "asset-orders",
                    path: "raw/sources/orders.csv",
                    __knowledgeSearchGroups: [1],
                    matchedIdentifiers: ["CUSTOMER-42"],
                    missingIdentifiers: ["BATCH-7"],
                    content: "order_id,customer_id\nORDER-9,CUSTOMER-42",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "partial", hasMore: false });
        expect(coverage.facets).toEqual([
            expect.objectContaining({ id: "relation:orders:customer", status: "partial" }),
        ]);
    });

    it("keeps exact multi-record verification strict when only one identifier is present", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "exact:orders",
                        query: "ORDER-9 ORDER-10",
                        searchGroup: 1,
                        hitCount: 1,
                        kind: "exact_identifier",
                        completion: "record_verified",
                        identifiers: ["ORDER-9", "ORDER-10"],
                        sourcePaths: ["raw/sources/orders.csv"],
                    },
                ],
                identifiers: ["ORDER-9", "ORDER-10"],
            },
            [
                {
                    path: "raw/sources/orders.csv",
                    __knowledgeSearchGroups: [1],
                    matchedIdentifiers: ["ORDER-9"],
                    missingIdentifiers: ["ORDER-10"],
                    content: "order_id\nORDER-9",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "partial", missingIdentifiers: ["ORDER-10"] });
        expect(coverage.facets[0]).toMatchObject({ status: "partial", reason: "missing_identifier" });
    });

    it("lets a fully authoritative structured result close auxiliary search and catalog pagination", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                identifiers: [],
                resultTruncated: true,
                catalogTruncated: true,
                catalogOmittedCount: 4,
                nextCatalogCursor: "irrelevant-catalog-page",
                catalogOffset: 32,
                structuredQuery: { status: "covered", authoritative: true },
            },
            [],
        );

        expect(coverage).toMatchObject({ status: "complete", hasMore: false });
        expect(coverage.nextCatalogCursor).toBeUndefined();
        expect(coverage.catalogOffset).toBeUndefined();
        expect(coverage.catalogTruncated).toBeUndefined();
        expect(coverage.catalogOmittedCount).toBeUndefined();
        expect(coverage.facets).toEqual([expect.objectContaining({ id: "structured-query", status: "covered" })]);
        const continuation = knowledgeContinuationFromCoverage({
            ...coverage,
            nextCatalogCursor: "defensive-catalog-page",
            nextStructuredCursor: "defensive-structured-page",
        });
        expect(continuation).not.toHaveProperty("nextCatalogCursor");
        expect(continuation).not.toHaveProperty("nextStructuredCursor");
    });

    it("does not let an authoritative structured result or generic read close an overflow sentinel", () => {
        const overflowId = "obligation-overflow:verified-history-window:unresolved";
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                identifiers: [],
                facets: [
                    ...plan.facets,
                    {
                        id: overflowId,
                        query: "trusted evidence exists outside the bounded review window",
                        searchGroup: 1,
                        hitCount: 1,
                        kind: "route_topology",
                        completion: "all_sources_verified",
                        identifiers: [],
                        sourcePaths: [],
                        sourceKeys: [],
                    },
                ],
                structuredQuery: {
                    status: "covered",
                    authoritative: true,
                    completedObligationIds: [overflowId],
                },
            },
            [
                {
                    path: "raw/sources/items.csv",
                    __knowledgeSearchGroups: [1],
                    __knowledgeObligationIds: [overflowId],
                    content: "item_id,status\nITEM-001,ready",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "partial", hasMore: false });
        expect(coverage.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: overflowId,
                    status: "uncovered",
                    reason: "source_limit",
                }),
                expect.objectContaining({ id: "structured-query", status: "covered" }),
            ]),
        );
        expect(coverage.facets).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "facet-1" })]));
    });

    it("keeps auxiliary search obligations for a non-authoritative structured sub-result", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                identifiers: [],
                resultTruncated: true,
                structuredQuery: { status: "covered", authoritative: false },
            },
            [],
        );

        expect(coverage.status).toBe("partial");
        expect(coverage.facets).toEqual(expect.arrayContaining([expect.objectContaining({ id: "search-results" })]));
    });

    it("does not invent a global search facet when typed facets own their coverage", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "semantic:1",
                        query: "independent question",
                        searchGroup: 1,
                        hitCount: 1,
                        kind: "semantic_facet",
                        completion: "readable_evidence",
                    },
                ],
                identifiers: [],
                resultTruncated: true,
                structuredQuery: { status: "covered", authoritative: false },
            },
            [
                {
                    path: "raw/sources/evidence.md",
                    __knowledgeSearchGroups: [1],
                    content: "verified evidence",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "complete", hasMore: false });
        expect(coverage.facets.some((facet) => facet.id === "search-results")).toBe(false);
    });

    it("keeps explicitly unfinished supporting search partial for a structured sub-result", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "semantic:1",
                        query: "independent supporting question",
                        searchGroup: 1,
                        hitCount: 1,
                        kind: "semantic_facet",
                        completion: "readable_evidence",
                    },
                ],
                identifiers: [],
                resultTruncated: true,
                structuredQuery: {
                    status: "covered",
                    authoritative: false,
                    supportingSearchRequired: true,
                },
            },
            [
                {
                    path: "raw/sources/evidence.md",
                    __knowledgeSearchGroups: [1],
                    content: "verified evidence",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "partial" });
        expect(coverage.facets).toEqual(expect.arrayContaining([expect.objectContaining({ id: "search-results" })]));
    });

    it("does not reopen a covered primary semantic facet for an unrelated broad cursor", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "semantic:1",
                        query: "aggregate plus an additional open-ended duty",
                        searchGroup: 0,
                        hitCount: 1,
                        kind: "semantic_facet",
                        completion: "readable_evidence",
                    },
                ],
                identifiers: [],
                resultTruncated: true,
                structuredQuery: { status: "covered", authoritative: false },
            },
            [
                {
                    path: "raw/sources/evidence.md",
                    __knowledgeSearchGroups: [0],
                    content: "one verified hit",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "complete", hasMore: false });
        expect(coverage.facets).toEqual([
            expect.objectContaining({ id: "semantic:1", status: "covered" }),
            expect.objectContaining({ id: "structured-query", status: "covered" }),
        ]);
    });

    it("keeps an unmodeled supporting prose obligation partial after a structured sub-result", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "exact:item-42",
                        query: "ITEM-42",
                        searchGroup: 0,
                        hitCount: 1,
                        kind: "exact_identifier",
                        completion: "record_verified",
                        identifiers: ["ITEM-42"],
                        sourcePaths: ["raw/sources/items.csv"],
                    },
                ],
                identifiers: ["ITEM-42"],
                resultTruncated: true,
                nextSearchCursor: "supporting-page-2",
                searchOffset: 32,
                structuredQuery: {
                    status: "covered",
                    authoritative: false,
                    supportingSearchRequired: true,
                    completedObligationIds: ["exact:item-42"],
                },
            },
            [],
        );

        expect(coverage).toMatchObject({ status: "partial", hasMore: true, resultTruncated: true });
        expect(coverage.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "exact:item-42", status: "covered" }),
                expect.objectContaining({ id: "search-results", status: "partial" }),
            ]),
        );
    });

    it("never claims complete when ranked search candidates were truncated", () => {
        const coverage = finalizeKnowledgeCoverage(
            { ...plan, identifiers: [], resultTruncated: true, nextSearchCursor: "search-next" },
            [
                { path: "raw/sources/devices.csv", __knowledgeSearchGroups: [1], content: "complete" },
                { path: "raw/sources/occupants.csv", __knowledgeSearchGroups: [2], content: "complete" },
            ],
        );

        expect(coverage.status).toBe("partial");
        expect(coverage.resultTruncated).toBe(true);
        expect(coverage.facets.at(-1)).toMatchObject({
            id: "search-results",
            status: "partial",
            reason: "result_truncated",
        });
        expect(coverage.hasMore).toBe(true);
    });

    it("reports an incomplete table catalog with an explicit omitted count", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [],
                identifiers: [],
                catalogCovered: false,
                catalogTruncated: true,
                catalogOmittedCount: 7,
            },
            [],
        );

        expect(coverage.status).toBe("partial");
        expect(coverage.catalogTruncated).toBe(true);
        expect(coverage.catalogOmittedCount).toBe(7);
        expect(coverage.facets).toEqual([
            expect.objectContaining({ id: "catalog-inventory", reason: "result_truncated" }),
        ]);
    });

    it("requires every chunk-level candidate key to have a complete read in complete mode", () => {
        const chunkPlan: KnowledgeCoveragePlan = {
            ...plan,
            facets: [
                {
                    id: "facet-1",
                    query: "完整长文",
                    searchGroup: 1,
                    hitCount: 2,
                    candidateKeys: ["asset-1:source:guide.md#0", "asset-1:source:guide.md#1"],
                },
            ],
            identifiers: [],
        };
        const partial = finalizeKnowledgeCoverage(chunkPlan, [
            {
                path: "raw/sources/guide.md",
                __knowledgeHitKey: "asset-1:source:guide.md#0",
                __knowledgeSearchGroups: [1],
                content: "first chunk",
            },
        ]);
        expect(partial.status).toBe("partial");
        expect(partial.facets[0]).toMatchObject({ status: "partial", reason: "source_limit" });

        const complete = finalizeKnowledgeCoverage(chunkPlan, [
            {
                path: "raw/sources/guide.md",
                __knowledgeHitKey: "asset-1:source:guide.md#0",
                __knowledgeSearchGroups: [1],
                content: "first chunk",
            },
            {
                path: "raw/sources/guide.md",
                __knowledgeHitKey: "asset-1:source:guide.md#1",
                __knowledgeSearchGroups: [1],
                content: "second chunk",
            },
        ]);
        expect(complete.status).toBe("complete");
    });

    it("closes an exact-identifier obligation without reading unrelated high-recall candidates", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "exact:inv-42",
                        query: "INV-42",
                        searchGroup: 1,
                        hitCount: 8,
                        kind: "exact_identifier",
                        completion: "record_verified",
                        identifiers: ["INV-42"],
                        sourcePaths: ["raw/sources/inventory.csv"],
                        candidateKeys: Array.from({ length: 8 }, (_, index) => `candidate-${index}`),
                    },
                ],
                identifiers: ["INV-42"],
                resultTruncated: true,
                nextSearchCursor: "irrelevant-recall-page",
                pendingSearchPages: [
                    {
                        id: "primary",
                        searchGroup: 0,
                        query: "INV-42",
                        limit: 3,
                        nextSearchCursor: "irrelevant-recall-page",
                        searchOffset: 3,
                    },
                ],
            },
            [
                {
                    path: "raw/sources/inventory.csv",
                    __knowledgeHitKey: "candidate-0",
                    __knowledgeSearchGroups: [],
                    matchedIdentifiers: ["INV-42"],
                    content: "inventory_id,status\nINV-42,ready",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "complete", hasMore: false, missingIdentifiers: [] });
        expect(coverage.resultTruncated).toBeUndefined();
        expect(coverage.nextSearchCursor).toBeUndefined();
        expect(coverage.pendingSearchPages).toBeUndefined();
        expect(coverage.searchOffset).toBeUndefined();
        expect(knowledgeContinuationFromCoverage(coverage)).not.toHaveProperty("resultTruncated");
        expect(knowledgeContinuationFromCoverage(coverage)).not.toHaveProperty("nextSearchCursor");
        expect(coverage.facets).toEqual([
            expect.objectContaining({ id: "exact:inv-42", status: "covered", kind: "exact_identifier" }),
        ]);
    });

    it("retains only search pages that can advance an unfinished typed obligation", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "exact:inv-42",
                        query: "INV-42",
                        searchGroup: 0,
                        hitCount: 1,
                        kind: "exact_identifier",
                        completion: "record_verified",
                        identifiers: ["INV-42"],
                    },
                    {
                        id: "exact:req-17",
                        query: "REQ-17",
                        searchGroup: 2,
                        hitCount: 0,
                        kind: "exact_identifier",
                        completion: "record_verified",
                        identifiers: ["REQ-17"],
                    },
                ],
                identifiers: ["INV-42", "REQ-17"],
                resultTruncated: true,
                nextSearchCursor: "covered-primary-page",
                pendingSearchPages: [
                    {
                        id: "primary",
                        searchGroup: 0,
                        query: "INV-42",
                        limit: 3,
                        nextSearchCursor: "covered-primary-page",
                        searchOffset: 3,
                    },
                    {
                        id: "facet-2",
                        searchGroup: 2,
                        query: "REQ-17",
                        limit: 3,
                        nextSearchCursor: "required-facet-page",
                        searchOffset: 3,
                    },
                ],
            },
            [
                {
                    path: "raw/sources/inventory.csv",
                    __knowledgeSearchGroups: [0],
                    matchedIdentifiers: ["INV-42"],
                    content: "inventory_id,status\nINV-42,ready",
                },
            ],
        );

        expect(coverage).toMatchObject({
            status: "partial",
            hasMore: true,
            resultTruncated: true,
            pendingSearchPages: [expect.objectContaining({ searchGroup: 2, nextSearchCursor: "required-facet-page" })],
        });
        expect(coverage.nextSearchCursor).toBeUndefined();
        expect(coverage.searchOffset).toBeUndefined();
        expect(coverage.pendingSearchPages).toHaveLength(1);
        expect(knowledgeContinuationFromCoverage(coverage)).toMatchObject({
            status: "partial",
            hasMore: true,
            pendingSearchPages: [expect.objectContaining({ searchGroup: 2 })],
        });
    });

    it("does not expose an unrelated search cursor for a non-resumable partial obligation", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "exact:inv-42",
                        query: "INV-42",
                        searchGroup: 0,
                        hitCount: 1,
                        kind: "exact_identifier",
                        completion: "record_verified",
                        identifiers: ["INV-42"],
                    },
                    {
                        id: "exact:req-17",
                        query: "REQ-17",
                        searchGroup: 2,
                        hitCount: 0,
                        kind: "exact_identifier",
                        completion: "record_verified",
                        identifiers: ["REQ-17"],
                    },
                ],
                identifiers: ["INV-42", "REQ-17"],
                resultTruncated: true,
                nextSearchCursor: "covered-primary-page",
                pendingSearchPages: [
                    {
                        id: "primary",
                        searchGroup: 0,
                        query: "INV-42",
                        limit: 3,
                        nextSearchCursor: "covered-primary-page",
                        searchOffset: 3,
                    },
                ],
            },
            [
                {
                    path: "raw/sources/inventory.csv",
                    __knowledgeSearchGroups: [0],
                    matchedIdentifiers: ["INV-42"],
                    content: "inventory_id,status\nINV-42,ready",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "partial", hasMore: false, resultTruncated: true });
        expect(coverage.nextSearchCursor).toBeUndefined();
        expect(coverage.pendingSearchPages).toBeUndefined();
        expect(coverage.searchOffset).toBeUndefined();
    });

    it("lets a bound structured row discharge its matching foreign-key obligation only", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "foreign-key:asset-1:assignments",
                        query: "INV-42 关联记录",
                        searchGroup: 1,
                        hitCount: 5,
                        kind: "foreign_key_filter",
                        completion: "record_verified",
                        identifiers: ["INV-42"],
                        sourcePaths: ["raw/sources/assignments.csv"],
                    },
                ],
                identifiers: [],
                structuredQuery: {
                    status: "covered",
                    completedObligationIds: ["foreign-key:asset-1:assignments"],
                },
            },
            [],
        );

        expect(coverage.status).toBe("complete");
        expect(coverage.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "foreign-key:asset-1:assignments", status: "covered" }),
                expect.objectContaining({ id: "structured-query", status: "covered" }),
            ]),
        );
    });

    it("uses one complete readable source to close a semantic facet", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [
                    {
                        id: "semantic:1",
                        query: "wheelchair evacuation",
                        searchGroup: 1,
                        hitCount: 6,
                        kind: "semantic_facet",
                        completion: "readable_evidence",
                        candidateKeys: Array.from({ length: 6 }, (_, index) => `semantic-${index}`),
                    },
                ],
                identifiers: [],
                resultTruncated: true,
            },
            [
                {
                    path: "raw/sources/accessibility.md",
                    __knowledgeHitKey: "semantic-0",
                    __knowledgeSearchGroups: [1],
                    content: "verified readable evidence",
                },
            ],
        );

        expect(coverage).toMatchObject({ status: "complete", hasMore: false });
        expect(coverage.facets[0]).toMatchObject({ id: "semantic:1", status: "covered" });
    });

    it("keeps an exhaustive obligation fail-closed until its cursor and candidate reads are exhausted", () => {
        const exhaustiveFacet = {
            id: "facet-1" as const,
            query: "list every record",
            searchGroup: 1,
            hitCount: 2,
            kind: "exhaustive_list" as const,
            completion: "cursor_exhausted" as const,
            candidateKeys: ["row-page-1", "row-page-2"],
        };
        const first = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [{ ...exhaustiveFacet, searchTruncated: true }],
                identifiers: [],
                resultTruncated: true,
                pendingSearchPages: [
                    {
                        id: "facet-1",
                        searchGroup: 1,
                        query: "list every record",
                        limit: 10,
                        nextSearchCursor: "page-2",
                        searchOffset: 10,
                    },
                ],
            },
            [
                {
                    path: "raw/sources/records.csv",
                    __knowledgeHitKey: "row-page-1",
                    __knowledgeSearchGroups: [1],
                    content: "page one",
                },
            ],
        );
        expect(first).toMatchObject({ status: "partial", hasMore: true });
        expect(first.facets[0]).toMatchObject({ status: "partial", reason: "result_truncated" });

        const terminal = finalizeKnowledgeCoverage(
            { ...plan, facets: [exhaustiveFacet], identifiers: [], resultTruncated: false },
            [
                {
                    path: "raw/sources/records.csv",
                    __knowledgeHitKey: "row-page-1",
                    __knowledgeSearchGroups: [1],
                    content: "page one",
                },
                {
                    path: "raw/sources/records.csv",
                    __knowledgeHitKey: "row-page-2",
                    __knowledgeSearchGroups: [1],
                    content: "page two",
                },
            ],
        );
        expect(terminal).toMatchObject({ status: "complete", hasMore: false });

        const unrelatedGlobalTruncation = finalizeKnowledgeCoverage(
            { ...plan, facets: [exhaustiveFacet], identifiers: [], resultTruncated: true },
            [
                {
                    path: "raw/sources/records.csv",
                    __knowledgeHitKey: "row-page-1",
                    __knowledgeSearchGroups: [1],
                    content: "page one",
                },
                {
                    path: "raw/sources/records.csv",
                    __knowledgeHitKey: "row-page-2",
                    __knowledgeSearchGroups: [1],
                    content: "page two",
                },
            ],
        );
        expect(unrelatedGlobalTruncation).toMatchObject({ status: "complete", hasMore: false });
        expect(unrelatedGlobalTruncation.facets).toEqual([
            expect.objectContaining({ id: "facet-1", status: "covered" }),
        ]);
    });

    it("keeps typed obligations fail-closed on explicit misses, read failures, and revision drift", () => {
        const typedPlan: KnowledgeCoveragePlan = {
            ...plan,
            facets: [
                {
                    id: "exact:inv-42",
                    query: "INV-42",
                    searchGroup: 1,
                    hitCount: 1,
                    kind: "exact_identifier",
                    completion: "record_verified",
                    identifiers: ["INV-42"],
                    sourcePaths: ["raw/sources/inventory.csv"],
                },
            ],
            identifiers: ["INV-42"],
        };
        const missing = finalizeKnowledgeCoverage(typedPlan, [
            {
                path: "raw/sources/inventory.csv",
                __knowledgeSearchGroups: [1],
                matchedIdentifiers: [],
                missingIdentifiers: ["INV-42"],
                content: "inventory_id,status",
            },
        ]);
        expect(missing.facets[0]).toMatchObject({ status: "partial", reason: "missing_identifier" });

        const failed = finalizeKnowledgeCoverage(typedPlan, [
            {
                path: "raw/sources/inventory.csv",
                __knowledgeSearchGroups: [1],
                __knowledgeReadFailed: true,
            },
        ]);
        expect(failed.facets[0]).toMatchObject({ status: "uncovered", reason: "read_error" });

        const stale = finalizeKnowledgeCoverage(typedPlan, [
            {
                path: "raw/sources/inventory.csv",
                __knowledgeSearchGroups: [1],
                __knowledgeRevisionChanged: true,
            },
        ]);
        expect(stale).toMatchObject({ status: "blocked", hasMore: false });
    });

    it("does not complete a relation batch until every declared source has usable evidence", () => {
        const relationPlan: KnowledgeCoveragePlan = {
            ...plan,
            facets: [
                {
                    id: "foreign-key:bounded-batch",
                    query: "AC-1",
                    searchGroup: 1,
                    hitCount: 2,
                    kind: "foreign_key_filter",
                    completion: "all_sources_verified",
                    identifiers: ["AC-1"],
                    sourcePaths: ["raw/sources/a.csv", "raw/sources/b.csv"],
                },
            ],
            identifiers: ["AC-1"],
        };
        const oneSource = finalizeKnowledgeCoverage(relationPlan, [
            {
                path: "raw/sources/a.csv",
                __knowledgeSearchGroups: [1],
                matchedIdentifiers: ["AC-1"],
                content: "id,value\nAC-1,A",
            },
        ]);
        expect(oneSource).toMatchObject({ status: "partial", hasMore: false });
        expect(oneSource.facets[0]).toMatchObject({ status: "partial", reason: "source_limit" });

        const everySource = finalizeKnowledgeCoverage(relationPlan, [
            {
                path: "raw/sources/a.csv",
                __knowledgeSearchGroups: [1],
                matchedIdentifiers: ["AC-1"],
                content: "id,value\nAC-1,A",
            },
            {
                path: "raw/sources/b.csv",
                __knowledgeSearchGroups: [1],
                matchedIdentifiers: ["AC-1"],
                content: "id,value\nAC-1,B",
            },
        ]);
        expect(everySource).toMatchObject({ status: "complete", hasMore: false });
        expect(everySource.facets[0]).toMatchObject({ status: "covered" });
    });

    it("requires readable relation-table evidence before a high-confidence all-related duty can close", () => {
        const relationPlan: KnowledgeCoveragePlan = {
            ...plan,
            facets: [
                {
                    id: "foreign-key:asset-1:raw/sources/orders.csv",
                    query: "all records related to AC-42",
                    searchGroup: 1,
                    hitCount: 1,
                    kind: "foreign_key_filter",
                    completion: "all_sources_verified",
                    identifiers: ["AC-42"],
                    sourcePaths: ["raw/sources/orders.csv"],
                    sourceKeys: ["asset-1:raw/sources/orders.csv"],
                },
            ],
            identifiers: ["AC-42"],
        };

        const catalogOnly = finalizeKnowledgeCoverage(relationPlan, []);
        expect(catalogOnly).toMatchObject({ status: "partial", hasMore: false });
        expect(catalogOnly.facets[0]).toMatchObject({ status: "uncovered", reason: "missing_identifier" });

        const verifiedRead = finalizeKnowledgeCoverage(relationPlan, [
            {
                assetId: "asset-1",
                path: "raw/sources/orders.csv",
                __knowledgeSearchGroups: [1],
                matchedRecordIds: ["OR-7"],
                __knowledgeReadFilters: [{ column: "account_id", op: "eq", value: "AC-42" }],
                content: "order_id,account_id\nOR-7,AC-42",
            },
        ]);
        expect(verifiedRead).toMatchObject({ status: "complete", hasMore: false });
        expect(verifiedRead.facets[0]).toMatchObject({ status: "covered" });
    });

    it("accepts a revision-pinned empty relation result without replacing the independently verified owner", () => {
        const relationId = "foreign-key:asset-map:data/resources.csv";
        const exactId = "exact:loc-z";
        const relationPlan: KnowledgeCoveragePlan = {
            version: 1,
            query: "Explain the resources related to LOC-Z",
            mode: "complete",
            indexRevision: "rev-map",
            supplementalPasses: 0,
            identifiers: ["LOC-Z"],
            facets: [
                {
                    id: exactId,
                    query: "LOC-Z",
                    searchGroup: 0,
                    hitCount: 1,
                    kind: "exact_identifier",
                    completion: "record_verified",
                    identifiers: ["LOC-Z"],
                    sourcePaths: ["data/locations.csv"],
                    sourceKeys: ["asset-map:data/locations.csv"],
                },
                {
                    id: relationId,
                    query: "resources related to LOC-Z",
                    searchGroup: 1,
                    hitCount: 1,
                    kind: "foreign_key_filter",
                    completion: "all_sources_verified",
                    identifiers: ["LOC-Z"],
                    sourcePaths: ["data/resources.csv"],
                    sourceKeys: ["asset-map:data/resources.csv"],
                    filters: [
                        {
                            column: "location_id",
                            value: "LOC-Z",
                            targetPath: "data/locations.csv",
                            targetColumn: "location_id",
                            confidence: "declared",
                        },
                    ],
                },
            ],
        };
        const ownerRead = {
            assetId: "asset-map",
            path: "data/locations.csv",
            __knowledgePath: "data/locations.csv",
            __knowledgeSearchGroups: [0],
            __knowledgeHitKey: "asset-map:source:data/locations.csv",
            __knowledgeExpectedRevision: "rev-map",
            __knowledgeReadIdentifiers: ["LOC-Z"],
            __knowledgeSelectorSignature: JSON.stringify({
                v: 1,
                assetId: "asset-map",
                path: "data/locations.csv",
                kind: "exact",
                identifiers: ["LOC-Z"],
            }),
            __knowledgeObligationIds: [exactId],
            matchedIdentifiers: ["LOC-Z"],
            content: "location_id,label\nLOC-Z,West",
        };
        const emptyRelationRead = {
            assetId: "asset-map",
            path: "data/resources.csv",
            __knowledgePath: "data/resources.csv",
            __knowledgeSearchGroups: [1],
            __knowledgeHitKey: "asset-map:source:data/resources.csv",
            __knowledgeExpectedRevision: "rev-map",
            __knowledgeReadFilters: [{ column: "location_id", op: "eq" as const, value: "LOC-Z" }],
            __knowledgeSelectorSignature: JSON.stringify({
                v: 1,
                assetId: "asset-map",
                path: "data/resources.csv",
                kind: "filter",
                filters: [{ column: "location_id", op: "eq", value: ["LOC-Z"] }],
            }),
            __knowledgeObligationIds: [relationId],
            matchedIdentifiers: [],
            content: "resource_id,location_id,kind\n",
        };

        const empty = finalizeKnowledgeCoverage(relationPlan, [ownerRead, emptyRelationRead]);
        expect(empty).toMatchObject({ status: "complete", verified: 2, missing: 0 });
        expect(empty.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: exactId, status: "covered" }),
                expect.objectContaining({ id: relationId, status: "covered" }),
            ]),
        );
        expect(
            empty.accumulator?.trustedEvidence.find((pointer) => pointer.path === "data/resources.csv"),
        ).not.toHaveProperty("identifiers");

        const positive = finalizeKnowledgeCoverage(relationPlan, [
            ownerRead,
            {
                ...emptyRelationRead,
                matchedIdentifiers: ["RES-1"],
                content: "resource_id,location_id,kind\nRES-1,LOC-Z,kit",
            },
        ]);
        expect(positive).toMatchObject({ status: "complete", verified: 2, missing: 0 });

        const missingOwner = finalizeKnowledgeCoverage(relationPlan, [emptyRelationRead]);
        expect(missingOwner).toMatchObject({ status: "partial", verified: 1, missing: 1 });
        expect(missingOwner.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: exactId, status: "uncovered" }),
                expect.objectContaining({ id: relationId, status: "covered" }),
            ]),
        );
    });

    it("keeps exact filtered relation evidence fail-closed for transport, binding and selector mismatches", () => {
        const relationId = "foreign-key:asset-map:data/resources.csv";
        const relationPlan: KnowledgeCoveragePlan = {
            version: 1,
            query: "List resources related to LOC-Z",
            mode: "complete",
            indexRevision: "rev-map",
            supplementalPasses: 0,
            identifiers: [],
            facets: [
                {
                    id: relationId,
                    query: "resources related to LOC-Z",
                    searchGroup: 1,
                    hitCount: 1,
                    kind: "foreign_key_filter",
                    completion: "all_sources_verified",
                    identifiers: ["LOC-Z"],
                    sourcePaths: ["data/resources.csv"],
                    sourceKeys: ["asset-map:data/resources.csv"],
                    filters: [{ column: "location_id", value: "LOC-Z", confidence: "declared" }],
                },
            ],
        };
        const receipt = {
            assetId: "asset-map",
            path: "data/resources.csv",
            __knowledgePath: "data/resources.csv",
            __knowledgeSearchGroups: [1],
            __knowledgeHitKey: "asset-map:source:data/resources.csv",
            __knowledgeExpectedRevision: "rev-map",
            __knowledgeReadFilters: [{ column: "location_id", op: "eq" as const, value: "LOC-Z" }],
            __knowledgeSelectorSignature: JSON.stringify({
                v: 1,
                assetId: "asset-map",
                path: "data/resources.csv",
                kind: "filter",
                filters: [{ column: "location_id", op: "eq", value: ["LOC-Z"] }],
            }),
            __knowledgeObligationIds: [relationId],
            content: "resource_id,location_id\n",
        };
        const selectorSignature = (assetId: string, path: string, op: "eq" | "in", values: string[]) =>
            JSON.stringify({
                v: 1,
                assetId,
                path,
                kind: "filter",
                filters: [{ column: "location_id", op, value: values }],
            });
        const incompleteReceipts = [
            { ...receipt, __knowledgeReadFailed: true },
            { ...receipt, __knowledgeReadTruncated: true },
            { ...receipt, __knowledgeRevisionChanged: true },
            {
                ...receipt,
                assetId: "asset-other",
                __knowledgeSelectorSignature: selectorSignature("asset-other", "data/resources.csv", "eq", ["LOC-Z"]),
            },
            {
                ...receipt,
                path: "data/other-resources.csv",
                __knowledgePath: "data/other-resources.csv",
                __knowledgeSelectorSignature: selectorSignature("asset-map", "data/other-resources.csv", "eq", [
                    "LOC-Z",
                ]),
            },
            { ...receipt, __knowledgeExpectedRevision: "rev-old" },
            {
                ...receipt,
                __knowledgeReadFilters: [{ column: "location_id", op: "in" as const, value: ["LOC-Z", "LOC-X"] }],
                __knowledgeSelectorSignature: selectorSignature("asset-map", "data/resources.csv", "in", [
                    "LOC-X",
                    "LOC-Z",
                ]),
            },
            {
                ...receipt,
                __knowledgeReadFilters: [
                    { column: "location_id", op: "eq" as const, value: "LOC-Z" },
                    { column: "kind", op: "eq" as const, value: "kit" },
                ],
                __knowledgeSelectorSignature: JSON.stringify({
                    v: 1,
                    assetId: "asset-map",
                    path: "data/resources.csv",
                    kind: "filter",
                    filters: [
                        { column: "kind", op: "eq", value: ["kit"] },
                        { column: "location_id", op: "eq", value: ["LOC-Z"] },
                    ],
                }),
            },
            { ...receipt, __knowledgeSelectorSignature: undefined },
            { ...receipt, __knowledgeObligationIds: [] },
        ];

        for (const incompleteReceipt of incompleteReceipts) {
            expect(finalizeKnowledgeCoverage(relationPlan, [incompleteReceipt]).status).not.toBe("complete");
        }
        expect(
            finalizeKnowledgeCoverage(relationPlan, [{ ...receipt, __knowledgeReadFailed: true }]).facets[0],
        ).toMatchObject({ status: "uncovered", reason: "read_error" });
        expect(
            finalizeKnowledgeCoverage(relationPlan, [{ ...receipt, __knowledgeReadTruncated: true }]).facets[0],
        ).toMatchObject({ status: "partial", reason: "result_truncated" });
        expect(
            finalizeKnowledgeCoverage(relationPlan, [{ ...receipt, __knowledgeRevisionChanged: true }]).facets[0],
        ).toMatchObject({ status: "stale", reason: "revision_changed" });
    });

    it("accepts only an exact-set in selector when one relation column owes multiple values", () => {
        const relationId = "foreign-key:asset-map:data/overrides.csv";
        const multiValuePlan: KnowledgeCoveragePlan = {
            version: 1,
            query: "Compare CASE-A and CASE-B overrides",
            mode: "complete",
            indexRevision: "asset-map:rev-map",
            supplementalPasses: 0,
            identifiers: [],
            facets: [
                {
                    id: relationId,
                    query: "CASE-A and CASE-B overrides",
                    searchGroup: 1,
                    hitCount: 1,
                    kind: "foreign_key_filter",
                    completion: "all_sources_verified",
                    identifiers: ["CASE-A", "CASE-B"],
                    sourcePaths: ["data/overrides.csv"],
                    sourceKeys: ["asset-map:data/overrides.csv"],
                    filters: [
                        { column: "case_id", value: "CASE-A", confidence: "declared" },
                        { column: "case_id", value: "CASE-B", confidence: "declared" },
                    ],
                },
            ],
        };
        const exactSet = {
            assetId: "asset-map",
            path: "data/overrides.csv",
            __knowledgePath: "data/overrides.csv",
            __knowledgeSearchGroups: [1],
            __knowledgeHitKey: "asset-map:source:data/overrides.csv",
            __knowledgeExpectedRevision: "rev-map",
            __knowledgeReadFilters: [{ column: "case_id", op: "in" as const, value: ["CASE-B", "CASE-A"] }],
            __knowledgeSelectorSignature: JSON.stringify({
                v: 1,
                assetId: "asset-map",
                path: "data/overrides.csv",
                kind: "filter",
                filters: [{ column: "case_id", op: "in", value: ["CASE-A", "CASE-B"] }],
            }),
            __knowledgeObligationIds: [relationId],
            content: "override_id,case_id,state\nOV-A,CASE-A,closed\nOV-B,CASE-B,open",
        };
        expect(finalizeKnowledgeCoverage(multiValuePlan, [exactSet])).toMatchObject({ status: "complete" });

        const singleValuePlan = {
            ...multiValuePlan,
            facets: [
                {
                    ...multiValuePlan.facets[0],
                    identifiers: ["CASE-A"],
                    filters: [{ column: "case_id", value: "CASE-A", confidence: "declared" as const }],
                },
            ],
        };
        expect(finalizeKnowledgeCoverage(singleValuePlan, [exactSet]).status).toBe("partial");
    });

    it("keeps an unbound relation-overflow sentinel uncovered despite unrelated readable rows", () => {
        const overflowPlan: KnowledgeCoveragePlan = {
            version: 1,
            query: "Compare more independently filtered relation sources than the bounded planner can represent",
            mode: "complete",
            indexRevision: "rev-map",
            supplementalPasses: 0,
            identifiers: [],
            facets: [
                {
                    id: "foreign-key:overflow-unresolved",
                    query: "overflow relations",
                    searchGroup: 0,
                    hitCount: 12,
                    kind: "foreign_key_filter",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: [],
                    sourceKeys: [],
                    filters: [],
                },
            ],
        };
        const coverage = finalizeKnowledgeCoverage(overflowPlan, [
            {
                assetId: "asset-map",
                path: "data/unrelated.csv",
                __knowledgeSearchGroups: [0],
                matchedIdentifiers: ["ITEM-1"],
                content: "item_id\nITEM-1",
            },
        ]);
        expect(coverage).toMatchObject({ status: "partial", verified: 0, missing: 1 });
        expect(coverage.facets[0]).toMatchObject({ status: "uncovered", reason: "source_limit" });
    });

    it("closes each route-topology source independently and never accepts another asset or a truncated read", () => {
        const topologyPlan: KnowledgeCoveragePlan = {
            ...plan,
            query: "find a route from ENTITY-A to ENTITY-B",
            identifiers: [],
            facets: [
                {
                    id: "route-topology:asset-map:data/links.csv",
                    query: "find a route from ENTITY-A to ENTITY-B",
                    searchGroup: 0,
                    hitCount: 1,
                    kind: "route_topology",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: ["data/links.csv"],
                    sourceKeys: ["asset-map:data/links.csv"],
                },
                {
                    id: "route-topology:asset-map:data/locations.csv",
                    query: "find a route from ENTITY-A to ENTITY-B",
                    searchGroup: 0,
                    hitCount: 1,
                    kind: "route_topology",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: ["data/locations.csv"],
                    sourceKeys: ["asset-map:data/locations.csv"],
                },
            ],
        };

        const oneSource = finalizeKnowledgeCoverage(topologyPlan, [
            { assetId: "asset-map", path: "data/links.csv", content: "LINK-1,A,B" },
        ]);
        expect(oneSource).toMatchObject({ status: "partial" });
        expect(oneSource.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "route-topology:asset-map:data/links.csv", status: "covered" }),
                expect.objectContaining({
                    id: "route-topology:asset-map:data/locations.csv",
                    status: "uncovered",
                }),
            ]),
        );

        const wrongAsset = finalizeKnowledgeCoverage(topologyPlan, [
            { assetId: "asset-other", path: "data/links.csv", content: "LINK-1,A,B" },
            { assetId: "asset-other", path: "data/locations.csv", content: "A\nB" },
        ]);
        expect(wrongAsset).toMatchObject({ status: "partial", verified: 0 });

        const truncated = finalizeKnowledgeCoverage(topologyPlan, [
            {
                assetId: "asset-map",
                path: "data/links.csv",
                __knowledgeReadTruncated: true,
                content: "partial link data",
            },
            { assetId: "asset-map", path: "data/locations.csv", content: "A\nB" },
        ]);
        expect(truncated).toMatchObject({ status: "partial" });
        expect(truncated.facets[0]).toMatchObject({ status: "partial", reason: "result_truncated" });

        const chunkOnly = finalizeKnowledgeCoverage(topologyPlan, [
            {
                assetId: "asset-map",
                path: "data/links.csv",
                __knowledgePath: "source:data/links.csv#7",
                content: "LINK-7,A,B",
            },
            { assetId: "asset-map", path: "data/locations.csv", content: "A\nB" },
        ]);
        expect(chunkOnly).toMatchObject({ status: "partial", verified: 1 });
        expect(chunkOnly.facets[0]).toMatchObject({ status: "uncovered", reason: "source_limit" });

        const complete = finalizeKnowledgeCoverage(topologyPlan, [
            { assetId: "asset-map", path: "data/links.csv", content: "LINK-1,A,B" },
            { assetId: "asset-map", path: "data/locations.csv", content: "A\nB" },
        ]);
        expect(complete).toMatchObject({ status: "complete", verified: 2, missing: 0 });
    });

    it("keeps an unbound topology obligation fail-closed despite unrelated readable evidence", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                query: "is LOCATION-X reachable?",
                identifiers: [],
                facets: [
                    {
                        id: "route-topology:unresolved",
                        query: "is LOCATION-X reachable?",
                        searchGroup: 0,
                        hitCount: 5,
                        kind: "route_topology",
                        completion: "all_sources_verified",
                        identifiers: [],
                        sourcePaths: [],
                        sourceKeys: [],
                    },
                ],
            },
            [{ assetId: "asset-map", path: "notes/readme.md", content: "general guidance" }],
        );

        expect(coverage).toMatchObject({ status: "partial", verified: 0 });
        expect(coverage.facets[0]).toMatchObject({ status: "uncovered", reason: "source_limit" });
    });

    it("requires the exact catalog-proven scope filter before route overrides can close", () => {
        const scopedPlan: KnowledgeCoveragePlan = {
            ...plan,
            query: "plan a route for CASE-7",
            identifiers: ["CASE-7"],
            facets: [
                {
                    id: "foreign-key:asset-map:data/overrides.csv",
                    query: "plan a route for CASE-7",
                    searchGroup: 0,
                    hitCount: 1,
                    kind: "foreign_key_filter",
                    completion: "all_sources_verified",
                    identifiers: ["CASE-7"],
                    sourcePaths: ["data/overrides.csv"],
                    sourceKeys: ["asset-map:data/overrides.csv"],
                    filters: [
                        {
                            column: "case_id",
                            value: "CASE-7",
                            targetPath: "data/cases.csv",
                            targetColumn: "case_id",
                            confidence: "high",
                        },
                    ],
                },
            ],
        };
        const baseRead = {
            assetId: "asset-map",
            path: "data/overrides.csv",
            __knowledgePath: "data/overrides.csv",
            __knowledgeSearchGroups: [0],
            __knowledgeHitKey: "asset-map:source:data/overrides.csv",
            __knowledgeExpectedRevision: "rev-1",
            __knowledgeObligationIds: ["foreign-key:asset-map:data/overrides.csv"],
            matchedIdentifiers: ["CASE-7"],
            content: "override_id,case_id,link_id,status\nOV-8,CASE-8,LINK-2,blocked",
        };
        const filterSignature = (value: string) =>
            JSON.stringify({
                v: 1,
                assetId: "asset-map",
                path: "data/overrides.csv",
                kind: "filter",
                filters: [{ column: "case_id", op: "eq", value: [value] }],
            });

        const unfiltered = finalizeKnowledgeCoverage(scopedPlan, [baseRead]);
        expect(unfiltered).toMatchObject({ status: "partial", verified: 0 });

        const wrongScope = finalizeKnowledgeCoverage(scopedPlan, [
            {
                ...baseRead,
                __knowledgeReadFilters: [{ column: "case_id", op: "eq", value: "CASE-8" }],
                __knowledgeSelectorSignature: filterSignature("CASE-8"),
            },
        ]);
        expect(wrongScope).toMatchObject({ status: "partial", verified: 0 });

        const correctlyScoped = finalizeKnowledgeCoverage(scopedPlan, [
            {
                ...baseRead,
                matchedIdentifiers: ["OV-7"],
                __knowledgeReadFilters: [{ column: "case_id", op: "eq", value: "CASE-7" }],
                __knowledgeSelectorSignature: filterSignature("CASE-7"),
                content: "override_id,case_id,link_id,status\nOV-7,CASE-7,LINK-1,closed",
            },
        ]);
        expect(correctlyScoped).toMatchObject({ status: "complete", verified: 1, missing: 0 });
        expect(isKnowledgeContinuationState(knowledgeContinuationFromCoverage(correctlyScoped))).toBe(true);
    });

    it("requires a unique natural-language scope before a route state overlay can close", () => {
        const summaries = [
            {
                assetId: "asset-map",
                path: "data/links.csv",
                columns: ["link_id", "from_location", "to_location", "base_status"],
                primaryKey: "link_id",
            },
            {
                assetId: "asset-map",
                path: "data/cases.csv",
                columns: ["case_id", "label", "origin_location"],
                primaryKey: "case_id",
            },
            {
                assetId: "asset-map",
                path: "data/overrides.csv",
                columns: ["override_id", "case_id", "link_id", "state"],
                primaryKey: "override_id",
                relations: [
                    {
                        sourceColumn: "case_id",
                        targetPath: "data/cases.csv",
                        targetColumn: "case_id",
                        confidence: "declared" as const,
                    },
                    {
                        sourceColumn: "link_id",
                        targetPath: "data/links.csv",
                        targetColumn: "link_id",
                        confidence: "high" as const,
                    },
                ],
            },
        ];
        const scopeBinding = {
            overlaySourcePath: "data/overrides.csv",
            overlaySourceKey: "asset-map:data/overrides.csv",
            overlayScopeColumn: "case_id",
            ownerSourcePath: "data/cases.csv",
            ownerSourceKey: "asset-map:data/cases.csv",
            ownerPrimaryKey: "case_id",
            descriptorColumns: ["label", "origin_location"],
        };
        const scopedPlan: KnowledgeCoveragePlan = {
            ...plan,
            query: "When the north hall alarm occurs, find the route from NODE-A",
            identifiers: [],
            trustedTableSummaries: summaries,
            facets: [
                {
                    id: "route-state-overlay:asset-map:data/overrides.csv",
                    query: "When the north hall alarm occurs, find the route from NODE-A",
                    searchGroup: 0,
                    hitCount: 0,
                    kind: "route_topology",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: ["data/overrides.csv"],
                    sourceKeys: ["asset-map:data/overrides.csv"],
                    routeScope: {
                        role: "state_overlay",
                        requiresUniqueResolution: true,
                        bindings: [scopeBinding],
                    },
                },
                {
                    id: "route-scope-owner:asset-map:data/overrides.csv:case_id:asset-map:data/cases.csv",
                    query: "When the north hall alarm occurs, find the route from NODE-A",
                    searchGroup: 0,
                    hitCount: 0,
                    kind: "route_topology",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: ["data/cases.csv"],
                    sourceKeys: ["asset-map:data/cases.csv"],
                    routeScope: {
                        role: "descriptor_owner",
                        requiresUniqueResolution: true,
                        bindings: [scopeBinding],
                    },
                },
            ],
        };
        const casesRead = {
            assetId: "asset-map",
            path: "data/cases.csv",
            content: "case_id,label,origin_location\nCASE-7,North hall alarm,NODE-A\nCASE-8,South hall routine,NODE-B",
        };
        const overlayRead = {
            assetId: "asset-map",
            path: "data/overrides.csv",
            content: "override_id,case_id,link_id,state\nOV-7,CASE-7,LINK-DIRECT,blocked\nOV-8,CASE-8,LINK-ALT,blocked",
        };

        const unfiltered = finalizeKnowledgeCoverage(scopedPlan, [casesRead, overlayRead]);
        expect(unfiltered).toMatchObject({ status: "partial" });
        expect(unfiltered.facets[0]).toMatchObject({ status: "partial", reason: "scope_unresolved" });

        const resolvedPlan: KnowledgeCoveragePlan = {
            ...scopedPlan,
            facets: scopedPlan.facets.map((facet, index) =>
                index === 0
                    ? {
                          ...facet,
                          filters: [
                              {
                                  column: "case_id",
                                  value: "CASE-7",
                                  targetPath: "data/cases.csv",
                                  targetColumn: "case_id",
                                  confidence: "declared" as const,
                              },
                          ],
                          routeScope: {
                              ...facet.routeScope!,
                              resolution: {
                                  bindingIndex: 0,
                                  value: "CASE-7",
                                  method: "unique_descriptor" as const,
                              },
                          },
                      }
                    : facet,
            ),
        };
        const filteredOverlayRead = {
            ...overlayRead,
            __knowledgeReadFilters: [{ column: "case_id", op: "eq" as const, value: "CASE-7" }],
            content: "override_id,case_id,link_id,state\nOV-7,CASE-7,LINK-DIRECT,blocked",
        };
        const complete = finalizeKnowledgeCoverage(resolvedPlan, [casesRead, filteredOverlayRead]);
        expect(complete).toMatchObject({ status: "complete", verified: 2, missing: 0 });

        const wrongScope = finalizeKnowledgeCoverage(resolvedPlan, [
            casesRead,
            {
                ...overlayRead,
                __knowledgeReadFilters: [{ column: "case_id", op: "eq", value: "CASE-8" }],
                content: "override_id,case_id,link_id,state\nOV-8,CASE-8,LINK-ALT,blocked",
            },
        ]);
        expect(wrongScope).toMatchObject({ status: "partial" });

        const multiScope = finalizeKnowledgeCoverage(resolvedPlan, [
            casesRead,
            {
                ...overlayRead,
                __knowledgeReadFilters: [{ column: "case_id", op: "in", value: ["CASE-7", "CASE-8"] }],
            },
        ]);
        expect(multiScope).toMatchObject({ status: "partial" });

        const ambiguous = finalizeKnowledgeCoverage(
            { ...resolvedPlan, query: "When the hall alarm occurs, find a safe route" },
            [
                {
                    ...casesRead,
                    content:
                        "case_id,label,origin_location\nCASE-7,North hall alarm,NODE-A\nCASE-8,South hall alarm,NODE-B",
                },
                filteredOverlayRead,
            ],
        );
        expect(ambiguous).toMatchObject({ status: "partial" });
        expect(ambiguous.facets[0]).toMatchObject({ status: "partial", reason: "scope_unresolved" });

        const truncated = finalizeKnowledgeCoverage(resolvedPlan, [
            casesRead,
            { ...filteredOverlayRead, __knowledgeReadTruncated: true },
        ]);
        expect(truncated.facets[0]).toMatchObject({ status: "partial", reason: "result_truncated" });

        const wrongAsset = finalizeKnowledgeCoverage(resolvedPlan, [
            casesRead,
            { ...filteredOverlayRead, assetId: "asset-other" },
        ]);
        expect(wrongAsset).toMatchObject({ status: "partial" });
        expect(wrongAsset.facets[0]).toMatchObject({ status: "uncovered", reason: "source_limit" });
    });

    it("verifies an exact entity-to-scope relation before accepting the filtered overlay", () => {
        const binding = {
            overlaySourcePath: "data/overrides.csv",
            overlaySourceKey: "asset-map:data/overrides.csv",
            overlayScopeColumn: "case_id",
            ownerSourcePath: "data/cases.csv",
            ownerSourceKey: "asset-map:data/cases.csv",
            ownerPrimaryKey: "case_id",
            descriptorColumns: ["label"],
            selectors: [
                {
                    sourcePath: "data/entities.csv",
                    sourceKey: "asset-map:data/entities.csv",
                    primaryKey: "entity_id",
                    scopeColumn: "case_id",
                    identifier: "ENTITY-42",
                },
            ],
        };
        const relationPlan: KnowledgeCoveragePlan = {
            ...plan,
            query: "Which route should ENTITY-42 take?",
            identifiers: [],
            facets: [
                {
                    id: "route-state-overlay:asset-map:data/overrides.csv",
                    query: "Which route should ENTITY-42 take?",
                    searchGroup: 0,
                    hitCount: 0,
                    kind: "route_topology",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: ["data/overrides.csv"],
                    sourceKeys: ["asset-map:data/overrides.csv"],
                    filters: [
                        {
                            column: "case_id",
                            value: "CASE-7",
                            targetPath: "data/cases.csv",
                            targetColumn: "case_id",
                            confidence: "declared",
                        },
                    ],
                    routeScope: {
                        role: "state_overlay",
                        requiresUniqueResolution: true,
                        bindings: [binding],
                        resolution: { bindingIndex: 0, value: "CASE-7", method: "exact_relation" },
                    },
                },
                {
                    id: "route-scope-owner:asset-map:data/overrides.csv:case_id:asset-map:data/cases.csv",
                    query: "Which route should ENTITY-42 take?",
                    searchGroup: 0,
                    hitCount: 0,
                    kind: "route_topology",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: ["data/cases.csv"],
                    sourceKeys: ["asset-map:data/cases.csv"],
                    routeScope: {
                        role: "descriptor_owner",
                        requiresUniqueResolution: true,
                        bindings: [binding],
                    },
                },
            ],
        };
        const entityRead = {
            assetId: "asset-map",
            path: "data/entities.csv",
            __knowledgeReadIdentifiers: ["ENTITY-42"],
            content: "entity_id,case_id,location_id\nENTITY-42,CASE-7,NODE-A",
        };
        const ownerRead = {
            assetId: "asset-map",
            path: "data/cases.csv",
            content: "case_id,label\nCASE-7,North hall alarm\nCASE-8,South hall alarm",
        };
        const overlayRead = {
            assetId: "asset-map",
            path: "data/overrides.csv",
            __knowledgeReadFilters: [{ column: "case_id", op: "eq" as const, value: "CASE-7" }],
            content: "override_id,case_id,link_id,state\nOV-7,CASE-7,LINK-DIRECT,blocked",
        };
        expect(finalizeKnowledgeCoverage(relationPlan, [entityRead, ownerRead, overlayRead])).toMatchObject({
            status: "complete",
            verified: 2,
            missing: 0,
        });
        expect(finalizeKnowledgeCoverage(relationPlan, [ownerRead, overlayRead])).toMatchObject({
            status: "partial",
        });
        expect(
            finalizeKnowledgeCoverage(relationPlan, [
                { ...entityRead, content: "entity_id,case_id,location_id\nENTITY-42,CASE-8,NODE-A" },
                ownerRead,
                overlayRead,
            ]),
        ).toMatchObject({ status: "partial" });
    });

    it("requires an exact route-state filter when the scope identifier is explicit", () => {
        const explicitPlan: KnowledgeCoveragePlan = {
            ...plan,
            query: "Plan the CASE-7 route",
            identifiers: [],
            facets: [
                {
                    id: "route-state-overlay:asset-map:data/overrides.csv",
                    query: "Plan the CASE-7 route",
                    searchGroup: 0,
                    hitCount: 0,
                    kind: "route_topology",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: ["data/overrides.csv"],
                    sourceKeys: ["asset-map:data/overrides.csv"],
                    filters: [
                        {
                            column: "case_id",
                            value: "CASE-7",
                            targetPath: "data/cases.csv",
                            targetColumn: "case_id",
                            confidence: "declared",
                        },
                    ],
                },
            ],
        };
        const read = {
            assetId: "asset-map",
            path: "data/overrides.csv",
            content: "override_id,case_id,link_id,state\nOV-7,CASE-7,LINK-DIRECT,blocked",
        };
        expect(finalizeKnowledgeCoverage(explicitPlan, [read])).toMatchObject({ status: "partial", verified: 0 });
        expect(
            finalizeKnowledgeCoverage(explicitPlan, [
                {
                    ...read,
                    __knowledgeReadFilters: [{ column: "case_id", op: "eq", value: "CASE-8" }],
                },
            ]),
        ).toMatchObject({ status: "partial", verified: 0 });
        expect(
            finalizeKnowledgeCoverage(explicitPlan, [
                {
                    ...read,
                    __knowledgeReadFilters: [{ column: "case_id", op: "eq", value: "CASE-7" }],
                },
            ]),
        ).toMatchObject({ status: "complete", verified: 1, missing: 0 });
    });

    it("closes route support only with a canonical full unfiltered source receipt", () => {
        const supportPlan: KnowledgeCoveragePlan = {
            ...plan,
            query: "Which equipment is available along this route?",
            identifiers: [],
            facets: [
                {
                    id: "route-support:asset-map:data/resources.csv",
                    query: "Which equipment is available along this route?",
                    searchGroup: 0,
                    hitCount: 0,
                    kind: "route_support",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: ["data/resources.csv"],
                    sourceKeys: ["asset-map:data/resources.csv"],
                },
            ],
        };
        const read = {
            assetId: "asset-map",
            path: "data/resources.csv",
            content: "resource_id,location_id,type\nRES-1,NODE-A,chair",
        };
        expect(finalizeKnowledgeCoverage(supportPlan, [read])).toMatchObject({
            status: "complete",
            verified: 1,
            missing: 0,
        });
        for (const unsafeRead of [
            {
                ...read,
                __knowledgeReadFilters: [{ column: "location_id", op: "eq", value: "NODE-A" }],
            },
            { ...read, __knowledgeReadIdentifiers: ["RES-1"] },
            { ...read, __knowledgePath: "source:data/resources.csv#1" },
            { ...read, __knowledgeReadTruncated: true },
            { ...read, assetId: "asset-other" },
        ]) {
            expect(finalizeKnowledgeCoverage(supportPlan, [unsafeRead])).toMatchObject({
                status: "partial",
                verified: 0,
            });
        }
    });

    it("preserves bounded catalog relations across accumulated pages and rejects forged continuation joins", () => {
        const tableSummaries = [
            {
                assetId: "asset-1",
                path: "raw/sources/accounts.csv",
                columns: ["account_id", "name"],
                primaryKey: "account_id",
            },
            {
                assetId: "asset-1",
                path: "raw/sources/orders.csv",
                columns: ["order_id", "account_id"],
                primaryKey: "order_id",
                relations: [
                    {
                        sourceColumn: "account_id",
                        targetPath: "raw/sources/accounts.csv",
                        targetColumn: "account_id",
                        confidence: "declared" as const,
                        reason: "schema" as const,
                    },
                ],
            },
        ];
        const first = finalizeKnowledgeCoverage(
            {
                version: 1,
                query: "all records related to AC-42",
                mode: "complete",
                facets: [],
                identifiers: [],
                supplementalPasses: 0,
                trustedTableSummaries: tableSummaries,
            },
            [],
        );
        const accumulated = accumulateKnowledgeCoveragePlan(
            {
                version: 1,
                query: "all records related to AC-42",
                mode: "complete",
                facets: [],
                identifiers: [],
                supplementalPasses: 0,
                trustedTableSummaries: tableSummaries.map(({ relations: _relations, ...summary }) => summary),
            },
            first.accumulator,
        );
        const receipt = finalizeKnowledgeCoverage(accumulated, []);
        const continuation = knowledgeContinuationFromCoverage(receipt);

        expect(receipt.accumulator?.trustedTableSummaries).toContainEqual(
            expect.objectContaining({
                path: "raw/sources/orders.csv",
                relations: [expect.objectContaining({ targetPath: "raw/sources/accounts.csv" })],
            }),
        );
        expect(isKnowledgeContinuationState(continuation)).toBe(true);

        for (const mutate of [
            (relation: Record<string, unknown>) => {
                relation.targetPath = "raw/sources/../secrets.csv";
            },
            (relation: Record<string, unknown>) => {
                relation.sourceColumn = "untrusted_column";
            },
            (relation: Record<string, unknown>) => {
                relation.targetColumn = "untrusted_column";
            },
            (relation: Record<string, unknown>) => {
                relation.confidence = "guessed";
            },
        ]) {
            const forged = JSON.parse(JSON.stringify(continuation)) as Record<string, any>;
            const orderSummary = forged.accumulator.trustedTableSummaries.find(
                (summary: Record<string, unknown>) => summary.path === "raw/sources/orders.csv",
            );
            mutate(orderSummary.relations[0]);
            expect(isKnowledgeContinuationState(forged)).toBe(false);
        }
    });

    it("persists executable search and catalog cursors in the continuation", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                identifiers: [],
                resultTruncated: true,
                catalogCovered: false,
                catalogTruncated: true,
                nextSearchCursor: "search-next",
                nextCatalogCursor: "catalog-next",
                searchOffset: 12,
                catalogOffset: 32,
            },
            [],
        );
        expect(knowledgeContinuationFromCoverage(coverage)).toEqual(
            expect.objectContaining({
                nextSearchCursor: "search-next",
                nextCatalogCursor: "catalog-next",
                searchOffset: 12,
                catalogOffset: 32,
            }),
        );
    });

    it("persists every independently signed facet page and keeps it executable", () => {
        const pendingSearchPages = [
            {
                id: "primary" as const,
                searchGroup: 0,
                query: "分别查设备和人员",
                limit: 10,
                nextSearchCursor: "primary-page-2",
                searchOffset: 10,
            },
            {
                id: "facet-2" as const,
                searchGroup: 2,
                query: "人员",
                limit: 5,
                nextSearchCursor: "people-page-2",
                searchOffset: 5,
            },
        ];
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                identifiers: [],
                facets: [
                    { ...plan.facets[0], searchTruncated: false },
                    { ...plan.facets[1], searchTruncated: true },
                ],
                resultTruncated: true,
                pendingSearchPages,
                nextSearchCursor: "primary-page-2",
            },
            [
                { path: "raw/sources/devices.csv", __knowledgeSearchGroups: [1], content: "complete" },
                { path: "raw/sources/occupants.csv", __knowledgeSearchGroups: [2], content: "complete" },
            ],
        );

        expect(coverage).toMatchObject({ status: "partial", hasMore: true, pendingSearchPages });
        expect(knowledgeContinuationFromCoverage(coverage)).toMatchObject({ hasMore: true, pendingSearchPages });
    });

    it("does not advertise another facet page when truncation has no signed cursor", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                identifiers: [],
                facets: [{ ...plan.facets[0], searchTruncated: true }],
                facetSearchTruncated: true,
            },
            [{ path: "raw/sources/devices.csv", __knowledgeSearchGroups: [1], content: "complete" }],
        );

        expect(coverage).toMatchObject({ status: "partial", hasMore: false });
    });

    it("keeps exhaustive ID enumeration partial when catalog record IDs are truncated", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [],
                identifiers: [],
                catalogCovered: true,
                recordIdsTruncated: true,
            },
            [],
        );
        expect(coverage).toMatchObject({ status: "partial", recordIdsTruncated: true, hasMore: false });
        expect(coverage.facets).toEqual([expect.objectContaining({ id: "catalog-inventory", status: "partial" })]);
    });

    it("does not advertise an infinite continuation for an unretrievable catalog without a cursor", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                ...plan,
                facets: [],
                identifiers: [],
                catalogCovered: false,
                catalogUnretrievableCount: 1,
            },
            [],
        );
        expect(coverage).toMatchObject({ status: "partial", catalogUnretrievableCount: 1, hasMore: false });
    });

    it("rejects malformed cursor and offset metadata before it can be replayed", () => {
        expect(
            isKnowledgeContinuationState({
                protocolVersion: 1,
                query: "q",
                mode: "complete",
                status: "partial",
                unresolved: [],
                missingIdentifiers: [],
                nextSearchCursor: "",
                hasMore: true,
            }),
        ).toBe(false);
        expect(
            isKnowledgeContinuationState({
                protocolVersion: 1,
                query: "q",
                mode: "complete",
                status: "partial",
                unresolved: [],
                missingIdentifiers: [],
                searchOffset: -1,
                hasMore: true,
            }),
        ).toBe(false);
        expect(
            isKnowledgeContinuationState({
                protocolVersion: 1,
                query: "q",
                mode: "complete",
                status: "complete",
                unresolved: [],
                missingIdentifiers: [],
                resultTruncated: true,
                nextSearchCursor: "unexpected-page",
                hasMore: false,
            }),
        ).toBe(false);
    });

    it("strictly bounds and validates pending facet page metadata", () => {
        const base = {
            protocolVersion: 1,
            query: "q",
            mode: "complete",
            status: "partial",
            unresolved: [],
            missingIdentifiers: [],
            hasMore: true,
        };
        const page = (searchGroup: number) => ({
            id: searchGroup === 0 ? "primary" : `facet-${searchGroup}`,
            searchGroup,
            query: `q-${searchGroup}`,
            limit: 1,
            nextSearchCursor: `cursor-${searchGroup}`,
            searchOffset: 1,
        });

        expect(
            isKnowledgeContinuationState({
                ...base,
                nextSearchCursor: "cursor-0",
                searchOffset: 1,
                pendingSearchPages: [page(0), page(2)],
            }),
        ).toBe(true);
        expect(isKnowledgeContinuationState({ ...base, pendingSearchPages: [page(2), page(2)] })).toBe(false);
        expect(
            isKnowledgeContinuationState({
                ...base,
                pendingSearchPages: Array.from({ length: 10 }, (_, index) => page(index)),
            }),
        ).toBe(false);
        expect(
            isKnowledgeContinuationState({
                ...base,
                pendingSearchPages: [{ ...page(2), id: "facet-1" }],
            }),
        ).toBe(false);
        expect(
            isKnowledgeContinuationState({
                ...base,
                nextSearchCursor: "different-primary-cursor",
                pendingSearchPages: [page(0)],
            }),
        ).toBe(false);
        expect(
            isKnowledgeContinuationState({
                ...base,
                pendingSearchPages: [page(0)],
            }),
        ).toBe(false);
        expect(
            isKnowledgeContinuationState({
                ...base,
                nextSearchCursor: "cursor-0",
                searchOffset: 99,
                pendingSearchPages: [page(0)],
            }),
        ).toBe(false);
    });

    it("accumulates verified candidates across pages and completes only after the prior page is reread", () => {
        const first = finalizeKnowledgeCoverage(
            {
                version: 1,
                query: "完整指南",
                mode: "complete",
                facets: [
                    {
                        id: "primary",
                        query: "完整指南",
                        searchGroup: 0,
                        hitCount: 1,
                        candidateKeys: ["asset-1:source:guide.md#0"],
                        searchTruncated: true,
                    },
                ],
                identifiers: [],
                indexRevision: "rev-1",
                resultTruncated: true,
                nextSearchCursor: "page-2",
                supplementalPasses: 0,
            },
            [
                {
                    path: "raw/sources/guide.md",
                    __knowledgePath: "source:raw/sources/guide.md#0",
                    __knowledgeHitKey: "asset-1:source:guide.md#0",
                    __knowledgeSearchGroups: [0],
                    __knowledgeExpectedRevision: "rev-1",
                    content: "PAGE_ONE_TRUSTED",
                },
            ],
        );
        expect(first).toMatchObject({ status: "partial", hasMore: true });
        const currentPage = accumulateKnowledgeCoveragePlan(
            {
                version: 1,
                query: "完整指南",
                mode: "complete",
                facets: [
                    {
                        id: "primary",
                        query: "完整指南",
                        searchGroup: 0,
                        hitCount: 1,
                        candidateKeys: ["asset-1:source:guide.md#1"],
                        searchTruncated: false,
                    },
                ],
                identifiers: [],
                indexRevision: "rev-1",
                resultTruncated: false,
                supplementalPasses: 0,
            },
            first.accumulator,
        );
        const pageTwoRead = {
            path: "raw/sources/guide.md",
            __knowledgePath: "source:raw/sources/guide.md#1",
            __knowledgeHitKey: "asset-1:source:guide.md#1",
            __knowledgeSearchGroups: [0],
            content: "PAGE_TWO_TRUSTED",
        };
        expect(finalizeKnowledgeCoverage(currentPage, [pageTwoRead])).toMatchObject({
            status: "partial",
            hasMore: false,
        });
        const complete = finalizeKnowledgeCoverage(currentPage, [
            {
                path: "raw/sources/guide.md",
                __knowledgePath: "source:raw/sources/guide.md#0",
                __knowledgeHitKey: "asset-1:source:guide.md#0",
                __knowledgeSearchGroups: [0],
                content: "PAGE_ONE_REREAD",
            },
            pageTwoRead,
        ]);
        expect(complete).toMatchObject({ status: "complete", hasMore: false });
        expect(complete.accumulator).toMatchObject({ pageCount: 2 });
        expect(complete.accumulator?.facets[0].candidateKeys).toEqual([
            "asset-1:source:guide.md#0",
            "asset-1:source:guide.md#1",
        ]);
    });

    it("rejects stale accumulated pages and never accepts assistant prose as verified evidence", () => {
        const previous = finalizeKnowledgeCoverage(
            {
                version: 1,
                query: "q",
                mode: "complete",
                facets: [{ id: "primary", query: "q", searchGroup: 0, hitCount: 1, candidateKeys: ["k1"] }],
                identifiers: [],
                indexRevision: "rev-1",
                supplementalPasses: 0,
            },
            [
                {
                    path: "raw/a.md",
                    __knowledgePath: "source:raw/a.md#0",
                    __knowledgeHitKey: "k1",
                    __knowledgeSearchGroups: [0],
                    content: "tool evidence",
                },
            ],
        );
        const stale = accumulateKnowledgeCoveragePlan(
            {
                version: 1,
                query: "q",
                mode: "complete",
                facets: [{ id: "primary", query: "q", searchGroup: 0, hitCount: 0, candidateKeys: [] }],
                identifiers: [],
                indexRevision: "rev-2",
                supplementalPasses: 0,
            },
            previous.accumulator,
        );
        expect(finalizeKnowledgeCoverage(stale, [{ content: "assistant says k1 was verified" }])).toMatchObject({
            status: "blocked",
            hasMore: false,
        });
        const continuation = knowledgeContinuationFromCoverage(previous);
        expect(isKnowledgeContinuationState(JSON.parse(JSON.stringify(continuation)))).toBe(true);
    });

    it("keeps a signed page executable even when an independent index obligation is incomplete", () => {
        const pendingSearchPages = [
            {
                id: "primary" as const,
                searchGroup: 0,
                query: "完整查询",
                limit: 10,
                nextSearchCursor: "signed-page-2",
                searchOffset: 10,
            },
        ];
        const coverage = finalizeKnowledgeCoverage(
            {
                version: 1,
                query: "完整查询",
                mode: "complete",
                facets: [
                    {
                        id: "primary",
                        query: "完整查询",
                        searchGroup: 0,
                        hitCount: 1,
                        searchTruncated: true,
                    },
                ],
                identifiers: [],
                indexIncomplete: true,
                resultTruncated: true,
                pendingSearchPages,
                supplementalPasses: 0,
            },
            [{ path: "raw/a.md", __knowledgeSearchGroups: [0], content: "page one" }],
        );

        expect(coverage).toMatchObject({
            status: "partial",
            hasMore: true,
            nextSearchCursor: "signed-page-2",
            searchOffset: 10,
            pendingSearchPages,
        });
        expect(coverage.facets).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: "index-completeness" })]),
        );
        expect(isKnowledgeContinuationState(knowledgeContinuationFromCoverage(coverage))).toBe(true);
    });

    it("fails closed on a mismatched primary cursor instead of persisting an invalid continuation", () => {
        const coverage = finalizeKnowledgeCoverage(
            {
                version: 1,
                query: "完整查询",
                mode: "complete",
                facets: [
                    {
                        id: "primary",
                        query: "完整查询",
                        searchGroup: 0,
                        hitCount: 1,
                        searchTruncated: true,
                    },
                ],
                identifiers: [],
                resultTruncated: true,
                nextSearchCursor: "cursor-a",
                pendingSearchPages: [
                    {
                        id: "primary",
                        searchGroup: 0,
                        query: "完整查询",
                        limit: 10,
                        nextSearchCursor: "cursor-b",
                        searchOffset: 10,
                    },
                ],
                supplementalPasses: 0,
            },
            [{ path: "raw/a.md", __knowledgeSearchGroups: [0], content: "page one" }],
        );

        expect(coverage).toMatchObject({ status: "partial", hasMore: false });
        expect(coverage.nextSearchCursor).toBeUndefined();
        expect(coverage.pendingSearchPages).toBeUndefined();
        expect(coverage.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "continuation-cursor", reason: "cursor_inconsistent" }),
            ]),
        );
        expect(isKnowledgeContinuationState(knowledgeContinuationFromCoverage(coverage))).toBe(true);
    });

    it("persists a signed structured cursor until an exhaustive typed obligation is closed", () => {
        const partial = finalizeKnowledgeCoverage(
            {
                version: 1,
                query: "列出全部记录",
                mode: "complete",
                facets: [],
                identifiers: [],
                supplementalPasses: 0,
                structuredQuery: {
                    status: "partial",
                    reason: "structured_query_truncated",
                    exhaustive: true,
                    nextCursor: "structured-page-2",
                },
            },
            [],
        );
        expect(partial).toMatchObject({
            status: "partial",
            hasMore: true,
            nextStructuredCursor: "structured-page-2",
        });
        const continuation = knowledgeContinuationFromCoverage(partial);
        expect(continuation).toMatchObject({ hasMore: true, nextStructuredCursor: "structured-page-2" });
        expect(isKnowledgeContinuationState(continuation)).toBe(true);

        const inconsistent = finalizeKnowledgeCoverage(
            {
                version: 1,
                query: "列出全部记录",
                mode: "complete",
                facets: [],
                identifiers: [],
                supplementalPasses: 0,
                structuredQuery: { status: "covered", authoritative: true, nextCursor: "unexpected-page" },
            },
            [],
        );
        expect(inconsistent).toMatchObject({ status: "partial", hasMore: false });
        expect(inconsistent.nextStructuredCursor).toBeUndefined();
        expect(inconsistent.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "continuation-cursor", reason: "cursor_inconsistent" }),
            ]),
        );
    });

    it("isolates same-source selector receipts and preserves each selector across continuation", () => {
        const path = "data/locations.csv";
        const fullId = "route-topology:asset-map:data/locations.csv";
        const exactId = "exact:asset-map:data/locations.csv:LOC-7";
        const signature = (kind: "full" | "exact", identifiers: string[] = []) =>
            JSON.stringify({
                v: 1,
                assetId: "asset-map",
                path,
                kind,
                ...(identifiers.length > 0 ? { identifiers } : {}),
            });
        const selectorPlan: KnowledgeCoveragePlan = {
            version: 1,
            query: "verify LOC-7 and its route graph",
            mode: "complete",
            identifiers: ["LOC-7"],
            supplementalPasses: 0,
            facets: [
                {
                    id: fullId,
                    query: "route graph",
                    searchGroup: 0,
                    hitCount: 1,
                    kind: "route_topology",
                    completion: "all_sources_verified",
                    identifiers: [],
                    sourcePaths: [path],
                    sourceKeys: [`asset-map:${path}`],
                },
                {
                    id: exactId,
                    query: "LOC-7",
                    searchGroup: 0,
                    hitCount: 1,
                    kind: "exact_identifier",
                    completion: "record_verified",
                    identifiers: ["LOC-7"],
                    sourcePaths: [path],
                    sourceKeys: [`asset-map:${path}`],
                },
            ],
        };
        const fullRead = {
            assetId: "asset-map",
            path,
            content: "location_id,label\nLOC-7,North",
            __knowledgePath: path,
            __knowledgeSearchGroups: [0],
            __knowledgeHitKey: `asset-map:source:${path}`,
            __knowledgeSelectorSignature: signature("full"),
            __knowledgeObligationIds: [fullId],
        };
        const failedExact = {
            ...fullRead,
            content: "",
            __knowledgeReadFailed: true,
            __knowledgeReadIdentifiers: ["LOC-7"],
            __knowledgeSelectorSignature: signature("exact", ["LOC-7"]),
            __knowledgeObligationIds: [exactId],
        };
        const partial = finalizeKnowledgeCoverage(selectorPlan, [fullRead, failedExact]);
        expect(partial.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: fullId, status: "covered" }),
                expect.objectContaining({ id: exactId, status: "uncovered", reason: "read_error" }),
            ]),
        );

        const exactRead = {
            ...failedExact,
            __knowledgeReadFailed: false,
            content: "location_id,label\nLOC-7,North",
            matchedIdentifiers: ["LOC-7"],
        };
        const complete = finalizeKnowledgeCoverage(selectorPlan, [fullRead, exactRead]);
        expect(complete).toMatchObject({ status: "complete", verified: 2, missing: 0 });
        expect(complete.accumulator?.trustedEvidence).toHaveLength(2);
        expect(new Set(complete.accumulator?.trustedEvidence.map((pointer) => pointer.selectorSignature)).size).toBe(2);
        const rotatedHit = finalizeKnowledgeCoverage(
            {
                ...selectorPlan,
                trustedEvidence: [
                    {
                        key: `asset-map:source:${path}#old`,
                        path,
                        assetId: "asset-map",
                        searchGroups: [0],
                        selectorSignature: signature("full"),
                        obligationIds: [fullId],
                    },
                ],
            },
            [{ ...fullRead, __knowledgeHitKey: `asset-map:source:${path}#new` }, exactRead],
        );
        expect(rotatedHit.accumulator?.trustedEvidence).toHaveLength(2);
        expect(
            rotatedHit.accumulator?.trustedEvidence.find((pointer) => pointer.selectorSignature === signature("full"))
                ?.key,
        ).toBe(`asset-map:source:${path}#new`);
        const longFilterValue = "S".repeat(256);
        const longFilterCoverage = {
            ...complete,
            accumulator: {
                ...complete.accumulator!,
                trustedEvidence: complete.accumulator!.trustedEvidence.map((pointer, index) =>
                    index === 0
                        ? { ...pointer, filters: [{ column: "scope_id", op: "eq" as const, value: longFilterValue }] }
                        : pointer,
                ),
            },
        };
        expect(isKnowledgeContinuationState(knowledgeContinuationFromCoverage(longFilterCoverage))).toBe(true);

        expect(finalizeKnowledgeCoverage(selectorPlan, [fullRead, failedExact, exactRead])).toMatchObject({
            status: "complete",
            verified: 2,
        });
        const differentFailedSelector = {
            ...failedExact,
            __knowledgeSelectorSignature: signature("exact", ["LOC-8"]),
        };
        expect(finalizeKnowledgeCoverage(selectorPlan, [fullRead, exactRead, differentFailedSelector])).toMatchObject({
            status: "partial",
            verified: 1,
        });

        for (const legacyNarrowRead of [
            {
                ...fullRead,
                __knowledgeSelectorSignature: undefined,
                __knowledgeObligationIds: undefined,
                __knowledgeReadIdentifiers: ["LOC-7"],
            },
            {
                ...fullRead,
                __knowledgeSelectorSignature: undefined,
                __knowledgeObligationIds: undefined,
                __knowledgeReadFilters: [{ column: "location_id", op: "eq", value: "LOC-7" }],
            },
        ]) {
            const topologyOnly = { ...selectorPlan, identifiers: [], facets: [selectorPlan.facets[0]] };
            expect(finalizeKnowledgeCoverage(topologyOnly, [legacyNarrowRead])).toMatchObject({
                status: "partial",
                verified: 0,
            });
        }

        const forged = finalizeKnowledgeCoverage(selectorPlan, [
            fullRead,
            { ...exactRead, __knowledgeSelectorSignature: "not-json" },
        ]);
        expect(forged).toMatchObject({ status: "partial", verified: 1 });
        expect(forged.accumulator?.trustedEvidence).toHaveLength(1);
    });

    it("closes structured history locators only with exact revision-pinned selector receipts", () => {
        const assetId = "asset-history";
        const revision = "revision-history";
        const locators = [
            {
                assetId,
                path: "raw/sources/relationships.csv",
                kind: "source" as const,
                value: "source:raw/sources/relationships.csv",
            },
            {
                assetId,
                path: "raw/sources/items.csv",
                kind: "record" as const,
                value: "ITEM-001",
            },
            {
                assetId,
                path: "wiki/policy.md",
                kind: "section" as const,
                value: "Eligibility",
            },
            {
                assetId,
                path: "notes/current.md",
                kind: "chunk" as const,
                value: "source:notes/current.md#2",
            },
        ];
        const historyPlan: KnowledgeCoveragePlan = {
            version: 1,
            query: "review prior verified evidence",
            mode: "complete",
            identifiers: [],
            indexRevision: revision,
            supplementalPasses: 0,
            facets: [
                {
                    id: "verified-history-locators",
                    query: "review prior verified evidence",
                    searchGroup: 0,
                    hitCount: 4,
                    kind: "route_support",
                    completion: "all_sources_verified",
                    sourcePaths: Array.from(new Set(locators.map((locator) => locator.path))),
                    sourceKeys: Array.from(new Set(locators.map((locator) => `${locator.assetId}:${locator.path}`))),
                    verifiedHistoryLocators: locators,
                },
            ],
        };
        const signature = (locator: (typeof locators)[number]) =>
            JSON.stringify({
                v: 1,
                assetId: locator.assetId,
                path: locator.path,
                kind: locator.kind === "source" ? "full" : "exact",
                ...(locator.kind === "source" ? {} : { identifiers: [locator.value] }),
            });
        const receipt = (locator: (typeof locators)[number]) => ({
            assetId: locator.assetId,
            path: locator.path,
            content:
                locator.kind === "record"
                    ? "item_id,status\nITEM-001,ready"
                    : locator.kind === "section"
                      ? "## Eligibility\nCurrent policy."
                      : "Current revision-pinned content.",
            matchedIdentifiers: locator.kind === "record" ? [locator.value] : [],
            __knowledgePath: locator.kind === "chunk" ? locator.value : locator.path,
            __knowledgeSearchGroups: [0],
            __knowledgeHitKey: `${locator.assetId}:source:${locator.path}`,
            __knowledgeExpectedRevision: revision,
            ...(locator.kind === "source" ? {} : { __knowledgeReadIdentifiers: [locator.value] }),
            __knowledgeSelectorSignature: signature(locator),
            __knowledgeObligationIds: ["verified-history-locators"],
            __knowledgeVerifiedHistoryLocators: [locator],
        });
        const receipts = locators.map(receipt);

        const complete = finalizeKnowledgeCoverage(historyPlan, receipts);
        expect(complete).toMatchObject({ status: "complete", verified: 1, missing: 0 });
        expect(complete.accumulator?.trustedEvidence).toHaveLength(4);

        const searchIndependentReceipts = receipts.map((item) => ({ ...item, __knowledgeSearchGroups: [] }));
        const searchIndependent = finalizeKnowledgeCoverage(historyPlan, searchIndependentReceipts);
        expect(searchIndependent).toMatchObject({ status: "complete", verified: 1, missing: 0 });
        expect(searchIndependent.accumulator?.trustedEvidence).toHaveLength(4);
        expect(
            searchIndependent.accumulator?.trustedEvidence.every((pointer) => pointer.searchGroups.length === 0),
        ).toBe(true);
        const searchIndependentState = knowledgeContinuationFromCoverage(searchIndependent);
        expect(isKnowledgeContinuationState(searchIndependentState)).toBe(true);

        const targetReceipt = searchIndependentReceipts[1] as Record<string, unknown>;
        const malformedReceipts: Array<[string, Record<string, unknown>]> = [
            ["ordinary obligation", { ...targetReceipt, __knowledgeObligationIds: ["semantic:1"] }],
            [
                "mixed obligation",
                {
                    ...targetReceipt,
                    __knowledgeObligationIds: ["verified-history-locators", "semantic:1"],
                },
            ],
            ["wrong asset", { ...targetReceipt, assetId: "asset-other" }],
            ["wrong path", { ...targetReceipt, __knowledgePath: "raw/sources/other.csv" }],
            ["wrong revision", { ...targetReceipt, __knowledgeExpectedRevision: "revision-other" }],
            [
                "wrong selector",
                {
                    ...targetReceipt,
                    __knowledgeSelectorSignature: JSON.stringify({
                        v: 1,
                        assetId,
                        path: locators[1].path,
                        kind: "semantic",
                        identifiers: [locators[1].value],
                    }),
                },
            ],
            ["identifier mismatch", { ...targetReceipt, __knowledgeReadIdentifiers: ["ITEM-OTHER"] }],
            ["empty locator", { ...targetReceipt, __knowledgeVerifiedHistoryLocators: [] }],
            ["duplicate locator", { ...targetReceipt, __knowledgeVerifiedHistoryLocators: [locators[1], locators[1]] }],
            ["failed read", { ...targetReceipt, __knowledgeReadFailed: true }],
            ["stale read", { ...targetReceipt, __knowledgeRevisionChanged: true }],
            ["truncated read", { ...targetReceipt, __knowledgeReadTruncated: true }],
            ["missing group metadata", { ...targetReceipt, __knowledgeSearchGroups: undefined }],
            ["non-numeric empty group", { ...targetReceipt, __knowledgeSearchGroups: ["invalid"] }],
            ["negative empty group", { ...targetReceipt, __knowledgeSearchGroups: [-1] }],
            ["fractional empty group", { ...targetReceipt, __knowledgeSearchGroups: [1.5] }],
            ["out-of-range group", { ...targetReceipt, __knowledgeSearchGroups: [9] }],
            ["duplicate group", { ...targetReceipt, __knowledgeSearchGroups: [1, 1] }],
            ["mixed valid and invalid groups", { ...targetReceipt, __knowledgeSearchGroups: [1, "invalid"] }],
            ["exact duplicate identifiers", { ...targetReceipt, __knowledgeReadIdentifiers: ["ITEM-001", "ITEM-001"] }],
            [
                "case-equivalent duplicate identifiers",
                { ...targetReceipt, __knowledgeReadIdentifiers: ["ITEM-001", "item-001"] },
            ],
            [
                "NFKC-equivalent duplicate identifiers",
                { ...targetReceipt, __knowledgeReadIdentifiers: ["ITEM-001", "ＩＴＥＭ－００１"] },
            ],
            [
                "whitespace-equivalent duplicate identifiers",
                { ...targetReceipt, __knowledgeReadIdentifiers: ["ITEM-001", " ITEM-001 "] },
            ],
            ["blank identifier", { ...targetReceipt, __knowledgeReadIdentifiers: ["ITEM-001", " "] }],
            [
                "over-limit identifiers",
                { ...targetReceipt, __knowledgeReadIdentifiers: Array.from({ length: 65 }, () => "ITEM-001") },
            ],
            ["trimmed key", { ...targetReceipt, __knowledgeHitKey: ` ${targetReceipt.__knowledgeHitKey} ` }],
            ["trimmed asset", { ...targetReceipt, assetId: ` ${assetId} ` }],
            ["trimmed path", { ...targetReceipt, path: ` ${locators[1].path} ` }],
            ["trimmed read path", { ...targetReceipt, __knowledgePath: ` ${locators[1].path} ` }],
            ["trimmed revision", { ...targetReceipt, __knowledgeExpectedRevision: ` ${revision} ` }],
            ["empty read filters", { ...targetReceipt, __knowledgeReadFilters: [] }],
        ];
        for (const [label, malformed] of malformedReceipts) {
            const result = finalizeKnowledgeCoverage(historyPlan, [
                searchIndependentReceipts[0],
                malformed,
                ...searchIndependentReceipts.slice(2),
            ]);
            expect({ label, pointers: result.accumulator?.trustedEvidence.length }).toEqual({ label, pointers: 3 });
        }

        const forgedState = (overrides: Record<string, unknown>): Record<string, unknown> => {
            const state = JSON.parse(JSON.stringify(searchIndependentState)) as Record<string, unknown>;
            const accumulator = state.accumulator as Record<string, unknown>;
            const pointers = accumulator.trustedEvidence as Array<Record<string, unknown>>;
            const index = pointers.findIndex((pointer) =>
                Array.isArray(pointer.identifiers) ? pointer.identifiers.includes("ITEM-001") : false,
            );
            pointers[index] = { ...pointers[index], ...overrides };
            return state;
        };
        const wrongSelector = JSON.stringify({
            v: 1,
            assetId,
            path: locators[1].path,
            kind: "semantic",
            identifiers: [locators[1].value],
        });
        for (const forged of [
            forgedState({ obligationIds: ["verified-history-locators", "semantic:1"] }),
            forgedState({ path: "raw/sources/other.csv" }),
            forgedState({ expectedRevision: "revision-other" }),
            forgedState({ selectorSignature: wrongSelector }),
            forgedState({ identifiers: ["ITEM-OTHER"] }),
            forgedState({ identifiers: [" ITEM-001 "] }),
            forgedState({ verifiedHistoryLocators: [locators[1], locators[1]] }),
        ]) {
            expect(isKnowledgeContinuationState(forged)).toBe(false);
        }

        const wrongAsset = {
            ...receipts[1],
            assetId: "asset-other",
        };
        expect(finalizeKnowledgeCoverage(historyPlan, [receipts[0], wrongAsset, ...receipts.slice(2)])).toMatchObject({
            status: "partial",
        });
        const wrongPath = {
            ...receipts[1],
            path: "raw/sources/other.csv",
        };
        expect(finalizeKnowledgeCoverage(historyPlan, [receipts[0], wrongPath, ...receipts.slice(2)])).toMatchObject({
            status: "partial",
        });
        const wrongKindValue = {
            ...receipts[1],
            __knowledgeVerifiedHistoryLocators: [{ ...locators[1], kind: "section", value: "ITEM-001" }],
        };
        expect(
            finalizeKnowledgeCoverage(historyPlan, [receipts[0], wrongKindValue, ...receipts.slice(2)]),
        ).toMatchObject({ status: "partial" });
        expect(
            finalizeKnowledgeCoverage(historyPlan, [
                receipts[0],
                { ...receipts[1], __knowledgeExpectedRevision: "revision-stale" },
                ...receipts.slice(2),
            ]),
        ).toMatchObject({ status: "blocked" });
        expect(
            finalizeKnowledgeCoverage(historyPlan, [
                receipts[0],
                { ...receipts[1], __knowledgeReadTruncated: true },
                ...receipts.slice(2),
            ]),
        ).toMatchObject({ status: "partial" });
        expect(
            finalizeKnowledgeCoverage(historyPlan, [
                receipts[0],
                { ...receipts[1], __knowledgeReadFailed: true },
                ...receipts.slice(2),
            ]),
        ).toMatchObject({ status: "partial" });
    });

    it("fails closed when scope uniqueness would depend on rows beyond the bounded parser", () => {
        const binding = {
            overlaySourcePath: "data/overrides.csv",
            overlayScopeColumn: "case_id",
            ownerSourcePath: "data/cases.csv",
            ownerPrimaryKey: "case_id",
            descriptorColumns: ["label"],
        };
        const rows = Array.from({ length: 300 }, (_, index) =>
            index === 0 || index === 299
                ? `CASE-${index + 1},North hall alarm`
                : `CASE-${index + 1},Other ${index + 1}`,
        );
        expect(
            resolveKnowledgeRouteScope("North hall alarm", binding, 0, {
                ownerContents: [`case_id,label\n${rows.join("\n")}`],
            }),
        ).toBeNull();
    });

    it("rejects persisted cursor metadata that contradicts completion or hasMore", () => {
        const catalogUnresolved = [
            {
                id: "catalog-inventory",
                query: "inventory",
                status: "partial" as const,
                selectedPaths: [],
            },
        ];
        const structuredUnresolved = [
            {
                id: "structured-query",
                query: "records",
                status: "partial" as const,
                selectedPaths: [],
            },
        ];
        const base = {
            protocolVersion: 1 as const,
            query: "inventory",
            mode: "complete" as const,
            missingIdentifiers: [],
        };

        expect(
            isKnowledgeContinuationState({
                ...base,
                status: "complete",
                unresolved: catalogUnresolved,
                hasMore: false,
                nextCatalogCursor: "catalog-page-2",
                catalogOffset: 32,
            }),
        ).toBe(false);
        expect(
            isKnowledgeContinuationState({
                ...base,
                status: "partial",
                unresolved: catalogUnresolved,
                hasMore: false,
                nextCatalogCursor: "catalog-page-2",
            }),
        ).toBe(false);
        expect(
            isKnowledgeContinuationState({
                ...base,
                status: "complete",
                unresolved: structuredUnresolved,
                hasMore: false,
                nextStructuredCursor: "structured-page-2",
            }),
        ).toBe(false);
        expect(
            isKnowledgeContinuationState({
                ...base,
                status: "partial",
                unresolved: structuredUnresolved,
                hasMore: false,
                nextStructuredCursor: "structured-page-2",
            }),
        ).toBe(false);
    });
});
