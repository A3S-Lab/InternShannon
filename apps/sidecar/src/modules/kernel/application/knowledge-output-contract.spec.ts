import {
    knowledgeOutputLengthContract,
    outputContractViolationMessage,
    validateKnowledgeOutputContract,
    visibleKnowledgeAnswerCharacters,
} from "./knowledge-output-contract";

describe("knowledge output contracts", () => {
    it.each([
        ["答案控制在 120 字内，提供可打开来源。", 120],
        ["先用不超过 250 字说明。", 250],
        ["压缩成 300 字以内。", 300],
    ])("parses %s", (text, maximum) => {
        expect(knowledgeOutputLengthContract(text)).toEqual({ unit: "characters", maximum });
    });

    it("does not count verified handles or markdown control characters as prose", () => {
        expect(visibleKnowledgeAnswerCharacters("**结论** [[K1:E-1]]\n- 安全")).toBe(4);
    });

    it("fails closed when the visible response exceeds the explicit bound", () => {
        expect(validateKnowledgeOutputContract("答案控制在 4 字内", "一二三四五 [[K1]]")).toMatchObject({
            measured: 5,
            valid: false,
        });
    });

    it.each([1, 2, 3, 4, 12, 80])("builds a deterministic replacement within a %i-character bound", (maximum) => {
        const first = outputContractViolationMessage(maximum, true);
        const second = outputContractViolationMessage(maximum, true);

        expect(first).toBe(second);
        expect(first).not.toBe("");
        expect(visibleKnowledgeAnswerCharacters(first)).toBeLessThanOrEqual(maximum);
    });

    it("mentions retained verified sources when the bound permits it", () => {
        expect(outputContractViolationMessage(80, true)).toContain("已验证来源");
        expect(outputContractViolationMessage(80, false)).not.toContain("已验证来源");
    });
});
