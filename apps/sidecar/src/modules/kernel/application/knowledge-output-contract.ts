export interface KnowledgeOutputLengthContract {
    unit: "characters";
    maximum: number;
}

export interface KnowledgeOutputContractResult {
    contract?: KnowledgeOutputLengthContract;
    measured: number;
    valid: boolean;
}

const MAX_ENFORCEABLE_CHARACTERS = 10_000;

export function knowledgeOutputLengthContract(userText: string): KnowledgeOutputLengthContract | undefined {
    const patterns = [
        /(?:答案|回答|内容)?控制在\s*(\d{1,5})\s*字以?内/iu,
        /(?:答案|回答|内容)?不超过\s*(\d{1,5})\s*字/iu,
        /(\d{1,5})\s*字以内/iu,
    ];
    for (const pattern of patterns) {
        const maximum = Number(pattern.exec(userText)?.[1]);
        if (Number.isInteger(maximum) && maximum > 0 && maximum <= MAX_ENFORCEABLE_CHARACTERS) {
            return { unit: "characters", maximum };
        }
    }
    return undefined;
}

export function visibleKnowledgeAnswerCharacters(text: string): number {
    const visible = text
        .replace(/\[\[K\d+(?::[^\]\r\n]+)?\]\]/giu, "")
        .replace(/```(?:agent-ui)?[\s\S]*?```/giu, "")
        .replace(/[*_`#>|\[\]()~-]/gu, "")
        .replace(/\s+/gu, "");
    return Array.from(visible).length;
}

const OUTPUT_CONTRACT_VIOLATION_MESSAGES = {
    withSources: ["回答超出字数上限，原文未展示。已验证来源保留在来源卡片中。"],
    generic: ["回答超出字数上限，原文未展示。", "回答超限，原文未展示。", "回答超限", "已超限", "超限", "限"],
} as const;

/**
 * Builds a deterministic, non-model-authored replacement for a response that
 * violated an explicit visible-character limit. Only the fixed notice may be
 * shortened; model prose is never clipped because doing so can detach claims
 * from citations or reverse a qualification at the truncation boundary.
 */
export function outputContractViolationMessage(maximum: number, hasVerifiedSources = false): string {
    const candidates = hasVerifiedSources
        ? [...OUTPUT_CONTRACT_VIOLATION_MESSAGES.withSources, ...OUTPUT_CONTRACT_VIOLATION_MESSAGES.generic]
        : OUTPUT_CONTRACT_VIOLATION_MESSAGES.generic;
    const replacement = candidates.find((candidate) => visibleKnowledgeAnswerCharacters(candidate) <= maximum);
    // Parsed contracts always have maximum >= 1. Keep this defensive fallback
    // deterministic for direct callers as well.
    return (
        replacement ??
        Array.from(OUTPUT_CONTRACT_VIOLATION_MESSAGES.generic.at(-1) ?? "限")
            .slice(0, Math.max(0, Math.floor(maximum)))
            .join("")
    );
}

export function validateKnowledgeOutputContract(userText: string, answerText: string): KnowledgeOutputContractResult {
    const contract = knowledgeOutputLengthContract(userText);
    const measured = visibleKnowledgeAnswerCharacters(answerText);
    return { contract, measured, valid: !contract || measured <= contract.maximum };
}
