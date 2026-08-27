import { Message } from "../domain/entities/message.entity";
import { KernelConversationLogService } from "./kernel-conversation-log.service";

function repository(messages: Message[] = []) {
    return {
        findById: jest.fn(),
        findAll: jest.fn(),
        save: jest.fn(),
        delete: jest.fn(),
        findBySessionId: jest.fn().mockResolvedValue(messages),
        findBySessionIdOrdered: jest.fn().mockResolvedValue(messages),
        findLatestBySessionIdAndRole: jest.fn(),
        deleteBySessionId: jest.fn(),
    };
}

describe("KernelConversationLogService knowledge continuation", () => {
    it("persists the immutable parent run id for correlated recovery", async () => {
        const repo = repository();
        const service = new KernelConversationLogService(repo);

        await service.recordAssistantMessage({
            id: "assistant-correlated",
            parentRunId: "user-run-1",
            sessionId: "session-correlated",
            content: "done",
            contentBlocks: [],
        });

        expect(repo.save).toHaveBeenCalledWith(
            expect.objectContaining({ metadata: expect.objectContaining({ parentRunId: "user-run-1" }) }),
        );
    });

    it("persists a bounded retrieval receipt and returns the latest valid assistant continuation", async () => {
        const repo = repository();
        const service = new KernelConversationLogService(repo);
        const continuation = {
            protocolVersion: 1 as const,
            query: "全部场景",
            mode: "complete" as const,
            status: "partial" as const,
            unresolved: [
                {
                    id: "catalog-inventory",
                    query: "全部场景",
                    status: "partial" as const,
                    reason: "result_truncated" as const,
                    selectedPaths: [],
                },
                {
                    id: "facet-2",
                    query: "人员优先级",
                    status: "uncovered" as const,
                    reason: "source_limit" as const,
                    selectedPaths: [],
                },
            ],
            missingIdentifiers: ["OG-S04-03"],
            nextSearchCursor: "signed-search-page-2",
            pendingSearchPages: [
                {
                    id: "primary" as const,
                    searchGroup: 0,
                    query: "全部场景",
                    limit: 10,
                    nextSearchCursor: "signed-search-page-2",
                    searchOffset: 10,
                },
                {
                    id: "facet-2" as const,
                    searchGroup: 2,
                    query: "人员优先级",
                    limit: 5,
                    nextSearchCursor: "signed-facet-page-2",
                    searchOffset: 5,
                },
            ],
            nextCatalogCursor: "signed-catalog-page-2",
            searchOffset: 10,
            catalogOffset: 32,
            indexRevision: "rev-1",
            hasMore: true,
        };

        await service.recordAssistantMessage({
            id: "assistant-1",
            sessionId: "session-1",
            content: "本轮只完成了一部分。",
            contentBlocks: [],
            knowledgeContinuation: continuation,
        });

        expect(repo.save).toHaveBeenCalledWith(
            expect.objectContaining({ metadata: expect.objectContaining({ knowledgeContinuation: continuation }) }),
        );

        const older = new Message("assistant-older", "session-1", "assistant", "older", {});
        const valid = new Message("assistant-valid", "session-1", "assistant", "valid", {
            knowledgeContinuation: continuation,
        });
        repo.findBySessionIdOrdered.mockResolvedValueOnce([older, valid]);
        await expect(service.latestKnowledgeContinuation("session-1")).resolves.toEqual(continuation);
    });

    it("does not resurrect an older continuation after a later assistant turn moved on", async () => {
        const continuation = {
            protocolVersion: 1 as const,
            query: "全部场景",
            mode: "complete" as const,
            status: "partial" as const,
            unresolved: [],
            missingIdentifiers: [],
            hasMore: true,
        };
        const repo = repository([
            new Message("assistant-old", "session-3", "assistant", "partial", { knowledgeContinuation: continuation }),
            new Message("assistant-latest", "session-3", "assistant", "unrelated", {}),
        ]);
        const service = new KernelConversationLogService(repo);

        await expect(service.latestKnowledgeContinuation("session-3")).resolves.toBeUndefined();
    });

    it("does not expose malformed metadata as continuation state", async () => {
        const repo = repository([
            new Message("assistant-invalid", "session-2", "assistant", "invalid", {
                knowledgeContinuation: { protocolVersion: 1, query: "q", hasMore: true },
            }),
        ]);
        const service = new KernelConversationLogService(repo);

        await expect(service.latestKnowledgeContinuation("session-2")).resolves.toBeUndefined();
    });
});

