export type KnowledgeObservationAuthority = "authorized" | "unverified";

export interface KnowledgeConversationObservation {
    version: 1;
    turnId: string;
    recordedAt: string;
    observedAt?: string;
    actor: string;
    authority: KnowledgeObservationAuthority;
    statement: string;
}

const MAX_OBSERVATION_BYTES = 4 * 1024;

function boundedUtf8(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(text.slice(0, middle), "utf8") <= maxBytes) low = middle;
        else high = middle - 1;
    }
    return text.slice(0, low).trimEnd();
}

function observationActor(content: string): string {
    const confirmed = /(?:^|[\s，,;；。])([^\s，,;；。：:]{1,24}?)(?:已)?确认/iu.exec(content)?.[1]?.trim();
    if (confirmed) return confirmed.replace(/^(?:新的?|再|同时|并且)+/u, "").trim() || "user-reported actor";
    const reported = /(?:^|[\s，,;；。])(?:一名|一位)?([^\s，,;；。“”"']{1,24}?)说/iu.exec(content)?.[1]?.trim();
    return reported || "user";
}

/**
 * Preserve user-provided operational observations independently from model
 * summaries. The extractor deliberately stores the bounded original statement
 * instead of guessing domain fields; downstream retrieval can apply schema
 * semantics while provenance and authorization survive SDK compaction.
 */
export function extractKnowledgeConversationObservation(input: {
    turnId: string;
    content: string;
    recordedAt: Date;
}): KnowledgeConversationObservation | undefined {
    const statement = input.content.trim();
    if (!statement) return undefined;
    const hasObservationSignal =
        /(?:授权(?:更新|观测|观察|消息)|新(?:的)?(?:消息|观测|观察|更新)|(?:已|再|同时)?确认|状态改为|已经全部|已经没有|好像|似乎)/iu.test(
            statement,
        );
    if (!hasObservationSignal) return undefined;

    const explicitlyUnverified = /(?:未经确认|没有.{0,20}确认|未.{0,20}确认|好像|似乎|听说|一名普通|一位普通)/iu.test(
        statement,
    );
    const explicitlyAuthorized =
        /(?:授权(?:更新|观测|观察|消息)|(?:^|[\s，,;；。])[^\s，,;；。：:]{1,24}(?:已)?确认|已确认)/iu.test(statement);
    const time = /(?:^|[^0-9])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/u.exec(statement);

    return {
        version: 1,
        turnId: input.turnId,
        recordedAt: input.recordedAt.toISOString(),
        ...(time ? { observedAt: `${time[1].padStart(2, "0")}:${time[2]}` } : {}),
        actor: observationActor(statement),
        authority: explicitlyAuthorized && !explicitlyUnverified ? "authorized" : "unverified",
        statement: boundedUtf8(statement, MAX_OBSERVATION_BYTES),
    };
}

export function isKnowledgeConversationObservation(value: unknown): value is KnowledgeConversationObservation {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        record.version === 1 &&
        typeof record.turnId === "string" &&
        typeof record.recordedAt === "string" &&
        typeof record.actor === "string" &&
        (record.authority === "authorized" || record.authority === "unverified") &&
        typeof record.statement === "string"
    );
}

export function appendKnowledgeObservationsToGrounding(
    grounding: string,
    observations: KnowledgeConversationObservation[],
): string {
    if (observations.length === 0) return grounding;
    let payload: unknown;
    try {
        payload = JSON.parse(grounding);
    } catch {
        return grounding;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return grounding;
    const safe = observations.filter(isKnowledgeConversationObservation).slice(-12);
    if (safe.length === 0) return grounding;
    return JSON.stringify({ ...(payload as Record<string, unknown>), conversationObservations: safe });
}
