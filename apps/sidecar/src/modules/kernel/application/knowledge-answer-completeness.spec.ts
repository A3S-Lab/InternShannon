import {
    analyzeKnowledgeAnswerCompleteness,
    missingRequiredKnowledgeIdentifiers,
} from "./knowledge-answer-completeness";

const NEUTRAL_ASSET_ID = "asset-neutral-state";
const NEUTRAL_REVISION = "revision-neutral-state";

function trustedCsvRead(input: {
    path: string;
    content: string;
    primaryKey: string;
    relations?: Array<{
        sourceColumn: string;
        targetPath: string;
        targetColumn: string;
        confidence: "declared" | "high";
    }>;
    assetId?: string;
    revision?: string;
    overrides?: Record<string, unknown>;
}): Record<string, unknown> {
    const assetId = input.assetId ?? NEUTRAL_ASSET_ID;
    const revision = input.revision ?? NEUTRAL_REVISION;
    const columns = input.content.split(/\r?\n/u)[0]?.split(",") ?? [];
    const resource = `asset://${assetId}/${input.path}`;
    return {
        assetId,
        path: input.path,
        __knowledgePath: `source:${input.path}#0`,
        __knowledgeExpectedRevision: revision,
        indexSnapshot: { revision },
        resource,
        tableSummary: {
            assetId,
            path: input.path,
            columns,
            primaryKey: input.primaryKey,
            relations: input.relations ?? [],
            resource,
        },
        content: input.content,
        ...(input.overrides ?? {}),
    };
}

function restrictiveStateGrounding(reads: Record<string, unknown>[], revision = NEUTRAL_REVISION): string {
    return JSON.stringify({
        status: "ok",
        reads,
        search: { tableSummaries: reads.map((read) => read.tableSummary).filter(Boolean) },
        coverage: { indexRevision: revision },
    });
}

function restrictiveStateGroundingWithVerifiedHistoryScope(
    reads: Record<string, unknown>[],
    values: string[],
    overrides: {
        assetId?: string;
        path?: string;
        pointerAssetId?: string;
        pointerPath?: string;
        pointerKey?: string;
        omitPointerKey?: boolean;
        searchGroups?: unknown;
        pointerFilters?: unknown;
        selectorFilters?: unknown;
        pointerIdentifiers?: unknown;
        selectorIdentifiers?: unknown;
        obligationIds?: unknown;
        pointerLocators?: unknown;
        omitTrustedEvidence?: boolean;
        selectorAssetId?: string;
        selectorPath?: string;
        expectedRevision?: string;
        accumulatorRevision?: string;
        accumulatorEvidenceTruncated?: boolean;
        selectorKind?: string;
        obligationId?: string;
        completion?: string;
        status?: string;
        coverageOverrides?: Record<string, unknown>;
    } = {},
): string {
    const assetId = overrides.assetId ?? NEUTRAL_ASSET_ID;
    const path = overrides.path ?? "data/cases.csv";
    const pointerAssetId = overrides.pointerAssetId ?? assetId;
    const pointerPath = overrides.pointerPath ?? path;
    const selectorAssetId = overrides.selectorAssetId ?? pointerAssetId;
    const selectorPath = overrides.selectorPath ?? pointerPath;
    const expectedRevision = overrides.expectedRevision ?? NEUTRAL_REVISION;
    const locators = values.map((value) => ({ assetId, path, kind: "record", value }));
    const selectorSignature = JSON.stringify({
        v: 1,
        assetId: selectorAssetId,
        path: selectorPath,
        kind: overrides.selectorKind ?? "exact",
        identifiers: overrides.selectorIdentifiers ?? values,
        ...(overrides.selectorFilters !== undefined ? { filters: overrides.selectorFilters } : {}),
    });
    const coverageQuery = "verified history scope revalidation";
    const coverageStatus = overrides.status ?? "complete";
    const coverageComplete = coverageStatus === "complete";
    const coverageFacet = {
        id: "verified-history-locators",
        query: "revalidate verified history locators",
        searchGroup: 0,
        hitCount: values.length,
        kind: "route_support",
        completion: overrides.completion ?? "all_sources_verified",
        sourcePaths: [path],
        sourceKeys: [`${assetId}:${path}`],
        verifiedHistoryLocators: locators,
    };
    return JSON.stringify({
        status: "ok",
        reads,
        search: { tableSummaries: reads.map((read) => read.tableSummary).filter(Boolean) },
        coverage: {
            version: 1,
            query: coverageQuery,
            mode: "complete",
            status: coverageStatus,
            facets: [
                {
                    ...coverageFacet,
                    status: coverageComplete ? "covered" : "uncovered",
                    selectedPaths: coverageComplete ? [path] : [],
                },
            ],
            requestedIdentifiers: [],
            matchedIdentifiers: [],
            missingIdentifiers: [],
            required: 1,
            verified: coverageComplete ? 1 : 0,
            missing: coverageComplete ? 0 : 1,
            indexRevision: NEUTRAL_REVISION,
            supplementalPasses: 0,
            hasMore: false,
            accumulator: {
                protocolVersion: 1,
                query: coverageQuery,
                mode: "complete",
                pageCount: 1,
                identifiers: [],
                indexRevision: overrides.accumulatorRevision ?? NEUTRAL_REVISION,
                ...(overrides.accumulatorEvidenceTruncated !== undefined
                    ? { evidenceTruncated: overrides.accumulatorEvidenceTruncated }
                    : {}),
                facets: [coverageFacet],
                trustedEvidence: overrides.omitTrustedEvidence
                    ? []
                    : [
                          {
                              ...(!overrides.omitPointerKey
                                  ? { key: overrides.pointerKey ?? `${pointerAssetId}:source:${pointerPath}#0` }
                                  : {}),
                              path: pointerPath,
                              searchGroups: overrides.searchGroups ?? [1],
                              assetId: pointerAssetId,
                              expectedRevision,
                              identifiers: overrides.pointerIdentifiers ?? values,
                              ...(overrides.pointerFilters !== undefined ? { filters: overrides.pointerFilters } : {}),
                              selectorSignature,
                              obligationIds: overrides.obligationIds ?? [
                                  overrides.obligationId ?? "verified-history-locators",
                              ],
                              verifiedHistoryLocators: overrides.pointerLocators ?? locators,
                          },
                      ],
                trustedTableSummaries: [],
            },
            ...(overrides.coverageOverrides ?? {}),
        },
    });
}

function neutralStateReads(): Record<string, unknown>[] {
    return [
        trustedCsvRead({
            path: "data/links.csv",
            content: [
                "link_id,from_location,to_location",
                "LINK-AB,ZONE-A,ZONE-B",
                "LINK-CB,ZONE-C,ZONE-B",
                "LINK-XY,ZONE-X,ZONE-Y",
            ].join("\n"),
            primaryKey: "link_id",
        }),
        trustedCsvRead({
            path: "data/overrides.csv",
            content: [
                "override_id,case_id,link_id,state",
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                "OVR-CASE7-CB,CASE-7,LINK-CB,restricted",
                "OVR-CASE7-XY,CASE-7,LINK-XY,blocked",
                "OVR-CASE7-OPEN,CASE-7,LINK-AB,open",
            ].join("\n"),
            primaryKey: "override_id",
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
        }),
        trustedCsvRead({
            path: "data/cases.csv",
            content: "case_id,title\nCASE-7,Neutral case",
            primaryKey: "case_id",
        }),
        trustedCsvRead({
            path: "data/locations.csv",
            content: [
                "location_id,label",
                "ZONE-A,Zone A",
                "ZONE-B,Zone B",
                "ZONE-C,Zone C",
                "ZONE-X,Zone X",
                "ZONE-Y,Zone Y",
            ].join("\n"),
            primaryKey: "location_id",
        }),
    ];
}