describe("KernelConversationLogService trusted knowledge context", () => {
    it("persists and reloads an explicit trusted-context marker independently of assistant prose", async () => {
        const repo = repository();
        const service = new KernelConversationLogService(repo);

        await service.recordAssistantMessage({
            id: "assistant-grounded",
            sessionId: "session-grounded",
            content: "A grounded answer without a rendered source card.",
            contentBlocks: [],
            trustedKnowledgeContext: true,
        });

        const saved = repo.save.mock.calls[0]?.[0] as Message;
        expect(saved.metadata).toMatchObject({ trustedKnowledgeContext: true });
        repo.findBySessionIdOrdered.mockResolvedValueOnce([saved]);
        await expect(service.hasTrustedKnowledgeContext("session-grounded")).resolves.toBe(true);
    });

    it("recognizes legacy verified source metadata but rejects malformed or continuation-only metadata", async () => {
        const verifiedSource = {
            protocolVersion: 1,
            ref: "K1",
            assetId: "asset-1",
            relativePath: "raw/sources/records.csv",
            title: "records.csv",
            resource: "asset://asset-1/raw/sources/records.csv",
            evidence: "read",
            locators: [],
        };
        const repo = repository([
            new Message("assistant-malformed", "session-legacy", "assistant", "malformed", {
                knowledgeSourceProtocolVersion: 1,
                knowledgeSources: [{ protocolVersion: 1, resource: "not-an-asset-uri" }],
            }),
            new Message("assistant-continuation", "session-legacy", "assistant", "partial", {
                knowledgeContinuation: { protocolVersion: 1, hasMore: true },
            }),
            new Message("assistant-verified", "session-legacy", "assistant", "verified", {
                knowledgeSourceProtocolVersion: 1,
                knowledgeSources: [verifiedSource],
            }),
        ]);
        const service = new KernelConversationLogService(repo);

        await expect(service.hasTrustedKnowledgeContext("session-legacy")).resolves.toBe(true);
        repo.findBySessionIdOrdered.mockResolvedValueOnce([
            new Message("assistant-invalid", "session-invalid", "assistant", "invalid", {
                knowledgeSourceProtocolVersion: 1,
                knowledgeSources: [{ protocolVersion: 1, resource: "asset://asset-1/raw/sources/records.csv" }],
            }),
        ]);
        await expect(service.hasTrustedKnowledgeContext("session-invalid")).resolves.toBe(false);
    });
});

