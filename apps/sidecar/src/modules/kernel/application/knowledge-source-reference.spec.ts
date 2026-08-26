import {
    buildKnowledgeSourceRegistry,
    containsProtectedKnowledgeReference,
    finalizeKnowledgeAnswer,
    hasTrustedKnowledgeGrounding,
    knowledgeGroundingForModel,
    knowledgeGroundingSupportsLocator,
    MAX_KNOWLEDGE_SOURCE_REFERENCES,
    verifiedKnowledgeReadLocatorCitations,
} from "./knowledge-source-reference";

const grounding = JSON.stringify({
    status: "ok",
    reads: [
        {
            kind: "source",
            assetId: "asset-1",
            path: "raw/sources/people.csv",
            title: "people.csv",
            mime: "text/csv",
            content: "person_id,count\nP-1,14\nP-2,3",
            resource: "asset://asset-1/raw/sources/people.csv",
            citations: ["asset://asset-1/raw/sources/people.csv"],
        },
        {
            kind: "source",
            assetId: "asset-1",
            path: "raw/sources/rules.md",
            title: "rules.md",
            conceptId: "source:raw/sources/rules.md#2",
            content: "## Approval\nOnly approved changes are valid.",
            resource: "asset://asset-1/raw/sources/rules.md",
        },
    ],
});