describe("domain-neutral knowledge answer completeness", () => {
    it("reports quoted stable identifiers omitted from the final draft", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请合并 `EXIT-W` 和 `E-EXIT-E` 的状态。",
                answerText: "E-EXIT-E 已在结果中明确说明。",
            }),
        ).toEqual(["EXIT-W"]);
    });

    it("matches identifiers case-insensitively while preserving the user's spelling in failures", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请核对 `EXIT-W` 和 `E-EXIT-E`。",
                answerText: "exit-w 与 e-exit-e 都已核对。",
            }),
        ).toEqual([]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请核对 `Exit-W`。",
                answerText: "当前答案没有给出精确标识。",
            }),
        ).toEqual(["Exit-W"]);
    });

    it("requires exact identifier boundaries instead of accepting longer substrings", () => {
        for (const answerText of ["PRE-EXIT-W", "E-EXIT-W", "EXIT-WEST"]) {
            expect(
                missingRequiredKnowledgeIdentifiers({
                    userText: "请保留 `EXIT-W`。",
                    answerText,
                }),
            ).toEqual(["EXIT-W"]);
        }
    });

    it("uses explicit record ID syntax, including a numeric ID, without treating ordinary numbers as IDs", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "记录 ID：18432；record ID: ALPHA_ROW。答案限制 300 字。",
                answerText: "已保留记录 18432。",
            }),
        ).toEqual(["ALPHA_ROW"]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "答案限制 300 字，60 秒内完成。",
                answerText: "",
            }),
        ).toEqual([]);
    });

    it("does not mistake ordinary inline code words or filenames for stable identifiers", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请解释 `blocked` 并查看 `orders.csv` 和 `orders-2026.csv`。",
                answerText: "",
            }),
        ).toEqual([]);
    });

    it("does not require identifiers covered only by a local negative output directive", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "不要提及 `EXIT-W`，请保留 `E-EXIT-E`。",
                answerText: "E-EXIT-E 已保留。",
            }),
        ).toEqual([]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "omit `EXIT-W`; output `E-EXIT-E`.",
                answerText: "",
            }),
        ).toEqual(["E-EXIT-E"]);
    });

    it("still requires an identifier when another clause positively requests the same value", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "不要输出 `EXIT-W`，但请在排除列表中保留 `EXIT-W`。",
                answerText: "",
            }),
        ).toEqual(["EXIT-W"]);
    });

    it("distinguishes a request not to omit an identifier from a request to omit it", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "不要省略 `E-EXIT-E`。",
                answerText: "",
            }),
        ).toEqual(["E-EXIT-E"]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "省略 `E-EXIT-E`。",
                answerText: "",
            }),
        ).toEqual([]);
    });

    it("uses the shared generic scanner for unquoted mixed letter-digit identifiers", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请比较 REC-100 和 INV_2026_004。",
                answerText: "rec-100 已包含。",
            }),
        ).toEqual(["INV_2026_004"]);
    });

    it("deduplicates repeated identifiers regardless of user-side case", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请保留 `EXIT-W`，并再核对 `exit-w`。",
                answerText: "",
            }),
        ).toEqual(["EXIT-W"]);
    });

    it("requires the verified core of a uniquely grounded route without domain-specific IDs", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "L-1,N-A,N-B,open",
                        "L-2,N-B,N-C,open",
                        "L-3,N-C,N-D,open",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请给出 `N-A` 的安全路径。",
                answerText: "从 N-A 前往 N-C。",
                grounding,
            }),
        ).toEqual(["N-B", "N-D"]);
    });

    it("follows an explicitly bidirectional graph in reverse and requires its verified route core", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status,bidirectional",
                        "L-AB,N-A,N-B,open,yes",
                        "L-BC,N-B,N-C,open,true",
                        "L-CD,N-C,N-D,open,1",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请给出 `N-D` 的安全路线。",
                answerText: "N-D 向 N-A 撤离。",
                grounding,
            }),
        ).toEqual(["N-C", "N-B"]);
    });

    it("excludes blocked and closed edges before deriving route identifiers", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "L-AB,N-A,N-B,open",
                        "L-BC,N-B,N-C,open",
                        "L-AD,N-A,N-D,open",
                        "L-DE,N-D,N-E,open",
                        "L-EC,N-E,N-C,open",
                    ].join("\n"),
                },
                {
                    content: ["event_id,link_id,state", "EV-1,L-AB,blocked", "EV-2,L-BC,closed"].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请给出 `N-A` 的安全路线。",
                answerText: "N-A 经 N-D 前往 N-C。",
                grounding,
            }),
        ).toEqual(["N-E"]);
    });

    it("derives an alphabetic verified route start from answer order without widening generic identifiers", () => {
        const reads = [
            {
                content: [
                    "link_id,from_location,to_location,status",
                    "PATH-ENTRY,PLACE-START,PLACE-JUNCTION,open",
                    "PATH-DIRECT,PLACE-JUNCTION,PLACE-ASSEMBLY,open",
                    "PATH-SAFE-A,PLACE-JUNCTION,PLACE-SAFE-MID,open",
                    "PATH-SAFE-B,PLACE-SAFE-MID,PLACE-ASSEMBLY,open",
                ].join("\n"),
            },
            {
                content: "state_id,link_id,state\nSTATE-CURRENT,PATH-DIRECT,blocked",
            },
            {
                content: [
                    "location_id,type,label",
                    "PLACE-START,origin,Start",
                    "PLACE-JUNCTION,transit,Junction",
                    "PLACE-SAFE-MID,transit,Protected corridor",
                    "PLACE-ASSEMBLY,assembly,Assembly",
                ].join("\n"),
            },
        ];
        const grounding = JSON.stringify({ reads });
        const unsafeDraft =
            "安全主路线：PLACE-START → PLACE-JUNCTION → PLACE-ASSEMBLY；连接 PATH-ENTRY、PATH-DIRECT；明确排除 PATH-DIRECT blocked。";
        const safeDraft =
            "安全主路线：PLACE-START → PLACE-JUNCTION → PLACE-SAFE-MID → PLACE-ASSEMBLY；连接 PATH-ENTRY、PATH-SAFE-A、PATH-SAFE-B。";

        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "When the north hall alarm occurs, give the safe route from the described start.",
                answerText: unsafeDraft,
                grounding,
            }),
        ).toEqual(["PLACE-SAFE-MID"]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "When the north hall alarm occurs, give the safe route from the described start.",
                answerText: safeDraft,
                grounding,
            }),
        ).toEqual([]);

        const reversedGrounding = JSON.stringify({
            reads: [
                {
                    content: [reads[0].content.split("\n")[0], ...reads[0].content.split("\n").slice(1).reverse()].join(
                        "\n",
                    ),
                },
                reads[1],
                {
                    content: [reads[2].content.split("\n")[0], ...reads[2].content.split("\n").slice(1).reverse()].join(
                        "\n",
                    ),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "When the north hall alarm occurs, give the safe route from the described start.",
                answerText: unsafeDraft,
                grounding: reversedGrounding,
            }),
        ).toEqual(["PLACE-SAFE-MID"]);
    });

    it("ignores an earlier goal and non-node identifiers when choosing an answer-derived route start", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "PATH-ENTRY,PLACE-START,PLACE-JUNCTION,open",
                        "PATH-DIRECT,PLACE-JUNCTION,PLACE-ASSEMBLY,open",
                        "PATH-SAFE-A,PLACE-JUNCTION,PLACE-SAFE-MID,open",
                        "PATH-SAFE-B,PLACE-SAFE-MID,PLACE-ASSEMBLY,open",
                    ].join("\n"),
                },
                { content: "state_id,link_id,state\nSTATE-CURRENT,PATH-DIRECT,blocked" },
                {
                    content: [
                        "node_id,kind",
                        "PLACE-START,origin",
                        "PLACE-JUNCTION,transit",
                        "PLACE-SAFE-MID,transit",
                        "PLACE-ASSEMBLY,assembly",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Give the safe route for the described context.",
                answerText:
                    "PLACE-ASSEMBLY is the goal; CTX-NORTH uses PATH-DIRECT. Route: PLACE-START → PLACE-JUNCTION → PLACE-ASSEMBLY.",
                grounding,
            }),
        ).toEqual(["PLACE-SAFE-MID"]);
    });

    it("keeps equivalent verified route branches fail-closed for branch-specific identifiers", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "PATH-ENTRY,PLACE-START,PLACE-JUNCTION,open",
                        "PATH-A1,PLACE-JUNCTION,PLACE-BRANCH-A,open",
                        "PATH-A2,PLACE-BRANCH-A,PLACE-ASSEMBLY,open",
                        "PATH-B1,PLACE-JUNCTION,PLACE-BRANCH-B,open",
                        "PATH-B2,PLACE-BRANCH-B,PLACE-ASSEMBLY,open",
                    ].join("\n"),
                },
                {
                    content: [
                        "node_id,kind",
                        "PLACE-START,origin",
                        "PLACE-JUNCTION,transit",
                        "PLACE-BRANCH-A,transit",
                        "PLACE-BRANCH-B,transit",
                        "PLACE-ASSEMBLY,assembly",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Give the safe route from the described start.",
                answerText: "PLACE-START reaches PLACE-JUNCTION and then PLACE-ASSEMBLY by an equivalent branch.",
                grounding,
            }),
        ).toEqual([]);
    });

    it("requires only a bounded shared core when safe paths locally branch and reconverge", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "L-AB,N-A,N-B,open",
                        "L-BC,N-B,N-C,open",
                        "L-BX,N-B,N-X,open",
                        "L-CD,N-C,N-D,open",
                        "L-XD,N-X,N-D,open",
                        "L-DE,N-D,N-E,open",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请给出 `N-A` 的安全路线。",
                answerText: "N-A 可到达 N-E。",
                grounding,
            }),
        ).toEqual(["N-B", "N-D"]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请给出 `N-A` 的安全路线。",
                answerText: "N-A 经 N-B 后在 N-D 汇合，最终到达 N-E。",
                grounding,
            }),
        ).toEqual([]);
    });

    it("does not guess branch identifiers for genuinely ambiguous destinations", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "L-AB,N-A,N-B,open",
                        "L-BC,N-B,N-C,open",
                        "L-AX,N-A,N-X,open",
                        "L-XY,N-X,N-Y,open",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请核对 `N-A` 的安全路线。",
                answerText: "N-A 有两个尚未消除歧义的去向。",
                grounding,
            }),
        ).toEqual([]);
    });

    it("uses verified node descriptors to disambiguate several related starts in Chinese or English", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: ["case_id,location_node", "CASE-4,S-1", "CASE-4,S-2"].join("\n"),
                },
                {
                    content: [
                        "node_id,node_label,description,node_type",
                        "S-1,Alpha Zone,东侧实验区,work_area",
                        "S-2,Beta Zone,西侧实验区,work_area",
                        "T-1,Assembly Alpha,安全集合点,assembly",
                        "T-2,Assembly Beta,备用集合点,assembly",
                    ].join("\n"),
                },
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "L-1,S-1,A-1,open",
                        "L-2,A-1,B-1,open",
                        "L-3,B-1,T-1,open",
                        "L-4,S-2,A-2,open",
                        "L-5,A-2,B-2,open",
                        "L-6,B-2,T-2,open",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请给出 `CASE-4` 东侧实验区人员的安全路线。",
                answerText: "CASE-4 从 S-1 前往 B-1，最终到 T-1。",
                grounding,
            }),
        ).toEqual(["A-1"]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Give the route for `CASE-4` people in Alpha Zone.",
                answerText: "CASE-4 starts at S-1, passes B-1, and reaches T-1.",
                grounding,
            }),
        ).toEqual(["A-1"]);
    });

    it("does not use the draft to guess between equally matching verified start descriptors", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: ["case_id,location_node", "CASE-5,S-1", "CASE-5,S-2"].join("\n"),
                },
                {
                    content: [
                        "node_id,label,role",
                        "S-1,Shared Lab,work_area",
                        "S-2,Shared Lab,work_area",
                        "T-1,Goal One,destination",
                        "T-2,Goal Two,destination",
                    ].join("\n"),
                },
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "L-1,S-1,A-1,open",
                        "L-2,A-1,B-1,open",
                        "L-3,B-1,T-1,open",
                        "L-4,S-2,A-2,open",
                        "L-5,A-2,B-2,open",
                        "L-6,B-2,T-2,open",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Give the route for `CASE-5` in Shared Lab.",
                answerText: "CASE-5 starts at S-1 and reaches T-1.",
                grounding,
            }),
        ).toEqual([]);
    });

    it("uses bounded shortest-path search to prefer a verified assembly goal over cycles, exits, and dead ends", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "node_id,category",
                        "S-1,origin",
                        "A-1,corridor",
                        "D-1,storage",
                        "C-1,exit",
                        "G-1,assembly",
                    ].join("\n"),
                },
                {
                    content: [
                        "link_id,from_node,to_node,status,bidirectional",
                        "L-SA,S-1,A-1,open,true",
                        "L-AD,A-1,D-1,open,true",
                        "L-AB,A-1,B-1,open,true",
                        "L-BC,B-1,C-1,open,true",
                        "L-CA,C-1,A-1,open,true",
                        "L-CG,C-1,G-1,open,true",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "请给出 `S-1` 到安全目的地的路线。",
                answerText: "S-1 最终到达 G-1。",
                grounding,
            }),
        ).toEqual(["A-1", "C-1"]);
    });

    it("retains a directly related equipment identifier when correcting a remembered fact", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: "job_id,location_id,required_equipment_id\nJOB-8,ZONE-C,EQ-LIFT-8",
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "我记得 JOB-8 的设备在 ZONE-C，对吗？",
                answerText: "JOB-8 位于 ZONE-C，需要使用升降设备。",
                grounding,
            }),
        ).toEqual(["EQ-LIFT-8"]);
    });

    it("retains only row-related resource identifiers for an explicit equipment request", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "resource_id,location_id,resource_type",
                        "RES-8,NODE-8,transfer-chair",
                        "RES-OTHER,NODE-OTHER,transfer-chair",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Give the route from `NODE-7` and list the required equipment.",
                answerText: "NODE-7 continues through NODE-8; use the verified transfer chair.",
                grounding,
            }),
        ).toEqual(["RES-8"]);
    });

    it("derives only the resource on a verified alphabetic route traversal", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "LINK-AB,NODE-A,NODE-B,open",
                        "LINK-BC,NODE-B,NODE-C,open",
                        "LINK-CD,NODE-C,NODE-D,open",
                    ].join("\n"),
                },
                {
                    content: [
                        "resource_id,node_id,kind",
                        "RES-ROUTE,NODE-B,transfer-chair",
                        "RES-OTHER,NODE-X,transfer-chair",
                    ].join("\n"),
                },
            ],
        });
        const userText = "Starting at NODE-A, give the complete route and list all required resources.";
        const route = "NODE-A → NODE-B → NODE-C → NODE-D";
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText,
                answerText: `Continuous route: ${route}.`,
                grounding,
            }),
        ).toEqual(["RES-ROUTE"]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText,
                answerText: `Continuous route: ${route}. Required resource: RES-ROUTE.`,
                grounding,
            }),
        ).toEqual([]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Starting at NODE-A, give the complete route.",
                answerText: `Continuous route: ${route}.`,
                grounding,
            }),
        ).toEqual([]);
    });

    it("collects a missing route node and its same-row resource in one correction", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "LINK-AB,NODE-A,NODE-B,open",
                        "LINK-BC,NODE-B,NODE-C,open",
                    ].join("\n"),
                },
                {
                    content: "resource_id,node_id,kind\nRES-ROUTE,NODE-B,transfer-chair",
                },
            ],
        });
        const userText = "Starting at NODE-A, give the complete route and list all required equipment.";
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText,
                answerText: "Continuous route: NODE-A → NODE-C.",
                grounding,
            }),
        ).toEqual(["RES-ROUTE", "NODE-B"]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText,
                answerText: "Continuous route: NODE-A → NODE-B → NODE-C. Required equipment: RES-ROUTE.",
                grounding,
            }),
        ).toEqual([]);
    });

    it("uses every internal node of one long verified route as a resource relation seed", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "LINK-AB,NODE-A,NODE-B,open",
                        "LINK-BC,NODE-B,NODE-C,open",
                        "LINK-CD,NODE-C,NODE-D,open",
                        "LINK-DE,NODE-D,NODE-E,open",
                        "LINK-EF,NODE-E,NODE-F,open",
                    ].join("\n"),
                },
                {
                    content: [
                        "resource_id,node_id,kind",
                        "RES-DEEP,NODE-E,route-kit",
                        "RES-OTHER,NODE-X,route-kit",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Starting at NODE-A, give the complete route and list required equipment.",
                answerText: "NODE-A → NODE-B → NODE-C → NODE-D → NODE-E → NODE-F.",
                grounding,
            }),
        ).toEqual(["RES-DEEP"]);
    });

    it("does not derive resources from an ambiguous branch selected only by the draft", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: [
                        "link_id,from_node,to_node,status",
                        "LINK-AJ,NODE-A,NODE-JUNCTION,open",
                        "LINK-JL,NODE-JUNCTION,NODE-LEFT,open",
                        "LINK-LD,NODE-LEFT,NODE-D,open",
                        "LINK-JR,NODE-JUNCTION,NODE-RIGHT,open",
                        "LINK-RD,NODE-RIGHT,NODE-D,open",
                    ].join("\n"),
                },
                {
                    content: [
                        "resource_id,node_id,kind",
                        "RES-LEFT,NODE-LEFT,branch-kit",
                        "RES-RIGHT,NODE-RIGHT,branch-kit",
                    ].join("\n"),
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Starting at NODE-A, give the complete route and list required resources.",
                answerText: "NODE-A → NODE-JUNCTION → NODE-LEFT → NODE-D.",
                grounding,
            }),
        ).toEqual([]);
    });

    it("does not introduce related resource identifiers when equipment was not requested", () => {
        const grounding = JSON.stringify({
            reads: [
                {
                    content: "resource_id,location_id,resource_type\nRES-8,NODE-8,transfer-chair",
                },
            ],
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Give the route from `NODE-7`.",
                answerText: "NODE-7 continues through NODE-8.",
                grounding,
            }),
        ).not.toContain("RES-8");
    });

    it("requires every restrictive row ID in the one trusted scope selected by the user's state re-evaluation", () => {
        const userText =
            "A coworker says ZONE-B looks restored and may be reopened. Update the timeline and recompute what changed and what remains unchanged.";
        const grounding = restrictiveStateGrounding(neutralStateReads());

        expect(
            missingRequiredKnowledgeIdentifiers({
                userText,
                answerText: "ZONE-B remains unavailable; the unrelated ZONE-X branch OVR-CASE7-XY is unchanged.",
                grounding,
            }),
        ).toEqual(["OVR-CASE7-AB", "OVR-CASE7-CB"]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText,
                answerText: "ZONE-B remains unavailable under OVR-CASE7-AB and OVR-CASE7-CB.",
                grounding,
            }),
        ).toEqual([]);
    });

    it("uses an exactly bound catalog relation when the read summary is compact", () => {
        const reads = neutralStateReads();
        const catalogSummaries = reads.map((read) => read.tableSummary);
        reads[1] = {
            ...reads[1],
            tableSummary: {
                ...(reads[1]?.tableSummary as Record<string, unknown>),
                assetId: undefined,
                relations: undefined,
            },
        };
        const grounding = JSON.stringify({
            status: "ok",
            reads,
            search: {
                hits: [
                    {
                        assetId: NEUTRAL_ASSET_ID,
                        path: "docs/current-note.md",
                        resource: `asset://${NEUTRAL_ASSET_ID}/docs/current-note.md`,
                    },
                ],
                tableSummaries: catalogSummaries,
            },
            coverage: { indexRevision: NEUTRAL_REVISION },
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may be reopened. Update the timeline and recompute its current state.",
                answerText: "ZONE-B remains restricted.",
                grounding,
            }),
        ).toEqual(["OVR-CASE7-AB", "OVR-CASE7-CB"]);
    });

    it.each([
        "missing",
        "wrong-resource",
    ])("does not use a %s catalog relation to expand a compact state receipt", (catalogMode) => {
        const reads = neutralStateReads();
        const catalogSummaries = reads.map((read) => read.tableSummary as Record<string, unknown>);
        reads[1] = {
            ...reads[1],
            tableSummary: {
                ...(reads[1]?.tableSummary as Record<string, unknown>),
                assetId: undefined,
                relations: undefined,
            },
        };
        const stateCatalog = catalogSummaries[1];
        const visibleCatalog =
            catalogMode === "missing"
                ? catalogSummaries.filter((_, index) => index !== 1)
                : catalogSummaries.map((summary, index) =>
                      index === 1
                          ? {
                                ...summary,
                                resource: `asset://${NEUTRAL_ASSET_ID}/data/other-overrides.csv`,
                            }
                          : summary,
                  );
        expect(stateCatalog?.relations).toBeDefined();
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may be reopened. Update the timeline and recompute its current state.",
                answerText: "ZONE-B remains restricted.",
                grounding: JSON.stringify({
                    status: "ok",
                    reads,
                    search: { tableSummaries: visibleCatalog },
                    coverage: { indexRevision: NEUTRAL_REVISION },
                }),
            }),
        ).toEqual([]);
    });

    it("uses an exactly bound relation retained only by the trusted continuation accumulator", () => {
        const reads = neutralStateReads();
        const catalogSummaries = reads.map((read) => read.tableSummary);
        reads[1] = {
            ...reads[1],
            tableSummary: {
                ...(reads[1]?.tableSummary as Record<string, unknown>),
                assetId: undefined,
                relations: undefined,
            },
        };
        const grounding = JSON.stringify({
            status: "ok",
            reads,
            search: { tableSummaries: [] },
            coverage: {
                indexRevision: NEUTRAL_REVISION,
                accumulator: {
                    indexRevision: NEUTRAL_REVISION,
                    trustedTableSummaries: catalogSummaries,
                },
            },
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may be reopened. Update the timeline and recompute its current state.",
                answerText: "ZONE-B remains restricted.",
                grounding,
            }),
        ).toEqual(["OVR-CASE7-AB", "OVR-CASE7-CB"]);
    });

    it("rejects conflicting catalog relation targets for the same source column", () => {
        const reads = neutralStateReads();
        const catalogSummaries = reads.map((read) => read.tableSummary as Record<string, unknown>);
        reads[1] = {
            ...reads[1],
            tableSummary: {
                ...(reads[1]?.tableSummary as Record<string, unknown>),
                relations: undefined,
            },
        };
        const conflictingCatalog = catalogSummaries.map((summary, index) =>
            index === 1
                ? {
                      ...summary,
                      relations: [
                          ...((summary.relations as unknown[]) ?? []),
                          {
                              sourceColumn: "link_id",
                              targetPath: "data/other-links.csv",
                              targetColumn: "link_id",
                              confidence: "high",
                          },
                      ],
                  }
                : summary,
        );
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may reopen. Update the timeline and recompute its current state.",
                answerText: "ZONE-B remains restricted.",
                grounding: JSON.stringify({
                    status: "ok",
                    reads,
                    search: { tableSummaries: catalogSummaries },
                    coverage: {
                        indexRevision: NEUTRAL_REVISION,
                        accumulator: {
                            indexRevision: NEUTRAL_REVISION,
                            trustedTableSummaries: conflictingCatalog,
                        },
                    },
                }),
            }),
        ).toEqual([]);
    });

    it("merges consistent exact receipts from the same source before joining state to topology", () => {
        const base = neutralStateReads();
        const stateSummary = base[1]?.tableSummary as Record<string, unknown>;
        const relations = stateSummary.relations as Array<{
            sourceColumn: string;
            targetPath: string;
            targetColumn: string;
            confidence: "declared" | "high";
        }>;
        const reads = [
            trustedCsvRead({
                path: "data/links.csv",
                content: "link_id,from_location,to_location\nLINK-AB,ZONE-A,ZONE-B",
                primaryKey: "link_id",
            }),
            trustedCsvRead({
                path: "data/links.csv",
                content: "link_id,from_location,to_location\nLINK-CB,ZONE-C,ZONE-B",
                primaryKey: "link_id",
            }),
            trustedCsvRead({
                path: "data/overrides.csv",
                content: "override_id,case_id,link_id,state\nOVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                primaryKey: "override_id",
                relations,
            }),
            trustedCsvRead({
                path: "data/overrides.csv",
                content: "override_id,case_id,link_id,state\nOVR-CASE7-CB,CASE-7,LINK-CB,restricted",
                primaryKey: "override_id",
                relations,
            }),
            base[2] ?? {},
        ];
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may be reopened. Update the timeline and recompute what remains unchanged.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual(["OVR-CASE7-AB", "OVR-CASE7-CB"]);
    });

    it("drops a source when two trusted receipts conflict on the same primary key", () => {
        const base = neutralStateReads();
        const reads = [
            trustedCsvRead({
                path: "data/links.csv",
                content: "link_id,from_location,to_location\nLINK-AB,ZONE-A,ZONE-B",
                primaryKey: "link_id",
            }),
            trustedCsvRead({
                path: "data/links.csv",
                content: "link_id,from_location,to_location\nLINK-AB,ZONE-X,ZONE-Y",
                primaryKey: "link_id",
            }),
            base[1] ?? {},
            base[2] ?? {},
        ];
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may be reopened. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains blocked.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual([]);
    });

    it.each([
        ["first endpoint last", ["LINK-AB,ZONE-A,ZONE-B", "LINK-AB,ZONE-X,ZONE-Y"]],
        ["second endpoint last", ["LINK-AB,ZONE-X,ZONE-Y", "LINK-AB,ZONE-A,ZONE-B"]],
    ])("drops one topology receipt with a conflicting duplicate primary key (%s)", (_label, rows) => {
        const reads = neutralStateReads();
        reads[0] = trustedCsvRead({
            path: "data/links.csv",
            content: ["link_id,from_location,to_location", ...rows].join("\n"),
            primaryKey: "link_id",
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it.each([
        ["adjacent", ["LINK-AB,ZONE-A,ZONE-B", "LINK-AB,ZONE-A,ZONE-B", "LINK-CB,ZONE-C,ZONE-B"]],
        ["separated", ["LINK-AB,ZONE-A,ZONE-B", "LINK-CB,ZONE-C,ZONE-B", "LINK-AB,ZONE-A,ZONE-B"]],
    ])("drops one topology receipt with an identical duplicate primary key (%s)", (_label, rows) => {
        const reads = neutralStateReads();
        reads[0] = trustedCsvRead({
            path: "data/links.csv",
            content: ["link_id,from_location,to_location", ...rows].join("\n"),
            primaryKey: "link_id",
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it.each([
        ["restrictive row first", ["OVR-DUP,CASE-7,LINK-AB,blocked", "OVR-DUP,CASE-8,LINK-XY,open"]],
        ["restrictive row last", ["OVR-DUP,CASE-8,LINK-XY,open", "OVR-DUP,CASE-7,LINK-AB,blocked"]],
    ])("drops one state receipt with a conflicting duplicate primary key (%s)", (_label, rows) => {
        const reads = neutralStateReads();
        const stateSummary = reads[1]?.tableSummary as Record<string, unknown>;
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: ["override_id,case_id,link_id,state", ...rows].join("\n"),
            primaryKey: "override_id",
            relations: stateSummary.relations as Array<{
                sourceColumn: string;
                targetPath: string;
                targetColumn: string;
                confidence: "declared" | "high";
            }>,
        });
        reads[2] = trustedCsvRead({
            path: "data/cases.csv",
            content: "case_id,title\nCASE-7,First case\nCASE-8,Second case",
            primaryKey: "case_id",
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it.each([
        [
            "adjacent",
            [
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                "OVR-CASE7-CB,CASE-7,LINK-CB,restricted",
            ],
        ],
        [
            "separated",
            [
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                "OVR-CASE7-CB,CASE-7,LINK-CB,restricted",
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
            ],
        ],
    ])("rejects an identical duplicate state primary key within one receipt (%s)", (_label, stateRows) => {
        const reads = neutralStateReads();
        const stateSummary = reads[1]?.tableSummary as Record<string, unknown>;
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: ["override_id,case_id,link_id,state", ...stateRows].join("\n"),
            primaryKey: "override_id",
            relations: stateSummary.relations as Array<{
                sourceColumn: string;
                targetPath: string;
                targetColumn: string;
                confidence: "declared" | "high";
            }>,
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it("drops a receipt containing an empty primary key", () => {
        const reads = neutralStateReads();
        const stateSummary = reads[1]?.tableSummary as Record<string, unknown>;
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: "override_id,case_id,link_id,state\n,CASE-7,LINK-AB,blocked",
            primaryKey: "override_id",
            relations: stateSummary.relations as Array<{
                sourceColumn: string;
                targetPath: string;
                targetColumn: string;
                confidence: "declared" | "high";
            }>,
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it("keeps identical rows from separate selector receipts valid while rejecting source-local duplicates", () => {
        const base = neutralStateReads();
        const state = base[1] ?? {};
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding([base[0] ?? {}, state, state, base[2] ?? {}]),
            }),
        ).toEqual({
            missingIdentifiers: ["OVR-CASE7-AB", "OVR-CASE7-CB"],
            unresolvedEvidence: false,
        });
    });

    it("blocks a partial answer when one matching restrictive row has no retainable primary key", () => {
        const reads = neutralStateReads();
        const relations = (reads[1]?.tableSummary as Record<string, unknown>).relations as Array<{
            sourceColumn: string;
            targetPath: string;
            targetColumn: string;
            confidence: "declared" | "high";
        }>;
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: [
                "override_id,case_id,link_id,state",
                "OVR-VALID,CASE-7,LINK-AB,blocked",
                "INVALID,CASE-7,LINK-CB,restricted",
            ].join("\n"),
            primaryKey: "override_id",
            relations,
        });
        const analysis = analyzeKnowledgeAnswerCompleteness({
            userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
            answerText: "ZONE-B remains unavailable under OVR-VALID.",
            grounding: restrictiveStateGrounding(reads),
        });
        expect(analysis).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
        expect(JSON.stringify(analysis)).not.toContain("INVALID");
    });

    it("does not let an invalid row on an unrelated endpoint poison the selected scope", () => {
        const reads = neutralStateReads();
        const relations = (reads[1]?.tableSummary as Record<string, unknown>).relations as Array<{
            sourceColumn: string;
            targetPath: string;
            targetColumn: string;
            confidence: "declared" | "high";
        }>;
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: [
                "override_id,case_id,link_id,state",
                "OVR-VALID,CASE-7,LINK-AB,blocked",
                "INVALID,CASE-7,LINK-XY,restricted",
            ].join("\n"),
            primaryKey: "override_id",
            relations,
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual({ missingIdentifiers: ["OVR-VALID"], unresolvedEvidence: false });
    });

    it.each([
        "missing",
        "conflicting-owner",
        "invalid-owner",
    ])("requires every declared scope binding and a valid unique owner (%s)", (mode) => {
        const base = neutralStateReads();
        const stateRelations = [
            ...(((base[1]?.tableSummary as Record<string, unknown>).relations as unknown[]) ?? []),
            {
                sourceColumn: "tenant_id",
                targetPath: "data/tenants.csv",
                targetColumn: "tenant_id",
                confidence: "declared",
            },
        ] as Array<{
            sourceColumn: string;
            targetPath: string;
            targetColumn: string;
            confidence: "declared" | "high";
        }>;
        const reads = [
            base[0] ?? {},
            trustedCsvRead({
                path: "data/overrides.csv",
                content: "override_id,case_id,tenant_id,link_id,state\nOVR-VALID,CASE-7,TENANT-1,LINK-AB,blocked",
                primaryKey: "override_id",
                relations: stateRelations,
            }),
            base[2] ?? {},
        ];
        if (mode === "conflicting-owner") {
            reads.push(
                trustedCsvRead({
                    path: "data/tenants.csv",
                    content: "tenant_id,title\nTENANT-1,First title",
                    primaryKey: "tenant_id",
                }),
                trustedCsvRead({
                    path: "data/tenants.csv",
                    content: "tenant_id,title\nTENANT-1,Conflicting title",
                    primaryKey: "tenant_id",
                }),
            );
        } else if (mode === "invalid-owner") {
            reads.push(
                trustedCsvRead({
                    path: "data/tenants.csv",
                    content: "tenant_id,title\nBAD VALUE,Invalid owner",
                    primaryKey: "tenant_id",
                }),
            );
        }
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable under OVR-VALID.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it("ignores stale continuation catalog relations and blocks revision-changed coverage", () => {
        const reads = neutralStateReads();
        const currentCatalog = reads.map((read) => read.tableSummary as Record<string, unknown>);
        reads[1] = {
            ...reads[1],
            tableSummary: {
                ...(reads[1]?.tableSummary as Record<string, unknown>),
                relations: undefined,
            },
        };
        const currentWithoutRelations = reads.map((read) => read.tableSummary).filter(Boolean);
        const input = {
            userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
            answerText: "ZONE-B remains unavailable.",
        };
        expect(
            analyzeKnowledgeAnswerCompleteness({
                ...input,
                grounding: JSON.stringify({
                    status: "ok",
                    reads,
                    search: { tableSummaries: currentWithoutRelations },
                    coverage: {
                        indexRevision: NEUTRAL_REVISION,
                        accumulator: {
                            indexRevision: "revision-old",
                            trustedTableSummaries: currentCatalog,
                        },
                    },
                }),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: false });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                ...input,
                grounding: JSON.stringify({
                    status: "ok",
                    reads: neutralStateReads(),
                    search: { tableSummaries: currentCatalog },
                    coverage: {
                        status: "blocked",
                        indexRevision: NEUTRAL_REVISION,
                        facets: [{ status: "stale", reason: "revision_changed" }],
                    },
                }),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: false });
    });

    it.each([
        "state-columns",
        "endpoint-columns",
    ])("marks request-intersecting ambiguous semantic columns unresolved (%s)", (mode) => {
        const reads = neutralStateReads();
        if (mode === "state-columns") {
            const relations = (reads[1]?.tableSummary as Record<string, unknown>).relations as Array<{
                sourceColumn: string;
                targetPath: string;
                targetColumn: string;
                confidence: "declared" | "high";
            }>;
            reads[1] = trustedCsvRead({
                path: "data/overrides.csv",
                content: "override_id,case_id,link_id,state,status\nOVR-VALID,CASE-7,LINK-AB,blocked,open",
                primaryKey: "override_id",
                relations,
            });
        } else {
            reads[0] = trustedCsvRead({
                path: "data/links.csv",
                content: "link_id,from_location,source_location,to_location\nLINK-AB,ZONE-A,ZONE-X,ZONE-B",
                primaryKey: "link_id",
            });
        }
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it("marks a unique scope with more than the bounded identifier set unresolved instead of passing empty", () => {
        const linkRows = Array.from({ length: 17 }, (_, index) => {
            const suffix = String(index + 1).padStart(2, "0");
            return `LINK-${suffix},ZONE-${suffix},ZONE-B`;
        });
        const stateRows = Array.from({ length: 17 }, (_, index) => {
            const suffix = String(index + 1).padStart(2, "0");
            return `OVR-${suffix},CASE-7,LINK-${suffix},blocked`;
        });
        const reads = [
            trustedCsvRead({
                path: "data/links.csv",
                content: ["link_id,from_location,to_location", ...linkRows].join("\n"),
                primaryKey: "link_id",
            }),
            trustedCsvRead({
                path: "data/overrides.csv",
                content: ["override_id,case_id,link_id,state", ...stateRows].join("\n"),
                primaryKey: "override_id",
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
            }),
            trustedCsvRead({
                path: "data/cases.csv",
                content: "case_id,title\nCASE-7,Neutral case",
                primaryKey: "case_id",
            }),
        ];
        const analysis = analyzeKnowledgeAnswerCompleteness({
            userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
            answerText: "ZONE-B remains unavailable.",
            grounding: restrictiveStateGrounding(reads),
        });
        expect(analysis).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
        expect(JSON.stringify(analysis)).not.toContain("OVR-");
    });

    it("uses only user-selected topology endpoints and never lets the draft choose an unrelated restrictive branch", () => {
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Update the current status: can ZONE-B be reopened, and what remains unchanged?",
                answerText: "The draft discusses ZONE-X and OVR-CASE7-XY, but ZONE-B remains restricted.",
                grounding: restrictiveStateGrounding(neutralStateReads()),
            }),
        ).toEqual(["OVR-CASE7-AB", "OVR-CASE7-CB"]);
    });

    it("accepts a bounded mixed letter-digit endpoint segment only after the trusted topology proves it", () => {
        const reads = [
            trustedCsvRead({
                path: "data/links.csv",
                content: "link_id,from_location,to_location\nLINK-Z2,LEVEL-10-EAST,LEVEL-10-Z2",
                primaryKey: "link_id",
            }),
            trustedCsvRead({
                path: "data/overrides.csv",
                content: "override_id,case_id,link_id,status\nOVR-CASE7-Z2,CASE-7,LINK-Z2,closed",
                primaryKey: "override_id",
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
            }),
            trustedCsvRead({
                path: "data/cases.csv",
                content: "case_id,title\nCASE-7,Neutral case",
                primaryKey: "case_id",
            }),
        ];
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "A report says Z2 is restored. Update the timeline and recompute the current status.",
                answerText: "Z2 remains closed.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual(["OVR-CASE7-Z2"]);
    });

    it("requires every restrictive primary key joined to the same user-selected endpoint in one scope", () => {
        const reads = [
            trustedCsvRead({
                path: "data/links.csv",
                content: [
                    "link_id,from_location,to_location",
                    "LINK-L10-EZ2,LEVEL10-EAST,LEVEL10-Z2",
                    "LINK-L10-CZ2,LEVEL10-CENTER,LEVEL10-Z2",
                ].join("\n"),
                primaryKey: "link_id",
            }),
            trustedCsvRead({
                path: "data/overrides.csv",
                content: [
                    "override_id,case_id,link_id,state",
                    "STATE-CASE7-02,CASE-7,LINK-L10-EZ2,blocked",
                    "STATE-CASE7-03,CASE-7,LINK-L10-CZ2,restricted",
                ].join("\n"),
                primaryKey: "override_id",
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
            }),
            trustedCsvRead({
                path: "data/cases.csv",
                content: "case_id,title\nCASE-7,Neutral case",
                primaryKey: "case_id",
            }),
        ].map((read) => {
            // The production grounding compactor removes the raw snapshot
            // after knowledge_read has enforced expectedRevision.
            const { indexSnapshot: _removedByCompaction, ...compactRead } = read;
            return compactRead;
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText:
                    "A colleague says Z2 has been restored and may reopen. Update the timeline, recompute, and state what changed or remains unchanged.",
                answerText: "Z2 remains blocked.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual(["STATE-CASE7-02", "STATE-CASE7-03"]);
    });

    it("does not infer restrictive IDs when the matching endpoint spans more than one trusted scope", () => {
        const reads = neutralStateReads();
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: [
                "override_id,case_id,link_id,state",
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                "OVR-CASE8-AB,CASE-8,LINK-AB,blocked",
            ].join("\n"),
            primaryKey: "override_id",
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
        });
        reads[2] = trustedCsvRead({
            path: "data/cases.csv",
            content: "case_id,title\nCASE-7,First neutral case\nCASE-8,Second neutral case",
            primaryKey: "case_id",
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may be restored. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains blocked.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it("uses one revision-pinned exact verified-history owner to scope a follow-up state re-evaluation", () => {
        const reads = neutralStateReads();
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: [
                "override_id,case_id,link_id,state",
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                "OVR-CASE8-AB,CASE-8,LINK-AB,blocked",
            ].join("\n"),
            primaryKey: "override_id",
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
        });
        reads[2] = trustedCsvRead({
            path: "data/cases.csv",
            content: "case_id,title\nCASE-7,First neutral case\nCASE-8,Second neutral case",
            primaryKey: "case_id",
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may be restored. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains blocked.",
                grounding: restrictiveStateGroundingWithVerifiedHistoryScope(reads, ["CASE-7"], {
                    searchGroups: [],
                }),
            }),
        ).toEqual({ missingIdentifiers: ["OVR-CASE7-AB"], unresolvedEvidence: false });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may be restored. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains blocked.",
                grounding: restrictiveStateGroundingWithVerifiedHistoryScope(reads, ["case-7"], {
                    searchGroups: [],
                }),
            }),
        ).toEqual({ missingIdentifiers: ["OVR-CASE7-AB"], unresolvedEvidence: false });
    });

    it("keeps a multi-scope follow-up fail-closed when verified history names more than one owner", () => {
        const reads = neutralStateReads();
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: [
                "override_id,case_id,link_id,state",
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                "OVR-CASE8-AB,CASE-8,LINK-AB,blocked",
            ].join("\n"),
            primaryKey: "override_id",
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
        });
        reads[2] = trustedCsvRead({
            path: "data/cases.csv",
            content: "case_id,title\nCASE-7,First neutral case\nCASE-8,Second neutral case",
            primaryKey: "case_id",
        });
        const analyze = (grounding: string, userText = "ZONE-B may reopen. Update the timeline and recompute.") =>
            analyzeKnowledgeAnswerCompleteness({ userText, answerText: "ZONE-B remains blocked.", grounding });

        expect(analyze(restrictiveStateGroundingWithVerifiedHistoryScope(reads, ["CASE-7", "CASE-8"]))).toEqual({
            missingIdentifiers: [],
            unresolvedEvidence: true,
        });
        expect(
            analyze(
                restrictiveStateGroundingWithVerifiedHistoryScope(reads, ["CASE-7"]),
                "CASE-8 says ZONE-B may reopen. Update the timeline and recompute.",
            ),
        ).toEqual({ missingIdentifiers: ["CASE-8"], unresolvedEvidence: true });
    });

    it.each([
        ["exact", ["CASE-7", "CASE-7"]],
        ["case-equivalent", ["CASE-7", "case-7"]],
        ["NFKC-equivalent", ["CASE-7", "ＣＡＳＥ－７"]],
    ])("rejects %s duplicate verified-history owner locators before scope selection", (_label, values) => {
        const reads = neutralStateReads();
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: [
                "override_id,case_id,link_id,state",
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                "OVR-CASE8-AB,CASE-8,LINK-AB,blocked",
            ].join("\n"),
            primaryKey: "override_id",
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
        });
        reads[2] = trustedCsvRead({
            path: "data/cases.csv",
            content: "case_id,title\nCASE-7,First neutral case\nCASE-8,Second neutral case",
            primaryKey: "case_id",
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute.",
                answerText: "ZONE-B remains blocked.",
                grounding: restrictiveStateGroundingWithVerifiedHistoryScope(reads, values, { searchGroups: [] }),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it.each([
        ["revision", { expectedRevision: "revision-other" }],
        ["asset-prefixed pointer revision", { expectedRevision: `${NEUTRAL_ASSET_ID}:${NEUTRAL_REVISION}` }],
        [
            "multi-asset pointer revision",
            { expectedRevision: `${NEUTRAL_ASSET_ID}:${NEUTRAL_REVISION}|asset-other:revision-other` },
        ],
        ["accumulator revision", { accumulatorRevision: "revision-other" }],
        ["pointer path", { pointerPath: "data/other-cases.csv" }],
        ["pointer owner", { pointerAssetId: "asset-other" }],
        ["missing pointer key", { omitPointerKey: true }],
        ["empty pointer key", { pointerKey: "" }],
        ["pointer key owner", { pointerKey: "asset-other:source:data/cases.csv#0" }],
        ["pointer key path", { pointerKey: `${NEUTRAL_ASSET_ID}:source:data/other-cases.csv#0` }],
        ["out-of-range search group", { searchGroups: [9] }],
        ["fractional search group", { searchGroups: [1.5] }],
        ["non-numeric search group", { searchGroups: ["1"] }],
        ["duplicate search group", { searchGroups: [1, 1] }],
        ["empty pointer filters", { pointerFilters: [] }],
        ["pointer filters", { pointerFilters: [{ column: "case_id", op: "eq", value: ["CASE-7"] }] }],
        ["empty selector filters", { selectorFilters: [] }],
        ["selector filters", { selectorFilters: [{ column: "case_id", op: "eq", value: ["CASE-7"] }] }],
        ["duplicate obligation", { obligationIds: ["verified-history-locators", "verified-history-locators"] }],
        [
            "mixed-source pointer locator",
            {
                pointerLocators: [
                    {
                        assetId: NEUTRAL_ASSET_ID,
                        path: "data/cases.csv",
                        kind: "record",
                        value: "CASE-7",
                    },
                    {
                        assetId: NEUTRAL_ASSET_ID,
                        path: "data/other-cases.csv",
                        kind: "record",
                        value: "CASE-9",
                    },
                ],
            },
        ],
        ["selector path", { selectorPath: "data/other-cases.csv" }],
        ["selector kind", { selectorKind: "semantic" }],
        ["pointer identifier", { pointerIdentifiers: ["CASE-OTHER"] }],
        ["selector identifier", { selectorIdentifiers: ["CASE-OTHER"] }],
        ["obligation", { obligationId: "semantic:1" }],
        ["completion", { completion: "readable_evidence" }],
        ["coverage status", { status: "partial" }],
        ["missing raw receipt version", { coverageOverrides: { version: undefined } }],
        [
            "forged continuation envelope",
            { coverageOverrides: { version: undefined, protocolVersion: 1, unresolved: [] } },
        ],
        ["mixed raw and continuation envelope", { coverageOverrides: { protocolVersion: 1, unresolved: [] } }],
        ["raw receipt verified count", { coverageOverrides: { verified: 0 } }],
        ["raw receipt missing count", { coverageOverrides: { missing: 1 } }],
        ["raw receipt cursor", { coverageOverrides: { hasMore: true, nextSearchCursor: "cursor-next" } }],
        ["raw receipt truncation", { coverageOverrides: { resultTruncated: true } }],
        ["raw receipt accumulator truncation", { accumulatorEvidenceTruncated: true }],
        ["raw receipt missing identifiers", { coverageOverrides: { missingIdentifiers: ["CASE-7"] } }],
        [
            "uncovered raw receipt facet",
            {
                coverageOverrides: {
                    facets: [
                        {
                            id: "verified-history-locators",
                            query: "revalidate verified history locators",
                            status: "uncovered",
                            selectedPaths: [],
                        },
                    ],
                },
            },
        ],
    ])("does not use verified-history scope with a mismatched %s binding", (_label, overrides) => {
        const reads = neutralStateReads();
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: [
                "override_id,case_id,link_id,state",
                "OVR-CASE7-AB,CASE-7,LINK-AB,blocked",
                "OVR-CASE8-AB,CASE-8,LINK-AB,blocked",
            ].join("\n"),
            primaryKey: "override_id",
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
        });
        reads[2] = trustedCsvRead({
            path: "data/cases.csv",
            content: "case_id,title\nCASE-7,First neutral case\nCASE-8,Second neutral case",
            primaryKey: "case_id",
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute.",
                answerText: "ZONE-B remains blocked.",
                grounding: restrictiveStateGroundingWithVerifiedHistoryScope(reads, ["CASE-7"], {
                    searchGroups: [],
                    ...overrides,
                }),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it("keeps a covered verified-history facet unresolved when its trusted pointer is absent", () => {
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute.",
                answerText: "ZONE-B remains blocked.",
                grounding: restrictiveStateGroundingWithVerifiedHistoryScope(neutralStateReads(), ["CASE-7"], {
                    searchGroups: [],
                    omitTrustedEvidence: true,
                }),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it("treats the same scope value in two assets as ambiguous rather than merging their state rows", () => {
        const primaryReads = neutralStateReads();
        const secondaryReads = neutralStateReads().map((read) => {
            const prior = read as { content: string; path: string; tableSummary: Record<string, unknown> };
            const primaryKey = String(prior.tableSummary.primaryKey ?? "");
            const relations = prior.tableSummary.relations as Array<{
                sourceColumn: string;
                targetPath: string;
                targetColumn: string;
                confidence: "declared" | "high";
            }>;
            return trustedCsvRead({
                path: prior.path,
                content: prior.content.replaceAll("OVR-CASE7", "OVR-OTHER"),
                primaryKey,
                relations,
                assetId: "asset-secondary-state",
            });
        });
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may be restored. Update the timeline and recompute the current status.",
                answerText: "ZONE-B remains blocked.",
                grounding: restrictiveStateGrounding([...primaryReads, ...secondaryReads]),
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
    });

    it.each([
        ["failed", { __knowledgeReadFailed: true }],
        ["stale", { __knowledgeRevisionChanged: true }],
        ["truncated", { __knowledgeReadTruncated: true }],
        ["content-truncated", { __knowledgeContentTruncated: true }],
        ["error-status", { status: "error" }],
    ])("does not infer restrictive IDs from a %s state receipt", (_label, overrides) => {
        const reads = neutralStateReads();
        reads[1] = { ...reads[1], ...overrides };
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may be restored. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains blocked.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual([]);
    });

    it("treats the truncation marker as control data only at the normalized content suffix", () => {
        const notice = "[Knowledge read truncated by the grounding byte budget.]";
        const embedded = neutralStateReads();
        embedded[0] = trustedCsvRead({
            path: "data/links.csv",
            content: [
                "link_id,from_location,to_location,note",
                `LINK-AB,ZONE-A,ZONE-B,${notice}`,
                "LINK-CB,ZONE-C,ZONE-B,complete",
            ].join("\n"),
            primaryKey: "link_id",
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(embedded),
            }),
        ).toEqual(["OVR-CASE7-AB", "OVR-CASE7-CB"]);

        const suffixed = neutralStateReads();
        const relations = (suffixed[1]?.tableSummary as Record<string, unknown>).relations as Array<{
            sourceColumn: string;
            targetPath: string;
            targetColumn: string;
            confidence: "declared" | "high";
        }>;
        suffixed[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: `override_id,case_id,link_id,state,note\nOVR-VALID,CASE-7,LINK-AB,blocked,${notice}`,
            primaryKey: "override_id",
            relations,
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: "ZONE-B remains unavailable.",
                grounding: restrictiveStateGrounding(suffixed),
            }),
        ).toEqual([]);
    });

    it("rejects wrong asset, path, revision, and missing topology joins for restrictive-state inference", () => {
        const assertNoInference = (reads: Record<string, unknown>[]) =>
            expect(
                missingRequiredKnowledgeIdentifiers({
                    userText: "ZONE-B may be reopened. Update the timeline and recompute what remains unchanged.",
                    answerText: "ZONE-B remains blocked.",
                    grounding: restrictiveStateGrounding(reads),
                }),
            ).toEqual([]);

        const wrongAsset = neutralStateReads();
        wrongAsset[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: String((wrongAsset[1] as { content?: unknown }).content ?? ""),
            primaryKey: "override_id",
            assetId: "asset-other",
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
        });
        assertNoInference(wrongAsset);

        const wrongPath = neutralStateReads();
        wrongPath[1] = {
            ...wrongPath[1],
            tableSummary: {
                ...(wrongPath[1]?.tableSummary as Record<string, unknown>),
                path: "data/other.csv",
            },
        };
        assertNoInference(wrongPath);

        const wrongRevision = neutralStateReads();
        wrongRevision[1] = { ...wrongRevision[1], __knowledgeExpectedRevision: "revision-other" };
        assertNoInference(wrongRevision);

        const noJoin = neutralStateReads();
        noJoin[1] = {
            ...noJoin[1],
            tableSummary: {
                ...(noJoin[1]?.tableSummary as Record<string, unknown>),
                relations: [
                    {
                        sourceColumn: "case_id",
                        targetPath: "data/cases.csv",
                        targetColumn: "case_id",
                        confidence: "high",
                    },
                    {
                        sourceColumn: "link_id",
                        targetPath: "data/missing-links.csv",
                        targetColumn: "link_id",
                        confidence: "high",
                    },
                ],
            },
        };
        assertNoInference(noJoin);

        const missingScopeOwner = neutralStateReads().filter(
            (read) => (read as { path?: unknown }).path !== "data/cases.csv",
        );
        assertNoInference(missingScopeOwner);

        const malformed = neutralStateReads();
        malformed[1] = {
            ...malformed[1],
            content: 'override_id,case_id,link_id,state\n"OVR-CASE7-AB,CASE-7,LINK-AB,blocked',
        };
        assertNoInference(malformed);
    });

    it("does not derive row IDs from open states or unrelated update requests", () => {
        const reads = neutralStateReads();
        reads[1] = trustedCsvRead({
            path: "data/overrides.csv",
            content: "override_id,case_id,link_id,state\nOVR-CASE7-OPEN,CASE-7,LINK-AB,open",
            primaryKey: "override_id",
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
        });
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "ZONE-B may be reopened. Update the timeline and recompute the current state.",
                answerText: "ZONE-B is open.",
                grounding: restrictiveStateGrounding(reads),
            }),
        ).toEqual([]);
        expect(
            missingRequiredKnowledgeIdentifiers({
                userText: "Update the document title for ZONE-B.",
                answerText: "The title was updated.",
                grounding: restrictiveStateGrounding(neutralStateReads()),
            }),
        ).toEqual([]);
    });
});
