import {
    appendKnowledgeObservationsToGrounding,
    extractKnowledgeConversationObservation,
    isKnowledgeConversationObservation,
} from "./knowledge-conversation-observation";

describe("knowledge conversation observation provenance", () => {
    const recordedAt = new Date("2026-08-14T02:00:00.000Z");

    it("keeps an authorized actor, time and original statement", () => {
        const observation = extractKnowledgeConversationObservation({
            turnId: "turn-a5",
            recordedAt,
            content: "再更新：10:08，值班负责人确认 record-42 仍为 inactive；其他记录不变。",
        });

        expect(observation).toMatchObject({
            version: 1,
            turnId: "turn-a5",
            observedAt: "10:08",
            actor: "值班负责人",
            authority: "authorized",
        });
        expect(observation?.statement).toContain("record-42");
        expect(isKnowledgeConversationObservation(observation)).toBe(true);
    });

    it("never upgrades an explicitly unconfirmed observation", () => {
        const observation = extractKnowledgeConversationObservation({
            turnId: "turn-a4",
            recordedAt,
            content: "10:06 一名普通同事说 record-7 好像已经恢复，但没有负责人确认。",
        });

        expect(observation).toMatchObject({ observedAt: "10:06", authority: "unverified" });
    });

    it("ignores ordinary questions without an operational observation", () => {
        expect(
            extractKnowledgeConversationObservation({
                turnId: "turn-question",
                recordedAt,
                content: "请盘点知识库中的记录数量。",
            }),
        ).toBeUndefined();
    });

    it("adds only validated observations to a JSON grounding envelope", () => {
        const observation = extractKnowledgeConversationObservation({
            turnId: "turn-b3",
            recordedAt,
            content: "新的授权观测：18:26，运营主管确认 record-9 为 inactive。",
        });
        const merged = JSON.parse(
            appendKnowledgeObservationsToGrounding(JSON.stringify({ status: "ok", reads: [] }), [observation!]),
        );

        expect(merged.conversationObservations).toEqual([
            expect.objectContaining({ turnId: "turn-b3", authority: "authorized" }),
        ]);
        expect(appendKnowledgeObservationsToGrounding("not-json", [observation!])).toBe("not-json");
    });
});
