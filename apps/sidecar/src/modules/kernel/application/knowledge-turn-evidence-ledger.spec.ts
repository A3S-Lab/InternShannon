import { KNOWLEDGE_READ_RUNTIME_TOOL_NAME } from "./capabilities-runtime.constants";
import { finalizeKnowledgeAnswer } from "./knowledge-source-reference";
import {
    KnowledgeTurnEvidenceLedger,
    redundantGroundedSkillName,
    redundantParentGroundingToolName,
} from "./knowledge-turn-evidence-ledger";

describe("knowledge turn evidence ledger", () => {
    const parentGrounding = JSON.stringify({
        status: "ok",
        reads: [
            {
                title: "base.csv",
                content: "id,status\nB-1,open",
                resource: "asset://asset-1/raw/sources/base.csv",
            },
        ],
    });

    it("merges successful direct knowledge-tool reads into the final citation evidence", () => {
        const ledger = new KnowledgeTurnEvidenceLedger(parentGrounding);
        expect(
            ledger.recordToolResult(
                KNOWLEDGE_READ_RUNTIME_TOOL_NAME,
                JSON.stringify({
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                title: "details.csv",
                                content: "id,value\nD-1,verified",
                                resource: "asset://asset-1/raw/sources/details.csv",
                            }),
                        },
                    ],
                }),
            ),
        ).toBe(true);

        const answer = finalizeKnowledgeAnswer("[[K1:B-1]] [details.csv，记录 ID：D-1]", ledger.grounding());
        expect(answer.unverifiedCitationCount).toBe(0);
        expect(answer.sources.map((source) => source.relativePath)).toEqual([
            "raw/sources/base.csv",
            "raw/sources/details.csv",
        ]);
    });

    it("ignores failed, non-knowledge, and resource-free tool outputs", () => {
        const ledger = new KnowledgeTurnEvidenceLedger(parentGrounding);
        expect(ledger.recordToolResult(KNOWLEDGE_READ_RUNTIME_TOOL_NAME, "not json")).toBe(false);
        expect(
            ledger.recordToolResult(
                KNOWLEDGE_READ_RUNTIME_TOOL_NAME,
                JSON.stringify({ resource: "asset://asset-1/raw/sources/failed.csv", content: "id\nF-1" }),
                true,
            ),
        ).toBe(false);
        expect(
            ledger.recordToolResult(
                "Bash",
                JSON.stringify({ resource: "asset://asset-1/raw/sources/untrusted.csv", content: "id\nU-1" }),
            ),
        ).toBe(false);
        expect(finalizeKnowledgeAnswer("[[K2:F-1]]", ledger.grounding()).unverifiedCitationCount).toBe(1);
    });

    it("recognizes only the explicitly requested or configured redundant Skill", () => {
        expect(
            redundantGroundedSkillName({
                toolName: "Skill",
                toolInput: { skill_name: "fire-evacuation-simulation" },
                userContent: "请使用 $fire-evacuation-simulation 回答",
                configuredSkills: [],
                previouslyCompletedSkills: new Set(["fire-evacuation-simulation"]),
                hasTrustedGrounding: true,
            }),
        ).toBe("fire-evacuation-simulation");
        expect(
            redundantGroundedSkillName({
                toolName: "Skill",
                toolInput: { skill_name: "other-skill" },
                userContent: "请使用 $fire-evacuation-simulation 回答",
                configuredSkills: [],
                previouslyCompletedSkills: new Set(["other-skill"]),
                hasTrustedGrounding: true,
            }),
        ).toBeNull();
        expect(
            redundantGroundedSkillName({
                toolName: "Skill",
                toolInput: { skill_name: "fire-evacuation-simulation" },
                userContent: "请使用 $fire-evacuation-simulation 回答",
                configuredSkills: [],
                previouslyCompletedSkills: new Set(["fire-evacuation-simulation"]),
                hasTrustedGrounding: false,
            }),
        ).toBeNull();
    });

    it("allows the first same-skill invocation so its instruction contract can load", () => {
        expect(
            redundantGroundedSkillName({
                toolName: "Skill",
                toolInput: { skill_name: "fire-evacuation-simulation" },
                userContent: "请使用 $fire-evacuation-simulation 回答",
                configuredSkills: ["fire-evacuation-simulation"],
                previouslyCompletedSkills: new Set(),
                hasTrustedGrounding: true,
            }),
        ).toBeNull();
    });

    it("suppresses only redundant discovery/delegation tools while parent grounding owns the turn", () => {
        expect(redundantParentGroundingToolName("mcp__internshannon__knowledge_search", true)).toBe(
            "mcp__internshannon__knowledge_search",
        );
        expect(redundantParentGroundingToolName("mcp__internshannon__knowledge_query", true)).toBe(
            "mcp__internshannon__knowledge_query",
        );
        expect(redundantParentGroundingToolName("task", true)).toBe("task");
        expect(redundantParentGroundingToolName("parallel_task", true)).toBe("parallel_task");
        expect(redundantParentGroundingToolName(KNOWLEDGE_READ_RUNTIME_TOOL_NAME, true)).toBeNull();
        expect(redundantParentGroundingToolName("task", false)).toBeNull();
    });
});
