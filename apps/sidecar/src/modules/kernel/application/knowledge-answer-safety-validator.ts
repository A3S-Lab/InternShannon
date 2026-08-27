import { genericKnowledgeIdentifierCandidates } from "./knowledge-grounding-planner";
import { knowledgeGroundingSupportsLocator } from "./knowledge-source-reference";

export interface KnowledgeAnswerSafetyViolation {
    kind: "unsupported_identifier";
    value: string;
    detail: string;
}

function normalizedIdentifier(value: string): string {
    return value.normalize("NFKC").trim().toLowerCase();
}

const EXPLICIT_LOCATOR_ASSERTION =
    /(?:记录\s*ID|record\s*ID|source\s*(?:ID|locator)|定位|locator|section|chunk)\s*[：:]\s*([^\]\n）)]+?)(?=$|[，,.。；;!?！？])/giu;

/**
 * Extract only values which the model explicitly presents as evidence
 * locators. A token such as an order number in ordinary prose is a model
 * claim, but it is not by itself a source citation. Treating every mixed
 * letter/digit token as a locator made one incidental token replace an entire
 * otherwise grounded answer. Opaque K handles are intentionally excluded:
 * finalizeKnowledgeAnswer validates both their source and locator against the
 * current-turn registry and fails closed when either is unknown.
 */
function explicitLocatorCandidates(answerText: string): string[] {
    const withoutOpaqueHandles = answerText.replace(/\[\[K\d+(?::[^\]\r\n]+)?\]\]/giu, "");
    const candidates = new Set<string>();
    for (const match of withoutOpaqueHandles.matchAll(EXPLICIT_LOCATOR_ASSERTION)) {
        for (const candidate of genericKnowledgeIdentifierCandidates(`记录 ID：${match[1] ?? ""}`)) {
            candidates.add(candidate);
        }
    }
    return Array.from(candidates);
}

/**
 * Domain-neutral last-mile guard for grounded answers.
 *
 * The validator deliberately checks only an invariant the runtime can prove
 * without understanding a particular knowledge-base schema: every value that
 * the model explicitly labels as an evidence locator must occur in the user's
 * request or in the current turn's verified grounding envelope. Ordinary
 * prose identifiers are not citation syntax and therefore cannot cause a
 * whole-answer false positive here. Opaque handles, natural filename
 * citations, and URIs are independently resolved by finalizeKnowledgeAnswer,
 * which rejects unknown sources and locators. Domain rules must come from an
 * explicitly declared knowledge schema/skill, never from hard-coded column
 * names or provider-specific behavior in this shared runtime.
 */
export function validateKnowledgeAnswerSafety(input: {
    userText: string;
    answerText: string;
    grounding?: string;
}): KnowledgeAnswerSafetyViolation[] {
    if (!input.grounding) return [];
    try {
        JSON.parse(input.grounding);
    } catch {
        // A malformed envelope is handled by the grounding/finalization path;
        // do not infer support from an unparseable transport payload.
        return [];
    }

    const userSupported = new Set(genericKnowledgeIdentifierCandidates(input.userText).map(normalizedIdentifier));
    const violations = explicitLocatorCandidates(input.answerText).flatMap<KnowledgeAnswerSafetyViolation>(
        (identifier) => {
            if (
                /^K\d+$/iu.test(identifier) ||
                userSupported.has(normalizedIdentifier(identifier)) ||
                knowledgeGroundingSupportsLocator(input.grounding, identifier)
            ) {
                return [];
            }
            return [
                {
                    kind: "unsupported_identifier",
                    value: identifier,
                    detail: `Answer identifier ${identifier} is absent from current-turn evidence and user observations`,
                },
            ];
        },
    );

    return Array.from(
        new Map(
            violations.map((violation) => [`${violation.kind}:${normalizedIdentifier(violation.value)}`, violation]),
        ).values(),
    );
}