describe("knowledge source references", () => {
    it("recognizes trusted current-turn grounding but never trusts an error payload", () => {
        expect(hasTrustedKnowledgeGrounding(grounding)).toBe(true);
        expect(
            hasTrustedKnowledgeGrounding(
                JSON.stringify({
                    status: "error",
                    reads: [
                        {
                            content: "id\nSTALE-1",
                            resource: "asset://asset-1/raw/sources/stale.csv",
                        },
                    ],
                }),
            ),
        ).toBe(false);
        expect(hasTrustedKnowledgeGrounding(JSON.stringify({ status: "ok", reads: [] }))).toBe(false);
    });

    it("uses the same status and field trust gate for registry construction and finalization", () => {
        const staleError = JSON.stringify({
            status: "error",
            reads: [
                {
                    content: "id\nSTALE-1",
                    resource: "asset://asset-1/raw/sources/stale.csv",
                },
            ],
        });
        expect(buildKnowledgeSourceRegistry(staleError)).toEqual([]);
        const staleAnswer = finalizeKnowledgeAnswer("[[K1:STALE-1]]", staleError);
        expect(staleAnswer.text).toBe("[来源引用未验证]");
        expect(staleAnswer.sources).toEqual([]);
        expect(staleAnswer.unverifiedCitationCount).toBe(1);

        const arbitraryNestedResource = JSON.stringify({
            status: "ok",
            coverage: {
                debug: {
                    content: "id\nFORGED-1",
                    resource: "asset://asset-1/raw/sources/forged.csv",
                },
            },
        });
        expect(buildKnowledgeSourceRegistry(arbitraryNestedResource)).toEqual([]);
        expect(finalizeKnowledgeAnswer("[[K1:FORGED-1]]", arbitraryNestedResource).sources).toEqual([]);
    });

    it.each([
        ["failed", { __knowledgeReadFailed: true }],
        ["read-truncated", { __knowledgeReadTruncated: true }],
        ["content-truncated", { __knowledgeContentTruncated: true }],
        ["revision-changed", { __knowledgeRevisionChanged: true }],
        ["truncation-notice", {}],
    ])("never registers a %s read as locator-level or file-level evidence", (label, marker) => {
        const notice = "[Knowledge read truncated by the grounding byte budget.]";
        const invalidGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: `${label}.csv`,
                    content: `id,value\nSTALE-1,old${label === "truncation-notice" ? `\n${notice} \n\t` : ""}`,
                    resource: `asset://asset-1/raw/sources/${label}.csv`,
                    result: {
                        resources: [
                            {
                                title: "nested-stale.csv",
                                content: "id,value\nNESTED-STALE-1,old",
                                resource: "asset://asset-1/raw/sources/nested-stale.csv",
                            },
                        ],
                    },
                    ...marker,
                },
            ],
        });

        expect(buildKnowledgeSourceRegistry(invalidGrounding)).toEqual([]);
        const projection = knowledgeGroundingForModel(invalidGrounding);
        expect(projection.sourceGuide).toBe("(no verified source handles)");
        expect(projection.grounding).not.toContain("STALE-1");
        expect(projection.grounding).not.toContain("NESTED-STALE-1");
        expect(projection.grounding).not.toContain(notice);
        expect(projection.grounding).not.toContain("asset://");
        expect(projection.grounding).not.toContain("sourceRef");
        expect(projection.sourceGuide).not.toContain("K1:");
        for (const citation of ["[[K1:STALE-1]]", "[[K1]]"]) {
            const answer = finalizeKnowledgeAnswer(citation, invalidGrounding);
            const serialized = JSON.stringify(answer);
            expect(answer.text).toBe("[来源引用未验证]");
            expect(answer.sources).toEqual([]);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(answer.rejectedCitations[0]?.reason).toBe("unknown_source_handle");
            expect(containsProtectedKnowledgeReference(serialized)).toBe(false);
            expect(serialized.toLowerCase()).not.toContain("kref");
        }
    });

    it("does not mistake an embedded or mid-line truncation notice literal for the controlled suffix", () => {
        const notice = "[Knowledge read truncated by the grounding byte budget.]";
        const literalNoticeGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "manual.md",
                    content: [
                        "# Manual",
                        `The diagnostic documentation quotes ${notice} as an embedded example.`,
                        `${notice} is also harmless when more text follows on the same line.`,
                        "## RULE-1",
                        "This complete read remains valid.",
                    ].join("\n"),
                    resource: "asset://asset-1/raw/sources/manual.md",
                },
            ],
        });

        expect(buildKnowledgeSourceRegistry(literalNoticeGrounding).map((source) => source.relativePath)).toEqual([
            "raw/sources/manual.md",
        ]);
        const projection = knowledgeGroundingForModel(literalNoticeGrounding);
        expect(projection.grounding).toContain(notice);
        expect(projection.grounding).toContain("RULE-1");
        expect(projection.sourceGuide).toContain("K1: manual.md");
        expect(finalizeKnowledgeAnswer("[[K1:RULE-1]]", literalNoticeGrounding)).toMatchObject({
            text: "[manual.md，定位：RULE-1]",
            unverifiedCitationCount: 0,
        });
    });

    it("rejects an invalid body-shaped read and its complete nested subtree", () => {
        const invalidBodyGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "invalid-body.md",
                    body: "# STALE-SECTION\nOld body",
                    resource: "asset://asset-1/raw/sources/invalid-body.md",
                    __knowledgeRevisionChanged: true,
                    result: {
                        resources: [
                            {
                                title: "nested.md",
                                body: "# NESTED-STALE\nOld nested body",
                                resource: "asset://asset-1/raw/sources/nested.md",
                            },
                        ],
                    },
                },
            ],
        });

        expect(buildKnowledgeSourceRegistry(invalidBodyGrounding)).toEqual([]);
        const projection = knowledgeGroundingForModel(invalidBodyGrounding);
        expect(projection.sourceGuide).toBe("(no verified source handles)");
        expect(projection.grounding).not.toContain("STALE-SECTION");
        expect(projection.grounding).not.toContain("NESTED-STALE");
        expect(projection.grounding).not.toContain("invalid-body.md");
        expect(projection.grounding).not.toContain("nested.md");
        expect(finalizeKnowledgeAnswer("[[K1:STALE-SECTION]]", invalidBodyGrounding)).toMatchObject({
            text: "[来源引用未验证]",
            sources: [],
            unverifiedCitationCount: 1,
        });
    });

    it("keeps healthy read, search, and catalog sources when an invalid read shares the grounding", () => {
        const mixedGrounding = JSON.stringify({
            status: "ok",
            // A reserved-looking envelope field is not itself a read receipt and
            // must not suppress independently healthy children.
            __knowledgeReadFailed: true,
            reads: [
                {
                    title: "invalid.csv",
                    content: "id,value\nSTALE-1,old",
                    resource: "asset://asset-1/raw/sources/invalid.csv",
                    __knowledgeReadTruncated: true,
                },
                {
                    title: "healthy.csv",
                    content: "id,value\nOK-1,current",
                    resource: "asset://asset-1/raw/sources/healthy.csv",
                },
            ],
            search: {
                hits: [
                    {
                        title: "search.md",
                        snippet: "SEARCH-1 current snippet",
                        matchedRecordIds: ["SEARCH-1"],
                        resource: "asset://asset-1/raw/sources/search.md",
                    },
                ],
                tableSummaries: [
                    {
                        title: "catalog.csv",
                        recordCount: 2,
                        resource: "asset://asset-1/raw/sources/catalog.csv",
                    },
                ],
            },
        });

        const registry = buildKnowledgeSourceRegistry(mixedGrounding);
        expect(registry.map((source) => [source.ref, source.relativePath, source.evidence])).toEqual([
            ["K1", "raw/sources/healthy.csv", "read"],
            ["K2", "raw/sources/search.md", "search"],
            ["K3", "raw/sources/catalog.csv", "catalog"],
        ]);
        const projection = knowledgeGroundingForModel(mixedGrounding);
        expect(projection.grounding).toContain("OK-1");
        expect(projection.grounding).toContain("SEARCH-1");
        expect(projection.grounding).not.toContain("STALE-1");
        expect(projection.grounding).not.toContain("invalid.csv");
        expect(projection.sourceGuide).toContain("K1: healthy.csv");
        expect(projection.sourceGuide).toContain("K2: search.md");
        expect(projection.sourceGuide).toContain("K3: catalog.csv");
        expect(projection.sourceGuide).not.toContain("invalid.csv");
        const answer = finalizeKnowledgeAnswer("[[K1:OK-1]] [[K2:SEARCH-1]] [[K3]] [[K4:STALE-1]]", mixedGrounding);
        expect(answer.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/healthy.csv",
            "raw/sources/search.md",
            "raw/sources/catalog.csv",
        ]);
        expect(answer.unverifiedCitationCount).toBe(1);
        expect(answer.rejectedCitations[0]?.reason).toBe("unknown_source_handle");
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        expect(JSON.stringify(answer).toLowerCase()).not.toContain("kref");
    });

    it("continues to reject a nested error record while retaining a healthy sibling", () => {
        const nestedErrorGrounding = JSON.stringify({
            status: "ok",
            search: {
                hits: [
                    {
                        status: "error",
                        title: "stale.csv",
                        content: "id\nSTALE-1",
                        resource: "asset://asset-1/raw/sources/stale.csv",
                    },
                    {
                        status: "error",
                        result: {
                            resources: [
                                {
                                    title: "nested-stale.csv",
                                    content: "id\nNESTED-STALE-1",
                                    resource: "asset://asset-1/raw/sources/nested-stale.csv",
                                },
                            ],
                        },
                    },
                    {
                        title: "healthy.csv",
                        content: "id\nOK-1",
                        resource: "asset://asset-1/raw/sources/healthy.csv",
                    },
                ],
            },
        });

        expect(buildKnowledgeSourceRegistry(nestedErrorGrounding).map((source) => source.relativePath)).toEqual([
            "raw/sources/healthy.csv",
        ]);
        const projection = knowledgeGroundingForModel(nestedErrorGrounding);
        expect(projection.grounding).toContain("OK-1");
        expect(projection.grounding).not.toContain("STALE-1");
        expect(projection.grounding).not.toContain("NESTED-STALE-1");
        expect(projection.grounding).not.toContain("stale.csv");
        expect(projection.grounding).not.toContain("nested-stale.csv");
        const answer = finalizeKnowledgeAnswer("[[K1:OK-1]] [[K2:STALE-1]]", nestedErrorGrounding);
        expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/healthy.csv"]);
        expect(answer.unverifiedCitationCount).toBe(1);
    });

    it("replaces asset URIs with opaque handles before model generation", () => {
        const modelGrounding = knowledgeGroundingForModel(grounding);
        const projectedReads = (JSON.parse(modelGrounding.grounding) as { reads: Array<{ sourceRef: string }> }).reads;
        expect(modelGrounding.sourceGuide).toContain("K1: people.csv");
        expect(modelGrounding.sourceGuide).toContain("Cite a source only as [[K#]] or [[K#:exact-locator]]");
        expect(modelGrounding.sourceGuide).toContain("never write a bare K# alias in prose");
        expect(modelGrounding.sourceGuide).toContain("never invent a locator or emit an asset URI");
        expect(modelGrounding.sourceGuide).toContain('exactLocators=["P-1", "P-2"]');
        expect(projectedReads[0]?.sourceRef).toBe("K1");
        expect(modelGrounding.grounding).not.toContain("asset://");
        expect(modelGrounding.grounding).not.toContain('"assetId"');
    });

    it("prioritizes exact evidence in the model projection and removes the coverage accumulator only there", () => {
        const catalog = Array.from({ length: 24 }, (_, index) => ({
            title: `catalog-${index + 1}.csv`,
            recordCount: index + 1,
            note: "catalog-padding".repeat(200),
            resource: `asset://asset-1/raw/sources/catalog-${index + 1}.csv`,
        }));
        const largeGrounding = JSON.stringify({
            coverage: {
                status: "partial",
                mode: "complete",
                facets: [
                    { id: "exact-read", query: "EXACT-ROW-1", status: "covered", selectedPaths: ["read.csv"] },
                    { id: "remaining", query: "remaining facts", status: "uncovered", reason: "not_retrieved" },
                ],
                missing: 1,
                hasMore: true,
                indexRevision: "revision-1",
                accumulator: {
                    trustedTableSummaries: catalog,
                    trustedEvidence: Array.from({ length: 2_000 }, (_, index) => `large-accumulator-${index}`),
                },
            },
            search: { hits: [], tableSummaries: catalog },
            reads: [
                {
                    title: "exact-read.csv",
                    content: "id,value\nEXACT-ROW-1,precise evidence survives",
                    resource: "asset://asset-1/raw/sources/exact-read.csv",
                },
            ],
            structuredQuery: { status: "ok", matchedRows: 1, rows: [{ id: "EXACT-ROW-1" }] },
        });

        const registryBeforeProjection = buildKnowledgeSourceRegistry(largeGrounding);
        const projected = knowledgeGroundingForModel(largeGrounding);
        const parsed = JSON.parse(projected.grounding) as Record<string, unknown>;
        const projectedCoverage = parsed.coverage as Record<string, unknown>;
        const projectedReads = parsed.reads as Array<Record<string, unknown>>;
        const keys = Object.keys(parsed);

        expect(keys.indexOf("reads")).toBeLessThan(keys.indexOf("structuredQuery"));
        expect(keys.indexOf("structuredQuery")).toBeLessThan(keys.indexOf("search"));
        expect(projectedCoverage).not.toHaveProperty("accumulator");
        expect(projectedCoverage).toMatchObject({
            status: "partial",
            mode: "complete",
            missing: 1,
            hasMore: true,
            indexRevision: "revision-1",
            unresolved: [{ id: "remaining", query: "remaining facts", status: "uncovered", reason: "not_retrieved" }],
        });
        expect(projectedReads[0]?.content).toContain("EXACT-ROW-1,precise evidence survives");
        expect(projectedReads[0]?.sourceRef).toBe("K25");
        expect(projected.grounding).not.toContain("large-accumulator-1999");
        expect(projected.grounding.length).toBeLessThan(largeGrounding.length);
        expect(buildKnowledgeSourceRegistry(largeGrounding)).toEqual(registryBeforeProjection);
        expect(JSON.parse(largeGrounding).coverage.accumulator.trustedEvidence).toHaveLength(2_000);
    });

    it("compacts projected JSON and removes only search snippet text already covered by a same-source full read", () => {
        const repeatedSnippetGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "primary.md",
                    content: "# Primary\nROW-1 verified detail\nEnd",
                    resource: "asset://asset-1/raw/sources/primary.md",
                },
                {
                    title: "truncated.md",
                    content:
                        "# Truncated\nROW-2 repeated detail\n[Knowledge read truncated by the grounding byte budget.]",
                    resource: "asset://asset-1/raw/sources/truncated.md",
                    __knowledgeReadTruncated: true,
                },
            ],
            search: {
                hits: [
                    {
                        title: "primary.md",
                        snippet: "ROW-1   verified detail",
                        matchedRecordIds: ["ROW-1"],
                        rank: 1,
                        score: 0.99,
                        status: "ok",
                        resource: "asset://asset-1/raw/sources/primary.md",
                    },
                    {
                        title: "other.md",
                        snippet: "ROW-1 verified detail",
                        matchedRecordIds: ["ROW-1"],
                        rank: 2,
                        resource: "asset://asset-1/raw/sources/other.md",
                    },
                    {
                        title: "truncated.md",
                        snippet: "ROW-2 repeated detail",
                        matchedRecordIds: ["ROW-2"],
                        rank: 3,
                        resource: "asset://asset-1/raw/sources/truncated.md",
                    },
                ],
            },
        });
        const registryBeforeProjection = buildKnowledgeSourceRegistry(repeatedSnippetGrounding);

        const projected = knowledgeGroundingForModel(repeatedSnippetGrounding);
        const parsed = JSON.parse(projected.grounding) as {
            reads: Array<Record<string, unknown>>;
            search: { hits: Array<Record<string, unknown>> };
        };

        expect(projected.grounding).toBe(JSON.stringify(parsed));
        expect(parsed.reads).toHaveLength(1);
        expect(parsed.search.hits[0]).toMatchObject({
            sourceRef: "K1",
            matchedRecordIds: ["ROW-1"],
            rank: 1,
            score: 0.99,
            status: "ok",
        });
        expect(parsed.search.hits[0]).not.toHaveProperty("snippet");
        expect(parsed.search.hits[1]).toMatchObject({ sourceRef: "K2", snippet: "ROW-1 verified detail" });
        expect(parsed.search.hits[2]).toMatchObject({ sourceRef: "K3", snippet: "ROW-2 repeated detail" });
        expect(buildKnowledgeSourceRegistry(repeatedSnippetGrounding)).toEqual(registryBeforeProjection);
        expect(repeatedSnippetGrounding).toContain("ROW-1   verified detail");
    });

    it("does not trust caller-provided or nested source handles when removing repeated snippets", () => {
        const spoofedGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "primary.md",
                    content: "REAL verified content",
                    resource: "asset://asset-1/raw/sources/primary.md",
                    sourceRef: "K999",
                    nested: {
                        content: "FORGED",
                        resource: "asset://asset-1/raw/sources/primary.md",
                        sourceRef: "K999",
                    },
                },
                {
                    title: "orphan.md",
                    content: "FORGED",
                    sourceRef: "K1",
                },
            ],
            search: {
                hits: [
                    {
                        title: "primary.md",
                        snippet: "FORGED",
                        resource: "asset://asset-1/raw/sources/primary.md",
                        sourceRef: "K999",
                    },
                ],
            },
        });

        const projected = knowledgeGroundingForModel(spoofedGrounding);
        const parsed = JSON.parse(projected.grounding) as {
            reads: Array<Record<string, unknown>>;
            search: { hits: Array<Record<string, unknown>> };
        };
        const nested = parsed.reads[0]?.nested as Record<string, unknown>;

        expect(parsed.reads[0]?.sourceRef).toBe("K1");
        expect(nested.sourceRef).toBe("K1");
        expect(parsed.reads[1]).not.toHaveProperty("sourceRef");
        expect(parsed.search.hits[0]).toMatchObject({ sourceRef: "K1", snippet: "FORGED" });
        expect(projected.grounding).not.toContain("K999");
    });

    it("fails closed outside the 32-read and 32-hit snippet-deduplication bounds", () => {
        const resource = "asset://asset-1/raw/sources/primary.md";
        const read = {
            title: "primary.md",
            content: "ROW-1 verified detail",
            resource,
        };
        const hit = {
            title: "primary.md",
            snippet: "ROW-1 verified detail",
            resource,
        };
        const project = (readCount: number, hitCount: number) => {
            const result = knowledgeGroundingForModel(
                JSON.stringify({
                    status: "ok",
                    reads: Array.from({ length: readCount }, () => ({ ...read })),
                    search: { hits: Array.from({ length: hitCount }, () => ({ ...hit })) },
                }),
            );
            return JSON.parse(result.grounding) as { search: { hits: Array<Record<string, unknown>> } };
        };

        expect(project(32, 32).search.hits.every((item) => !("snippet" in item))).toBe(true);
        expect(project(33, 1).search.hits[0]).toHaveProperty("snippet", "ROW-1 verified detail");
        expect(project(1, 33).search.hits.every((item) => item.snippet === "ROW-1 verified detail")).toBe(true);
    });

    it("projects verified catalog counts before long reads without exposing catalog row IDs", () => {
        const mixedInventory = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "notes.md",
                    content: "# Notes\n" + "long-read-padding ".repeat(2_000),
                    resource: "asset://asset-1/raw/sources/notes.md",
                },
            ],
            search: {
                hits: [],
                tableSummaries: [
                    {
                        title: "people.csv",
                        recordCount: 36,
                        recordIds: ["CATALOG-ONLY-ID"],
                        resource: "asset://asset-1/raw/sources/people.csv",
                    },
                    {
                        title: "conflict.csv",
                        recordCount: 3,
                        resource: "asset://asset-1/raw/sources/conflict.csv",
                    },
                    {
                        title: "conflict.csv",
                        recordCount: 4,
                        resource: "asset://asset-1/raw/sources/conflict.csv",
                    },
                ],
            },
        });

        const projected = knowledgeGroundingForModel(mixedInventory);
        const parsed = JSON.parse(projected.grounding) as Record<string, unknown>;
        const keys = Object.keys(parsed);

        expect(keys.indexOf("catalogFacts")).toBeLessThan(keys.indexOf("reads"));
        expect(parsed.catalogFacts).toEqual([{ sourceRef: "K2", title: "people.csv", recordCount: 36 }]);
        expect(JSON.stringify(parsed.catalogFacts)).not.toContain("CATALOG-ONLY-ID");
        expect(projected.sourceGuide).toContain("K2: people.csv");
        expect(projected.sourceGuide).toContain("verifiedRecordCount=36");
        expect(projected.sourceGuide).not.toContain("CATALOG-ONLY-ID");
    });

    it("turns verified handles into readable citations and multiple structured sources", () => {
        const answer = finalizeKnowledgeAnswer(
            "人数为 14。[[K1:P-1]] 规则要求授权。[[K2:source:raw/sources/rules.md#2]]",
            grounding,
        );
        expect(answer.text).toContain("[people.csv，记录 ID：P-1]");
        expect(answer.text).toContain("[rules.md，定位：source:raw/sources/rules.md#2]");
        expect(answer.sources).toHaveLength(2);
        expect(answer.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/people.csv",
            "raw/sources/rules.md",
        ]);
    });

    it("normalizes safe citation variants from any model without trusting the display filename", () => {
        const answer = finalizeKnowledgeAnswer(
            "全角［K1:P-1］；单括号 [K1:P-2]；标签倒置［完全错误的文件名.csv: P-1｜K1］；逗号标签［rules, (current)：P-1｜K1］ [rules, (current): P-2 | K1]。",
            grounding,
        );
        expect(answer.text).not.toContain("K1");
        expect(answer.text).not.toContain("完全错误的文件名");
        expect(answer.text).not.toContain("rules, (current)");
        expect(answer.text).toContain("[people.csv，记录 ID：P-1]");
        expect(answer.text).toContain("[people.csv，记录 ID：P-2]");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1", "P-2"]);
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("fails closed when any handle locator item is discarded instead of blessing the retained subset", () => {
        const overlong = `FAKE-${"X".repeat(161)}`;
        const thirtyThree = Array.from({ length: 33 }, () => "P-1").join("|");
        for (const citation of [
            "[[K1:P-1,P-1]]",
            "[[K1:   ]]",
            "[[K1:P-1,]]",
            "[[K1:P-1, ,P-2]]",
            "[Sources: [K1:   ]]]",
            "[Sources: [K1:P-1,p-1]]]",
            "[Sources: [K1:P-1,Ｐ-１]]]",
            `[Sources: [K1:P-1,${overlong}]]]`,
            `[Sources: [K1:${thirtyThree}]]]`,
            "[[K1:P-1],[K1:P-1|P-1]]",
            "[people.csv，记录 ID：P-1,P-1]",
            "people.csv record ID: P-1,P-1",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toContain("[来源引用未验证]");
            expect(answer.sources).toEqual([]);
            expect(answer.unverifiedCitationCount).toBeGreaterThan(0);
            expect(answer.rejectedCitations.every((rejected) => rejected.reason === "unsupported_locator")).toBe(true);
        }

        const distinct = finalizeKnowledgeAnswer("[[K1:P-1,P-2]]", grounding);
        expect(distinct.text).toBe("[people.csv，记录 ID：P-1、P-2]");
        expect(distinct.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1", "P-2"]);
        expect(distinct.unverifiedCitationCount).toBe(0);
    });

    it("expands a bounded terminal locator pattern only into exact IDs verified by the current CSV read", () => {
        const csvRead = JSON.stringify({
            reads: [
                {
                    title: "orders.csv",
                    content: "order_id,value\nORD-42-01,one\nORD-42-02,two\nORD-42-03,three\nOTHER-01,other",
                    resource: "asset://asset-1/raw/sources/orders.csv",
                },
            ],
        });
        const citations = [
            "[[K1:ORD-42-*]]",
            "[K1:ORD-42-*]]",
            "[orders.csv，记录 ID：ORD-42-*]",
            "orders.csv + 记录 ID：ORD-42-*",
        ];

        for (const citation of citations) {
            const answer = finalizeKnowledgeAnswer(citation, csvRead);
            expect(answer.text).toBe("[orders.csv，记录 ID：ORD-42-01、ORD-42-02、ORD-42-03]");
            expect(answer.text).not.toContain("*");
            expect(answer.sources).toHaveLength(1);
            expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual([
                "ORD-42-01",
                "ORD-42-02",
                "ORD-42-03",
            ]);
            expect(answer.unverifiedCitationCount).toBe(0);
            expect(answer.rejectedCitations).toEqual([]);
        }
    });

    it("does not let search-only locators join a CSV read pattern expansion", () => {
        const mixedEvidence = JSON.stringify({
            reads: [
                {
                    title: "orders.csv",
                    content: "order_id,value\nORD-READ-01,read",
                    resource: "asset://asset-1/raw/sources/orders.csv",
                },
            ],
            hits: [
                {
                    title: "orders.csv",
                    snippet: "ORD-SEARCH-02 matched only in a search result",
                    matchedRecordIds: ["ORD-SEARCH-02"],
                    resource: "asset://asset-1/raw/sources/orders.csv",
                },
            ],
        });

        const expanded = finalizeKnowledgeAnswer("[[K1:ORD-*]]", mixedEvidence);
        expect(expanded.text).toBe("[orders.csv，记录 ID：ORD-READ-01]");
        expect(expanded.sources[0]?.locators.map((locator) => locator.value)).toEqual(["ORD-READ-01"]);
        expect(expanded.unverifiedCitationCount).toBe(0);

        const exactSearchLocator = finalizeKnowledgeAnswer("[[K1:ORD-SEARCH-02]]", mixedEvidence);
        expect(exactSearchLocator.text).toBe("[orders.csv，记录 ID：ORD-SEARCH-02]");
        expect(exactSearchLocator.unverifiedCitationCount).toBe(0);
    });

    it("keeps unsafe, empty, unbounded and unsupported locator patterns fail-closed", () => {
        const csvRead = JSON.stringify({
            reads: [
                {
                    title: "orders.csv",
                    content: "order_id,value\nAB-1,short\nABC-1,safe\nORD-42-01,one\nORD-X-01,two",
                    resource: "asset://asset-1/raw/sources/orders.csv",
                },
            ],
        });
        const rejectedPatterns = [
            "*",
            "AB*",
            "ORD-*-01",
            "ORD-42-**",
            "ORD-42-?*",
            "asset://*",
            "ORD-\t*",
            "MISSING-*",
            `${"A".repeat(161)}*`,
        ];

        for (const locator of rejectedPatterns) {
            const answer = finalizeKnowledgeAnswer(`[[K1:${locator}]]`, csvRead);
            expect(answer.text).toBe("[来源引用未验证]");
            expect(answer.sources).toHaveLength(0);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(answer.rejectedCitations[0]?.reason).toBe("unsupported_locator");
        }

        const nonCsvRead = JSON.stringify({
            reads: [
                {
                    title: "orders.md",
                    content: "## ORD-42-01\nVerified section.",
                    matchedRecordIds: ["ORD-42-01"],
                    resource: "asset://asset-1/raw/sources/orders.md",
                },
            ],
        });
        const searchOnlyCsv = JSON.stringify({
            hits: [
                {
                    title: "orders.csv",
                    snippet: "ORD-42-01",
                    matchedRecordIds: ["ORD-42-01"],
                    resource: "asset://asset-1/raw/sources/orders.csv",
                },
            ],
        });
        for (const unsupportedGrounding of [nonCsvRead, searchOnlyCsv]) {
            const answer = finalizeKnowledgeAnswer("[[K1:ORD-42-*]]", unsupportedGrounding);
            expect(answer.text).toBe("[来源引用未验证]");
            expect(answer.sources).toHaveLength(0);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(answer.rejectedCitations[0]?.reason).toBe("unsupported_locator");
        }
    });

    it("accepts at most 32 exact read matches for one locator pattern", () => {
        const groundingWithRows = (count: number) =>
            JSON.stringify({
                reads: [
                    {
                        title: "orders.csv",
                        content: [
                            "order_id,value",
                            ...Array.from(
                                { length: count },
                                (_, index) => `ROW-${String(index + 1).padStart(2, "0")},value`,
                            ),
                        ].join("\n"),
                        resource: "asset://asset-1/raw/sources/orders.csv",
                    },
                ],
            });

        const bounded = finalizeKnowledgeAnswer("[[K1:ROW-*]]", groundingWithRows(32));
        expect(bounded.unverifiedCitationCount).toBe(0);
        expect(bounded.sources[0]?.locators).toHaveLength(32);
        expect(bounded.text).not.toContain("*");
        expect(bounded.text).toContain("ROW-01");
        expect(bounded.text).toContain("ROW-32");

        const unbounded = finalizeKnowledgeAnswer("[[K1:ROW-*]]", groundingWithRows(33));
        expect(unbounded.text).toBe("[来源引用未验证]");
        expect(unbounded.sources).toHaveLength(0);
        expect(unbounded.unverifiedCitationCount).toBe(1);
        expect(unbounded.rejectedCitations[0]?.reason).toBe("unsupported_locator");
    });

    it("resolves report-style hash suffix handles only through one allowed locator on that K source", () => {
        const suffixGrounding = JSON.stringify({
            reads: [
                {
                    title: "overview.md",
                    conceptId: "source:raw/sources/overview.md#0",
                    content: "overview",
                    resource: "asset://asset-1/raw/sources/overview.md",
                },
                {
                    title: "rules.md",
                    conceptId: "source:raw/sources/rules.md#1",
                    content: "verified rule",
                    resource: "asset://asset-1/raw/sources/rules.md",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer("[[K2#1]] [K1#0]]", suffixGrounding);
        expect(answer.text).toBe(
            "[rules.md，定位：source:raw/sources/rules.md#1] [overview.md，定位：source:raw/sources/overview.md#0]",
        );
        expect(answer.sources.map((source) => source.ref)).toEqual(["K2", "K1"]);
        expect(answer.unverifiedCitationCount).toBe(0);

        const rejected = finalizeKnowledgeAnswer("[[K2#404]]", suffixGrounding);
        expect(rejected.text).toBe("[来源引用未验证]");
        expect(rejected.sources).toHaveLength(0);
        expect(rejected.unverifiedCitationCount).toBe(1);
        expect(rejected.rejectedCitations).toEqual([
            {
                citation: "[[K2#404]]",
                locator: "#404",
                sourcePath: "raw/sources/rules.md",
                reason: "unsupported_locator",
            },
        ]);
    });

    it("rejects a hash suffix shared by multiple allowed locators on the same source", () => {
        const ambiguousSuffixGrounding = JSON.stringify({
            reads: [
                {
                    title: "combined.md",
                    conceptId: "source:raw/sources/combined.md#1",
                    content: "first verified chunk",
                    resource: "asset://asset-1/raw/sources/combined.md",
                },
                {
                    title: "combined.md",
                    conceptId: "source:wiki/generated/combined.md#1",
                    content: "second verified chunk with more content",
                    resource: "asset://asset-1/raw/sources/combined.md",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer("[[K1#1]]", ambiguousSuffixGrounding);
        expect(answer.text).toBe("[来源引用未验证]");
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBe(1);
        expect(answer.rejectedCitations).toEqual([
            {
                citation: "[[K1#1]]",
                locator: "#1",
                sourcePath: "raw/sources/combined.md",
                reason: "ambiguous_locator_suffix",
            },
        ]);
    });

    it("consumes a report-style malformed handle and filename pair as one fail-closed citation", () => {
        const pairGrounding = JSON.stringify({
            reads: [
                ...Array.from({ length: 4 }, (_, index) => ({
                    title: `source-${index + 1}.md`,
                    content: `verified source ${index + 1}`,
                    resource: `asset://asset-1/raw/sources/source-${index + 1}.md`,
                })),
                {
                    title: "route_edges.csv",
                    content: "edge_id,status\nE-1,open",
                    resource: "asset://asset-1/raw/sources/route_edges.csv",
                },
            ],
        });

        const matching = finalizeKnowledgeAnswer("[[K5],[route edges.csv]", pairGrounding);
        expect(matching.text).toBe("[route_edges.csv]");
        expect(matching.sources.map((source) => source.ref)).toEqual(["K5"]);
        expect(matching.unverifiedCitationCount).toBe(0);

        const conflicting = finalizeKnowledgeAnswer("[[K4],[route edges.csv]", pairGrounding);
        expect(conflicting.text).toBe("[来源引用未验证]");
        expect(conflicting.text).not.toContain("route edges.csv");
        expect(conflicting.sources).toHaveLength(0);
        expect(conflicting.unverifiedCitationCount).toBe(1);
        expect(conflicting.rejectedCitations).toEqual([
            {
                citation: "[[K4],[route edges.csv]",
                reason: "source_filename_conflict",
            },
        ]);

        for (const citation of [
            "[[K5],[route edges.csv],asset://forged/x",
            "([[K5],[route edges.csv],asset://forged/x)",
            "[[[K5],[route edges.csv],K999]",
        ]) {
            const nested = finalizeKnowledgeAnswer(citation, pairGrounding);
            expect(nested.text).toBe("[来源引用未验证]");
            expect(nested.sources).toEqual([]);
            expect(nested.unverifiedCitationCount).toBe(1);
            expect(nested.rejectedCitations).toHaveLength(1);
        }
    });

    it("resolves a closed compound handle array through the ordinary per-handle verifier", () => {
        const citation =
            "[[K1:P-1],[K2:source:raw/sources/rules.md#2]] and [[K1:P-2],[K2:source:raw/sources/rules.md#2]]";
        const answer = finalizeKnowledgeAnswer(citation, grounding);

        expect(answer.text).toBe(
            "[people.csv，记录 ID：P-1] [rules.md，定位：source:raw/sources/rules.md#2] and [people.csv，记录 ID：P-2] [rules.md，定位：source:raw/sources/rules.md#2]",
        );
        expect(answer.sources.map((source) => source.ref)).toEqual(["K1", "K2"]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
    });

    it("removes one solitary fullwidth opener before a complete verified opaque citation", () => {
        const single = finalizeKnowledgeAnswer("单项［[[K1:P-1]]", grounding);
        expect(single.text).toBe("单项[people.csv，记录 ID：P-1]");
        expect(single.sources.map((source) => source.ref)).toEqual(["K1"]);
        expect(single.unverifiedCitationCount).toBe(0);
        expect(single.rejectedCitations).toEqual([]);

        const compound = finalizeKnowledgeAnswer("复合［[[K1:P-1],[K2:source:raw/sources/rules.md#2]]", grounding);
        expect(compound.text).toBe("复合[people.csv，记录 ID：P-1] [rules.md，定位：source:raw/sources/rules.md#2]");
        expect(compound.sources.map((source) => source.ref)).toEqual(["K1", "K2"]);
        expect(compound.unverifiedCitationCount).toBe(0);
        expect(compound.rejectedCitations).toEqual([]);
        expect(containsProtectedKnowledgeReference(JSON.stringify(compound))).toBe(false);

        const pairedCompound = finalizeKnowledgeAnswer(
            "成对［[[K1:P-2],[K2:source:raw/sources/rules.md#2]]］",
            grounding,
        );
        expect(pairedCompound.text).toBe(
            "成对[people.csv，记录 ID：P-2] [rules.md，定位：source:raw/sources/rules.md#2]",
        );
        expect(pairedCompound.sources.map((source) => source.ref)).toEqual(["K1", "K2"]);
        expect(pairedCompound.unverifiedCitationCount).toBe(0);
    });

    it("normalizes mixed fullwidth delimiters and punctuation through the ordinary verifier", () => {
        const handles = finalizeKnowledgeAnswer(
            "混合[[K1：P-1，P-2］］；［［K2：source:raw/sources/rules.md#2]]",
            grounding,
        );
        expect(handles.text).toBe(
            "混合[people.csv，记录 ID：P-1、P-2]；[rules.md，定位：source:raw/sources/rules.md#2]",
        );
        expect(handles.sources.map((source) => source.ref)).toEqual(["K1", "K2"]);
        expect(handles.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1", "P-2"]);
        expect(handles.unverifiedCitationCount).toBe(0);
        expect(handles.rejectedCitations).toEqual([]);

        const filename = finalizeKnowledgeAnswer("唯一［[people.csv，记录 ID：P-1]］", grounding);
        expect(filename.text).toBe("唯一[people.csv，记录 ID：P-1]");
        expect(filename.sources.map((source) => source.ref)).toEqual(["K1"]);
        expect(filename.unverifiedCitationCount).toBe(0);

        for (const citation of [
            "[[K1：P-404］］",
            "［［K999：P-1]]",
            "［[fabricated.csv，记录 ID：P-1]］",
            "［[rules.md，记录 ID：P-1]］",
        ]) {
            const rejected = finalizeKnowledgeAnswer(citation, grounding);
            expect(rejected.text).toContain("[来源引用未验证]");
            expect(rejected.sources).toEqual([]);
            expect(rejected.unverifiedCitationCount).toBeGreaterThan(0);
        }
    });

    it("keeps solitary fullwidth opener compatibility fail-closed for unverified citation material", () => {
        for (const citation of [
            "［[[K999]]",
            "［[[K1:P-404]]",
            "［[[K1:P-1],[K999]]",
            "［[[K1:P-1],[fabricated.csv]]",
            "［[[K1:P-1],[K2:source:raw/sources/rules.md#2]]，K999］",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toContain("[来源引用未验证]");
            expect(answer.unverifiedCitationCount).toBeGreaterThan(0);
            expect(answer.text).not.toMatch(/K\d+/u);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }

        const markdown = finalizeKnowledgeAnswer("［[people.csv](https://example.invalid)", grounding);
        expect(markdown.text).toBe("［[people.csv](https://example.invalid)");
        expect(markdown.sources).toEqual([]);
        expect(markdown.unverifiedCitationCount).toBe(0);
        expect(markdown.rejectedCitations).toEqual([]);
    });

    it("resolves only a repeated top-level bare handle after an earlier explicit verified handle", () => {
        const answer = finalizeKnowledgeAnswer(
            "[[K1:P-1]]；只有当 K1 中出现新的已验证记录时才更新；在此前不更新 K1 覆盖记录。",
            grounding,
        );

        expect(answer.text).toBe(
            "[people.csv，记录 ID：P-1]；只有当 [people.csv] 中出现新的已验证记录时才更新；在此前不更新 [people.csv] 覆盖记录。",
        );
        expect(answer.sources.map((source) => source.ref)).toEqual(["K1"]);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
    });

    it("restores thousands of repeated bare handles in one pass", () => {
        const repeated = 8_192;
        const answer = finalizeKnowledgeAnswer(`[[K1:P-1]] ${"K1 ".repeat(repeated)}`, grounding);

        expect(answer.text.match(/\[people\.csv\]/gu)).toHaveLength(repeated);
        expect(answer.sources.map((source) => source.ref)).toEqual(["K1"]);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
    });

    it("restores thousands of disjoint protected wrapper receipts in one pass", () => {
        const repeated = 8_192;
        const answer = finalizeKnowledgeAnswer("[来源：[[K1:P-1]]] ".repeat(repeated), grounding);

        expect(answer.text.match(/\[people\.csv，记录 ID：P-1\]/gu)).toHaveLength(repeated);
        expect(answer.sources.map((source) => source.ref)).toEqual(["K1"]);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
    });

    it("keeps non-repeated, nested, aliased, partial and locator-bearing bare handles fail-closed", () => {
        const cases = [
            "K1 在显式句柄之前 [[K1:P-1]]",
            "[[K1:P-1]] [outer K1]",
            "[[K1:P-1]]\n[\nK1\n]",
            "[[K1:P-1]]\n[\n)\nK1",
            "[[K1:P-1]] K01",
            "[[K1:P-1]] K999",
            "[[K1:P-1]] K1:P-1",
            "[[K1:P-1]] K1#1",
            "[[K1:P-1]] K1/path",
            "[[K1:P-1]] K1-P-404",
            "[[K1:P-1]] K1.P-404",
            "[[K1:P-1]] K1+P-404",
            "[[K1:P-1]] K1=P-404",
            "[[K1:P-1]] K1\u200b P-404",
            "[[K1:P-1]] [K1",
            "[[K1:P-1]] K1]",
        ];
        for (const citation of cases) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.unverifiedCitationCount).toBeGreaterThan(0);
            expect(answer.rejectedCitations.some((item) => item.reason === "malformed_handle")).toBe(true);
            expect(answer.text.match(/\[people\.csv/gu)).toHaveLength(1);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }
    });

    it("bounds wrapper ancestry lookup across repeated non-compound handles", () => {
        const repeatedHandles = "[K1:P-1] note ".repeat(8_191);
        const answer = finalizeKnowledgeAnswer(`[notes ${repeatedHandles}[K1:P-1], [fabricated.csv]]`, undefined);

        expect(answer.text).toBe("[来源引用未验证]");
        expect(answer.sources).toEqual([]);
        expect(answer.unverifiedCitationCount).toBe(1);
        expect(answer.rejectedCitations).toHaveLength(1);
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);

        const sharedClosing = `${"[x".repeat(8_192)}]`;
        const untouched = finalizeKnowledgeAnswer(sharedClosing, undefined);
        expect(untouched).toEqual({
            text: sharedClosing,
            sources: [],
            unverifiedCitationCount: 0,
            rejectedCitations: [],
        });
    });

    it("replaces many disjoint malformed compounds in one bounded pass", () => {
        const citation = "[［K1］,［fabricated.csv］] ".repeat(1_024);
        const answer = finalizeKnowledgeAnswer(citation, undefined);

        expect(answer.text.match(/\[来源引用未验证\]/gu)).toHaveLength(1_024);
        expect(answer.sources).toEqual([]);
        expect(answer.unverifiedCitationCount).toBe(1_024);
        expect(answer.rejectedCitations).toHaveLength(1_024);
    });

    it("keeps every untrusted or incomplete member of a compound handle array fail-closed", () => {
        for (const citation of [
            "[[K1:P-1],[K999]]",
            "[[K1:P-404],[K2:source:raw/sources/rules.md#2]]",
            "[[K1:asset://forged/raw/sources/people.csv],[K2:source:raw/sources/rules.md#2]]",
            "[[K1:P-1],[people.csv]]",
            "[[K1:P-1],[K2:source:raw/sources/rules.md#2]",
            "[[K1:P-1],[K2:source:raw/sources/rules.md#2]]]",
            "[[K1:P-1],[K2:source:raw/sources/rules.md#2],[people.csv]]",
            "[[[K1:P-1],[K2:source:raw/sources/rules.md#2]],asset://forged/x]",
            "[[[K1:P-1],[K2:source:raw/sources/rules.md#2]],K999]",
            "[[[[K1:P-1],[K2:source:raw/sources/rules.md#2]]]]",
            "([[K1:P-1],[K2:source:raw/sources/rules.md#2]],asset://forged/x)",
            "【[[K1:P-1],[K2:source:raw/sources/rules.md#2]]，K999】",
            "[[K1:bad , [K2]] , asset://forged/x]",
            "[［K1:P-1］,［fabricated.csv］]",
            "[［K1:P-1］,［fabricated.v2.csv］]",
            "[［K1:P-1］,［fabricated.csv，记录 ID：FAKE-1］]",
            "[［K1:P-1］,[文件：fabricated.csv + record ID:FAKE-1]]",
            "[［people.csv：P-1｜K1］,［fabricated.csv］]",
            "[来源：[[K1:P-1]], [fabricated.csv]]",
            "【[K1:P-1]], [fabricated.csv]】",
            "[来源：[K1:P-1]], [fabricated.csv]]",
            "[来源：［［K1:P-1］］, ［fabricated.csv］]",
            "[来源：［［people.csv：P-1｜K1］］, ［fabricated.csv］]",
            "[来源：【［K1:P-1］】, ［fabricated.csv］]",
            "[来源：［K1:P-1］, [[fabricated.csv]]]",
            "[来源：［K1:P-1］, [[K999]]]",
            "[来源：［K1:P-1］, [说明 [[fabricated.csv]]]]",
            "[来源：［K1:P-1］, [说明 [[K999]]]]",
            `[[K1:P-1]${" ".repeat(17)}, [K2:source:raw/sources/rules.md#2], asset://forged/x]`,
            `[[K1:${"X".repeat(241)}], [K2:source:raw/sources/rules.md#2], asset://forged/x]`,
            `【[K1:P-1], [fabricated.csv ${"x".repeat(2_100)}]】`,
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toBe("[来源引用未验证]");
            expect(answer.sources).toEqual([]);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(answer.rejectedCitations).toHaveLength(1);
            expect(answer.text).not.toMatch(/K\d+/u);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }
    });

    it("replaces every residual complete or partial K syntax instead of leaking it", () => {
        const answer = finalizeKnowledgeAnswer("[[K1:P-1]；[[K1；K1；K999]]", grounding);
        expect(answer.text).not.toMatch(/K\d+/u);
        expect(answer.text.match(/\[来源引用未验证\]/gu)).toHaveLength(4);
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBe(4);
        expect(answer.rejectedCitations).toHaveLength(4);
        expect(answer.rejectedCitations.slice(0, 3).every((item) => item.sourcePath === "raw/sources/people.csv")).toBe(
            true,
        );
        expect(answer.rejectedCitations[3]).toEqual({
            citation: "K999]]",
            reason: "malformed_handle",
        });
    });

    it("repairs only a line-terminal handle with one extra opening bracket", () => {
        const located = finalizeKnowledgeAnswer("人数 14。[[K1:P-1]", grounding);
        expect(located.text).toBe("人数 14。[people.csv，记录 ID：P-1]");
        expect(located.sources.map((source) => source.ref)).toEqual(["K1"]);
        expect(located.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(located.unverifiedCitationCount).toBe(0);

        const fileLevel = finalizeKnowledgeAnswer("规则依据：[[K2]", grounding);
        expect(fileLevel.text).toBe("规则依据：[rules.md]");
        expect(fileLevel.sources.map((source) => source.ref)).toEqual(["K2"]);
        expect(fileLevel.unverifiedCitationCount).toBe(0);

        for (const citation of ["[[K1:P-404]", "[[K999]"]) {
            const rejected = finalizeKnowledgeAnswer(citation, grounding);
            expect(rejected.text).toBe("[来源引用未验证]");
            expect(rejected.sources).toEqual([]);
            expect(rejected.unverifiedCitationCount).toBe(1);
        }
    });

    it("keeps an extra-opening handle fail-closed when it has an adjacent sibling", () => {
        for (const [citation, expectedText] of [
            [
                "[[K1:P-1] [[K2:source:raw/sources/rules.md#2]]",
                "[来源引用未验证] [rules.md，定位：source:raw/sources/rules.md#2]",
            ],
            [
                "[[K1:P-1][K2:source:raw/sources/rules.md#2]",
                "[来源引用未验证][rules.md，定位：source:raw/sources/rules.md#2]",
            ],
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toBe(expectedText);
            expect(answer.sources.map((source) => source.ref)).toEqual(["K2"]);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(answer.rejectedCitations[0]?.reason).toBe("malformed_handle");
        }
    });

    it("accepts a Markdown section ID present in a verified read even when the read also has a chunk locator", () => {
        const markdownWithChunk = JSON.stringify({
            reads: [
                {
                    title: "principles.md",
                    conceptId: "source:raw/sources/principles.md#1",
                    content: "### SRC-03\nUnified command.\n\n### SRC-04\nDo not use ordinary elevators.",
                    resource: "asset://asset-1/raw/sources/principles.md",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer("[[K1:SRC-03]] [[K1:SRC-04]]", markdownWithChunk);
        expect(answer.text).toContain("[principles.md，定位：SRC-03]");
        expect(answer.text).toContain("[principles.md，定位：SRC-04]");
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["SRC-03", "SRC-04"]);
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("allows balanced grouping punctuation inside exact Markdown locator handles", () => {
        const parenthesizedHeadingGrounding = JSON.stringify({
            reads: [
                {
                    title: "rules.md",
                    content: "## Safety (Current)\nUse the current verified procedure.",
                    resource: "asset://asset-1/raw/sources/rules.md",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer(
            "[[K1:Safety (Current)]] ［rules.md：Safety (Current)｜K1］",
            parenthesizedHeadingGrounding,
        );

        expect(answer.text).toBe("[rules.md，定位：Safety (Current)] [rules.md，定位：Safety (Current)]");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["Safety (Current)"]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
    });

    it("accepts only stable non-CSV section locators, never arbitrary words or embedded substrings", () => {
        const markdownGrounding = JSON.stringify({
            reads: [
                {
                    title: "handbook.md",
                    content: [
                        "The ordinary word open and number 1 are prose, not section locators.",
                        "An embedded token SRC-040 must not validate SRC-04.",
                        "Stable policy token SAFE_RULE-7 is explicitly present.",
                        "## 强制安全规则",
                    ].join("\n"),
                    resource: "asset://asset-1/raw/sources/handbook.md",
                },
            ],
        });

        expect(knowledgeGroundingSupportsLocator(markdownGrounding, "open")).toBe(false);
        expect(knowledgeGroundingSupportsLocator(markdownGrounding, "1")).toBe(false);
        expect(knowledgeGroundingSupportsLocator(markdownGrounding, "SRC-04")).toBe(false);
        expect(knowledgeGroundingSupportsLocator(markdownGrounding, "SAFE_RULE-7")).toBe(true);
        expect(knowledgeGroundingSupportsLocator(markdownGrounding, "强制安全规则")).toBe(true);

        const rejected = finalizeKnowledgeAnswer("[[K1:open]] [[K1:1]] [[K1:SRC-04]]", markdownGrounding);
        expect(rejected.sources).toHaveLength(0);
        expect(rejected.unverifiedCitationCount).toBe(3);
        expect(rejected.text.match(/\[来源引用未验证\]/gu)).toHaveLength(3);

        const accepted = finalizeKnowledgeAnswer("[[K1:SAFE_RULE-7]] [[K1:强制安全规则]]", markdownGrounding);
        expect(accepted.unverifiedCitationCount).toBe(0);
        expect(accepted.sources[0]?.locators.map((locator) => locator.value)).toEqual(["SAFE_RULE-7", "强制安全规则"]);
    });

    it("recovers an exact unique filename citation only from content read this turn", () => {
        const answer = finalizeKnowledgeAnswer(
            "人数为 14。[people.csv，记录 ID：P-1] 文件：people.csv + 记录 ID：P-2；规则见 [rules.md]。",
            grounding,
        );
        expect(answer.sources).toHaveLength(2);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1", "P-2"]);
        expect(answer.sources[1]?.relativePath).toBe("raw/sources/rules.md");
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("does not reinterpret ordinary Markdown links or bare parenthesized filenames as source citations", () => {
        const answer = finalizeKnowledgeAnswer(
            "阅读 [people.csv](/knowledge/files/people) 或 (people.csv)；引用 (people.csv，record ID: P-1)。",
            grounding,
        );

        expect(answer.text).toContain("[people.csv](/knowledge/files/people)");
        expect(answer.text).toContain("(people.csv)");
        expect(answer.text).toContain("[people.csv，记录 ID：P-1]");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("keeps ordinary parenthesized local-file prose unchanged", () => {
        const statements = [
            "直接双击 index.html 用浏览器打开即可使用（因为内置了 songs.js，不依赖网络或服务）",
            "Open index.html directly in a browser (because app.js bundles songs.json, no network or service is required).",
            "（入口文件是 index.html，不需要网络或服务）",
            "（歌曲数据位于 songs.js，不依赖后端）",
            "(the application uses app.js, no backend is required)",
            "(the catalog is stored in songs.json, no service is required)",
            "(songs.js, this is prose, locator: local)",
            "(songs.js, locator is local)",
        ];

        for (const currentGrounding of [undefined, grounding]) {
            for (const statement of statements) {
                const answer = finalizeKnowledgeAnswer(statement, currentGrounding);
                expect(answer.text).toBe(statement);
                expect(answer.sources).toEqual([]);
                expect(answer.unverifiedCitationCount).toBe(0);
                expect(answer.rejectedCitations).toEqual([]);
            }
        }
    });

    it.each([
        "（people.csv，记录 ID：P-1）",
        "(people.csv, record ID: P-1)",
        "（people.csv，ID：P-1）",
        "（people.csv，定位：P-1）",
        "(rules.md, locator: Approval)",
        "(rules.md, section: Approval)",
        "(rules.md, chunk: source:raw/sources/rules.md#2)",
    ])("still rejects an explicit parenthesized locator without a verified registry: %s", (citation) => {
        const answer = finalizeKnowledgeAnswer(citation, undefined);
        expect(answer.text).toBe("[来源引用未验证]");
        expect(answer.sources).toEqual([]);
        expect(answer.unverifiedCitationCount).toBe(1);
        expect(answer.rejectedCitations).toEqual([
            expect.objectContaining({ reason: "unknown_or_ambiguous_filename" }),
        ]);
    });

    it("still verifies an explicit parenthesized record citation from trusted grounding", () => {
        const answer = finalizeKnowledgeAnswer("(people.csv, record ID: P-1)", grounding);
        expect(answer.text).toBe("[people.csv，记录 ID：P-1]");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
    });

    it("never registers a source from any Markdown link-label form without a verified handle", () => {
        for (const citation of [
            "[people.csv，record ID：P-1](https://example.invalid)",
            "[people.csv，record ID：P-1][external]\n\n[external]: https://example.invalid",
            "[people.csv，record ID：P-1][]\n\n[people.csv，record ID：P-1]: https://example.invalid",
            "[people.csv，record ID：P-1]\n\n[people.csv，record ID：P-1]: https://example.invalid",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toBe(citation);
            expect(answer.sources).toEqual([]);
            expect(answer.unverifiedCitationCount).toBe(0);
            expect(answer.rejectedCitations).toEqual([]);
        }
    });

    it("keeps thousands of unterminated reference suffixes on a linear bounded path", () => {
        const repeated = 4_096;
        const scalingGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "known.csv",
                    content: "id\nR-1",
                    resource: "asset://neutral/raw/sources/known.csv",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer("known.csv record ID:R-1)[".repeat(repeated), scalingGrounding);

        expect(answer.text.match(/\[known\.csv，记录 ID：R-1\]/gu)).toHaveLength(repeated);
        expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/known.csv"]);
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("recovers separator-only filename variants when the current-turn source is unique", () => {
        const variantGrounding = JSON.stringify({
            reads: [
                {
                    title: "route_edges.csv",
                    content: "edge_id,status\nE-1,open",
                    resource: "asset://asset-1/raw/sources/route_edges.csv",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer(
            "[route edges.csv，记录 ID：E-1]；文件：route-edges.csv + 记录 ID：E-1",
            variantGrounding,
        );
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.relativePath).toBe("raw/sources/route_edges.csv");
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["E-1"]);
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("normalizes common natural citation wrappers and locator labels only after exact verification", () => {
        const answer = finalizeKnowledgeAnswer(
            [
                "(people.csv, record ID: P-1)",
                "【people.csv，ID：P-2】",
                "文件：people.csv + locator: P-1",
                "[raw/sources/people.csv，记录 ID：P-2]",
            ].join("；"),
            grounding,
        );
        expect(answer.text.match(/\[people\.csv，记录 ID：/gu)).toHaveLength(4);
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1", "P-2"]);
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("keeps protected handle tokens out of redundant natural CSV citations", () => {
        const answer = finalizeKnowledgeAnswer("[来源：people.csv，P-1[[K1:P-1]]；P-2[[K1:P-2]]]", grounding);

        expect(answer.text).toBe("[people.csv，记录 ID：P-1] [people.csv，记录 ID：P-2]");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1", "P-2"]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
        expect(JSON.stringify(answer)).not.toContain("KREF");
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
    });

    it("expands a bounded wildcard even when a redundant handle is nested in the natural citation", () => {
        const csvRead = JSON.stringify({
            reads: [
                {
                    title: "orders.csv",
                    content: "order_id,value\nORD-42-01,one\nORD-42-02,two\nOTHER-01,other",
                    resource: "asset://asset-1/raw/sources/orders.csv",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer("[来源：orders.csv，ORD-42-*[[K1:ORD-42-*]]]", csvRead);

        expect(answer.text).toBe("[orders.csv，记录 ID：ORD-42-01、ORD-42-02]");
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["ORD-42-01", "ORD-42-02"]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(JSON.stringify(answer)).not.toContain("KREF");
    });

    it("rejects model-authored protected tokens before they can alias a verified handle", () => {
        const orphan = finalizeKnowledgeAnswer("\uE000KREF999\uE001", grounding);
        expect(orphan.text).toBe("[来源引用未验证]");
        expect(orphan.sources).toHaveLength(0);
        expect(orphan.unverifiedCitationCount).toBe(1);
        expect(JSON.stringify(orphan)).not.toContain("KREF");

        const alias = finalizeKnowledgeAnswer("\uE000KREF0\uE001 [[K1:P-1]]", grounding);
        expect(alias.text).toBe("[来源引用未验证] [people.csv，记录 ID：P-1]");
        expect(alias.sources).toHaveLength(1);
        expect(alias.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(alias.unverifiedCitationCount).toBe(1);
        expect(JSON.stringify(alias)).not.toContain("KREF");
    });

    it("rejects every private placeholder namespace variant without leaking or aliasing it", () => {
        for (const privateToken of [
            "\uE000KREF０\uE001",
            "\uE000kref0\uE001",
            "\uE000KREF+0\uE001",
            "\uE000arbitrary-private-payload\uE001",
            `\uE000KREF${"0".repeat(161)}\uE001`,
            `\uE000KREF${"0".repeat(4_096)}\uE001`,
            `\uE000ｋＲｅＦ${"０".repeat(512)}\uE001`,
        ]) {
            expect(containsProtectedKnowledgeReference(privateToken)).toBe(true);
            const answer = finalizeKnowledgeAnswer(`${privateToken} [[K1:P-1]]`, grounding);
            expect(answer.text).toBe("[来源引用未验证] [people.csv，记录 ID：P-1]");
            expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
            expect(JSON.stringify(answer)).not.toContain("\uE000");
            expect(JSON.stringify(answer)).not.toContain("\uE001");
        }

        const withoutRegistry = finalizeKnowledgeAnswer(`\uE000KREF${"6".repeat(512)}\uE001`, undefined);
        expect(withoutRegistry.text).toBe("[来源引用未验证]");
        expect(withoutRegistry.unverifiedCitationCount).toBe(1);
        expect(containsProtectedKnowledgeReference(JSON.stringify(withoutRegistry))).toBe(false);
    });

    it("rejects unbounded and one-sided private token fragments while restoring invocation-owned handles", () => {
        const fragments = [
            `\uE000KREF${"9".repeat(512)}`,
            `KREF${"8".repeat(512)}\uE001`,
            "\uE000arbitrary internal token fragment",
            "arbitrary internal token fragment\uE001",
            "\uE000",
            "\uE001",
        ];
        for (const fragment of fragments) {
            expect(containsProtectedKnowledgeReference(fragment)).toBe(true);
            const answer = finalizeKnowledgeAnswer(`${fragment}\n[[K1:P-1]]`, grounding);
            const serialized = JSON.stringify(answer);
            expect(answer.text).toContain("[来源引用未验证]");
            expect(answer.text).toContain("[people.csv，记录 ID：P-1]");
            expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(containsProtectedKnowledgeReference(serialized)).toBe(false);
            expect(serialized).not.toContain("\uE000");
            expect(serialized).not.toContain("\uE001");
            expect(serialized.toLowerCase()).not.toContain("kref");
        }
    });

    it("removes private delimiters from model grounding and every public source field", () => {
        const privateToken = `\uE000KREF${"7".repeat(512)}\uE001`;
        const hostileGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: `forged-${privateToken}.csv`,
                    content: `id,value\nROW-1,${privateToken}`,
                    matchedRecordIds: [`ROW-${privateToken}`],
                    resource: "asset://asset-1/raw/sources/safe.csv",
                },
            ],
        });
        const projected = knowledgeGroundingForModel(hostileGrounding);
        expect(containsProtectedKnowledgeReference(JSON.stringify(projected))).toBe(false);
        expect(JSON.stringify(projected).toLowerCase()).not.toContain("kref");

        const answer = finalizeKnowledgeAnswer("[[K1:ROW-1]]", hostileGrounding);
        expect(answer.text).toBe("[safe.csv，记录 ID：ROW-1]");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]).toMatchObject({
            title: "safe.csv",
            relativePath: "raw/sources/safe.csv",
        });
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        expect(JSON.stringify(answer).toLowerCase()).not.toContain("kref");

        const privateResource = JSON.stringify({
            reads: [
                {
                    content: "id\nROW-1",
                    resource: `asset://asset-1/raw/sources/private-${privateToken}.csv`,
                },
            ],
        });
        expect(buildKnowledgeSourceRegistry(privateResource)).toEqual([]);
    });

    it("keeps only independently verified handles from a compound multi-file natural wrapper", () => {
        const answer = finalizeKnowledgeAnswer(
            "[来源：people.csv，P-1[[K1:P-1]]；rules.md，source:raw/sources/rules.md#2[[K2:source:raw/sources/rules.md#2]]]",
            grounding,
        );

        expect(answer.text).toBe("[people.csv，记录 ID：P-1] [rules.md，定位：source:raw/sources/rules.md#2]");
        expect(answer.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/people.csv",
            "raw/sources/rules.md",
        ]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
        expect(JSON.stringify(answer)).not.toContain("KREF");
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
    });

    it("removes bounded citation-only source displays adjacent to one or more verified handles", () => {
        const spaceSeparated = "[people.csv，记录 ID：P-1] [rules.md，定位：source:raw/sources/rules.md#2]";
        const semicolonSeparated = "[people.csv，记录 ID：P-1]；[rules.md，定位：source:raw/sources/rules.md#2]";
        for (const [citation, expectedText] of [
            [
                "[Sources: people.csv, record ID: P-1; rules.md, locator: source:raw/sources/rules.md#2] [[K1:P-1]] [[K2:source:raw/sources/rules.md#2]]",
                spaceSeparated,
            ],
            [
                "[来源：people.csv，记录 ID：P-1；rules.md，定位：source:raw/sources/rules.md#2]，[[K1:P-1]]；[[K2:source:raw/sources/rules.md#2]]",
                semicolonSeparated,
            ],
            [
                "[[K1:P-1]] [[K2:source:raw/sources/rules.md#2]] [References: people.csv, P-1; rules.md, source:raw/sources/rules.md#2]",
                spaceSeparated,
            ],
            [
                "[[K1:P-1]]；[[K2:source:raw/sources/rules.md#2]]【引用：people.csv，P-1；rules.md，source:raw/sources/rules.md#2】",
                semicolonSeparated,
            ],
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toBe(expectedText);
            expect(answer.sources.map((source) => source.relativePath)).toEqual([
                "raw/sources/people.csv",
                "raw/sources/rules.md",
            ]);
            expect(answer.unverifiedCitationCount).toBe(0);
            expect(answer.rejectedCitations).toEqual([]);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }
    });

    it("collapses an unlabeled adjacent display only for the exact current source-locator multiset", () => {
        const exactGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "alpha records.csv",
                    content: "id\nA-1\nA-2\nA-3",
                    resource: "asset://neutral/raw/sources/alpha_records.csv",
                },
                {
                    title: "beta.csv",
                    content: "id\nB-1",
                    resource: "asset://neutral/raw/sources/beta.csv",
                },
            ],
        });
        for (const citation of [
            "[alpha records.csv, record IDs: A-1, A-2, A-3] [[K1:A-1,A-2,A-3]]",
            "[[K1:A-1,A-2,A-3]] [alpha records.csv, record IDs: A-1, A-2, A-3]",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, exactGrounding);
            expect(answer.text.match(/\[alpha records\.csv，记录 ID：/gu)).toHaveLength(1);
            expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/alpha_records.csv"]);
            expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["A-1", "A-2", "A-3"]);
            expect(answer.unverifiedCitationCount).toBe(0);
            expect(answer.rejectedCitations).toEqual([]);
        }

        for (const citation of [
            "[alpha records.csv, record IDs: A-1, A-2, A-3; beta.csv, record ID: B-1] [[K1:A-1,A-2,A-3]] [[K2:B-1]]",
            "[[K1:A-1,A-2,A-3]] [[K2:B-1]] [alpha records.csv, record IDs: A-1, A-2, A-3; beta.csv, record ID: B-1]",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, exactGrounding);
            expect(answer.text.match(/\[alpha records\.csv，记录 ID：/gu)).toHaveLength(1);
            expect(answer.text.match(/\[beta\.csv，记录 ID：/gu)).toHaveLength(1);
            expect(answer.sources.map((source) => source.relativePath)).toEqual([
                "raw/sources/alpha_records.csv",
                "raw/sources/beta.csv",
            ]);
            expect(answer.unverifiedCitationCount).toBe(0);
            expect(answer.rejectedCitations).toEqual([]);
        }
    });

    it("keeps every unequal or untrusted unlabeled adjacent display fail-closed", () => {
        const exactGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "alpha records.csv",
                    content: "id\nA-1\nA-2\nA-3",
                    resource: "asset://neutral/raw/sources/alpha_records.csv",
                },
            ],
        });
        for (const citation of [
            "[alpha records.csv, record IDs: A-1, A-3] [[K1:A-1,A-2]]",
            "[alpha records.csv, record ID: A-1] [[K1:A-1,A-2]]",
            "[alpha records.csv, record IDs: A-1, A-2, A-3] [[K1:A-1,A-2]]",
            "[alpha records.csv, record IDs: A-1, A-1] [[K1:A-1]]",
            "[alpha records.csv] [[K1:A-1]]",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, exactGrounding);
            const survivingDisplayCount = answer.text.match(/alpha records\.csv/gu)?.length ?? 0;
            expect(answer.unverifiedCitationCount + Math.max(0, survivingDisplayCount - 1)).toBeGreaterThan(0);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }

        for (const citation of [
            "[fabricated.csv, record ID: A-1] [[K1:A-1]]",
            "[alpha records.csv, record ID: https://example.invalid] [[K1:A-1]]",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, exactGrounding);
            expect(answer.text).toContain("[来源引用未验证]");
            expect(answer.text).toContain("[alpha records.csv，记录 ID：A-1]");
            expect(answer.unverifiedCitationCount).toBeGreaterThan(0);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }

        const ambiguousGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "alpha records.csv",
                    content: "id\nA-1",
                    resource: "asset://neutral/raw/sources/alpha_records.csv",
                },
                {
                    title: "alpha-records.csv",
                    content: "id\nB-1",
                    resource: "asset://neutral/raw/sources/alpha-records.csv",
                },
            ],
        });
        const ambiguous = finalizeKnowledgeAnswer(
            "[alpha__records.csv, record ID: A-1] [[K1:A-1]]",
            ambiguousGrounding,
        );
        expect(ambiguous.text).toContain("[来源引用未验证]");
        expect(ambiguous.unverifiedCitationCount).toBe(1);

        const markdownLink = finalizeKnowledgeAnswer(
            "[alpha records.csv](https://example.invalid) [[K1:A-1]]",
            exactGrounding,
        );
        expect(markdownLink.text).toContain("[alpha records.csv](https://example.invalid)");
        expect(markdownLink.text.match(/alpha records\.csv/gu)).toHaveLength(2);

        const reverseFileLink = finalizeKnowledgeAnswer(
            "[[K1]] [alpha records.csv](https://example.invalid)",
            exactGrounding,
        );
        expect(reverseFileLink.text).toContain("[alpha records.csv](https://example.invalid)");
        expect(reverseFileLink.text.match(/alpha records\.csv/gu)).toHaveLength(2);

        const chineseFileGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "人员清单.csv",
                    content: "编号\n人员一",
                    resource: "asset://neutral/raw/sources/people_zh.csv",
                },
            ],
        });
        const reverseFullwidthFileLink = finalizeKnowledgeAnswer(
            "[[K1]] ［人员清单.csv］(https://example.invalid)",
            chineseFileGrounding,
        );
        expect(reverseFullwidthFileLink.text).toContain("［人员清单.csv］(https://example.invalid)");
        expect(reverseFullwidthFileLink.text.match(/人员清单\.csv/gu)).toHaveLength(2);

        const reverseReferenceLink = finalizeKnowledgeAnswer(
            "[[K1]] [alpha records.csv][external]\n\n[external]: https://example.invalid",
            exactGrounding,
        );
        expect(reverseReferenceLink.text).toContain("[alpha records.csv][external]");
        expect(reverseReferenceLink.text.match(/alpha records\.csv/gu)).toHaveLength(2);
        expect(reverseReferenceLink.sources).toHaveLength(1);

        const reverseFullwidthReferenceLink = finalizeKnowledgeAnswer(
            "[[K1]] ［人员清单.csv］[外链]\n\n[外链]: https://example.invalid",
            chineseFileGrounding,
        );
        expect(reverseFullwidthReferenceLink.text).toContain("［人员清单.csv］[外链]");
        expect(reverseFullwidthReferenceLink.text.match(/人员清单\.csv/gu)).toHaveLength(2);
        expect(reverseFullwidthReferenceLink.sources).toHaveLength(1);

        const directHandleReferenceLink = finalizeKnowledgeAnswer(
            "[[K1]][external]\n\n[external]: https://example.invalid",
            exactGrounding,
        );
        expect(directHandleReferenceLink.text).toContain("［alpha records.csv］[external]");
        expect(directHandleReferenceLink.sources).toHaveLength(1);

        for (const citation of [
            "[[K1]] [alpha records.csv][]\n\n[alpha records.csv]: https://example.invalid",
            "[[K1]] [alpha records.csv]\n\n[alpha records.csv]: https://example.invalid",
        ]) {
            const shortcut = finalizeKnowledgeAnswer(citation, exactGrounding);
            expect(shortcut.text).toContain("［alpha records.csv］");
            expect(shortcut.text.match(/alpha records\.csv/gu)).toHaveLength(3);
            expect(shortcut.sources).toHaveLength(1);
        }

        const longLabel = "x".repeat(2_050);
        const protectedInsideLongInline = finalizeKnowledgeAnswer(
            `[${longLabel} [[K1:A-1]]](https://example.invalid)`,
            exactGrounding,
        );
        expect(protectedInsideLongInline.text.startsWith("［")).toBe(true);
        expect(protectedInsideLongInline.text).toContain("］(https://example.invalid)");
        expect(protectedInsideLongInline.sources).toHaveLength(1);

        const protectedInsideLongReference = finalizeKnowledgeAnswer(
            `[${longLabel} [[K1:A-1]]][external]\n\n[external]: https://example.invalid`,
            exactGrounding,
        );
        expect(protectedInsideLongReference.text.startsWith("［")).toBe(true);
        expect(protectedInsideLongReference.text).toContain("］[external]");
        expect(protectedInsideLongReference.sources).toHaveLength(1);

        const protectedInsideNestedInline = finalizeKnowledgeAnswer(
            `[outer [${longLabel} [[K1:A-1]]]](https://example.invalid)`,
            exactGrounding,
        );
        expect(protectedInsideNestedInline.text.startsWith("［outer [")).toBe(true);
        expect(protectedInsideNestedInline.text).toContain("］(https://example.invalid)");
        expect(protectedInsideNestedInline.sources).toHaveLength(1);

        const protectedAfterEscapedClosing = finalizeKnowledgeAnswer(
            "[prefix \\] [[K1:A-1]]](https://example.invalid)",
            exactGrounding,
        );
        expect(protectedAfterEscapedClosing.text.startsWith("［prefix \\]")).toBe(true);
        expect(protectedAfterEscapedClosing.text).toContain("］(https://example.invalid)");
        expect(protectedAfterEscapedClosing.sources).toHaveLength(1);

        const escapedReferenceLabel = finalizeKnowledgeAnswer(
            "[[K1]][x\\]]\n\n[x\\]]: https://example.invalid",
            exactGrounding,
        );
        expect(escapedReferenceLabel.text).toContain("［alpha records.csv］[x\\]]");
        expect(escapedReferenceLabel.sources).toHaveLength(1);

        const backtickReferenceLabel = finalizeKnowledgeAnswer(
            "[[K1]][x`]`]\n\n[x`]: https://example.invalid",
            exactGrounding,
        );
        expect(backtickReferenceLabel.text).toContain("［alpha records.csv］[x`]`]");
        expect(backtickReferenceLabel.sources).toHaveLength(1);

        const htmlTextReferenceLabel = finalizeKnowledgeAnswer(
            '[[K1]][x<span title="]">`]\n\n[x<span title="]: https://example.invalid',
            exactGrounding,
        );
        expect(htmlTextReferenceLabel.text).toContain('［alpha records.csv］[x<span title="]">`]');
        expect(htmlTextReferenceLabel.sources).toHaveLength(1);

        const protectedAfterInlineCodeClosing = finalizeKnowledgeAnswer(
            `[${longLabel} prefix \`]\` [[K1:A-1]]](https://example.invalid)`,
            exactGrounding,
        );
        expect(protectedAfterInlineCodeClosing.text.startsWith("［")).toBe(true);
        expect(protectedAfterInlineCodeClosing.text).toContain("］(https://example.invalid)");
        expect(protectedAfterInlineCodeClosing.sources).toHaveLength(1);

        const protectedAfterReferenceCodeClosing = finalizeKnowledgeAnswer(
            `[${longLabel} prefix \`\`]\`\` [[K1:A-1]]][external]\n\n[external]: https://example.invalid`,
            exactGrounding,
        );
        expect(protectedAfterReferenceCodeClosing.text.startsWith("［")).toBe(true);
        expect(protectedAfterReferenceCodeClosing.text).toContain("］[external]");
        expect(protectedAfterReferenceCodeClosing.sources).toHaveLength(1);

        const protectedAfterHtmlAttributeClosing = finalizeKnowledgeAnswer(
            `[${longLabel} <span title="]">x</span> [[K1:A-1]]](https://example.invalid)`,
            exactGrounding,
        );
        expect(protectedAfterHtmlAttributeClosing.text.startsWith("［")).toBe(true);
        expect(protectedAfterHtmlAttributeClosing.text).toContain("］(https://example.invalid)");
        expect(protectedAfterHtmlAttributeClosing.sources).toHaveLength(1);

        const protectedAfterUnquotedHtmlAttributeClosing = finalizeKnowledgeAnswer(
            `[${longLabel} <span data-close=]>x</span> [[K1:A-1]]](https://example.invalid)`,
            exactGrounding,
        );
        expect(protectedAfterUnquotedHtmlAttributeClosing.text.startsWith("［")).toBe(true);
        expect(protectedAfterUnquotedHtmlAttributeClosing.text).toContain("］(https://example.invalid)");
        expect(protectedAfterUnquotedHtmlAttributeClosing.sources).toHaveLength(1);

        const protectedAfterHtmlCommentClosing = finalizeKnowledgeAnswer(
            `[${longLabel} <!-- ] --> [[K1:A-1]]][external]\n\n[external]: https://example.invalid`,
            exactGrounding,
        );
        expect(protectedAfterHtmlCommentClosing.text.startsWith("［")).toBe(true);
        expect(protectedAfterHtmlCommentClosing.text).toContain("］[external]");
        expect(protectedAfterHtmlCommentClosing.sources).toHaveLength(1);

        const protectedAfterInvalidHtmlLikeTag = finalizeKnowledgeAnswer(
            `<bad [${longLabel} > [[K1:A-1]]](https://example.invalid)`,
            exactGrounding,
        );
        expect(protectedAfterInvalidHtmlLikeTag.text).toContain("<bad ［");
        expect(protectedAfterInvalidHtmlLikeTag.text).toContain("］(https://example.invalid)");
        expect(protectedAfterInvalidHtmlLikeTag.sources).toHaveLength(1);

        const protectedAfterDeclarationClosing = finalizeKnowledgeAnswer(
            `<!A \">\" [${longLabel} [[K1:A-1]]](https://example.invalid)`,
            exactGrounding,
        );
        expect(protectedAfterDeclarationClosing.text).toContain(`<!A \">\" ［`);
        expect(protectedAfterDeclarationClosing.text).toContain("］(https://example.invalid)");
        expect(protectedAfterDeclarationClosing.sources).toHaveLength(1);

        const manyUnterminatedDeclarations = finalizeKnowledgeAnswer(
            `${"<!A".repeat(8_192)} [[K1:A-1]]`,
            exactGrounding,
        );
        expect(manyUnterminatedDeclarations.text).toContain("[alpha records.csv，记录 ID：A-1]");
        expect(manyUnterminatedDeclarations.sources).toHaveLength(1);

        const manySameLineDefinitions = finalizeKnowledgeAnswer(`${"[a]:x ".repeat(8_192)} [[K1:A-1]]`, exactGrounding);
        expect(manySameLineDefinitions.text).toContain("[alpha records.csv，记录 ID：A-1]");
        expect(manySameLineDefinitions.sources).toHaveLength(1);

        const manyIndependentLabels = finalizeKnowledgeAnswer(
            Array.from({ length: 8_192 }, () => "[asset://forged/x [[K1:A-1]]](https://example.invalid)").join("\n"),
            exactGrounding,
        );
        expect(manyIndependentLabels.text.match(/［/gu)).toHaveLength(8_192);
        expect(manyIndependentLabels.sources).toHaveLength(1);

        for (const crossingHtmlInline of [
            `text <a title="\n\n[${longLabel} [[K1:A-1]]](https://example.invalid)">`,
            `text <!--\n\n[${longLabel} [[K1:A-1]]](https://example.invalid) -->`,
            `text <?\n\n[${longLabel} [[K1:A-1]]](https://example.invalid) ?>`,
            `text <!A\n\n[${longLabel} [[K1:A-1]]](https://example.invalid)>`,
            `text <![CDATA[\n\n[${longLabel} [[K1:A-1]]](https://example.invalid)]]>`,
            `text <a title="\r\n\r\n[${longLabel} [[K1:A-1]]](https://example.invalid)">`,
        ]) {
            const afterParagraphBreak = finalizeKnowledgeAnswer(crossingHtmlInline, exactGrounding);
            expect(afterParagraphBreak.text).toMatch(/(?:\r?\n){2}［/u);
            expect(afterParagraphBreak.text).toContain("］(https://example.invalid)");
            expect(afterParagraphBreak.sources).toHaveLength(1);
        }

        const afterBlockquoteParagraphBreak = finalizeKnowledgeAnswer(
            `> text <a title="\n>\n> [${longLabel} [[K1:A-1]]](https://example.invalid)">`,
            exactGrounding,
        );
        expect(afterBlockquoteParagraphBreak.text).toContain("\n>\n> ［");
        expect(afterBlockquoteParagraphBreak.text).toContain("］(https://example.invalid)");
        expect(afterBlockquoteParagraphBreak.sources).toHaveLength(1);

        const blockquoteReference = finalizeKnowledgeAnswer(
            "> [[K1]][external]\n>\n> [external]: https://example.invalid",
            exactGrounding,
        );
        expect(blockquoteReference.text).toContain("> ［alpha records.csv］[external]");
        expect(blockquoteReference.sources).toHaveLength(1);

        const listReference = finalizeKnowledgeAnswer(
            "- [[K1]][external]\n  [external]: https://example.invalid",
            exactGrounding,
        );
        expect(listReference.text).toContain("- ［alpha records.csv］[external]");
        expect(listReference.sources).toHaveLength(1);

        for (const citation of [
            "[[K1]][external\nref]\n\n[external\nref]: https://example.invalid",
            "> [[K1]][external\n> ref]\n>\n> [external\n> ref]: https://example.invalid",
            "- [[K1]][external\n  ref]\n\n  [external\n  ref]: https://example.invalid",
        ]) {
            const multilineReference = finalizeKnowledgeAnswer(citation, exactGrounding);
            expect(multilineReference.text).toContain("［alpha records.csv］[external");
            expect(multilineReference.sources).toHaveLength(1);
        }

        const listBlockquoteReference = finalizeKnowledgeAnswer(
            "-   > [foo\n    > bar]: https://example.invalid\n    > [[K1]][foo bar]",
            exactGrounding,
        );
        expect(listBlockquoteReference.text).toContain("> ［alpha records.csv］[foo bar]");
        expect(listBlockquoteReference.sources).toHaveLength(1);

        const literalIndentedGreaterThanReference = finalizeKnowledgeAnswer(
            "[[K1]][foo > bar]\n\n[foo\n    > bar]: https://example.invalid",
            exactGrounding,
        );
        expect(literalIndentedGreaterThanReference.text).toContain("［alpha records.csv］[foo > bar]");
        expect(literalIndentedGreaterThanReference.sources).toHaveLength(1);

        const partiallyStrippedBlockquoteReference = finalizeKnowledgeAnswer(
            "> [foo\n>     > bar]: https://example.invalid\n> [[K1]][foo > bar]",
            exactGrounding,
        );
        expect(partiallyStrippedBlockquoteReference.text).toContain("> ［alpha records.csv］[foo > bar]");
        expect(partiallyStrippedBlockquoteReference.sources).toHaveLength(1);

        const proseGreaterThanReference = finalizeKnowledgeAnswer(
            "> x > [[K1]][foo\n> bar]\n>\n> [foo bar]: https://example.invalid",
            exactGrounding,
        );
        expect(proseGreaterThanReference.text).toContain("> x > ［alpha records.csv］[foo\n> bar]");
        expect(proseGreaterThanReference.sources).toHaveLength(1);

        const lazyBlockquoteReference = finalizeKnowledgeAnswer(
            "> prefix\n[[K1]][foo\n> bar]\n>\n> [foo bar]: https://example.invalid",
            exactGrounding,
        );
        expect(lazyBlockquoteReference.text).toContain("［alpha records.csv］[foo\n> bar]");
        expect(lazyBlockquoteReference.sources).toHaveLength(1);

        const mixedDepthLazyBlockquoteReference = finalizeKnowledgeAnswer(
            "> > [[K1]][foo\n> bar\n> > baz]\n> >\n> > [foo bar baz]: https://example.invalid",
            exactGrounding,
        );
        expect(mixedDepthLazyBlockquoteReference.text).toContain("［alpha records.csv］[foo\n> bar\n> > baz]");
        expect(mixedDepthLazyBlockquoteReference.sources).toHaveLength(1);

        for (const [citation, expectedPrefix] of [
            ["> [[K1]]\n>\n> [alpha\n> records.csv]: https://example.invalid", "> ［alpha records.csv］"],
            ["> > [[K1]]\n> >\n> > [alpha\n> > records.csv]: https://example.invalid", "> > ［alpha records.csv］"],
        ]) {
            const blockquoteShortcut = finalizeKnowledgeAnswer(citation, exactGrounding);
            expect(blockquoteShortcut.text).toContain(expectedPrefix);
            expect(blockquoteShortcut.sources).toHaveLength(1);
        }

        const unicodeGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "straße.csv",
                    content: "id\nR-1",
                    resource: "asset://neutral/raw/sources/strasse.csv",
                },
                {
                    title: "ος.csv",
                    content: "id\nR-2",
                    resource: "asset://neutral/raw/sources/sigma.csv",
                },
            ],
        });
        const sharpSShortcut = finalizeKnowledgeAnswer(
            "[[K1]]\n\n[STRASSE.CSV]: https://example.invalid",
            unicodeGrounding,
        );
        expect(sharpSShortcut.text).toContain("［straße.csv］");
        expect(sharpSShortcut.sources).toHaveLength(1);

        const sharpSFullReference = finalizeKnowledgeAnswer(
            "[[K1]][straße]\n\n[STRASSE]: https://example.invalid",
            unicodeGrounding,
        );
        expect(sharpSFullReference.text).toContain("［straße.csv］[straße]");
        expect(sharpSFullReference.sources).toHaveLength(1);

        const sigmaShortcut = finalizeKnowledgeAnswer("[[K2]]\n\n[ΟΣ.CSV]: https://example.invalid", unicodeGrounding);
        expect(sigmaShortcut.text).toContain("［ος.csv］");
        expect(sigmaShortcut.sources).toHaveLength(1);

        const separated = finalizeKnowledgeAnswer(
            `[alpha records.csv, record ID: A-1]${" ".repeat(33)}[[K1:A-1]]`,
            exactGrounding,
        );
        expect(separated.text.match(/\[alpha records\.csv，记录 ID：A-1\]/gu)).toHaveLength(2);

        const overlong = finalizeKnowledgeAnswer(
            `[alpha records.csv, record ID: ${"LONG-".repeat(420)}] [[K1:A-1]]`,
            exactGrounding,
        );
        expect(overlong.unverifiedCitationCount).toBeGreaterThan(0);
        expect(overlong.text).toContain("[alpha records.csv，记录 ID：A-1]");
    });

    it("requires the displayed locator to be present in the current read before unlabeled deduplication", () => {
        const groundingWithoutCurrentLocator = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "alpha records.csv",
                    content: "id\nA-1",
                    resource: "asset://neutral/raw/sources/alpha_records.csv",
                },
            ],
        });
        const citation = "[alpha records.csv, record ID: A-2] [[K1:A-2]]";
        const stale = finalizeKnowledgeAnswer(citation, groundingWithoutCurrentLocator);
        expect(stale.unverifiedCitationCount).toBeGreaterThan(0);
        expect(stale.sources).toEqual([]);

        const groundingWithCurrentLocator = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "alpha records.csv",
                    content: "id\nA-1\nA-2",
                    resource: "asset://neutral/raw/sources/alpha_records.csv",
                },
            ],
        });
        const reread = finalizeKnowledgeAnswer(citation, groundingWithCurrentLocator);
        expect(reread.text).toBe("[alpha records.csv，记录 ID：A-2]");
        expect(reread.sources[0]?.locators.map((locator) => locator.value)).toEqual(["A-2"]);
        expect(reread.unverifiedCitationCount).toBe(0);
        expect(reread.rejectedCitations).toEqual([]);
    });

    it("keeps one embedded receipt only when a redundant opener hides an exactly equivalent display", () => {
        for (const citation of [
            "[people.csv，记录 ID：P-1[[[K1:P-1]]］",
            "［people.csv: record ID: P-1[[[K1:P-1]]］",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toBe("[people.csv，记录 ID：P-1]");
            expect(answer.sources.map((source) => source.ref)).toEqual(["K1"]);
            expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
            expect(answer.unverifiedCitationCount).toBe(0);
            expect(answer.rejectedCitations).toEqual([]);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }
    });

    it("rejects a conflicting or malformed embedded display without swallowing its verified receipt", () => {
        for (const [citation, expectedSource, expectedReason] of [
            ["[people.csv，记录 ID：P-404[[[K1:P-1]]］", "K1", "unsupported_locator"],
            ["[people.csv，记录 ID：P-1[[[K2]]］", "K2", "source_filename_conflict"],
            ["[people.csv，记录 ID：P-1[[[K1:P-1]][[K1:P-1]]］", "K1", "malformed_handle"],
            ["[people.csv，记录 ID：P-1[[[[K1:P-1]]］", "K1", "unsupported_locator"],
            ["[people.csv，记录 ID：P-1[[[K1:P-1]] extra］", "K1", "unsupported_locator"],
            ["[people.csv，记录 ID：P-1,P-1[[[K1:P-1]]］", "K1", "unsupported_locator"],
            ["[people.csv，记录 ID：P-1,p-1[[[K1:P-1]]］", "K1", "unsupported_locator"],
            ["[people.csv，记录 ID：P-1,P-1*[[[K1:P-1]]］", "K1", "unsupported_locator"],
            [`[people.csv，记录 ID：P-1,${"FAKE-".padEnd(161, "X")}[[[K1:P-1]]］`, "K1", "unsupported_locator"],
            [
                `[people.csv，记录 ID：${Array.from({ length: 33 }, () => "P-1").join(",")}[[[K1:P-1]]］`,
                "K1",
                "unsupported_locator",
            ],
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toContain("[来源引用未验证]");
            expect(answer.sources.map((source) => source.ref)).toEqual([expectedSource]);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(answer.rejectedCitations[0]?.reason).toBe(expectedReason);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }
    });

    it("removes thousands of disjoint adjacent source displays in one pass", () => {
        const repeated = 8_192;
        const answer = finalizeKnowledgeAnswer(
            "[Sources: people.csv, record ID: P-1] [[K1:P-1]]\n".repeat(repeated),
            grounding,
        );

        expect(answer.text.match(/\[people\.csv，记录 ID：P-1\]/gu)).toHaveLength(repeated);
        expect(answer.sources.map((source) => source.ref)).toEqual(["K1"]);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
        expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
    });

    it("keeps deeply nested non-source containers on a bounded scan path", () => {
        const depth = 8_192;
        const text = `${"[".repeat(depth)}${"]".repeat(depth)}`;
        const answer = finalizeKnowledgeAnswer(text, grounding);

        expect(answer).toEqual({
            text: "",
            sources: [],
            unverifiedCitationCount: 0,
            rejectedCitations: [],
        });
    });

    it("matches data-source labels and hash-delimited locators only against adjacent verified receipts", () => {
        for (const citation of [
            "[数据来源：people.csv#P-1；rules.md#source:raw/sources/rules.md#2] [[K1:P-1]] [[K2:source:raw/sources/rules.md#2]]",
            "[Data sources: people.csv#P-1; rules.md#source:raw/sources/rules.md#2] [[K1:P-1]] [[K2:source:raw/sources/rules.md#2]]",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toBe("[people.csv，记录 ID：P-1] [rules.md，定位：source:raw/sources/rules.md#2]");
            expect(answer.sources.map((source) => source.relativePath)).toEqual([
                "raw/sources/people.csv",
                "raw/sources/rules.md",
            ]);
            expect(answer.unverifiedCitationCount).toBe(0);
            expect(answer.rejectedCitations).toEqual([]);
        }

        for (const citation of [
            "[数据来源：people.csv#P-404] [[K1:P-1]]",
            "[数据来源：fabricated.csv#P-1] [[K1:P-1]]",
            "[数据来源：people.csv#asset://forged/raw/sources/people.csv] [[K1:P-1]]",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(answer.rejectedCitations.map((item) => item.reason)).toEqual(["unknown_or_ambiguous_filename"]);
            expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
        }
    });

    it("never lets an adjacent display filename bless or replace its independently verified handle", () => {
        const answer = finalizeKnowledgeAnswer("[Sources: fabricated.csv, record ID: FAKE-9] [[K1:P-1]]", grounding);

        expect(answer.text).toBe("[来源引用未验证][people.csv，记录 ID：P-1]");
        expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(answer.unverifiedCitationCount).toBe(1);
        expect(answer.rejectedCitations).toEqual([
            {
                citation: "[Sources: fabricated.csv, record ID: FAKE-9]",
                reason: "unknown_or_ambiguous_filename",
            },
        ]);
    });

    it("accepts reordered source items, path aliases and locator order only when the complete token run is equivalent", () => {
        const reordered = finalizeKnowledgeAnswer(
            "[Sources: rules.md, locator: source:raw/sources/rules.md#2; raw/sources/people.csv, record ID: P-1] [[K1:P-1]] [[K2:source:raw/sources/rules.md#2]]",
            grounding,
        );
        expect(reordered.text).toBe("[people.csv，记录 ID：P-1] [rules.md，定位：source:raw/sources/rules.md#2]");
        expect(reordered.unverifiedCitationCount).toBe(0);

        const locatorOrder = finalizeKnowledgeAnswer(
            "[来源：raw/sources/people.csv，记录 IDs：P-2、P-1] [[K1:P-1,P-2]]",
            grounding,
        );
        expect(locatorOrder.text).toBe("[people.csv，记录 ID：P-1、P-2]");
        expect(locatorOrder.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1", "P-2"]);
        expect(locatorOrder.unverifiedCitationCount).toBe(0);
    });

    it("matches grouped sibling displays and split handles by exact source-locator atoms", () => {
        const groupedGrounding = JSON.stringify({
            reads: [
                {
                    title: "alpha records.csv",
                    content: "id\nA-1\nA-2\nA-3",
                    resource: "asset://neutral/raw/sources/alpha_records.csv",
                },
                {
                    title: "beta.csv",
                    content: "id\nB-1",
                    resource: "asset://neutral/raw/sources/beta.csv",
                },
            ],
        });
        const groupedDisplay = finalizeKnowledgeAnswer(
            "[Sources: alpha records.csv, record IDs: A-1, A-2, A-3; beta.csv, record ID: B-1] [[K1:A-1]][[K1:A-2]][[K1:A-3]][[K2:B-1]]",
            groupedGrounding,
        );
        expect(groupedDisplay.text).toBe(
            "[alpha records.csv，记录 ID：A-1][alpha records.csv，记录 ID：A-2][alpha records.csv，记录 ID：A-3][beta.csv，记录 ID：B-1]",
        );
        expect(groupedDisplay.unverifiedCitationCount).toBe(0);
        expect(groupedDisplay.rejectedCitations).toEqual([]);

        const groupedHandle = finalizeKnowledgeAnswer(
            "[Sources: alpha_records.csv, record ID: A-3; alpha_records.csv, record ID: A-1; alpha_records.csv, record ID: A-2; beta.csv, record ID: B-1] [[K1:A-1,A-2,A-3]][[K2:B-1]]",
            groupedGrounding,
        );
        expect(groupedHandle.text).toBe("[alpha records.csv，记录 ID：A-1、A-2、A-3][beta.csv，记录 ID：B-1]");
        expect(groupedHandle.unverifiedCitationCount).toBe(0);
        expect(groupedHandle.rejectedCitations).toEqual([]);
    });

    it("lets one locator-free display label defer only to located receipts for the same complete source set", () => {
        const fiveSourceGrounding = JSON.stringify({
            reads: [
                { title: "alpha.csv", content: "id\nA-1", resource: "asset://neutral/raw/sources/alpha.csv" },
                { title: "beta.csv", content: "id\nB-1", resource: "asset://neutral/raw/sources/beta.csv" },
                { title: "gamma.csv", content: "id\nG-1", resource: "asset://neutral/raw/sources/gamma.csv" },
                { title: "delta.csv", content: "id\nD-1", resource: "asset://neutral/raw/sources/delta.csv" },
                { title: "epsilon.csv", content: "id\nE-1", resource: "asset://neutral/raw/sources/epsilon.csv" },
            ],
        });
        const answer = finalizeKnowledgeAnswer(
            "[Sources: alpha.csv; beta.csv; gamma.csv; delta.csv; epsilon.csv] [[K1:A-1]][[K2:B-1]][[K3:G-1]][[K4:D-1]][[K5:E-1]]",
            fiveSourceGrounding,
        );

        expect(answer.text).toBe(
            "[alpha.csv，记录 ID：A-1][beta.csv，记录 ID：B-1][gamma.csv，记录 ID：G-1][delta.csv，记录 ID：D-1][epsilon.csv，记录 ID：E-1]",
        );
        expect(answer.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/alpha.csv",
            "raw/sources/beta.csv",
            "raw/sources/gamma.csv",
            "raw/sources/delta.csv",
            "raw/sources/epsilon.csv",
        ]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);
    });

    it("keeps grouped sibling display comparison fail-closed for every unequal atom multiset", () => {
        const groupedGrounding = JSON.stringify({
            reads: [
                {
                    title: "alpha records.csv",
                    content: "id\nA-1\nA-2\nA-3",
                    resource: "asset://neutral/raw/sources/alpha_records.csv",
                },
                {
                    title: "beta.csv",
                    content: "id\nB-1",
                    resource: "asset://neutral/raw/sources/beta.csv",
                },
            ],
        });
        for (const citation of [
            // Wrong, missing, extra, and duplicate locator atoms.
            "[Sources: alpha records.csv, record IDs: A-1, A-3] [[K1:A-1]][[K1:A-2]]",
            "[Sources: alpha records.csv, record ID: A-1] [[K1:A-1]][[K1:A-2]]",
            "[Sources: alpha records.csv, record IDs: A-1, A-2, A-3] [[K1:A-1]][[K1:A-2]]",
            "[Sources: alpha records.csv, record IDs: A-1, A-1] [[K1:A-1]]",
            // A displayed locator still cannot be invented for file-level evidence.
            "[Sources: alpha records.csv, record ID: A-1] [[K1]]",
            // A locator-free display may not omit an adjacent receipt source.
            "[Sources: alpha records.csv] [[K1:A-1]][[K2:B-1]]",
            // A display source absent from the adjacent receipt run cannot be introduced by name.
            "[Sources: alpha records.csv, record ID: A-1; beta.csv, record ID: B-1] [[K1:A-1]][[K1:A-2]]",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, groupedGrounding);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(answer.rejectedCitations.map((item) => item.reason)).toEqual(["unknown_or_ambiguous_filename"]);
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }
    });

    it("does not resolve a separator alias when adjacent receipts make that filename ambiguous", () => {
        const ambiguousAliasGrounding = JSON.stringify({
            reads: [
                {
                    title: "alpha records.csv",
                    content: "id\nA-1",
                    resource: "asset://neutral/raw/sources/alpha_records.csv",
                },
                {
                    title: "alpha-records.csv",
                    content: "id\nB-1",
                    resource: "asset://neutral/raw/sources/alpha-records.csv",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer(
            "[Sources: alpha records.csv, record ID: A-1; alpha records.csv, record ID: B-1] [[K1:A-1]][[K2:B-1]]",
            ambiguousAliasGrounding,
        );

        expect(answer.text).toBe("[来源引用未验证][alpha records.csv，记录 ID：A-1][alpha-records.csv，记录 ID：B-1]");
        expect(answer.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/alpha_records.csv",
            "raw/sources/alpha-records.csv",
        ]);
        expect(answer.unverifiedCitationCount).toBe(1);
        expect(answer.rejectedCitations[0]?.reason).toBe("unknown_or_ambiguous_filename");
    });

    it("counts duplicate source items and duplicate locators instead of collapsing them", () => {
        const exactDuplicates = finalizeKnowledgeAnswer(
            "[Sources: people.csv, record ID: P-1; people.csv, record ID: P-1] [[K1:P-1]] [[K1:P-1]]",
            grounding,
        );
        expect(exactDuplicates.text).toBe("[people.csv，记录 ID：P-1] [people.csv，记录 ID：P-1]");
        expect(exactDuplicates.sources).toHaveLength(1);
        expect(exactDuplicates.unverifiedCitationCount).toBe(0);

        const missingDuplicate = finalizeKnowledgeAnswer(
            "[Sources: people.csv, record ID: P-1] [[K1:P-1]] [[K1:P-1]]",
            grounding,
        );
        expect(missingDuplicate.text).toBe("[来源引用未验证][people.csv，记录 ID：P-1] [people.csv，记录 ID：P-1]");
        expect(missingDuplicate.unverifiedCitationCount).toBe(1);

        const duplicateLocator = finalizeKnowledgeAnswer(
            "[Sources: people.csv, record IDs: P-1, P-1] [[K1:P-1]]",
            grounding,
        );
        expect(duplicateLocator.text).toBe("[来源引用未验证][people.csv，记录 ID：P-1]");
        expect(duplicateLocator.unverifiedCitationCount).toBe(1);

        const emptyLocatorLabel = finalizeKnowledgeAnswer("[Sources: people.csv, record ID:] [[K1]]", grounding);
        expect(emptyLocatorLabel.text).toBe("[来源引用未验证][people.csv]");
        expect(emptyLocatorLabel.unverifiedCitationCount).toBe(1);
    });

    it("rejects wrong locators, missing or extra items, and only-partially-adjacent token runs", () => {
        for (const citation of [
            "[Sources: people.csv, record ID: P-2] [[K1:P-1]]",
            "[Sources: rules.md, locator: source:raw/sources/rules.md#2] [[K1:P-1]]",
            "[Sources: people.csv, record ID: P-1; rules.md, locator: source:raw/sources/rules.md#2] [[K1:P-1]]",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toBe("[来源引用未验证][people.csv，记录 ID：P-1]");
            expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
            expect(answer.unverifiedCitationCount).toBe(1);
        }

        const missingItem = finalizeKnowledgeAnswer(
            "[Sources: people.csv, record ID: P-1] [[K1:P-1]] [[K2:source:raw/sources/rules.md#2]]",
            grounding,
        );
        expect(missingItem.text).toBe(
            "[来源引用未验证][people.csv，记录 ID：P-1] [rules.md，定位：source:raw/sources/rules.md#2]",
        );
        expect(missingItem.sources).toHaveLength(2);
        expect(missingItem.unverifiedCitationCount).toBe(1);

        const partialRun = finalizeKnowledgeAnswer(
            "[Sources: people.csv, record ID: P-1; rules.md, locator: source:raw/sources/rules.md#2] [[K1:P-1]] and then [[K2:source:raw/sources/rules.md#2]]",
            grounding,
        );
        expect(partialRun.text).toBe(
            "[来源引用未验证][people.csv，记录 ID：P-1] and then [rules.md，定位：source:raw/sources/rules.md#2]",
        );
        expect(partialRun.sources).toHaveLength(2);
        expect(partialRun.unverifiedCitationCount).toBe(1);
    });

    it("keeps standalone, prose, malformed and overlong source displays fail-closed", () => {
        const standalone = finalizeKnowledgeAnswer("[Sources: fabricated.csv, record ID: FAKE-9]", grounding);
        expect(standalone.text).toBe("[来源引用未验证]");
        expect(standalone.sources).toEqual([]);
        expect(standalone.unverifiedCitationCount).toBe(1);

        const prose = finalizeKnowledgeAnswer(
            "[Sources: people.csv. This paragraph is prose, not citation metadata.] [[K1:P-1]]",
            grounding,
        );
        expect(prose.text).toBe("[来源引用未验证][people.csv，记录 ID：P-1]");
        expect(prose.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
        expect(prose.unverifiedCitationCount).toBe(1);

        const malformed = finalizeKnowledgeAnswer("[Sources: fabricated.csv） [[K1:P-1]]]", grounding);
        expect(malformed.text).toContain("[来源引用未验证]");
        expect(malformed.text).toContain("[people.csv，记录 ID：P-1]");
        expect(malformed.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
        expect(malformed.unverifiedCitationCount).toBeGreaterThan(0);

        const overlong = finalizeKnowledgeAnswer(
            `[Sources: fabricated.csv, record ID: ${"LONG-".repeat(420)}] [[K1:P-1]]`,
            grounding,
        );
        expect(overlong.text).toBe("[来源引用未验证][people.csv，记录 ID：P-1]");
        expect(overlong.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
        expect(overlong.unverifiedCitationCount).toBe(1);

        const leadingWhitespaceOverlong = finalizeKnowledgeAnswer(
            `[${" ".repeat(255)}Sources: fabricated.csv ${"x".repeat(2_100)}] [[K1:P-1]]`,
            grounding,
        );
        expect(leadingWhitespaceOverlong.text).toBe("[来源引用未验证][people.csv，记录 ID：P-1]");
        expect(leadingWhitespaceOverlong.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/people.csv",
        ]);
        expect(leadingWhitespaceOverlong.unverifiedCitationCount).toBe(1);

        for (const label of [`Data${" ".repeat(260)}Sources:`, `Source${" ".repeat(260)}References:`]) {
            const splitLabelOverlong = finalizeKnowledgeAnswer(
                `[${label} fabricated.csv ${"x".repeat(2_100)}] [[K1:P-1]]`,
                grounding,
            );
            expect(splitLabelOverlong.text).toBe("[来源引用未验证][people.csv，记录 ID：P-1]");
            expect(splitLabelOverlong.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
            expect(splitLabelOverlong.unverifiedCitationCount).toBe(1);
        }
    });

    it("does not strip adjacent source displays without a trusted current-turn registry", () => {
        const staleError = JSON.stringify({
            status: "error",
            reads: [
                {
                    title: "people.csv",
                    content: "id,name\nP-1,Ada",
                    resource: "asset://asset-1/raw/sources/people.csv",
                },
            ],
        });
        for (const currentGrounding of [undefined, staleError]) {
            const answer = finalizeKnowledgeAnswer(
                "[Sources: people.csv, record ID: P-1] [[K1:P-1]]",
                currentGrounding,
            );
            expect(answer.sources).toEqual([]);
            expect(answer.unverifiedCitationCount).toBe(2);
            expect(answer.text).toBe("[来源引用未验证] [来源引用未验证]");
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }
    });

    it("never lets an unsupported outer claim change the verified inner handle", () => {
        const answer = finalizeKnowledgeAnswer("[来源：rules.md，P-404；[[K1:P-1]]]", grounding);

        expect(answer.text).toBe("[people.csv，记录 ID：P-1]");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.relativePath).toBe("raw/sources/people.csv");
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("keeps only a surviving verified inner handle from any bounded natural outer container", () => {
        for (const citation of [
            "[bogus.csv，P-404 [[K1:P-1]]]",
            "[rules.md，source:raw/sources/rules.md#2 [[K1:P-1]]]",
            "【错误外层（不应成为卡片） [[K1:P-1]]】",
            "[来源：[K1:P-1], (当前说明)]",
            "[来源：［K1:P-1］，（当前说明）]",
            "[来源：[K1:P-1], (当前版本 v2.0)]",
            "[来源：［K1:P-1］，（current version v2.0）]",
            "[来源：[K1:P-1], [guide.md](https://example.invalid)]",
            "[来源：[[K1:P-1]], (当前说明)]",
            "[来源：[[K1:P-1]], [guide.md](https://example.invalid)]",
            "【[K1:P-1]], (当前说明)】",
            "[来源：［［K1:P-1］］, （当前说明）]",
            "[来源：【［K1:P-1］】, （当前说明）]",
            "[来源：［K1:P-1］, [[guide.md](https://example.invalid)]]",
            "[来源：［K1:P-1］, [说明 [[guide.md](https://example.invalid)]]]",
            "[来源：［K1:P-1］, [说明 [当前说明]]]",
        ]) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toBe("[people.csv，记录 ID：P-1]");
            expect(answer.sources).toHaveLength(1);
            expect(answer.sources[0]?.relativePath).toBe("raw/sources/people.csv");
            expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);
            expect(answer.unverifiedCitationCount).toBe(0);
        }
    });

    it("resolves exact nested single-bracket handles before removing redundant bounded wrappers", () => {
        const answer = finalizeKnowledgeAnswer(
            "[Sources: people.csv, record ID: P-404 [[K1:P-1]] [K2:source:raw/sources/rules.md#2]]]",
            grounding,
        );

        expect(answer.text).toBe("[people.csv，记录 ID：P-1] [rules.md，定位：source:raw/sources/rules.md#2]");
        expect(answer.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/people.csv",
            "raw/sources/rules.md",
        ]);
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.rejectedCitations).toEqual([]);

        const ordered = finalizeKnowledgeAnswer(
            "[[K1:P-1]] then [Sources: [K2:source:raw/sources/rules.md#2]]]",
            grounding,
        );
        expect(ordered.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/people.csv",
            "raw/sources/rules.md",
        ]);

        const invalid = finalizeKnowledgeAnswer("[Sources: [[K1:P-1]] [K1:P-404]]]", grounding);
        expect(invalid.text).toContain("[来源引用未验证]");
        expect(invalid.unverifiedCitationCount).toBe(1);
        expect(invalid.rejectedCitations[0]?.reason).toBe("unsupported_locator");

        const bareOverclosed = finalizeKnowledgeAnswer("[K1:P-1]]]", grounding);
        expect(bareOverclosed.text).toContain("[来源引用未验证]");
        expect(bareOverclosed.unverifiedCitationCount).toBe(1);
    });

    it("does not let a bounded outer container hide raw source material beside a verified handle", () => {
        for (const [citation, hidden, reason, leavesPlaceholder] of [
            ["[outer [[K1:P-1]] asset://forged/x]", "asset://", "unverified_resource", false],
            ["[outer [[K1:P-1]] K999]", "K999", "malformed_handle", true],
        ] as const) {
            const answer = finalizeKnowledgeAnswer(citation, grounding);
            expect(answer.text).toContain("[people.csv，记录 ID：P-1]");
            expect(answer.text.includes("[来源引用未验证]")).toBe(leavesPlaceholder);
            expect(answer.text).not.toContain(hidden);
            expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
            expect(answer.unverifiedCitationCount).toBe(1);
            expect(answer.rejectedCitations).toEqual([
                expect.objectContaining({
                    reason,
                }),
            ]);
            expect(JSON.stringify(answer.rejectedCitations)).not.toContain("asset://");
            expect(containsProtectedKnowledgeReference(JSON.stringify(answer))).toBe(false);
        }
    });

    it("does not hide a verified inner handle behind a malformed cross-bracket outer citation", () => {
        const answer = finalizeKnowledgeAnswer("[bogus.csv）outer [[K1:P-1]]]", grounding);
        expect(answer.text).toContain("[来源引用未验证]");
        expect(answer.text).toContain("[people.csv，记录 ID：P-1]");
        expect(answer.sources.map((source) => source.relativePath)).toEqual(["raw/sources/people.csv"]);
        expect(answer.unverifiedCitationCount).toBe(1);
    });

    it("fails closed for an unsupported locator in a natural citation", () => {
        const answer = finalizeKnowledgeAnswer("文件：people.csv + record ID: P-404", grounding);
        expect(answer.text).toBe("[来源引用未验证]");
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBe(1);
    });

    it("downgrades an invalid locator on a unique full text read to a file citation only", () => {
        const textGrounding = JSON.stringify({
            reads: [
                {
                    title: "rules.md",
                    content: "# Current rules\nThe complete file was read in this turn.",
                    resource: "asset://asset-1/raw/sources/rules.md",
                },
            ],
        });

        const natural = finalizeKnowledgeAnswer("[rules.md，定位：source:raw/sources/rules.md#404]", textGrounding);
        expect(natural.text).toBe("[rules.md]");
        expect(natural.sources).toHaveLength(1);
        expect(natural.sources[0]?.locators).toEqual([]);
        expect(natural.unverifiedCitationCount).toBe(0);
        expect(natural.rejectedCitations).toEqual([]);

        const handle = finalizeKnowledgeAnswer("[[K1:source:raw/sources/rules.md#405]]", textGrounding);
        expect(handle.text).toBe("[rules.md]");
        expect(handle.sources[0]?.locators).toEqual([]);
        expect(handle.unverifiedCitationCount).toBe(0);

        const arbitrary = finalizeKnowledgeAnswer("[[K1:stale-section-404]]", textGrounding);
        expect(arbitrary.text).toBe("[来源引用未验证]");
        expect(arbitrary.sources).toHaveLength(0);

        const wrongFile = finalizeKnowledgeAnswer("[[K1:source:raw/sources/other.md#1]]", textGrounding);
        expect(wrongFile.text).toBe("[来源引用未验证]");
        expect(wrongFile.sources).toHaveLength(0);

        const forgedUri = finalizeKnowledgeAnswer("[[K1:asset://forged/rules.md]]", textGrounding);
        expect(forgedUri.text).toBe("[来源引用未验证]");
        expect(forgedUri.sources).toHaveLength(0);
        expect(forgedUri.unverifiedCitationCount).toBe(1);
    });

    it("never treats a model-authored Markdown URI as a verified filename citation", () => {
        const answer = finalizeKnowledgeAnswer("[people.csv](asset://forged/raw/sources/people.csv)", grounding);
        expect(answer.text).toContain("[来源引用未验证]");
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBeGreaterThan(0);
        expect(answer.rejectedCitations).toEqual([
            {
                citation: "asset-reference",
                reason: "unverified_resource",
            },
        ]);
        expect(JSON.stringify(answer.rejectedCitations)).not.toContain("asset://");

        const forgedLocator = finalizeKnowledgeAnswer("[[K1:asset://forged/raw/sources/people.csv]]", grounding);
        expect(forgedLocator.text).toBe("[来源引用未验证]");
        expect(forgedLocator.rejectedCitations).toEqual([
            {
                citation: "asset-reference",
                sourcePath: "raw/sources/people.csv",
                reason: "unsupported_locator",
            },
        ]);
        expect(JSON.stringify(forgedLocator.rejectedCitations)).not.toContain("asset://");
    });

    it("fails closed when separator normalization would match more than one source", () => {
        const ambiguous = JSON.stringify({
            reads: [
                {
                    title: "shared-name.csv",
                    content: "id\nA-1",
                    resource: "asset://asset-1/raw/sources/a/shared-name.csv",
                },
                {
                    title: "shared_name.csv",
                    content: "id\nA-1",
                    resource: "asset://asset-1/raw/sources/b/shared_name.csv",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer("[shared name.csv，记录 ID：A-1]", ambiguous);
        expect(answer.text).toBe("[来源引用未验证]");
        expect(answer.sources).toHaveLength(0);
        expect(answer.rejectedCitations).toEqual([
            {
                citation: "[shared name.csv，记录 ID：A-1]",
                reason: "unknown_or_ambiguous_filename",
            },
        ]);
    });

    it("allows exact file cards for catalog-only inventory but never validates a row ID from catalog metadata", () => {
        const inventory = JSON.stringify({
            status: "ok",
            search: {
                hits: [],
                tableSummaries: [
                    {
                        title: "people.csv",
                        recordCount: 36,
                        recordIds: ["P-1"],
                        resource: "asset://asset-1/raw/sources/people.csv",
                    },
                ],
            },
            reads: [],
        });
        const fileCard = finalizeKnowledgeAnswer("共 36 条。[people.csv]", inventory);
        expect(fileCard.sources).toHaveLength(1);
        expect(fileCard.sources[0]?.evidence).toBe("catalog");
        const fakeRow = finalizeKnowledgeAnswer("[people.csv，记录 ID：P-1]", inventory);
        expect(fakeRow.text).toBe("[来源引用未验证]");
        expect(fakeRow.sources).toHaveLength(0);
    });

    it("allows counted catalog file cards in a mixed turn but never turns catalog metadata into row evidence", () => {
        const mixedInventory = JSON.stringify({
            status: "ok",
            reads: [
                {
                    title: "notes.md",
                    content: "# Inventory notes\nThis file was read.",
                    resource: "asset://asset-1/raw/sources/notes.md",
                },
            ],
            search: {
                hits: [],
                tableSummaries: [
                    {
                        title: "people.csv",
                        recordCount: 36,
                        recordIds: ["P-CATALOG"],
                        matchedRecordIds: ["P-MATCHED-CATALOG"],
                        resource: "asset://asset-1/raw/sources/people.csv",
                    },
                    {
                        title: "uncounted.csv",
                        resource: "asset://asset-1/raw/sources/uncounted.csv",
                    },
                ],
            },
        });

        const files = finalizeKnowledgeAnswer("[notes.md] [people.csv]", mixedInventory);
        expect(files.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/notes.md",
            "raw/sources/people.csv",
        ]);
        expect(files.sources[1]).toMatchObject({ evidence: "catalog", locators: [] });
        expect(files.unverifiedCitationCount).toBe(0);

        const catalogRow = finalizeKnowledgeAnswer("[people.csv，记录 ID：P-CATALOG]", mixedInventory);
        expect(catalogRow.text).toBe("[来源引用未验证]");
        expect(catalogRow.sources).toHaveLength(0);
        expect(catalogRow.unverifiedCitationCount).toBe(1);

        const matchedCatalogRow = finalizeKnowledgeAnswer("[[K2:P-MATCHED-CATALOG]]", mixedInventory);
        expect(matchedCatalogRow.text).toBe("[来源引用未验证]");
        expect(matchedCatalogRow.sources).toHaveLength(0);

        const uncountedCatalog = finalizeKnowledgeAnswer("[uncounted.csv]", mixedInventory);
        expect(uncountedCatalog.text).toBe("[来源引用未验证]");
        expect(uncountedCatalog.sources).toHaveLength(0);
    });

    it("does not revalidate a resolved opaque catalog handle as a model-authored filename", () => {
        const structuredZeroResult = JSON.stringify({
            status: "ok",
            structuredQuery: {
                status: "ok",
                matchedRows: 0,
                rows: [],
                resources: [
                    {
                        title: "knowledge-smoke.csv",
                        resource: "asset://asset-1/raw/sources/knowledge-smoke.csv",
                    },
                ],
            },
        });
        const answer = finalizeKnowledgeAnswer("查询结果为 0。[[K1]]", structuredZeroResult);
        expect(answer.text).toBe("查询结果为 0。[knowledge-smoke.csv]");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.evidence).toBe("catalog");
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("fails closed when an exact filename is ambiguous or its record was not read", () => {
        const ambiguous = JSON.stringify({
            reads: [
                {
                    title: "shared.csv",
                    content: "id\nA-1",
                    resource: "asset://asset-1/raw/sources/a/shared.csv",
                },
                {
                    title: "shared.csv",
                    content: "id\nA-1",
                    resource: "asset://asset-1/raw/sources/b/shared.csv",
                },
            ],
        });
        const ambiguousAnswer = finalizeKnowledgeAnswer("[shared.csv，记录 ID：A-1]", ambiguous);
        expect(ambiguousAnswer.text).toBe("[来源引用未验证]");
        expect(ambiguousAnswer.sources).toHaveLength(0);

        const unreadAnswer = finalizeKnowledgeAnswer("[people.csv，记录 ID：P-404]", grounding);
        expect(unreadAnswer.text).toBe("[来源引用未验证]");
        expect(unreadAnswer.sources).toHaveLength(0);
    });

    it("accepts an exact locator present in a verified search snippet but not a bare search-only file", () => {
        const searchOnly = JSON.stringify({
            hits: [
                {
                    title: "principles.md",
                    snippet: "### SRC-04\nFollow the verified evacuation principle.",
                    resource: "asset://asset-1/raw/sources/principles.md",
                },
            ],
        });
        const cited = finalizeKnowledgeAnswer("[principles.md，定位：SRC-04]", searchOnly);
        expect(cited.sources).toHaveLength(1);
        expect(cited.sources[0]?.evidence).toBe("search");
        expect(cited.sources[0]?.locators[0]?.value).toBe("SRC-04");

        const bare = finalizeKnowledgeAnswer("[principles.md]", searchOnly);
        expect(bare.text).toBe("[来源引用未验证]");
        expect(bare.sources).toHaveLength(0);

        const bareHandle = finalizeKnowledgeAnswer("[[K1]]", searchOnly);
        expect(bareHandle.text).toBe("[来源引用未验证]");
        expect(bareHandle.sources).toHaveLength(0);
        expect(bareHandle.unverifiedCitationCount).toBe(1);

        const locatedHandle = finalizeKnowledgeAnswer("[[K1:SRC-04]]", searchOnly);
        expect(locatedHandle.sources).toHaveLength(1);
        expect(locatedHandle.sources[0]?.locators[0]?.value).toBe("SRC-04");

        const repeatedBareHandle = finalizeKnowledgeAnswer("[[K1:SRC-04]] then K1", searchOnly);
        expect(repeatedBareHandle.text).toBe("[principles.md，定位：SRC-04] then [来源引用未验证]");
        expect(repeatedBareHandle.sources).toHaveLength(1);
        expect(repeatedBareHandle.unverifiedCitationCount).toBe(1);
        expect(repeatedBareHandle.rejectedCitations).toEqual([
            {
                citation: "K1",
                sourcePath: "raw/sources/principles.md",
                reason: "locator_required",
            },
        ]);
    });

    it("fails closed for variant handles with an unknown source or unread locator", () => {
        const answer = finalizeKnowledgeAnswer("［K99:P-1］［people.csv: P-404｜K1］", grounding);
        expect(answer.text).toContain("[来源引用未验证]");
        expect(answer.text.match(/\[来源引用未验证\]/gu)).toHaveLength(2);
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBe(2);
        expect(answer.rejectedCitations).toEqual(
            expect.arrayContaining([
                {
                    citation: "［K99:P-1］",
                    reason: "unknown_source_handle",
                },
                {
                    citation: "［people.csv: P-404｜K1］",
                    locator: "P-404",
                    sourcePath: "raw/sources/people.csv",
                    reason: "unsupported_locator",
                },
            ]),
        );
    });

    it("accepts filename-plus-handle variants only when both identify the same unique source", () => {
        const answer = finalizeKnowledgeAnswer("［people.csv｜K1］ [people.csv|K1] [[people.csv|K1]]", grounding);
        expect(answer.text).toBe("[people.csv] [people.csv] [people.csv]");
        expect(answer.sources.map((source) => source.ref)).toEqual(["K1"]);
        expect(answer.unverifiedCitationCount).toBe(0);

        const canonical = JSON.stringify({
            reads: [
                {
                    title: "route_edges.csv",
                    content: "id,status\nE-1,open",
                    resource: "asset://asset-1/raw/sources/route_edges.csv",
                },
            ],
        });
        expect(finalizeKnowledgeAnswer("［route edges.csv｜K1］", canonical).text).toBe("[route_edges.csv]");
        expect(finalizeKnowledgeAnswer("[来源：route edges.csv]", canonical).text).toBe("[route_edges.csv]");
        expect(finalizeKnowledgeAnswer("[Source: route-edges.csv excerpt]", canonical).text).toBe("[route_edges.csv]");
    });

    it("rejects filename-plus-handle conflicts, ambiguity, unknown handles and search-only bare citations", () => {
        const conflict = finalizeKnowledgeAnswer("[rules.md|K1]", grounding);
        expect(conflict.text).toBe("[来源引用未验证]");
        expect(conflict.rejectedCitations[0]?.reason).toBe("source_filename_conflict");

        const ambiguous = JSON.stringify({
            reads: [
                {
                    title: "shared.csv",
                    content: "id\nA-1",
                    resource: "asset://asset-1/raw/sources/a/shared.csv",
                },
                {
                    title: "shared.csv",
                    content: "id\nB-1",
                    resource: "asset://asset-1/raw/sources/b/shared.csv",
                },
            ],
        });
        const ambiguousAnswer = finalizeKnowledgeAnswer("[shared.csv|K1]", ambiguous);
        expect(ambiguousAnswer.text).toBe("[来源引用未验证]");
        expect(ambiguousAnswer.rejectedCitations[0]?.reason).toBe("unknown_or_ambiguous_filename");

        const unknown = finalizeKnowledgeAnswer("[people.csv|K999]", grounding);
        expect(unknown.text).toBe("[来源引用未验证]");
        expect(unknown.rejectedCitations[0]?.reason).toBe("unknown_source_handle");

        const searchOnly = JSON.stringify({
            hits: [
                {
                    title: "principles.md",
                    snippet: "### SRC-04\nVerified principle.",
                    resource: "asset://asset-1/raw/sources/principles.md",
                },
            ],
        });
        const searchAnswer = finalizeKnowledgeAnswer("[principles.md|K1]", searchOnly);
        expect(searchAnswer.text).toBe("[来源引用未验证]");
        expect(searchAnswer.rejectedCitations[0]?.reason).toBe("locator_required");
    });

    it("checks locators against current-turn evidence and keeps CSV checks first-column-only", () => {
        const locatorGrounding = JSON.stringify({
            reads: [
                {
                    title: "people.csv",
                    content: "id,note\nP-1,SECONDARY",
                    resource: "asset://asset-1/raw/sources/people.csv",
                },
                {
                    title: "principles.md",
                    conceptId: "source:raw/sources/principles.md#3",
                    content: "### SRC-04\nVerified principle.",
                    resource: "asset://asset-1/raw/sources/principles.md",
                },
            ],
        });

        expect(knowledgeGroundingSupportsLocator(locatorGrounding, "P-1")).toBe(true);
        expect(knowledgeGroundingSupportsLocator(locatorGrounding, "SECONDARY")).toBe(false);
        expect(knowledgeGroundingSupportsLocator(locatorGrounding, "SRC-04")).toBe(true);
        expect(knowledgeGroundingSupportsLocator(locatorGrounding, "source:raw/sources/principles.md#3")).toBe(true);
        expect(knowledgeGroundingSupportsLocator(locatorGrounding, "P-404")).toBe(false);
        expect(knowledgeGroundingSupportsLocator(locatorGrounding, "asset://forged/source.md")).toBe(false);
        expect(knowledgeGroundingSupportsLocator(undefined, "P-1")).toBe(false);
    });

    it("keeps internal CSV chunk addresses out of record citations and model grounding", () => {
        const chunkLocator = "source:raw/sources/items.csv#6";
        const csvChunkGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    assetId: "asset-csv-chunk",
                    path: "raw/sources/items.csv",
                    conceptId: chunkLocator,
                    __knowledgePath: chunkLocator,
                    __knowledgeHitKey: `asset-csv-chunk:${chunkLocator}`,
                    matchedRecordIds: [chunkLocator, "ITEM-42"],
                    matchedIdentifiers: [chunkLocator, "ITEM-42"],
                    content: "item_id,status\nITEM-42,ready",
                    resource: "asset://asset-csv-chunk/raw/sources/items.csv",
                },
            ],
        });

        const registry = buildKnowledgeSourceRegistry(csvChunkGrounding);
        expect(registry).toHaveLength(1);
        expect(Array.from(registry[0]?.allowedLocators ?? [])).toEqual(["ITEM-42"]);

        const projected = knowledgeGroundingForModel(csvChunkGrounding);
        expect(projected.grounding).toContain("ITEM-42");
        expect(projected.grounding).not.toContain(chunkLocator);
        expect(projected.sourceGuide).not.toContain(chunkLocator);

        const rejectedChunk = finalizeKnowledgeAnswer(`[[K1:${chunkLocator}]]`, csvChunkGrounding);
        expect(rejectedChunk.sources).toEqual([]);
        expect(rejectedChunk.rejectedCitations[0]?.reason).toBe("unsupported_locator");
        expect(finalizeKnowledgeAnswer("[[K1:ITEM-42]]", csvChunkGrounding).sources).toHaveLength(1);

        expect(verifiedKnowledgeReadLocatorCitations(csvChunkGrounding, ["ITEM-42"])).toEqual([
            { locator: "ITEM-42", citation: "[[K1:ITEM-42]]" },
        ]);
        expect(verifiedKnowledgeReadLocatorCitations(csvChunkGrounding, [chunkLocator])).toEqual([]);
    });

    it("appends identifier receipts only from one unambiguous current-turn read", () => {
        const searchOnly = JSON.stringify({
            hits: [
                {
                    snippet: "ITEM-42,ready",
                    matchedRecordIds: ["ITEM-42"],
                    resource: "asset://asset-search/raw/sources/items.csv",
                },
            ],
        });
        expect(verifiedKnowledgeReadLocatorCitations(searchOnly, ["ITEM-42"])).toEqual([]);

        const ambiguous = JSON.stringify({
            reads: [
                {
                    content: "item_id,status\nITEM-42,ready",
                    resource: "asset://asset-a/raw/sources/items.csv",
                },
                {
                    content: "item_id,status\nITEM-42,ready",
                    resource: "asset://asset-b/raw/sources/archive.csv",
                },
            ],
        });
        expect(verifiedKnowledgeReadLocatorCitations(ambiguous, ["ITEM-42"])).toEqual([]);
    });

    it("routes arbitrarily large unknown handle numbers through the same fail-closed resolver", () => {
        const answer = finalizeKnowledgeAnswer(
            "[[K1000000]]、［K1000000］、[K1000000]、［people.csv: P-1｜K1000000］",
            grounding,
        );
        expect(answer.text.match(/\[来源引用未验证\]/gu)).toHaveLength(4);
        expect(answer.text).not.toContain("K1000000");
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBe(4);
        expect(answer.rejectedCitations.every((item) => item.sourcePath === undefined)).toBe(true);
    });

    it("rejects stale or hallucinated handles when the current turn has no verified registry", () => {
        const answer = finalizeKnowledgeAnswer(
            "旧引用［错误显示名.csv: P-1｜K1］和 asset://opaque/raw/sources/people.csv",
            undefined,
        );

        expect(answer.text).toContain("[来源引用未验证]");
        expect(answer.text).not.toContain("错误显示名.csv");
        expect(answer.text).not.toContain("K1");
        expect(answer.text).not.toContain("asset://");
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBe(2);
    });

    it("rejects natural filename citations when the current turn has no verified registry", () => {
        const answer = finalizeKnowledgeAnswer(
            "[people.csv，记录 ID：P-1]；文件：rules.md + locator: RULE-1；[notes.md]",
            undefined,
        );
        expect(answer.text.match(/\[来源引用未验证\]/gu)).toHaveLength(3);
        expect(answer.text).not.toContain("people.csv");
        expect(answer.text).not.toContain("rules.md");
        expect(answer.text).not.toContain("notes.md");
        expect(answer.sources).toEqual([]);
        expect(answer.unverifiedCitationCount).toBe(3);
        expect(answer.rejectedCitations.every((item) => item.reason === "unknown_or_ambiguous_filename")).toBe(true);
    });

    it("keeps ordinary parenthesized version prose when the current turn has no verified registry", () => {
        const staleGrounding = JSON.stringify({
            status: "error",
            reads: [
                {
                    title: "stale.md",
                    content: "stale",
                    resource: "asset://asset-1/raw/sources/stale.md",
                },
            ],
        });
        for (const currentGrounding of [undefined, staleGrounding]) {
            for (const text of ["(当前版本 v2.0)", "（current version v2.0）"]) {
                const answer = finalizeKnowledgeAnswer(text, currentGrounding);
                expect(answer.text).toBe(text);
                expect(answer.sources).toEqual([]);
                expect(answer.unverifiedCitationCount).toBe(0);
                expect(answer.rejectedCitations).toEqual([]);
            }
        }

        const forgedFilename = finalizeKnowledgeAnswer("[fabricated.v2.csv]", undefined);
        expect(forgedFilename.text).toBe("[来源引用未验证]");
        expect(forgedFilename.sources).toEqual([]);
        expect(forgedFilename.unverifiedCitationCount).toBe(1);
    });

    it("never creates source cards for internal snapshot or trash resources", () => {
        const internalGrounding = JSON.stringify({
            reads: [
                {
                    title: "old.csv",
                    content: "id\nOLD-1",
                    resource: "asset://asset-1/raw/sources/.shuan-os-snapshots/old.csv",
                },
                {
                    title: "deleted.csv",
                    content: "id\nDELETED-1",
                    resource: "asset://asset-1/raw/sources/.shuan-os-trash/deleted.csv",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer("[[K1:OLD-1]] [[K2:DELETED-1]]", internalGrounding);

        expect(answer.sources).toEqual([]);
        expect(answer.text).not.toContain("old.csv");
        expect(answer.text).not.toContain("deleted.csv");
    });

    it("removes repeated shortened URIs and keeps one source per answer", () => {
        const answer = finalizeKnowledgeAnswer(
            [
                "people.csv P-1 asset://asset-1/raw/sources/people.csv",
                "people.csv P-2 asset://…/people.csv",
                "people.csv again asset:/raw/sources/people.csv",
            ].join("\n"),
            grounding,
        );
        expect(answer.text).not.toContain("asset:");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.relativePath).toBe("raw/sources/people.csv");
    });

    it("fails closed for an invalid locator without creating a misleading file card", () => {
        const answer = finalizeKnowledgeAnswer("[[K1:P-404]]", grounding);
        expect(answer.text).toBe("[来源引用未验证]");
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBe(1);
        expect(answer.rejectedCitations).toEqual([
            {
                citation: "[[K1:P-404]]",
                locator: "P-404",
                sourcePath: "raw/sources/people.csv",
                reason: "unsupported_locator",
            },
        ]);
    });

    it("repairs one extra closing bracket only after verifying the handle and locator", () => {
        const answer = finalizeKnowledgeAnswer("人数 14。[K1:P-1]]", grounding);
        expect(answer.text).toBe("人数 14。[people.csv，记录 ID：P-1]");
        expect(answer.text).not.toContain("]]");
        expect(answer.sources).toHaveLength(1);
        expect(answer.sources[0]?.locators.map((locator) => locator.value)).toEqual(["P-1"]);

        const rejected = finalizeKnowledgeAnswer("[K1:P-404]]", grounding);
        expect(rejected.text).toBe("[来源引用未验证]");
        expect(rejected.sources).toHaveLength(0);
    });

    it("does not register ambiguous shortened resources", () => {
        const ambiguous = JSON.stringify({
            reads: [
                { resource: "asset://asset-1/raw/sources/shared.csv", content: "id\nA" },
                { resource: "asset://asset-2/raw/sources/shared.csv", content: "id\nB" },
            ],
        });
        const answer = finalizeKnowledgeAnswer("来源 asset://…/shared.csv", ambiguous);
        expect(answer.text).not.toContain("asset:");
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBe(1);
    });

    it("never guesses a card from a uniquely named truncated URI", () => {
        const answer = finalizeKnowledgeAnswer("来源 asset://…/people.csv", grounding);
        expect(answer.text).not.toContain("asset:");
        expect(answer.sources).toHaveLength(0);
        expect(answer.unverifiedCitationCount).toBe(1);
    });

    it("does not validate a record locator from table inventory alone", () => {
        const inventoryOnly = JSON.stringify({
            reads: [
                {
                    path: "raw/sources/people.csv",
                    title: "people.csv",
                    content: "person_id,count\nP-1,14",
                    tableSummary: { recordIds: ["P-1", "P-404"] },
                    resource: "asset://asset-1/raw/sources/people.csv",
                },
            ],
        });
        const answer = finalizeKnowledgeAnswer("[[K1:P-404]]", inventoryOnly);
        expect(answer.text).toBe("[来源引用未验证]");
        expect(answer.sources).toHaveLength(0);
    });

    it("removes punctuation-only lines left by legacy inline citations", () => {
        const answer = finalizeKnowledgeAnswer("正文 asset://…/people.csv\n]\n;\n)\n结尾", grounding);
        expect(answer.text).toBe("正文\n结尾");
    });

    it("builds one registry entry when search and read repeat a resource", () => {
        expect(buildKnowledgeSourceRegistry(grounding)).toHaveLength(2);
    });

    it("assigns trustworthy handles and source cards to catalog entries 25 through 32", () => {
        const entries = Array.from({ length: 32 }, (_, index) => ({
            title: `table-${index + 1}.csv`,
            recordCount: index + 1,
            resource: `asset://asset-1/raw/sources/table-${index + 1}.csv`,
        }));
        const catalogGrounding = JSON.stringify({
            status: "ok",
            search: { hits: [], tableSummaries: entries },
            reads: [],
        });

        const modelGrounding = knowledgeGroundingForModel(catalogGrounding);
        const sourceRefs = (
            JSON.parse(modelGrounding.grounding) as { catalogFacts: Array<{ sourceRef: string }> }
        ).catalogFacts.map((fact) => fact.sourceRef);
        expect(sourceRefs).toEqual(expect.arrayContaining(["K25", "K32"]));
        expect(modelGrounding.sourceGuide).toContain("K25: table-25.csv");
        expect(modelGrounding.sourceGuide).toContain("K32: table-32.csv");

        const answer = finalizeKnowledgeAnswer("[[K25]] [[K32]]", catalogGrounding);
        expect(answer.text).toContain("[table-25.csv]");
        expect(answer.text).toContain("[table-32.csv]");
        expect(answer.sources.map((source) => source.ref)).toEqual(["K25", "K32"]);
        expect(answer.unverifiedCitationCount).toBe(0);
    });

    it("caps the verified registry at the shared limit and rejects handles beyond it", () => {
        const overLimitGrounding = JSON.stringify({
            reads: Array.from({ length: MAX_KNOWLEDGE_SOURCE_REFERENCES + 1 }, (_, index) => ({
                title: `source-${index + 1}.md`,
                content: `verified source ${index + 1}`,
                resource: `asset://asset-1/raw/sources/source-${index + 1}.md`,
            })),
        });

        const registry = buildKnowledgeSourceRegistry(overLimitGrounding);
        expect(registry).toHaveLength(MAX_KNOWLEDGE_SOURCE_REFERENCES);
        expect(registry.at(-1)?.ref).toBe("K32");

        const answer = finalizeKnowledgeAnswer("[[K32]] [[K33]]", overLimitGrounding);
        expect(answer.text).toContain("[source-32.md]");
        expect(answer.text).toContain("[来源引用未验证]");
        expect(answer.sources.map((source) => source.ref)).toEqual(["K32"]);
        expect(answer.unverifiedCitationCount).toBe(1);
    });
});
