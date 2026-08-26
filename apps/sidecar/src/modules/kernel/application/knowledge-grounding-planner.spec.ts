import {
    genericKnowledgeIdentifierCandidates,
    isKnowledgeCatalogInventoryQuery,
    isKnowledgeDecisionOrActionRequest,
    isKnowledgeGlobalCatalogInventoryQuery,
    isKnowledgeOutputOnlyClause,
    isKnowledgeRouteOrTopologyRequest,
    isKnowledgeStructuredPlanSoleObligation,
    knowledgeQueryFacets,
    knowledgeQueryIntentCount,
    knowledgeRetrievalIntentText,
    planKnowledgeGroundingSources,
    planKnowledgeRetrievalObligations,
    planKnowledgeStructuredGrounding,
} from "./knowledge-grounding-planner";
import { finalizeKnowledgeCoverage } from "./knowledge-retrieval-coverage";

describe("knowledge grounding planner", () => {
    it("selects renamed tables by exact IDs and generic relations", () => {
        const searchRecord = {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/a.csv",
                    title: "a.csv",
                    columns: ["account_id", "name"],
                    primaryKey: "account_id",
                    recordIds: ["AC-1042"],
                    resource: "asset://asset-1/raw/sources/a.csv",
                    relations: [],
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/b.csv",
                    title: "b.csv",
                    columns: ["order_id", "account_id"],
                    primaryKey: "order_id",
                    recordIds: ["OR-9"],
                    resource: "asset://asset-1/raw/sources/b.csv",
                    relations: [
                        {
                            sourceColumn: "account_id",
                            targetPath: "raw/sources/a.csv",
                            targetColumn: "account_id",
                            confidence: "high",
                        },
                    ],
                },
            ],
        };
        const plan = planKnowledgeGroundingSources(
            [
                {
                    kind: "source",
                    assetId: "asset-1",
                    path: "raw/sources/b.csv",
                    title: "b.csv",
                    snippet: "OR-9,AC-1042",
                },
            ],
            "查询 OR-9 对应的账户 AC-1042",
            searchRecord,
        );

        expect(plan.sources.map((source) => source.path)).toEqual(
            expect.arrayContaining(["raw/sources/a.csv", "raw/sources/b.csv"]),
        );
        expect(plan.diagnostics.some((item) => item.reasons.includes("catalog_record_id"))).toBe(true);
    });

    it("replaces a ranked CSV chunk with its canonical catalog source for an exact record read", () => {
        const plan = planKnowledgeGroundingSources(
            [
                {
                    kind: "source",
                    assetId: "asset-1",
                    conceptId: "source:raw/sources/orders.csv#7",
                    path: "raw/sources/orders.csv",
                    snippet: "neighboring rows without OR-900",
                    __knowledgeSearchGroups: [0, 1],
                },
            ],
            "请查询 OR-900 的状态",
            {
                tableSummaries: [
                    {
                        assetId: "asset-1",
                        path: "raw/sources/orders.csv",
                        title: "orders.csv",
                        recordIds: ["OR-900"],
                        resource: "asset://asset-1/raw/sources/orders.csv",
                    },
                ],
            },
        );

        expect(plan.sources[0]).toMatchObject({
            kind: "source",
            assetId: "asset-1",
            path: "raw/sources/orders.csv",
            __knowledgeSearchGroups: [0, 1],
        });
        expect(plan.sources[0]).not.toHaveProperty("conceptId");
        expect(plan.diagnostics[0].reasons).toContain("catalog_record_id");
    });

    it("keeps exact owner obligations bound to assetId when two assets share a relative path", () => {
        const searchRecord = {
            tableSummaries: [
                {
                    assetId: "asset-a",
                    path: "raw/sources/shared.csv",
                    columns: ["record_id", "value"],
                    primaryKey: "record_id",
                    recordIds: ["REC-A1"],
                    resource: "asset://asset-a/raw/sources/shared.csv",
                },
                {
                    assetId: "asset-b",
                    path: "raw/sources/shared.csv",
                    columns: ["record_id", "value"],
                    primaryKey: "record_id",
                    recordIds: ["REC-B2"],
                    resource: "asset://asset-b/raw/sources/shared.csv",
                },
            ],
        };

        const obligations = planKnowledgeRetrievalObligations("读取 REC-B2", searchRecord);
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "exact_identifier",
                    identifiers: ["REC-B2"],
                    sourceKeys: ["asset-b:raw/sources/shared.csv"],
                }),
            ]),
        );

        const plan = planKnowledgeGroundingSources(
            [
                {
                    kind: "source",
                    assetId: "asset-a",
                    conceptId: "source:raw/sources/shared.csv#0",
                    path: "raw/sources/shared.csv",
                    snippet: "REC-B2 appears only as unrelated text",
                },
            ],
            "读取 REC-B2",
            searchRecord,
            1,
        );
        expect(plan.sources).toEqual([expect.objectContaining({ assetId: "asset-b", path: "raw/sources/shared.csv" })]);
    });

    it("extracts identifiers without project-specific prefixes", () => {
        expect(
            genericKnowledgeIdentifierCandidates(
                "记录 ID：INV_2026_004；另一个为 550e8400-e29b-41d4-a716-446655440000",
            ),
        ).toEqual(expect.arrayContaining(["INV_2026_004", "550e8400-e29b-41d4-a716-446655440000"]));
        expect(genericKnowledgeIdentifierCandidates("预算 18432 字节，耗时 2026 秒")).toEqual([]);
        expect(genericKnowledgeIdentifierCandidates("记录 ID：18432")).toEqual(["18432"]);
        expect(genericKnowledgeIdentifierCandidates("请读取记录 EXACT-LATE")).toEqual(["EXACT-LATE"]);
        expect(genericKnowledgeIdentifierCandidates("read record-id ALPHA_ROW")).toEqual(["ALPHA_ROW"]);
        expect(genericKnowledgeIdentifierCandidates("record status is pending")).toEqual([]);
        expect(genericKnowledgeIdentifierCandidates("请核对 `EXIT-W` 和 `FACP-SOUTH` 的状态")).toEqual([
            "EXIT-W",
            "FACP-SOUTH",
        ]);
        expect(genericKnowledgeIdentifierCandidates("解释 `blocked` 与 `orders.csv`")).toEqual([]);
    });

    it("reserves bounded high-confidence relation targets when broad hits fill the source budget", () => {
        const searchRecord = {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/orders.csv",
                    resource: "asset://asset-1/raw/sources/orders.csv",
                    relations: [
                        {
                            targetPath: "raw/sources/accounts.csv",
                            confidence: "declared",
                        },
                    ],
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/accounts.csv",
                    resource: "asset://asset-1/raw/sources/accounts.csv",
                },
            ],
        };
        const hits = Array.from({ length: 6 }, (_, index) => ({
            kind: "source",
            assetId: "asset-1",
            path: index === 0 ? "raw/sources/orders.csv" : `raw/sources/hit-${index}.md`,
            snippet: `broad result ${index}`,
        }));

        const plan = planKnowledgeGroundingSources(hits, "compare all related records", searchRecord, 3);

        expect(plan.sources.map((source) => source.path)).toContain("raw/sources/accounts.csv");
        expect(plan.sources).toHaveLength(3);
    });

    it("closes generic multi-table evidence from an identifier embedded in related record ids", () => {
        const searchRecord = {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/events.csv",
                    recordIds: ["EVT-42"],
                    resource: "asset://asset-1/raw/sources/events.csv",
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/constraints.csv",
                    recordIds: ["BLOCK-EVT-42-1"],
                    resource: "asset://asset-1/raw/sources/constraints.csv",
                    relations: [
                        {
                            targetPath: "raw/sources/links.csv",
                            confidence: "declared",
                        },
                    ],
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/links.csv",
                    recordIds: ["LINK-7"],
                    resource: "asset://asset-1/raw/sources/links.csv",
                },
            ],
        };
        const broadHits = Array.from({ length: 8 }, (_, index) => ({
            kind: "source",
            assetId: "asset-1",
            path: index === 0 ? "raw/sources/events.csv" : `raw/sources/broad-${index}.md`,
            snippet: `broad result ${index}`,
        }));

        const plan = planKnowledgeGroundingSources(broadHits, "请核验 EVT-42 的约束和完整关联连接", searchRecord, 4);

        expect(plan.sources.map((source) => source.path)).toEqual(
            expect.arrayContaining(["raw/sources/events.csv", "raw/sources/constraints.csv", "raw/sources/links.csv"]),
        );
        expect(plan.diagnostics.some((item) => item.reasons.includes("catalog_related_identifier"))).toBe(true);
    });

    it("does not synthesize an unrelated catalog table without a hit, ID, term, or relation", () => {
        const plan = planKnowledgeGroundingSources(
            [{ kind: "source", assetId: "asset-1", path: "raw/sources/relevant.md", snippet: "renewal" }],
            "renewal policy",
            {
                tableSummaries: [
                    {
                        assetId: "asset-1",
                        path: "raw/sources/unrelated.csv",
                        title: "unrelated.csv",
                        columns: ["row_id"],
                        recordIds: ["ROW-1"],
                        resource: "asset://asset-1/raw/sources/unrelated.csv",
                    },
                ],
            },
        );
        expect(plan.sources.map((source) => source.path)).toEqual(["raw/sources/relevant.md"]);
    });

    it("detects generic inventory questions and extracts only positive bounded search facets", () => {
        expect(isKnowledgeCatalogInventoryQuery("请盘点各表的记录数和主键")).toBe(true);
        expect(isKnowledgeCatalogInventoryQuery("explain the evacuation route")).toBe(false);
        expect(isKnowledgeGlobalCatalogInventoryQuery("请盘点各表的记录数和主键")).toBe(true);
        expect(isKnowledgeGlobalCatalogInventoryQuery("请统计 status 为 open 的记录总数")).toBe(true);
        expect(isKnowledgeGlobalCatalogInventoryQuery("请统计 orders.csv 中 status 为 open 的记录总数")).toBe(false);
        expect(isKnowledgeGlobalCatalogInventoryQuery("请根据 orders.csv 盘点所有表的记录数")).toBe(true);
        expect(
            planKnowledgeRetrievalObligations("请统计 orders.csv 中 status 为 open 的记录总数").some(
                (obligation) => obligation.kind === "catalog_inventory",
            ),
        ).toBe(false);
        const facets = knowledgeQueryFacets(
            "找出所有等待区楼层、节点 ID、相关设备 ID，以及哪些场景包含辅助人员。请按四类关联，不要使用总表。",
        );
        expect(facets).toHaveLength(3);
        expect(facets.join(" ")).toContain("等待区楼层");
        expect(facets.join(" ")).toContain("相关设备 ID");
        expect(facets.join(" ")).toContain("哪些场景包含辅助人员");
        expect(facets.join(" ")).not.toContain("不要使用总表");
    });

    it("recognizes several independent questions and keeps a leading explain facet", () => {
        const query =
            "仅根据离线资料，说明为什么不能使用某类设备、为什么未知物质不能直接处置、专业人员到场后谁负责统一指挥。";
        expect(knowledgeQueryIntentCount(query)).toBe(3);
        const facets = knowledgeQueryFacets(query);
        expect(facets).toEqual([
            "为什么不能使用某类设备",
            "为什么未知物质不能直接处置",
            "专业人员到场后谁负责统一指挥",
        ]);
    });

    it("keeps punctuation inside quotes and brackets within its semantic facet", () => {
        const query = "用户问“候选 A、候选 B，哪个更合适？”当前条件未知。并且为何要复核（记录 A、记录 B）？";

        expect(knowledgeQueryIntentCount(query)).toBe(2);
        const facets = knowledgeQueryFacets(query);
        expect(facets).toHaveLength(2);
        expect(facets[0]).toContain("“候选 A、候选 B,哪个更合适?”");
        expect(facets[1]).toContain("(记录 A、记录 B)");
        expect(facets).not.toEqual(expect.arrayContaining(["候选 A", "候选 B", "记录 A", "记录 B"]));
    });

    it("creates exhaustive duties only for explicit complete collection retrieval", () => {
        for (const query of [
            "请完整列出全部记录",
            "请完整列出相关记录",
            "请列出 orders.csv 所有记录",
            "请检索全部相关文档",
            "请检索全部相关人员、设备和关联边",
            "list all records from orders.csv",
        ]) {
            expect(planKnowledgeRetrievalObligations(query)).toEqual(
                expect.arrayContaining([expect.objectContaining({ kind: "exhaustive_list" })]),
            );
        }

        for (const query of [
            "请对每一点给出依据",
            "请给出完整路线",
            "相关人员已经全部撤到集合点",
            "请列出 10 项事实",
            "请列出 10 条完整记录",
            "请列出最终状态表应有的字段",
            "请按分组分别给出完整路线",
            "读取 INV-42 的全部字段",
        ]) {
            expect(planKnowledgeRetrievalObligations(query).some((item) => item.kind === "exhaustive_list")).toBe(
                false,
            );
        }
    });

    it("reserves one source for each bounded search facet without increasing the source budget", () => {
        const hits = [
            { path: "raw/a.md", __knowledgeSearchGroups: [0], snippet: "broad primary" },
            { path: "raw/b.md", __knowledgeSearchGroups: [1], snippet: "first question" },
            { path: "raw/c.md", __knowledgeSearchGroups: [2], snippet: "second question" },
            { path: "raw/d.md", __knowledgeSearchGroups: [3], snippet: "third question" },
            ...Array.from({ length: 8 }, (_, index) => ({
                path: `raw/broad-${index}.md`,
                snippet: `high ranking broad result ${index}`,
            })),
        ];
        const plan = planKnowledgeGroundingSources(hits, "three independent questions", null, 4);
        expect(plan.sources.map((source) => source.path)).toEqual(
            expect.arrayContaining(["raw/a.md", "raw/b.md", "raw/c.md", "raw/d.md"]),
        );
        expect(plan.sources).toHaveLength(4);
    });

    it("reserves a uniquely named CSV hit inside the existing source budget", () => {
        const hits = [
            ...Array.from({ length: 6 }, (_, index) => ({
                kind: "source",
                assetId: "asset-1",
                path: `raw/sources/broad-${index}.csv`,
                title: `broad-${index}.csv`,
                snippet: `high-ranked result ${index}`,
            })),
            {
                kind: "source",
                assetId: "asset-1",
                path: "raw/sources/orders.csv",
                title: "orders.csv",
                snippet: "late exact filename hit",
            },
        ];
        const plan = planKnowledgeGroundingSources(hits, "请统计 orders.csv 中 status=open 的记录总数", null, 6);

        expect(plan.sources).toHaveLength(6);
        expect(plan.sources.map((source) => source.path)).toContain("raw/sources/orders.csv");
        expect(plan.diagnostics.find((item) => item.path.endsWith("orders.csv"))?.reasons).toContain("explicit_csv");
    });

    it("does not reserve ambiguous or suffix-only CSV hits", () => {
        const ambiguous = [
            { kind: "source", assetId: "asset-a", path: "raw/a/orders.csv", title: "orders.csv" },
            { kind: "source", assetId: "asset-b", path: "raw/b/orders.csv", title: "orders.csv" },
            { kind: "source", assetId: "asset-a", path: "raw/a/preorders.csv", title: "preorders.csv" },
        ];

        expect(
            planKnowledgeGroundingSources(ambiguous, "请统计 orders.csv 中记录总数", null, 3).diagnostics.every(
                (item) => !item.reasons.includes("explicit_csv"),
            ),
        ).toBe(true);
        expect(
            planKnowledgeGroundingSources(ambiguous.slice(2), "请统计 orders.csv 中记录总数", null, 1).diagnostics[0]
                ?.reasons,
        ).not.toContain("explicit_csv");
    });

    it("plans a deterministic aggregate from one explicitly named catalog table", () => {
        const plan = planKnowledgeStructuredGrounding("请统计 orders.csv 中 status 为 open 的记录总数", {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/orders.csv",
                    title: "orders.csv",
                    columns: ["order_id", "status", "amount"],
                    primaryKey: "order_id",
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/accounts.csv",
                    title: "accounts.csv",
                    columns: ["account_id", "status"],
                    primaryKey: "account_id",
                },
            ],
        });

        expect(plan).toEqual(
            expect.objectContaining({
                kind: "aggregate",
                confidence: "high",
                request: expect.objectContaining({
                    assetId: "asset-1",
                    from: "raw/sources/orders.csv",
                    filters: [{ column: "status", op: "eq", value: "open" }],
                    aggregates: [{ op: "count", as: "countResult" }],
                    limit: 25,
                }),
            }),
        );
        expect(isKnowledgeStructuredPlanSoleObligation("请统计 orders.csv 中 status 为 open 的记录总数", plan!)).toBe(
            true,
        );
    });

    it("never treats an unconsumed structured or prose action as the sole obligation", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/orders.csv",
                    title: "orders.csv",
                    columns: ["order_id", "status", "amount"],
                    primaryKey: "order_id",
                },
            ],
        };
        for (const query of [
            "请统计 orders.csv 中 status 为 open 的记录总数并写诗",
            "请统计 orders.csv 中 status 为 open 的记录总数然后写一首诗",
            "请统计 orders.csv 中 status 为 open 的记录总数并翻译成英文",
            "请统计 orders.csv 中 status 为 open 的记录总数并总结结果",
            "请统计 orders.csv 中 status 为 open 的记录总数并结合其他文件",
            "请统计 orders.csv 中 status 为 open 的记录总数并核对其他文件",
            "请统计 orders.csv 中 status 为 open 的记录总数并列出订单号",
            "请统计 orders.csv 中 status 为 open 的记录总数并分析趋势",
            "请统计 orders.csv 中 status 为 open 的记录总数并评估风险",
            "请统计 orders.csv 中 status 为 open 的记录总数及每一条记录",
            "请统计 orders.csv 中 status 为 open 的记录总数且给出记录",
            "请统计 orders.csv 中 status 为 open 的记录总数且返回记录",
        ]) {
            const plan = planKnowledgeStructuredGrounding(query, catalog);
            expect(plan).not.toBeNull();
            expect(isKnowledgeStructuredPlanSoleObligation(query, plan!)).toBe(false);
        }
        expect(
            planKnowledgeStructuredGrounding(
                "请统计 orders.csv 中 status 为 open 的记录总数并给出最大 amount",
                catalog,
            ),
        ).toBeNull();

        for (const value of ["分析", "翻译", "建议"]) {
            const query = `请统计 orders.csv 中 status 为 ${value} 的记录总数且${value}`;
            const plan = planKnowledgeStructuredGrounding(query, catalog);
            expect(plan).not.toBeNull();
            expect(isKnowledgeStructuredPlanSoleObligation(query, plan!)).toBe(false);
        }
    });

    it("resolves adjacent and full-path CSV references without suffix or asset ambiguity", () => {
        const tables = [
            {
                assetId: "asset-1",
                path: "raw/sources/orders.csv",
                title: "orders.csv",
                columns: ["id", "status"],
            },
            {
                assetId: "asset-1",
                path: "raw/sources/preorders.csv",
                title: "preorders.csv",
                columns: ["id", "status"],
            },
        ];
        expect(
            planKnowledgeStructuredGrounding("请统计 orders.csv中 status=open 的记录总数", { tableSummaries: tables })
                ?.request.from,
        ).toBe("raw/sources/orders.csv");
        expect(
            planKnowledgeStructuredGrounding("请统计 preorders.csv中 status=open 的记录总数", {
                tableSummaries: tables,
            })?.request.from,
        ).toBe("raw/sources/preorders.csv");
        expect(
            planKnowledgeStructuredGrounding("请统计 missing.csv中 status=open 的记录总数", { tableSummaries: tables }),
        ).toBeNull();

        const duplicateBasenames = {
            tableSummaries: [
                { assetId: "asset-1", path: "raw/a/orders.csv", title: "orders.csv", columns: ["id"] },
                { assetId: "asset-1", path: "raw/b/orders.csv", title: "orders.csv", columns: ["id"] },
            ],
        };
        expect(planKnowledgeStructuredGrounding("请列出 orders.csv 全部记录", duplicateBasenames)).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请列出 raw/b/orders.csv中所有记录", duplicateBasenames)?.request.from,
        ).toBe("raw/b/orders.csv");

        expect(
            planKnowledgeStructuredGrounding("请统计 orders.csv中 id=1 的记录总数", {
                tableSummaries: [{ assetId: "asset-a", path: "raw/orders.csv", title: "orders.csv", columns: ["id"] }],
                hits: [
                    { assetId: "asset-a", path: "raw/orders.csv", title: "orders.csv" },
                    { assetId: "asset-b", path: "raw/orders.csv", title: "orders.csv" },
                ],
            }),
        ).toBeNull();
    });

    it("preserves every safe AND filter and fails closed on partial, OR, and negative predicates", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/orders.csv",
                    title: "orders.csv",
                    columns: ["order_id", "status", "amount"],
                    primaryKey: "order_id",
                },
            ],
        };
        expect(
            planKnowledgeStructuredGrounding("请统计 orders.csv 中 status=open 且 amount>100 的记录总数", catalog)
                ?.request.filters,
        ).toEqual([
            { column: "status", op: "eq", value: "open" },
            { column: "amount", op: "gt", value: 100 },
        ]);
        expect(
            planKnowledgeStructuredGrounding(
                "请统计 orders.csv 中 status 为 open，并且 amount 大于 100 的记录总数",
                catalog,
            )?.request.filters,
        ).toEqual([
            { column: "status", op: "eq", value: "open" },
            { column: "amount", op: "gt", value: 100 },
        ]);
        expect(
            planKnowledgeStructuredGrounding('请统计 orders.csv 中 status 为 "in progress" 的记录总数', catalog)
                ?.request.filters,
        ).toEqual([{ column: "status", op: "eq", value: "in progress" }]);
        expect(
            planKnowledgeStructuredGrounding("请统计 orders.csv 中 status 为 in progress 的记录总数", catalog),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请列出 orders.csv 中 amount>=100 且 amount<=200 的所有记录", catalog)
                ?.request.filters,
        ).toEqual([
            { column: "amount", op: "gte", value: 100 },
            { column: "amount", op: "lte", value: 200 },
        ]);
        expect(
            planKnowledgeStructuredGrounding(
                "请统计 orders.csv 中 status=open 且 unknown_column=x 的记录总数",
                catalog,
            ),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请统计 orders.csv 中 status=open 且 amount> 的记录总数", catalog),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请列出 orders.csv 中 status=open 或者 amount>100 的所有记录", catalog),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请列出 orders.csv 中 status 不等于 closed 的所有记录", catalog),
        ).toBeNull();
    });

    it("uses only schema-declared joins and requires both tables to be explicit", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/orders.csv",
                    title: "orders.csv",
                    columns: ["order_id", "account_id"],
                    primaryKey: "order_id",
                    relations: [
                        {
                            sourceColumn: "account_id",
                            targetPath: "raw/sources/accounts.csv",
                            targetColumn: "account_id",
                            confidence: "declared",
                        },
                    ],
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/accounts.csv",
                    title: "accounts.csv",
                    columns: ["account_id", "name"],
                    primaryKey: "account_id",
                },
            ],
        };

        expect(
            planKnowledgeStructuredGrounding("请联表列出 orders.csv 与 accounts.csv 的 account_id 和 name", catalog),
        ).toEqual(
            expect.objectContaining({
                kind: "join",
                request: expect.objectContaining({
                    from: "raw/sources/orders.csv",
                    select: expect.arrayContaining(["order_id", "account_id", "accounts.account_id", "accounts.name"]),
                    joins: [
                        {
                            sourceColumn: "account_id",
                            targetPath: "raw/sources/accounts.csv",
                            targetColumn: "account_id",
                            type: "inner",
                        },
                    ],
                }),
            }),
        );
        expect(planKnowledgeStructuredGrounding("请关联列出 orders.csv 的记录", catalog)).toBeNull();
    });

    it("binds joins by asset and path and safely applies qualified target filters", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-a",
                    path: "raw/sources/orders.csv",
                    title: "orders.csv",
                    columns: ["order_id", "account_id", "status"],
                    primaryKey: "order_id",
                    relations: [
                        {
                            sourceColumn: "account_id",
                            targetPath: "raw/sources/accounts.csv",
                            targetColumn: "account_id",
                            confidence: "declared",
                        },
                    ],
                },
                {
                    assetId: "asset-a",
                    path: "raw/sources/accounts.csv",
                    title: "accounts.csv",
                    columns: ["account_id", "status", "tier"],
                    primaryKey: "account_id",
                },
            ],
        };
        const plan = planKnowledgeStructuredGrounding(
            "请联表列出 orders.csv 与 accounts.csv，orders.status=open 且 accounts.tier=gold 的所有记录",
            catalog,
        );
        expect(plan?.request).toEqual(
            expect.objectContaining({
                assetId: "asset-a",
                from: "raw/sources/orders.csv",
                joins: [
                    {
                        sourceColumn: "account_id",
                        targetPath: "raw/sources/accounts.csv",
                        targetColumn: "account_id",
                        type: "inner",
                    },
                ],
                filters: [
                    { column: "status", op: "eq", value: "open" },
                    { column: "accounts.tier", op: "eq", value: "gold" },
                ],
            }),
        );
        expect(
            planKnowledgeStructuredGrounding("请联表列出 orders.csv 与 accounts.csv 中 name 为 Ada 的所有记录", {
                tableSummaries: [
                    {
                        ...catalog.tableSummaries[0],
                        columns: ["order_id", "account_id", "status"],
                    },
                    {
                        ...catalog.tableSummaries[1],
                        columns: ["account_id", "status", "tier", "name"],
                    },
                ],
            })?.request.filters,
        ).toEqual([{ column: "accounts.name", op: "eq", value: "Ada" }]);
        expect(
            planKnowledgeStructuredGrounding(
                "请联表列出 orders.csv 与 accounts.csv 中 status=open 的所有记录",
                catalog,
            ),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding(
                "请联表列出 orders.csv 与 accounts.csv 中 accounts.unknown=x 的所有记录",
                catalog,
            ),
        ).toBeNull();

        expect(
            planKnowledgeStructuredGrounding("请联表列出 orders.csv 与 accounts.csv 的所有记录", {
                tableSummaries: [
                    catalog.tableSummaries[0],
                    {
                        assetId: "asset-b",
                        path: "raw/sources/accounts.csv",
                        title: "accounts.csv",
                        columns: ["account_id", "status", "tier"],
                        primaryKey: "account_id",
                    },
                ],
            }),
        ).toBeNull();
    });

    it("marks only aggregates or catalog-proven small projections exhaustive", () => {
        const aggregate = planKnowledgeStructuredGrounding("请统计 small.csv中记录总数", {
            tableSummaries: [{ assetId: "asset-1", path: "small.csv", columns: ["id"], recordCount: 100 }],
        });
        expect(aggregate).toMatchObject({ exhaustive: false, exhaustiveWithinKnownBounds: false });
        const bounded = planKnowledgeStructuredGrounding("请列出 small.csv 中 10 条记录", {
            tableSummaries: [{ assetId: "asset-1", path: "small.csv", columns: ["id"], recordCount: 100 }],
        });
        expect(bounded).toMatchObject({ exhaustive: false, completion: "single_result" });
        const small = planKnowledgeStructuredGrounding("请列出 small.csv 所有记录", {
            tableSummaries: [{ assetId: "asset-1", path: "small.csv", columns: ["id", "name"], recordCount: 25 }],
        });
        expect(small).toMatchObject({ exhaustive: true, exhaustiveWithinKnownBounds: true });
        const unknown = planKnowledgeStructuredGrounding("请列出 unknown.csv 所有记录", {
            tableSummaries: [{ assetId: "asset-1", path: "unknown.csv", columns: ["id"] }],
        });
        expect(unknown).toMatchObject({ exhaustive: true, exhaustiveWithinKnownBounds: false });
    });

    it("fails closed for ambiguous tables, inferred joins, and ordinary prose lookups", () => {
        const sharedCatalog = {
            tableSummaries: [
                {
                    path: "raw/sources/a.csv",
                    title: "a.csv",
                    aliases: ["订单"],
                    columns: ["id", "status"],
                },
                {
                    path: "raw/sources/b.csv",
                    title: "b.csv",
                    aliases: ["订单"],
                    columns: ["id", "status"],
                },
            ],
        };
        expect(planKnowledgeStructuredGrounding("请列出订单 status 为 open 的全部记录", sharedCatalog)).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请说明 orders.csv 的状态含义", {
                tableSummaries: [
                    {
                        path: "raw/sources/orders.csv",
                        title: "orders.csv",
                        columns: ["order_id", "status"],
                    },
                ],
            }),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请统计 missing.csv 中 status 为 open 的记录总数", sharedCatalog),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请统计 orders.csv 中 status 为 open 的记录总数", {
                tableSummaries: [
                    {
                        assetId: "asset-a",
                        path: "raw/sources/orders.csv",
                        title: "orders.csv",
                        columns: ["id", "status"],
                    },
                    {
                        assetId: "asset-b",
                        path: "raw/sources/orders.csv",
                        title: "orders.csv",
                        columns: ["id", "status"],
                    },
                ],
            }),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请统计 missing.csv 中 status 为 open 的记录总数", sharedCatalog),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请统计 orders.csv 中 status 为 open 的记录总数", {
                tableSummaries: [
                    {
                        assetId: "asset-a",
                        path: "raw/sources/orders.csv",
                        title: "orders.csv",
                        columns: ["id", "status"],
                    },
                    {
                        assetId: "asset-b",
                        path: "raw/sources/orders.csv",
                        title: "orders.csv",
                        columns: ["id", "status"],
                    },
                ],
            }),
        ).toBeNull();
        expect(
            planKnowledgeStructuredGrounding("请联表列出 orders.csv 与 accounts.csv", {
                tableSummaries: [
                    {
                        path: "raw/sources/orders.csv",
                        title: "orders.csv",
                        columns: ["order_id", "account_id"],
                        relations: [
                            {
                                sourceColumn: "account_id",
                                targetPath: "raw/sources/accounts.csv",
                                targetColumn: "account_id",
                                confidence: "high",
                            },
                        ],
                    },
                    {
                        path: "raw/sources/accounts.csv",
                        title: "accounts.csv",
                        columns: ["account_id"],
                    },
                ],
            }),
        ).toBeNull();
    });

    it("keeps output constraints out of retrieval facets and completeness", () => {
        const query =
            "请只回答 E-F10-ES2 在 S04 中的覆盖状态。答案控制在 120 字以内，提供可打开来源，不要展示工具过程。";
        expect(knowledgeRetrievalIntentText(query)).toBe("请只回答 E-F10-ES2 在 S04 中的覆盖状态");
        expect(genericKnowledgeIdentifierCandidates(query)).toEqual(["E-F10-ES2", "S04"]);
        expect(knowledgeQueryFacets(query).join(" ")).not.toMatch(/120|来源|工具/u);

        const aggregateQuery = "请统计 orders.csv 中 status=open 的记录总数。答案控制在 80 字以内，提供可打开来源。";
        const plan = planKnowledgeStructuredGrounding(aggregateQuery, {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/orders.csv",
                    columns: ["order_id", "status"],
                    primaryKey: "order_id",
                },
            ],
        });
        expect(plan).not.toBeNull();
        expect(isKnowledgeStructuredPlanSoleObligation(aggregateQuery, plan!)).toBe(true);
    });

    it("drops only standalone English personal-knowledge source constraints", () => {
        for (const constraint of [
            "Use only my personal knowledge base",
            "Rely only on the personal knowledge base",
            "Answer only using personal knowledge base",
            "Please answer based on only my personal knowledge base",
        ]) {
            const query = `Find ITEM-42 status. ${constraint}.`;
            expect(knowledgeRetrievalIntentText(query)).toBe("Find ITEM-42 status.");
            expect(knowledgeQueryFacets(query)).toEqual(["Find ITEM-42 status."]);
            expect(
                planKnowledgeRetrievalObligations(query).filter((obligation) => obligation.kind === "semantic_facet"),
            ).toEqual([expect.objectContaining({ id: "semantic:1", query: "Find ITEM-42 status." })]);
        }

        expect(knowledgeRetrievalIntentText("Use only my personal knowledge base.")).toBe("");
        expect(knowledgeQueryFacets("Use only my personal knowledge base.")).toEqual([]);
        expect(
            planKnowledgeRetrievalObligations("Use only my personal knowledge base.").some(
                (obligation) => obligation.kind === "semantic_facet",
            ),
        ).toBe(false);

        const inlineConstraint = "Find ITEM-42 using only my personal knowledge base";
        expect(knowledgeRetrievalIntentText(inlineConstraint)).toBe(inlineConstraint);
        expect(knowledgeQueryFacets(inlineConstraint)).toEqual([inlineConstraint]);

        const connectedConstraint = "Read ITEM-42 and rely only on my personal knowledge base";
        expect(knowledgeRetrievalIntentText(connectedConstraint)).toBe(connectedConstraint);
        expect(knowledgeQueryFacets(connectedConstraint)).toEqual(["Read ITEM-42"]);

        const mixedFacts = "What is ITEM-42? Answer only using my personal knowledge base and include its status";
        expect(knowledgeRetrievalIntentText(mixedFacts)).toBe(mixedFacts.replace("? ", "。"));
        expect(knowledgeQueryFacets(mixedFacts)).toEqual(["What is ITEM-42", "include its status"]);
        for (const mixed of [inlineConstraint, connectedConstraint, mixedFacts]) {
            expect(genericKnowledgeIdentifierCandidates(mixed)).toContain("ITEM-42");
        }
    });

    it("does not let compound citation instructions or purpose frames evict substantive facets", () => {
        const query =
            "为了便于后续审核，请说明为什么候选 A 不可用、如何处理候选 B、由谁确认候选 C。每一点给出具体离线文件和来源 ID。";

        expect(knowledgeRetrievalIntentText(query)).not.toMatch(/文件|来源\s*ID/u);
        expect(knowledgeQueryFacets(query)).toEqual(["为什么候选 A 不可用", "如何处理候选 B", "由谁确认候选 C"]);
    });

    it("does not spend a semantic facet on a mandatory qualified citation-only clause", () => {
        const query =
            "强制复核连续历史中的路线与限制状态。请只使用我的个人知识库，重新评估从 HNODE-A 到 HNODE-D 的当前路线状态，复核哪些结论改变或仍保持不变；必须保留限制状态的稳定记录 ID 和精确来源。";

        expect(knowledgeRetrievalIntentText(query)).not.toMatch(/稳定记录\s*ID|精确来源/u);
        expect(knowledgeQueryFacets(query, 4)).toEqual([
            "强制复核连续历史中的路线与限制状态",
            "重新评估从 HNODE-A 到 HNODE-D 的当前路线状态",
            "复核哪些结论改变或仍保持不变",
        ]);
        expect(
            planKnowledgeRetrievalObligations(query)
                .filter((obligation) => obligation.kind === "semantic_facet")
                .map((obligation) => obligation.query),
        ).toEqual([
            "强制复核连续历史中的路线与限制状态",
            "重新评估从 HNODE-A 到 HNODE-D 的当前路线状态",
            "复核哪些结论改变或仍保持不变",
        ]);

        for (const citationOnly of [
            "务必附上上述结论的对应记录编号与可定位来源",
            "请显示当前状态的稳定记录 ID 和对应来源",
            "Please retain the stable record ID and exact source.",
            "若无",
            "也要给出检查清单及逐项结论",
            "If none are found",
            "provide a checklist and item-by-item conclusions",
        ]) {
            expect(knowledgeRetrievalIntentText(citationOnly)).toBe("");
            expect(knowledgeQueryFacets(citationOnly)).toEqual([]);
            expect(isKnowledgeOutputOnlyClause(citationOnly)).toBe(true);
        }
        expect(knowledgeRetrievalIntentText("若无，也要给出检查清单及逐项结论")).toBe("");
        for (const factualConditional of [
            "若无，也要核对当前税率",
            "若无，也要核对新导入数据",
            "设备检查清单中的当前状态",
        ]) {
            expect(knowledgeRetrievalIntentText(factualConditional)).not.toBe("");
            expect(isKnowledgeOutputOnlyClause(factualConditional)).toBe(false);
        }
        expect(isKnowledgeOutputOnlyClause("必须说明限制状态，并保留稳定记录 ID 和精确来源")).toBe(false);

        const mixedFact = "必须说明限制状态，并保留稳定记录 ID 和精确来源";
        expect(knowledgeRetrievalIntentText(mixedFact)).toContain("限制状态");
        const mixedEnglishFact = "Must explain the current status and cite the source";
        expect(knowledgeRetrievalIntentText(mixedEnglishFact)).toBe(mixedEnglishFact);

        for (const scope of [
            "全部记录",
            "所有文件",
            "全量来源",
            "穷尽结果",
            "每一条记录",
            "每条记录",
            "每个对象",
            "每份文件",
            "每行数据",
            "逐条记录",
            "逐一记录",
            "逐项记录",
            "各项记录",
        ]) {
            const exhaustiveOrRetrieval = `必须提供${scope}的来源`;
            expect(knowledgeRetrievalIntentText(exhaustiveOrRetrieval)).toBe(exhaustiveOrRetrieval);
            expect(knowledgeQueryFacets(exhaustiveOrRetrieval)).not.toEqual([]);
        }
        for (const action of [
            "列出",
            "列举",
            "枚举",
            "查找",
            "找出",
            "检索",
            "搜索",
            "查询",
            "读取",
            "返回",
            "展示",
            "核对",
            "检查",
            "验证",
        ]) {
            const exhaustiveOrRetrieval = `务必附上${action}结果的引用`;
            expect(knowledgeRetrievalIntentText(exhaustiveOrRetrieval)).toBe(exhaustiveOrRetrieval);
            expect(knowledgeQueryFacets(exhaustiveOrRetrieval)).not.toEqual([]);
        }
        for (const exhaustiveOrRetrieval of ["Show every source", "Must display each record ID"]) {
            expect(knowledgeRetrievalIntentText(exhaustiveOrRetrieval)).toBe(exhaustiveOrRetrieval);
            expect(knowledgeQueryFacets(exhaustiveOrRetrieval)).not.toEqual([]);
        }
    });

    it("classifies generic decision and action requests without treating plain facts as actions", () => {
        for (const query of ["如何处理 ITEM-42", "ITEM-42 接下来应当采取什么行动", "show the status of ITEM-42"]) {
            expect(isKnowledgeDecisionOrActionRequest(query)).toBe(true);
        }
        expect(isKnowledgeDecisionOrActionRequest("读取 ITEM-42 的名称")).toBe(false);
    });

    it("binds route topology to schema-proven edge and node sources", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/entities.csv",
                    columns: ["entity_id", "case_id", "location_id"],
                    primaryKey: "entity_id",
                    recordIds: ["ENTITY-42"],
                    resource: "asset://asset-map/data/entities.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/links.csv",
                    columns: ["link_id", "from_location", "to_location", "bidirectional", "status"],
                    primaryKey: "link_id",
                    resource: "asset://asset-map/data/links.csv",
                    relations: [
                        {
                            sourceColumn: "from_location",
                            targetPath: "data/locations.csv",
                            targetColumn: "location_id",
                            confidence: "declared",
                        },
                        {
                            sourceColumn: "to_location",
                            targetPath: "data/locations.csv",
                            targetColumn: "location_id",
                            confidence: "declared",
                        },
                    ],
                },
                {
                    assetId: "asset-map",
                    path: "data/overrides.csv",
                    columns: ["case_id", "link_id", "status"],
                    primaryKey: "case_id",
                    resource: "asset://asset-map/data/overrides.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/locations.csv",
                    columns: ["location_id", "label", "type"],
                    primaryKey: "location_id",
                    resource: "asset://asset-map/data/locations.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/intervals.csv",
                    columns: ["interval_id", "start_time", "end_time", "start", "end"],
                    primaryKey: "interval_id",
                    resource: "asset://asset-map/data/intervals.csv",
                },
            ],
        };

        expect(isKnowledgeRouteOrTopologyRequest("How should ENTITY-42 travel to a destination?")).toBe(true);
        expect(isKnowledgeRouteOrTopologyRequest("Which path connects NODE-A to NODE-B?")).toBe(true);
        expect(isKnowledgeRouteOrTopologyRequest("There is no node at LOCATION-99; is it reachable?")).toBe(true);
        expect(isKnowledgeRouteOrTopologyRequest("读取 ENTITY-42 的名称")).toBe(false);

        const obligations = planKnowledgeRetrievalObligations(
            "How should ENTITY-42 travel to a destination?",
            catalog,
        ).filter((obligation) => obligation.kind === "route_topology");
        expect(obligations).toEqual([
            expect.objectContaining({
                sourcePaths: ["data/links.csv"],
                sourceKeys: ["asset-map:data/links.csv"],
                completion: "all_sources_verified",
            }),
            expect.objectContaining({
                sourcePaths: ["data/locations.csv"],
                sourceKeys: ["asset-map:data/locations.csv"],
                completion: "all_sources_verified",
            }),
        ]);
        expect(obligations.some((obligation) => obligation.sourcePaths.includes("data/intervals.csv"))).toBe(false);

        const planned = planKnowledgeGroundingSources(
            [{ assetId: "asset-map", path: "notes/guide.md", snippet: "general guidance" }],
            "How should ENTITY-42 travel to a destination?",
            catalog,
            4,
        );
        expect(planned.sources.map((source) => source.path)).toEqual(
            expect.arrayContaining(["data/links.csv", "data/locations.csv"]),
        );
        expect(planned.diagnostics.filter((item) => item.reasons.includes("route_topology"))).toHaveLength(2);
    });

    it("requires a route override table through a catalog-proven exact identifier filter", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/cases.csv",
                    columns: ["case_id", "label"],
                    primaryKey: "case_id",
                    recordIds: ["CASE-7"],
                    resource: "asset://asset-map/data/cases.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/links.csv",
                    columns: ["link_id", "from_location", "to_location", "base_status"],
                    primaryKey: "link_id",
                    resource: "asset://asset-map/data/links.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/overrides.csv",
                    columns: ["override_id", "case_id", "link_id", "status"],
                    primaryKey: "override_id",
                    resource: "asset://asset-map/data/overrides.csv",
                    relations: [
                        {
                            sourceColumn: "case_id",
                            targetPath: "data/cases.csv",
                            targetColumn: "case_id",
                            confidence: "high",
                        },
                        {
                            sourceColumn: "link_id",
                            targetPath: "data/links.csv",
                            targetColumn: "link_id",
                            confidence: "high",
                        },
                    ],
                },
            ],
        };

        const obligations = planKnowledgeRetrievalObligations("Plan a route for CASE-7", catalog);
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "foreign-key:asset-map:data/overrides.csv",
                    kind: "foreign_key_filter",
                    completion: "all_sources_verified",
                    sourceKeys: ["asset-map:data/overrides.csv"],
                    filters: [
                        expect.objectContaining({
                            column: "case_id",
                            value: "CASE-7",
                            confidence: "high",
                        }),
                    ],
                }),
            ]),
        );

        const planned = planKnowledgeGroundingSources([], "Plan a route for CASE-7", catalog, 4);
        expect(planned.sources).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ assetId: "asset-map", path: "data/overrides.csv" }),
                expect.objectContaining({ assetId: "asset-map", path: "data/links.csv" }),
            ]),
        );
    });

    it("binds natural-language route state to its overlay and scope descriptor without guessing a scope id", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/cases.csv",
                    columns: ["case_id", "label", "origin_location"],
                    primaryKey: "case_id",
                    resource: "asset://asset-map/data/cases.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/links.csv",
                    columns: ["link_id", "from_location", "to_location", "base_status"],
                    primaryKey: "link_id",
                    resource: "asset://asset-map/data/links.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/overrides.csv",
                    columns: ["override_id", "case_id", "link_id", "state"],
                    primaryKey: "override_id",
                    resource: "asset://asset-map/data/overrides.csv",
                    relations: [
                        {
                            sourceColumn: "case_id",
                            targetPath: "data/cases.csv",
                            targetColumn: "case_id",
                            confidence: "declared",
                        },
                        {
                            sourceColumn: "link_id",
                            targetPath: "data/links.csv",
                            targetColumn: "link_id",
                            confidence: "high",
                        },
                    ],
                },
                {
                    assetId: "asset-map",
                    path: "data/locations.csv",
                    columns: ["location_id", "label", "type"],
                    primaryKey: "location_id",
                    resource: "asset://asset-map/data/locations.csv",
                },
            ],
        };

        const obligations = planKnowledgeRetrievalObligations(
            "When the north hall alarm occurs, what is the safe route from NODE-A?",
            catalog,
        );
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "route-state-overlay:asset-map:data/overrides.csv",
                    kind: "route_topology",
                    sourceKeys: ["asset-map:data/overrides.csv"],
                    routeScope: expect.objectContaining({
                        role: "state_overlay",
                        requiresUniqueResolution: true,
                        bindings: [
                            expect.objectContaining({
                                overlayScopeColumn: "case_id",
                                ownerSourceKey: "asset-map:data/cases.csv",
                                ownerPrimaryKey: "case_id",
                            }),
                        ],
                    }),
                    completion: "all_sources_verified",
                }),
                expect.objectContaining({
                    id: expect.stringContaining("route-scope-owner:asset-map:data/overrides.csv:case_id"),
                    kind: "route_topology",
                    sourceKeys: ["asset-map:data/cases.csv"],
                    routeScope: expect.objectContaining({
                        role: "descriptor_owner",
                        requiresUniqueResolution: true,
                    }),
                    completion: "all_sources_verified",
                }),
            ]),
        );

        const planned = planKnowledgeGroundingSources(
            [],
            "When the north hall alarm occurs, what is the safe route from NODE-A?",
            catalog,
            8,
        );
        expect(planned.sources).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ assetId: "asset-map", path: "data/links.csv" }),
                expect.objectContaining({ assetId: "asset-map", path: "data/overrides.csv" }),
                expect.objectContaining({ assetId: "asset-map", path: "data/cases.csv" }),
            ]),
        );
    });

    it("skips scoped overlays for base topology but derives scope through an exact entity relation", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/cases.csv",
                    columns: ["case_id", "label"],
                    primaryKey: "case_id",
                    recordIds: ["CASE-7"],
                    resource: "asset://asset-map/data/cases.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/entities.csv",
                    columns: ["entity_id", "case_id", "location_id"],
                    primaryKey: "entity_id",
                    recordIds: ["ENTITY-42"],
                    resource: "asset://asset-map/data/entities.csv",
                    relations: [
                        {
                            sourceColumn: "case_id",
                            targetPath: "data/cases.csv",
                            targetColumn: "case_id",
                            confidence: "high",
                        },
                    ],
                },
                {
                    assetId: "asset-map",
                    path: "data/links.csv",
                    columns: ["link_id", "from_location", "to_location", "base_status"],
                    primaryKey: "link_id",
                    resource: "asset://asset-map/data/links.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/locations.csv",
                    columns: ["location_id", "label", "type"],
                    primaryKey: "location_id",
                    resource: "asset://asset-map/data/locations.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/overrides.csv",
                    columns: ["override_id", "case_id", "link_id", "state"],
                    primaryKey: "override_id",
                    resource: "asset://asset-map/data/overrides.csv",
                    relations: [
                        {
                            sourceColumn: "case_id",
                            targetPath: "data/cases.csv",
                            targetColumn: "case_id",
                            confidence: "declared",
                        },
                        {
                            sourceColumn: "link_id",
                            targetPath: "data/links.csv",
                            targetColumn: "link_id",
                            confidence: "declared",
                        },
                    ],
                },
            ],
        };
        const base = planKnowledgeRetrievalObligations("Is LOCATION-99 reachable by any route?", catalog);
        expect(base.some((obligation) => obligation.id.startsWith("route-state-overlay:"))).toBe(false);
        expect(base.some((obligation) => obligation.id.startsWith("route-scope-owner:"))).toBe(false);

        const derived = planKnowledgeRetrievalObligations("Which route should ENTITY-42 take?", catalog);
        expect(derived).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "route-state-overlay:asset-map:data/overrides.csv",
                    routeScope: expect.objectContaining({
                        role: "state_overlay",
                        requiresUniqueResolution: true,
                        bindings: [
                            expect.objectContaining({
                                overlayScopeColumn: "case_id",
                                ownerPrimaryKey: "case_id",
                                selectors: [
                                    expect.objectContaining({
                                        sourceKey: "asset-map:data/entities.csv",
                                        primaryKey: "entity_id",
                                        scopeColumn: "case_id",
                                        identifier: "ENTITY-42",
                                    }),
                                ],
                            }),
                        ],
                    }),
                }),
                expect.objectContaining({
                    id: expect.stringContaining("route-scope-owner:"),
                    sourceKeys: ["asset-map:data/cases.csv"],
                }),
            ]),
        );
    });

    it("creates a source-bound full-read duty for explicitly requested route support resources", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/links.csv",
                    columns: ["link_id", "from_location", "to_location"],
                    primaryKey: "link_id",
                    resource: "asset://asset-map/data/links.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/locations.csv",
                    columns: ["location_id", "label", "type"],
                    primaryKey: "location_id",
                    resource: "asset://asset-map/data/locations.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/resources.csv",
                    columns: ["resource_id", "location_id", "resource_type"],
                    primaryKey: "resource_id",
                    resource: "asset://asset-map/data/resources.csv",
                    relations: [
                        {
                            sourceColumn: "location_id",
                            targetPath: "data/locations.csv",
                            targetColumn: "location_id",
                            confidence: "declared",
                        },
                    ],
                },
            ],
        };
        const query = "Which route reaches the destination, and which equipment or resource is available there?";
        const obligations = planKnowledgeRetrievalObligations(query, catalog);
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "route-support:asset-map:data/resources.csv",
                    kind: "route_support",
                    sourceKeys: ["asset-map:data/resources.csv"],
                    identifiers: [],
                    completion: "all_sources_verified",
                }),
            ]),
        );
        expect(planKnowledgeGroundingSources([], query, catalog, 8).sources).toEqual(
            expect.arrayContaining([expect.objectContaining({ assetId: "asset-map", path: "data/resources.csv" })]),
        );

        const unresolved = planKnowledgeRetrievalObligations("Which tools are on the safe route?", {
            tableSummaries: catalog.tableSummaries.filter((summary) => summary.path !== "data/resources.csv"),
        });
        expect(unresolved).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "route-support:unresolved",
                    kind: "route_support",
                    sourcePaths: [],
                }),
            ]),
        );
    });

    it("represents independent graph/support overflow with an unclosable typed sentinel", () => {
        const supportTables = Array.from({ length: 17 }, (_, index) => ({
            assetId: "asset-map",
            path: `data/resources-${String(index + 1).padStart(2, "0")}.csv`,
            columns: ["resource_id", "location_id", "resource_type"],
            primaryKey: "resource_id",
            resource: `asset://asset-map/data/resources-${String(index + 1).padStart(2, "0")}.csv`,
            relations: [
                {
                    sourceColumn: "location_id",
                    targetPath: "data/locations.csv",
                    targetColumn: "location_id",
                    confidence: "declared",
                },
            ],
        }));
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/links.csv",
                    columns: ["link_id", "from_location", "to_location"],
                    primaryKey: "link_id",
                    resource: "asset://asset-map/data/links.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/locations.csv",
                    columns: ["location_id", "label"],
                    primaryKey: "location_id",
                    resource: "asset://asset-map/data/locations.csv",
                },
                ...supportTables,
            ],
        };
        const query = "Which route reaches the destination, and which equipment or resource is available there?";
        const obligations = planKnowledgeRetrievalObligations(query, catalog);
        const overflow = obligations.find((obligation) => obligation.id.startsWith("obligation-overflow:"));

        expect(obligations).toHaveLength(16);
        expect(overflow).toMatchObject({
            id: expect.stringContaining("route_support"),
            kind: "route_support",
            sourcePaths: [],
            sourceKeys: [],
            identifiers: [],
            completion: "all_sources_verified",
        });
        if (!overflow) throw new Error("expected overflow sentinel");
        const retainedSupportPaths = obligations
            .filter((obligation) => obligation.id.startsWith("route-support:asset-map:data/resources-"))
            .flatMap((obligation) => obligation.sourcePaths);
        expect(retainedSupportPaths.length).toBeGreaterThan(0);
        expect(retainedSupportPaths.length).toBeLessThan(supportTables.length);

        // An unrelated readable hit in the same search group must not close the
        // deliberately unbound sentinel. The aggregate therefore remains
        // partial instead of silently claiming that all graph duties ran.
        const coverage = finalizeKnowledgeCoverage(
            {
                version: 1,
                query,
                mode: "complete",
                facets: [
                    {
                        ...overflow,
                        searchGroup: 1,
                        hitCount: 1,
                    },
                ],
                identifiers: [],
                supplementalPasses: 0,
            },
            [
                {
                    assetId: "asset-other",
                    path: "data/unrelated.csv",
                    __knowledgeSearchGroups: [1],
                    content: "id,label\nOTHER-1,unrelated",
                },
            ],
        );
        expect(coverage.status).toBe("partial");
        expect(coverage.facets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: overflow.id, status: "uncovered", reason: "source_limit" }),
            ]),
        );
    });

    it("keeps every independent graph/support duty when the bounded plan does not overflow", () => {
        const supportPaths = Array.from({ length: 3 }, (_, index) => `data/resources-${index + 1}.csv`);
        const query = "Which route reaches the destination, and which equipment or resource is available there?";
        const obligations = planKnowledgeRetrievalObligations(query, {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/links.csv",
                    columns: ["link_id", "from_location", "to_location"],
                    primaryKey: "link_id",
                    resource: "asset://asset-map/data/links.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/locations.csv",
                    columns: ["location_id", "label"],
                    primaryKey: "location_id",
                    resource: "asset://asset-map/data/locations.csv",
                },
                ...supportPaths.map((path) => ({
                    assetId: "asset-map",
                    path,
                    columns: ["resource_id", "location_id", "resource_type"],
                    primaryKey: "resource_id",
                    resource: `asset://asset-map/${path}`,
                    relations: [
                        {
                            sourceColumn: "location_id",
                            targetPath: "data/locations.csv",
                            targetColumn: "location_id",
                            confidence: "declared",
                        },
                    ],
                })),
            ],
        });

        expect(obligations.some((obligation) => obligation.id.startsWith("obligation-overflow:"))).toBe(false);
        expect(
            obligations
                .filter((obligation) => obligation.kind === "route_support")
                .flatMap((obligation) => obligation.sourcePaths),
        ).toEqual(supportPaths);
    });

    it("binds a unique catalog-owned letter ID to its exact owner and route-support relation", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/links.csv",
                    columns: ["link_id", "from_location", "to_location"],
                    primaryKey: "link_id",
                    resource: "asset://asset-map/data/links.csv",
                    relations: [
                        {
                            sourceColumn: "from_location",
                            targetPath: "data/locations.csv",
                            targetColumn: "location_id",
                            confidence: "declared",
                        },
                        {
                            sourceColumn: "to_location",
                            targetPath: "data/locations.csv",
                            targetColumn: "location_id",
                            confidence: "declared",
                        },
                    ],
                },
                {
                    assetId: "asset-map",
                    path: "data/locations.csv",
                    columns: ["location_id", "label"],
                    primaryKey: "location_id",
                    recordIds: ["NODE-A"],
                    resource: "asset://asset-map/data/locations.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/resources.csv",
                    columns: ["resource_id", "node_id", "description"],
                    primaryKey: "resource_id",
                    resource: "asset://asset-map/data/resources.csv",
                    relations: [
                        {
                            sourceColumn: "node_id",
                            targetPath: "data/locations.csv",
                            targetColumn: "location_id",
                            confidence: "declared",
                        },
                    ],
                },
            ],
        };
        const query = "Which route starts at NODE-A, and which equipment or resource is available there?";
        const obligations = planKnowledgeRetrievalObligations(query, catalog);

        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "exact:node-a",
                    kind: "exact_identifier",
                    identifiers: ["NODE-A"],
                    sourceKeys: ["asset-map:data/locations.csv"],
                }),
                expect.objectContaining({
                    id: "foreign-key:asset-map:data/resources.csv",
                    kind: "foreign_key_filter",
                    identifiers: ["NODE-A"],
                    sourceKeys: ["asset-map:data/resources.csv"],
                    filters: [
                        expect.objectContaining({
                            column: "node_id",
                            value: "NODE-A",
                            targetPath: "data/locations.csv",
                            targetColumn: "location_id",
                            confidence: "declared",
                        }),
                    ],
                }),
                expect.objectContaining({
                    id: "route-topology:asset-map:data/links.csv",
                    kind: "route_topology",
                    completion: "all_sources_verified",
                }),
                expect.objectContaining({
                    id: "route-topology:asset-map:data/locations.csv",
                    kind: "route_topology",
                    completion: "all_sources_verified",
                }),
                expect.objectContaining({
                    id: "route-support:asset-map:data/resources.csv",
                    kind: "route_support",
                    completion: "all_sources_verified",
                }),
            ]),
        );
        expect(planKnowledgeGroundingSources([], query, catalog, 8)).toEqual(
            expect.objectContaining({
                identifiers: expect.arrayContaining(["NODE-A"]),
                sources: expect.arrayContaining([
                    expect.objectContaining({ assetId: "asset-map", path: "data/locations.csv" }),
                    expect.objectContaining({ assetId: "asset-map", path: "data/resources.csv" }),
                ]),
            }),
        );
    });

    it("keeps unknown, substring-only and cross-asset letter IDs out of exact duties", () => {
        const uniqueCatalog = {
            tableSummaries: [
                {
                    assetId: "asset-one",
                    path: "data/locations.csv",
                    columns: ["location_id", "label"],
                    primaryKey: "location_id",
                    recordIds: ["NODE-A"],
                    resource: "asset://asset-one/data/locations.csv",
                },
            ],
        };
        for (const query of ["Read UNKNOWN-TOKEN", "Read XNODE-A", "Read NODE-AX"]) {
            expect(
                planKnowledgeRetrievalObligations(query, uniqueCatalog).filter(
                    (obligation) => obligation.kind === "exact_identifier",
                ),
            ).toEqual([]);
        }

        const ambiguousCatalog = {
            tableSummaries: [
                ...uniqueCatalog.tableSummaries,
                {
                    assetId: "asset-two",
                    path: "data/locations.csv",
                    columns: ["location_id", "label"],
                    primaryKey: "location_id",
                    recordIds: ["NODE-A"],
                    resource: "asset://asset-two/data/locations.csv",
                },
            ],
        };
        expect(
            planKnowledgeRetrievalObligations("Read NODE-A", ambiguousCatalog).filter(
                (obligation) => obligation.kind === "exact_identifier",
            ),
        ).toEqual([]);
        expect(planKnowledgeGroundingSources([], "Read NODE-A", ambiguousCatalog, 4).identifiers).not.toContain(
            "NODE-A",
        );
    });

    it("uses endpoint structure for node targets and keeps missing topology fail-closed", () => {
        const structuralCatalog = {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/links.csv",
                    columns: ["link_id", "from_location", "to_location"],
                    primaryKey: "link_id",
                    resource: "asset://asset-map/data/links.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/locations.csv",
                    columns: ["location_id", "label"],
                    primaryKey: "location_id",
                    resource: "asset://asset-map/data/locations.csv",
                },
            ],
        };
        const negative = planKnowledgeRetrievalObligations(
            "LOCATION-99 节点或连接边不存在，还能到达吗？",
            structuralCatalog,
        ).filter((obligation) => obligation.kind === "route_topology");
        expect(negative.map((obligation) => obligation.sourcePaths)).toEqual([
            ["data/links.csv"],
            ["data/locations.csv"],
        ]);

        const missing = planKnowledgeRetrievalObligations("Is LOCATION-99 reachable?", {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/entities.csv",
                    columns: ["entity_id", "location_id"],
                    primaryKey: "entity_id",
                    resource: "asset://asset-map/data/entities.csv",
                },
            ],
        }).filter((obligation) => obligation.kind === "route_topology");
        expect(missing).toEqual([
            expect.objectContaining({
                id: "route-topology:unresolved",
                sourcePaths: [],
                sourceKeys: [],
                completion: "all_sources_verified",
            }),
        ]);
    });

    it("creates one independently bound obligation for every proven graph table", () => {
        const obligations = planKnowledgeRetrievalObligations("Which route reaches NODE-Z?", {
            tableSummaries: [
                {
                    assetId: "asset-map",
                    path: "data/walking-links.csv",
                    columns: ["edge_id", "from_node", "to_node"],
                    resource: "asset://asset-map/data/walking-links.csv",
                },
                {
                    assetId: "asset-map",
                    path: "data/shuttle-links.csv",
                    columns: ["edge_id", "origin_node", "destination_node"],
                    resource: "asset://asset-map/data/shuttle-links.csv",
                },
            ],
        }).filter((obligation) => obligation.kind === "route_topology");
        expect(obligations).toHaveLength(2);
        expect(obligations.map((obligation) => obligation.sourceKeys)).toEqual([
            ["asset-map:data/walking-links.csv"],
            ["asset-map:data/shuttle-links.csv"],
        ]);
    });

    it("plans exact primary-key and declared foreign-key obligations before semantic hits", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/scenarios.csv",
                    columns: ["scenario_id", "name"],
                    primaryKey: "scenario_id",
                    recordIds: ["S04"],
                    resource: "asset://asset-1/raw/sources/scenarios.csv",
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/route_edges.csv",
                    columns: ["edge_id", "from_node", "to_node", "base_status", "accessible"],
                    primaryKey: "edge_id",
                    recordIds: ["E-F10-ES2"],
                    resource: "asset://asset-1/raw/sources/route_edges.csv",
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/scenario_blockages.csv",
                    columns: ["blockage_id", "scenario_id", "edge_id", "status", "confirmed_by"],
                    primaryKey: "blockage_id",
                    recordIds: ["BLK-S04-02"],
                    resource: "asset://asset-1/raw/sources/scenario_blockages.csv",
                    relations: [
                        {
                            sourceColumn: "scenario_id",
                            targetPath: "raw/sources/scenarios.csv",
                            targetColumn: "scenario_id",
                            confidence: "declared",
                        },
                        {
                            sourceColumn: "edge_id",
                            targetPath: "raw/sources/route_edges.csv",
                            targetColumn: "edge_id",
                            confidence: "declared",
                        },
                    ],
                },
            ],
        };
        const query = "请只回答 E-F10-ES2 在 S04 中的覆盖状态和确认人，答案控制在 120 字以内。";
        const structured = planKnowledgeStructuredGrounding(query, catalog);
        expect(structured).toMatchObject({
            kind: "filter",
            completion: "single_result",
            request: {
                from: "raw/sources/scenario_blockages.csv",
                filters: expect.arrayContaining([
                    { column: "scenario_id", op: "eq", value: "S04" },
                    { column: "edge_id", op: "eq", value: "E-F10-ES2" },
                ]),
            },
        });
        expect(structured?.request.select).toEqual(expect.arrayContaining(["blockage_id", "status", "confirmed_by"]));

        const obligations = planKnowledgeRetrievalObligations(query, catalog);
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "exact_identifier",
                    identifiers: ["E-F10-ES2"],
                    sourcePaths: ["raw/sources/route_edges.csv"],
                }),
                expect.objectContaining({
                    kind: "foreign_key_filter",
                    sourcePaths: ["raw/sources/scenario_blockages.csv"],
                    identifiers: expect.arrayContaining(["E-F10-ES2", "S04"]),
                }),
            ]),
        );

        const sources = planKnowledgeGroundingSources(
            Array.from({ length: 8 }, (_, index) => ({
                assetId: "asset-1",
                path: `raw/sources/broad-${index}.md`,
                snippet: `broad ${index}`,
            })),
            query,
            catalog,
            3,
        );
        expect(sources.sources.map((source) => source.path)).toEqual(
            expect.arrayContaining([
                "raw/sources/scenario_blockages.csv",
                "raw/sources/route_edges.csv",
                "raw/sources/scenarios.csv",
            ]),
        );
        expect(sources.diagnostics.find((item) => item.path.endsWith("scenario_blockages.csv"))?.reasons).toContain(
            "declared_foreign_key_identifier",
        );
    });

    it("uses an inferred relation as a bounded read duty for explicit relation questions", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/accounts.csv",
                    columns: ["account_id", "name"],
                    primaryKey: "account_id",
                    recordIds: ["AC-42"],
                    resource: "asset://asset-1/raw/sources/accounts.csv",
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/orders.csv",
                    columns: ["order_id", "account_id", "amount"],
                    primaryKey: "order_id",
                    recordIds: ["OR-7"],
                    resource: "asset://asset-1/raw/sources/orders.csv",
                    relations: [
                        {
                            sourceColumn: "account_id",
                            targetPath: "raw/sources/accounts.csv",
                            targetColumn: "account_id",
                            confidence: "high",
                        },
                    ],
                },
            ],
        };
        const query = "请列出 AC-42 相关的所有订单";

        const obligations = planKnowledgeRetrievalObligations(query, catalog);
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "exact_identifier",
                    identifiers: ["AC-42"],
                    sourcePaths: ["raw/sources/accounts.csv"],
                }),
                expect.objectContaining({
                    kind: "foreign_key_filter",
                    identifiers: ["AC-42"],
                    sourcePaths: ["raw/sources/orders.csv"],
                    completion: "all_sources_verified",
                    filters: [expect.objectContaining({ column: "account_id", confidence: "high" })],
                }),
            ]),
        );
        expect(obligations.some((obligation) => obligation.kind === "exhaustive_list")).toBe(false);

        const sources = planKnowledgeGroundingSources([], query, catalog, 2);
        expect(sources.sources.map((source) => source.path)).toContain("raw/sources/orders.csv");
        expect(sources.diagnostics.find((item) => item.path.endsWith("orders.csv"))?.reasons).toContain(
            "foreign_key_identifier",
        );

        const relationQuery = "请说明 `AC-42` 对应的订单关系";
        expect(planKnowledgeRetrievalObligations(relationQuery, catalog)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "foreign_key_filter",
                    identifiers: ["AC-42"],
                    sourcePaths: ["raw/sources/orders.csv"],
                    completion: "all_sources_verified",
                    filters: [expect.objectContaining({ column: "account_id", confidence: "high" })],
                }),
            ]),
        );
        expect(planKnowledgeStructuredGrounding(relationQuery, catalog)).toMatchObject({
            kind: "filter",
            reasons: expect.arrayContaining(["typed_high_confidence_foreign_key"]),
            request: {
                from: "raw/sources/orders.csv",
                filters: [{ column: "account_id", op: "eq", value: "AC-42" }],
            },
        });

        const actionQuery = "AC-42 下一步应该怎么处理";
        const actionObligations = planKnowledgeRetrievalObligations(actionQuery, catalog);
        expect(actionObligations.some((obligation) => obligation.kind === "foreign_key_filter")).toBe(false);
        const actionSources = planKnowledgeGroundingSources([], actionQuery, catalog, 2);
        expect(actionSources.sources.map((source) => source.path)).toContain("raw/sources/orders.csv");
        expect(actionSources.diagnostics.find((item) => item.path.endsWith("orders.csv"))?.reasons).toContain(
            "foreign_key_identifier",
        );
    });

    it("uses an empty-safe completion only for an exact asset-bound relation filter", () => {
        const tableSummaries = [
            {
                assetId: "asset-map",
                path: "data/locations.csv",
                columns: ["location_id", "label"],
                primaryKey: "location_id",
                recordIds: ["LOC-Z"],
                resource: "asset://asset-map/data/locations.csv",
            },
            {
                assetId: "asset-map",
                path: "data/resources.csv",
                columns: ["resource_id", "location_id", "kind"],
                primaryKey: "resource_id",
                recordIds: ["RES-1"],
                resource: "asset://asset-map/data/resources.csv",
                relations: [
                    {
                        sourceColumn: "location_id",
                        targetPath: "data/locations.csv",
                        targetColumn: "location_id",
                        confidence: "declared" as const,
                    },
                ],
            },
        ];
        const query = "Explain the resources related to LOC-Z";
        const bound = planKnowledgeRetrievalObligations(query, { tableSummaries });
        expect(bound).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "exact_identifier",
                    identifiers: ["LOC-Z"],
                    sourceKeys: ["asset-map:data/locations.csv"],
                    completion: "record_verified",
                }),
                expect.objectContaining({
                    kind: "foreign_key_filter",
                    identifiers: ["LOC-Z"],
                    sourceKeys: ["asset-map:data/resources.csv"],
                    filters: [expect.objectContaining({ column: "location_id", value: "LOC-Z" })],
                    completion: "all_sources_verified",
                }),
            ]),
        );

        const pathOnly = planKnowledgeRetrievalObligations(query, {
            tableSummaries: tableSummaries.map(({ assetId: _assetId, ...summary }) => summary),
        });
        expect(pathOnly).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "foreign_key_filter",
                    sourceKeys: [],
                    completion: "record_verified",
                }),
            ]),
        );
    });

    it("keeps a schema-declared event relation as a mandatory foreign-key obligation", () => {
        const catalog = {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/events.csv",
                    columns: ["event_id", "summary"],
                    primaryKey: "event_id",
                    recordIds: ["EVT-42"],
                    resource: "asset://asset-1/raw/sources/events.csv",
                },
                {
                    assetId: "asset-1",
                    path: "raw/sources/assignments.csv",
                    columns: ["assignment_id", "event_id", "owner"],
                    primaryKey: "assignment_id",
                    recordIds: ["ASN-9"],
                    resource: "asset://asset-1/raw/sources/assignments.csv",
                    relations: [
                        {
                            sourceColumn: "event_id",
                            targetPath: "raw/sources/events.csv",
                            targetColumn: "event_id",
                            confidence: "declared",
                        },
                    ],
                },
            ],
        };

        const obligations = planKnowledgeRetrievalObligations("说明 EVT-42 对应的分配关系", catalog);
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "foreign_key_filter",
                    identifiers: ["EVT-42"],
                    sourcePaths: ["raw/sources/assignments.csv"],
                    filters: [
                        expect.objectContaining({
                            column: "event_id",
                            value: "EVT-42",
                            targetPath: "raw/sources/events.csv",
                            targetColumn: "event_id",
                            confidence: "declared",
                        }),
                    ],
                }),
            ]),
        );

        const actionQuery = "EVT-42 接下来应当采取什么行动";
        expect(planKnowledgeRetrievalObligations(actionQuery, catalog)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "foreign_key_filter",
                    identifiers: ["EVT-42"],
                    sourcePaths: ["raw/sources/assignments.csv"],
                    completion: "all_sources_verified",
                }),
            ]),
        );
        expect(planKnowledgeStructuredGrounding(actionQuery, catalog)).toMatchObject({
            kind: "filter",
            reasons: expect.arrayContaining(["typed_declared_foreign_key"]),
            request: {
                from: "raw/sources/assignments.csv",
                filters: [{ column: "event_id", op: "eq", value: "EVT-42" }],
            },
        });
        const actionSources = planKnowledgeGroundingSources([], actionQuery, catalog, 2);
        expect(actionSources.sources.map((source) => source.path)).toContain("raw/sources/assignments.csv");
        expect(actionSources.diagnostics.find((item) => item.path.endsWith("assignments.csv"))?.reasons).toContain(
            "declared_foreign_key_identifier",
        );
    });

    it("uses a unique catalog primary key for an exact-ID structured read", () => {
        const plan = planKnowledgeStructuredGrounding("读取 INV-42 的全部字段", {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/inventory.csv",
                    columns: ["inventory_id", "name", "state"],
                    primaryKey: "inventory_id",
                    recordIds: ["INV-42"],
                },
            ],
        });
        expect(plan).toMatchObject({
            kind: "filter",
            exhaustive: false,
            completion: "single_result",
            request: {
                from: "raw/sources/inventory.csv",
                filters: [{ column: "inventory_id", op: "eq", value: "INV-42" }],
            },
        });
    });

    it("batches a long identifier list without dropping exhaustive or semantic obligations", () => {
        const identifiers = Array.from({ length: 18 }, (_, index) => `REC-${String(index + 1).padStart(3, "0")}`);
        const obligations = planKnowledgeRetrievalObligations(
            `请完整列出全部记录并逐项核对：${identifiers.join("、")}`,
        );

        expect(obligations.length).toBeLessThanOrEqual(16);
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "exact:bounded-batch",
                    kind: "exact_identifier",
                    identifiers,
                    completion: "record_verified",
                }),
                expect.objectContaining({ kind: "exhaustive_list", completion: "cursor_exhausted" }),
                expect.objectContaining({ kind: "semantic_facet", completion: "readable_evidence" }),
            ]),
        );
    });

    it("fails closed instead of applying one heterogeneous overflow filter batch to every relation source", () => {
        const identifiers = Array.from({ length: 17 }, (_, index) => `REL-${String(index + 1).padStart(3, "0")}`);
        const obligations = planKnowledgeRetrievalObligations(`请核对这些关联记录：${identifiers.join("、")}`, {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/targets.csv",
                    columns: ["target_id"],
                    primaryKey: "target_id",
                    recordIds: identifiers,
                },
                ...identifiers.map((_identifier, index) => ({
                    assetId: "asset-1",
                    path: `raw/sources/relation-${index + 1}.csv`,
                    columns: ["link_id", "target_id"],
                    primaryKey: "link_id",
                    relations: [
                        {
                            sourceColumn: "target_id",
                            targetPath: "raw/sources/targets.csv",
                            targetColumn: "target_id",
                            confidence: "declared",
                        },
                    ],
                })),
            ],
        });

        expect(obligations.length).toBeLessThanOrEqual(16);
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "exact:bounded-batch", identifiers }),
                {
                    id: "foreign-key:overflow-unresolved",
                    kind: "foreign_key_filter",
                    query: expect.any(String),
                    identifiers: [],
                    sourcePaths: [],
                    sourceKeys: [],
                    filters: [],
                    completion: "all_sources_verified",
                },
            ]),
        );
        expect(obligations.some((obligation) => obligation.id === "foreign-key:bounded-batch")).toBe(false);
    });

    it("batches exact identifiers while preserving heterogeneous relation selectors per source", () => {
        const identifiers = Array.from({ length: 14 }, (_, index) => `ITEM-${String(index + 1).padStart(2, "0")}`);
        const obligations = planKnowledgeRetrievalObligations(
            `Compare the related records for ${identifiers.join(", ")}`,
            {
                tableSummaries: [
                    {
                        assetId: "asset-catalog",
                        path: "data/items.csv",
                        columns: ["item_id", "label"],
                        primaryKey: "item_id",
                        recordIds: identifiers,
                        resource: "asset://asset-catalog/data/items.csv",
                    },
                    {
                        assetId: "asset-catalog",
                        path: "data/allocations.csv",
                        columns: ["allocation_id", "item_id"],
                        primaryKey: "allocation_id",
                        resource: "asset://asset-catalog/data/allocations.csv",
                        relations: [
                            {
                                sourceColumn: "item_id",
                                targetPath: "data/items.csv",
                                targetColumn: "item_id",
                                confidence: "declared",
                            },
                        ],
                    },
                    {
                        assetId: "asset-catalog",
                        path: "data/notes.csv",
                        columns: ["note_id", "parent_id"],
                        primaryKey: "note_id",
                        resource: "asset://asset-catalog/data/notes.csv",
                        relations: [
                            {
                                sourceColumn: "parent_id",
                                targetPath: "data/items.csv",
                                targetColumn: "item_id",
                                confidence: "declared",
                            },
                        ],
                    },
                ],
            },
        );

        expect(obligations.length).toBeLessThanOrEqual(16);
        expect(obligations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "exact:bounded-batch", identifiers }),
                expect.objectContaining({
                    id: "foreign-key:asset-catalog:data/allocations.csv",
                    sourcePaths: ["data/allocations.csv"],
                    filters: expect.arrayContaining([expect.objectContaining({ column: "item_id" })]),
                }),
                expect.objectContaining({
                    id: "foreign-key:asset-catalog:data/notes.csv",
                    sourcePaths: ["data/notes.csv"],
                    filters: expect.arrayContaining([expect.objectContaining({ column: "parent_id" })]),
                }),
            ]),
        );
        expect(obligations.some((obligation) => obligation.id.startsWith("foreign-key:bounded-batch"))).toBe(false);
    });

    it("marks an unbounded complete list as cursor-exhausted instead of pretending one page closes it", () => {
        const plan = planKnowledgeStructuredGrounding("请列出 orders.csv 所有记录", {
            tableSummaries: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/orders.csv",
                    columns: ["order_id", "status"],
                    primaryKey: "order_id",
                    recordCount: 80,
                },
            ],
        });
        expect(plan).toMatchObject({
            exhaustive: true,
            exhaustiveWithinKnownBounds: false,
            completion: "cursor_exhausted",
            request: { limit: 25 },
        });
    });
});
