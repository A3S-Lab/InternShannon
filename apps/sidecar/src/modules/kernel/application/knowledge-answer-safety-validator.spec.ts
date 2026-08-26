import { validateKnowledgeAnswerSafety } from "./knowledge-answer-safety-validator";

const grounding = JSON.stringify({
    status: "ok",
    reads: [
        {
            assetId: "asset-1",
            path: "raw/sources/records.csv",
            resource: "asset://asset-1/raw/sources/records.csv",
            citations: ["asset://asset-1/raw/sources/records.csv"],
            content: "record_id,owner_id,state\nREC-100,USR-7,inactive\nREC-101,USR-8,active",
        },
    ],
});

describe("domain-neutral grounded answer safety validation", () => {
    it("rejects an explicitly asserted locator absent from the request and current-turn evidence", () => {
        expect(
            validateKnowledgeAnswerSafety({
                userText: "请核对 REC-100",
                grounding,
                answerText: "REC-100 的后续负责人是 USR-999，记录 ID：USR-999。",
            }),
        ).toEqual([expect.objectContaining({ kind: "unsupported_identifier", value: "USR-999" })]);
    });

    it("does not treat incidental prose identifiers as citation locators", () => {
        expect(
            validateKnowledgeAnswerSafety({
                userText: "请核对 REC-100",
                grounding,
                answerText: "REC-100 的后续负责人可能是 USR-999，但当前证据不足，需要继续核对。",
            }),
        ).toEqual([]);
    });

    it("accepts identifiers from either the user or verified grounding, case-insensitively", () => {
        expect(
            validateKnowledgeAnswerSafety({
                userText: "请比较 EXT-42 和 REC-100",
                grounding,
                answerText: "ext-42 与 rec-100 可对照 REC-101 的已验证记录，记录 ID：REC-101。",
            }),
        ).toEqual([]);
    });

    it("does not lose an exact verified locator after a large unrelated grounding inventory", () => {
        const largeGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    assetId: "asset-1",
                    path: "raw/sources/records.csv",
                    resource: "asset://asset-1/raw/sources/records.csv",
                    citations: ["asset://asset-1/raw/sources/records.csv"],
                    content: [
                        "record_id,state",
                        ...Array.from({ length: 96 }, (_, index) => `UNRELATED-${index},inactive`),
                        "REC-LAST,active",
                    ].join("\n"),
                },
            ],
        });

        expect(
            validateKnowledgeAnswerSafety({
                userText: "请核对最后一条记录",
                grounding: largeGrounding,
                answerText: "已核对，记录 ID：REC-LAST。",
            }),
        ).toEqual([]);
    });

    it("leaves opaque source handles to the citation finalizer", () => {
        expect(
            validateKnowledgeAnswerSafety({
                userText: "请核对 REC-100",
                grounding,
                answerText: "REC-100 已验证 [[K1:REC-100]]，详见 [[K99:X-404]]。",
            }),
        ).toEqual([]);
    });

    it("does not infer domain policy from generic field names or state values", () => {
        expect(
            validateKnowledgeAnswerSafety({
                userText: "请说明 REC-100 的状态",
                grounding,
                answerText: "REC-100 的已验证状态是 inactive。",
            }),
        ).toEqual([]);
    });

    it("defers missing or malformed grounding to the grounding finalizer", () => {
        expect(validateKnowledgeAnswerSafety({ userText: "核对 REC-100", answerText: "新增 REC-999。" })).toEqual([]);
        expect(
            validateKnowledgeAnswerSafety({
                userText: "核对 REC-100",
                grounding: "not-json",
                answerText: "新增 REC-999。",
            }),
        ).toEqual([]);
    });

    it("deduplicates repeated unsupported identifiers", () => {
        expect(
            validateKnowledgeAnswerSafety({
                userText: "核对 REC-100",
                grounding,
                answerText: "记录 ID：USR-999。record ID: usr-999.",
            }),
        ).toHaveLength(1);
    });
});