describe("KernelConversationLogService knowledge query history", () => {
    it("returns persisted user text and verified locator metadata without assistant prose", async () => {
        const verifiedSource = {
            protocolVersion: 1,
            ref: "K1",
            assetId: "asset-neutral",
            relativePath: "raw/sources/people.csv",
            title: "people.csv",
            resource: "asset://asset-neutral/raw/sources/people.csv",
            evidence: "read",
            locators: [
                { kind: "record", value: "PERSON-001", label: "record ID" },
                { kind: "section", value: "Eligibility" },
                { kind: "chunk", value: "chunk-7" },
                { kind: "chunk", value: "source:raw/sources/people.csv#6" },
            ],
        };
        const repo = repository([
            new Message("user-old", "session-query-history", "user", "请按姓名 Avery 检索。"),
            new Message(
                "assistant-valid",
                "session-query-history",
                "assistant",
                "猜测 GUESSED-404 不得成为查询种子。",
                {
                    knowledgeSourceProtocolVersion: 1,
                    knowledgeSources: [verifiedSource],
                },
            ),
            new Message("assistant-invalid", "session-query-history", "assistant", "伪造来源。", {
                knowledgeSourceProtocolVersion: 1,
                knowledgeSources: [
                    {
                        ...verifiedSource,
                        ref: "K2",
                        locators: [{ kind: "record", value: "PERSON-404\u0007" }],
                    },
                ],
            }),
            new Message("user-current", "session-query-history", "user", "该记录当前状态如何？"),
        ]);
        const service = new KernelConversationLogService(repo);

        await expect(
            service.listKnowledgeQueryHistory("session-query-history", { excludeMessageId: "user-current" }),
        ).resolves.toEqual([
            { role: "user", content: "请按姓名 Avery 检索。" },
            {
                role: "assistant",
                content: "",
                knowledgeSources: [verifiedSource],
            },
        ]);
    });

    it("retains only trusted file-level read evidence for bounded history revalidation", async () => {
        const fileSource = {
            protocolVersion: 1,
            ref: "K1",
            assetId: "asset-neutral",
            relativePath: "raw/sources/relationships.csv",
            title: "relationships.csv",
            resource: "asset://asset-neutral/raw/sources/relationships.csv",
            evidence: "read",
            locators: [],
        };
        const repo = repository([
            new Message("assistant-read", "session-file-history", "assistant", "trusted read", {
                knowledgeSourceProtocolVersion: 1,
                knowledgeSources: [
                    fileSource,
                    { ...fileSource, ref: "K2", evidence: "search" },
                    { ...fileSource, ref: "K3", evidence: "catalog" },
                ],
            }),
        ]);
        const service = new KernelConversationLogService(repo);

        await expect(service.listKnowledgeQueryHistory("session-file-history")).resolves.toEqual([
            {
                role: "assistant",
                content: "",
                knowledgeSources: [fileSource],
            },
        ]);
    });

    it("reports only trusted source cards omitted before the bounded history tail", async () => {
        const source = (ref: string, value: string) => ({
            protocolVersion: 1,
            ref,
            assetId: "asset-neutral",
            relativePath: "raw/sources/people.csv",
            title: "people.csv",
            resource: "asset://asset-neutral/raw/sources/people.csv",
            evidence: "read",
            locators: [{ kind: "record", value }],
        });
        const repo = repository([
            new Message("command-old", "session-window", "user", "internal", { source: "command:compact" }),
            new Message("assistant-old", "session-window", "assistant", "old", {
                knowledgeSourceProtocolVersion: 1,
                knowledgeSources: [source("K1", "ITEM-001")],
            }),
            new Message("assistant-untrusted", "session-window", "assistant", "plain prose"),
            new Message("user-new", "session-window", "user", "new query"),
            new Message("assistant-new", "session-window", "assistant", "new", {
                knowledgeSourceProtocolVersion: 1,
                knowledgeSources: [source("K2", "ITEM-002")],
            }),
        ]);
        const service = new KernelConversationLogService(repo);

        await expect(service.listKnowledgeQueryHistoryWindow("session-window", { limit: 2 })).resolves.toEqual({
            messages: [
                { role: "user", content: "new query" },
                {
                    role: "assistant",
                    content: "",
                    knowledgeSources: [source("K2", "ITEM-002")],
                },
            ],
            omittedTrustedKnowledgeSources: 1,
        });
    });

    it.each([
        [
            "asset URI locator",
            { locators: [{ kind: "record", value: "asset://asset-neutral/raw/sources/people.csv" }] },
        ],
        ["HTTP locator", { locators: [{ kind: "section", value: "https://example.invalid/private" }] }],
        ["file URI locator", { locators: [{ kind: "chunk", value: "file:///tmp/private.txt" }] }],
        ["absolute path locator", { locators: [{ kind: "record", value: "/private/record.txt" }] }],
        ["traversal locator", { locators: [{ kind: "record", value: "../private/record.txt" }] }],
        ["secret token locator", { locators: [{ kind: "record", value: "sk-1234567890abcdef" }] }],
        ["email locator", { locators: [{ kind: "record", value: "avery@example.com" }] }],
        ["bearer locator", { locators: [{ kind: "record", value: "Bearer abcdefghijklmnop" }] }],
        ["API key locator", { locators: [{ kind: "record", value: "api_key=abcdefghijk" }] }],
        ["private-use locator", { locators: [{ kind: "record", value: "PERSON-\uE000001" }] }],
        [
            "CSV chunk address mislabeled as a record",
            { locators: [{ kind: "record", value: "source:raw/sources/people.csv#6" }] },
        ],
        [
            "source chunk address mislabeled as a section",
            { locators: [{ kind: "section", value: "source:raw/sources/people.csv#6" }] },
        ],
        [
            "source chunk address bound to another path",
            { locators: [{ kind: "chunk", value: "source:raw/sources/orders.csv#6" }] },
        ],
        ["path/resource mismatch", { resource: "asset://asset-neutral/raw/sources/orders.csv" }],
        [
            "non-public path",
            {
                relativePath: "raw/sources/../private/people.csv",
                resource: "asset://asset-neutral/raw/sources/../private/people.csv",
            },
        ],
        ["catalog locator", { evidence: "catalog", locators: [{ kind: "record", value: "PERSON-001" }] }],
        [
            "unsafe asset id",
            {
                assetId: "asset/other",
                resource: "asset://asset/other/raw/sources/people.csv",
            },
        ],
    ])("rejects %s from persisted query seeds", async (_label, override) => {
        const baseSource = {
            protocolVersion: 1,
            ref: "K1",
            assetId: "asset-neutral",
            relativePath: "raw/sources/people.csv",
            title: "people.csv",
            resource: "asset://asset-neutral/raw/sources/people.csv",
            evidence: "read",
            locators: [{ kind: "record", value: "PERSON-001" }],
        };
        const repo = repository([
            new Message("assistant-unsafe", "session-unsafe-query-history", "assistant", "untrusted prose", {
                knowledgeSourceProtocolVersion: 1,
                knowledgeSources: [{ ...baseSource, ...override }],
            }),
        ]);
        const service = new KernelConversationLogService(repo);

        await expect(service.listKnowledgeQueryHistory("session-unsafe-query-history")).resolves.toEqual([]);
    });
});

describe("KernelConversationLogService knowledge observations", () => {
    it("persists authorized user updates and reloads them after runtime compaction", async () => {
        const repo = repository();
        const service = new KernelConversationLogService(repo);

        await service.recordUserMessage({
            sessionId: "session-observation",
            content: "14:10 的授权更新：实验室引导员确认 OG-S06-03 已经全部撤到 F06-E。",
        });

        const saved = repo.save.mock.calls[0]?.[0] as Message;
        expect(saved.metadata.knowledgeObservation).toMatchObject({
            observedAt: "14:10",
            authority: "authorized",
        });
        repo.findBySessionIdOrdered.mockResolvedValueOnce([saved]);
        await expect(service.latestKnowledgeObservations("session-observation")).resolves.toEqual([
            expect.objectContaining({ turnId: saved.id, statement: expect.stringContaining("OG-S06-03") }),
        ]);
    });

    it("does not invent observation metadata for ordinary questions", async () => {
        const repo = repository();
        const service = new KernelConversationLogService(repo);

        await service.recordUserMessage({ sessionId: "session-question", content: "请列出全部人员组。" });

        const saved = repo.save.mock.calls[0]?.[0] as Message;
        expect(saved.metadata).not.toHaveProperty("knowledgeObservation");
    });
});
