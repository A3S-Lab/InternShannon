import { KernelMessageRunnerService } from "./kernel-message-runner.service";
import { analyzeKnowledgeAnswerCompleteness } from "./knowledge-answer-completeness";
import { visibleKnowledgeAnswerCharacters } from "./knowledge-output-contract";
import { hasTrustedKnowledgeGrounding } from "./knowledge-source-reference";

const KNOWLEDGE_READ_TOOL = "mcp__internshannon__knowledge_read";
const KNOWLEDGE_SEARCH_TOOL = "mcp__internshannon__knowledge_search";
const BASE_RESOURCE = "asset://asset-1/raw/sources/base.csv";

function iteratorFromEvents(events: Array<Record<string, unknown>>): AsyncIterator<unknown> {
    let index = 0;
    return {
        next: async () =>
            index < events.length ? { value: events[index++], done: false } : { value: undefined, done: true },
        return: async () => ({ value: undefined, done: true }),
    };
}

function baseGrounding(extraReads: Record<string, unknown>[] = []): string {
    return JSON.stringify({
        status: "ok",
        reads: [
            {
                kind: "source",
                assetId: "asset-1",
                path: "raw/sources/base.csv",
                title: "base.csv",
                mime: "text/csv",
                content: "id,status\nB-1,open",
                resource: BASE_RESOURCE,
                citations: [BASE_RESOURCE],
            },
            ...extraReads,
        ],
    });
}

function runResult(emitted: unknown[]): Record<string, unknown> {
    const result = emitted.find(
        (message) =>
            Boolean(message) && typeof message === "object" && (message as { type?: unknown }).type === "result",
    ) as { data?: Record<string, unknown> } | undefined;
    if (!result?.data) throw new Error("runner did not emit a result");
    return result.data;
}

function createHarness(
    streams: Array<Array<Record<string, unknown>>>,
    observations: unknown[] = [],
    grounding: string | null = baseGrounding(),
    agentSpec?: Record<string, unknown>,
) {
    const emitted: unknown[] = [];
    const conversationLog = {
        recordAssistantMessage: jest.fn().mockResolvedValue(undefined),
        listRuntimeHistory: jest.fn().mockResolvedValue([]),
        latestKnowledgeObservations: jest.fn().mockResolvedValue(observations),
    };
    const runtimeState = {
        isCancelled: jest.fn().mockReturnValue(false),
        clearCancelled: jest.fn(),
        updateActiveOperationPhase: jest.fn(),
    };
    const streamRequest = jest.fn();
    for (const events of streams) streamRequest.mockResolvedValueOnce(iteratorFromEvents(events));
    const session = {
        history: jest.fn().mockReturnValue([]),
        currentRun: jest.fn().mockResolvedValue({ id: "run-grounded" }),
        cancelRun: jest.fn().mockResolvedValue(undefined),
        cancelAndSettle: jest.fn().mockResolvedValue(true),
        supportsTransientContext: jest.fn().mockReturnValue(true),
        stream: streamRequest,
        streamRequest,
    };
    const metrics = { incCounter: jest.fn(), observeHistogram: jest.fn(), setGauge: jest.fn() };
    const runner = new KernelMessageRunnerService(
        conversationLog as never,
        runtimeState as never,
        null as never,
        { resolve: jest.fn().mockReturnValue(agentSpec) } as never,
        undefined,
        metrics as never,
    );
    jest.spyOn(
        runner as unknown as {
            personalKnowledgeGrounding(input: Record<string, unknown>): Promise<string | undefined>;
        },
        "personalKnowledgeGrounding",
    ).mockResolvedValue(grounding ?? undefined);

    const run = (content: string, runtimeOverrides: Record<string, unknown> = {}) =>
        runner.runUserMessage({
            sessionId: "session-grounded",
            content,
            emit: (message) => emitted.push(message),
            activeSession: {
                session,
                workspace: "/tmp/workspace",
                agentId: "default",
                userId: "user-1",
                runtimeKey: "controlled-a3s",
                runtimeOverrides,
                nativeConfirmationEnabled: false,
                nativeConfirmedToolKeys: new Set<string>(),
                createdAt: Date.now(),
                lastActivityAt: Date.now(),
            } as never,
        });

    return { conversationLog, emitted, metrics, run, runner, session, streamRequest };
}

describe("KernelMessageRunnerService grounded evidence policy", () => {
    it("merges current-turn direct knowledge evidence before validating citations", async () => {
        const detailsResource = "asset://asset-1/raw/sources/details.csv";
        const harness = createHarness([
            [
                {
                    type: "tool_start",
                    toolName: KNOWLEDGE_READ_TOOL,
                    toolId: "tool-read",
                    data: JSON.stringify({ input: { path: "raw/sources/details.csv" } }),
                },
                {
                    type: "tool_end",
                    toolName: KNOWLEDGE_READ_TOOL,
                    toolId: "tool-read",
                    toolOutput: JSON.stringify({
                        kind: "source",
                        assetId: "asset-1",
                        path: "raw/sources/details.csv",
                        title: "details.csv",
                        mime: "text/csv",
                        content: "id,value\nD-1,verified",
                        resource: detailsResource,
                        citations: [detailsResource],
                    }),
                    exitCode: 0,
                },
                { type: "text_delta", text: "详情已验证 [[K2:D-1]]" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 32 },
            ],
        ]);

        await harness.run("请根据我的知识库查询 D-1");

        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                knowledgeSources: expect.arrayContaining([expect.objectContaining({ resource: detailsResource })]),
            }),
        );
        expect(harness.emitted).not.toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({ type: "text_delta" }),
            }),
        );
    });

    it("cancels and restarts once when parent grounding already owns a duplicate search", async () => {
        const harness = createHarness([
            [
                {
                    type: "tool_start",
                    toolName: KNOWLEDGE_SEARCH_TOOL,
                    toolId: "tool-redundant-search",
                    data: JSON.stringify({ input: { query: "B-1", scope: "personal" } }),
                },
            ],
            [
                { type: "text_delta", text: "基线已验证 [[K1:B-1]]" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 20 },
            ],
        ]);

        await harness.run("请根据我的知识库核对 B-1");

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(harness.session.cancelRun).toHaveBeenCalledTimes(1);
        expect(harness.session.cancelAndSettle).toHaveBeenCalledTimes(1);
        expect(harness.streamRequest.mock.calls[1]?.[0]?.history).toEqual([]);
        expect(harness.streamRequest.mock.calls[1]?.[0]?.prompt).toContain("was suppressed");
        expect(JSON.stringify(harness.streamRequest.mock.calls[1]?.[0]?.transientContext)).toContain(
            "System-provided personal knowledge-base grounding",
        );
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                contentBlocks: expect.not.arrayContaining([
                    expect.objectContaining({ type: "tool_use", name: KNOWLEDGE_SEARCH_TOOL }),
                ]),
            }),
        );
        expect(harness.emitted).toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({
                    type: "knowledge_parent_tool_suppressed",
                    toolName: KNOWLEDGE_SEARCH_TOOL,
                }),
            }),
        );
    });

    it("suppresses task delegation under parent grounding without suppressing a direct knowledge read", async () => {
        const delegated = createHarness([
            [
                {
                    type: "tool_start",
                    toolName: "task",
                    toolId: "tool-redundant-task",
                    data: JSON.stringify({ input: { prompt: "repeat lookup" } }),
                },
            ],
            [
                { type: "text_delta", text: "直接回答 [[K1:B-1]]" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 20 },
            ],
        ]);
        await delegated.run("请根据我的知识库核对 B-1");
        expect(delegated.streamRequest).toHaveBeenCalledTimes(2);
        expect(delegated.session.cancelAndSettle).toHaveBeenCalledTimes(1);
        expect(runResult(delegated.emitted)).toMatchObject({ status: "succeeded" });

        const directRead = createHarness([
            [
                {
                    type: "tool_start",
                    toolName: KNOWLEDGE_READ_TOOL,
                    toolId: "tool-allowed-read",
                    data: JSON.stringify({ input: { path: "raw/sources/base.csv" } }),
                },
                {
                    type: "tool_end",
                    toolName: KNOWLEDGE_READ_TOOL,
                    toolId: "tool-allowed-read",
                    toolOutput: JSON.stringify({
                        title: "base.csv",
                        content: "id,status\nB-1,open",
                        resource: BASE_RESOURCE,
                    }),
                    exitCode: 0,
                },
                { type: "text_delta", text: "读取完成 [[K1:B-1]]" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 20 },
            ],
        ]);
        await directRead.run("请根据我的知识库读取 B-1");
        expect(directRead.streamRequest).toHaveBeenCalledTimes(1);
        expect(directRead.session.cancelRun).not.toHaveBeenCalled();
        expect(runResult(directRead.emitted)).toMatchObject({ status: "succeeded" });
    });

    it("allows direct discovery when no parent grounding owns the turn", async () => {
        const resource = "asset://asset-1/raw/sources/search.csv";
        const harness = createHarness(
            [
                [
                    {
                        type: "tool_start",
                        toolName: KNOWLEDGE_SEARCH_TOOL,
                        toolId: "tool-direct-search",
                        data: JSON.stringify({ input: { query: "REC-1", scope: "personal" } }),
                    },
                    {
                        type: "tool_end",
                        toolName: KNOWLEDGE_SEARCH_TOOL,
                        toolId: "tool-direct-search",
                        toolOutput: JSON.stringify({
                            hits: [
                                {
                                    title: "search.csv",
                                    snippet: "REC-1,active",
                                    matchedRecordIds: ["REC-1"],
                                    resource,
                                },
                            ],
                        }),
                        exitCode: 0,
                    },
                    { type: "text_delta", text: "检索完成 [[K1:REC-1]]" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 20 },
                ],
            ],
            [],
            null,
        );

        await harness.run("请使用知识库工具检索 REC-1");

        expect(harness.streamRequest).toHaveBeenCalledTimes(1);
        expect(harness.session.cancelRun).not.toHaveBeenCalled();
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded" });
    });

    it("buffers text that arrives after knowledge tool start but before its trusted result", async () => {
        const resource = "asset://asset-1/raw/sources/out-of-order.csv";
        const earlyDraft = "正在核对 REC-2。";
        const harness = createHarness(
            [
                [
                    {
                        type: "tool_start",
                        toolName: KNOWLEDGE_SEARCH_TOOL,
                        toolId: "tool-out-of-order-search",
                        data: JSON.stringify({ input: { query: "REC-2", scope: "personal" } }),
                    },
                    { type: "text_delta", text: earlyDraft },
                    {
                        type: "tool_end",
                        toolName: KNOWLEDGE_SEARCH_TOOL,
                        toolId: "tool-out-of-order-search",
                        toolOutput: JSON.stringify({
                            hits: [
                                {
                                    title: "out-of-order.csv",
                                    snippet: "REC-2,active",
                                    matchedRecordIds: ["REC-2"],
                                    resource,
                                },
                            ],
                        }),
                        exitCode: 0,
                    },
                    { type: "text_delta", text: "REC-2 已验证 [[K1:REC-2]]" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 20 },
                ],
            ],
            [],
            null,
        );

        await harness.run("请使用知识库工具检索 REC-2");

        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
        expect(harness.emitted).not.toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({ type: "text_delta", text: earlyDraft }),
            }),
        );
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("REC-2") }),
        );
    });

    it("fails boundedly when a replacement stream ignores the parent-grounding guard twice", async () => {
        const harness = createHarness([
            [
                {
                    type: "tool_start",
                    toolName: KNOWLEDGE_SEARCH_TOOL,
                    toolId: "tool-redundant-search-1",
                    data: JSON.stringify({ input: { query: "B-1" } }),
                },
            ],
            [
                {
                    type: "tool_start",
                    toolName: "parallel_task",
                    toolId: "tool-redundant-search-2",
                    data: JSON.stringify({ input: { prompt: "repeat lookup" } }),
                },
            ],
        ]);

        await harness.run("请根据我的知识库核对 B-1");

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(harness.session.cancelAndSettle).toHaveBeenCalledTimes(2);
        expect(runResult(harness.emitted)).toMatchObject({ status: "failed" });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("redundant_parent_grounding_tool_loop") }),
        );
    });

    it("never marks a response with an unverified citation as succeeded", async () => {
        const harness = createHarness([
            [
                { type: "text_delta", text: "未取回的记录 [[K99:X-404]]" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 16 },
            ],
        ]);

        await harness.run("请查询我的知识库");

        expect(runResult(harness.emitted)).toMatchObject({
            status: "incomplete",
            stopReason: "unverified_citations",
        });
    });

    it("keeps ordinary local-file prose unchanged in a successful non-knowledge answer", async () => {
        const rawAnswer =
            "直接双击 index.html 用浏览器打开即可使用（因为内置了 songs.js，不依赖网络或服务）";
        const harness = createHarness(
            [
                [
                    { type: "text_delta", text: rawAnswer },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 16 },
                ],
            ],
            [],
            null,
        );

        await harness.run("请说明如何离线打开这个本地页面");

        expect(runResult(harness.emitted)).toMatchObject({
            status: "succeeded",
            stopReason: "end_turn",
            toolCalls: 0,
            activeToolCount: 0,
        });
        expect(harness.streamRequest).toHaveBeenCalledTimes(1);
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: rawAnswer,
                contentBlocks: [expect.objectContaining({ type: "text", text: rawAnswer })],
            }),
        );
        expect(JSON.stringify(harness.emitted)).not.toContain("[来源引用未验证]");
        expect(JSON.stringify(harness.emitted)).not.toContain("unverified_citations");
    });

    it("loads a Skill once, suppresses its redundant repeat, and preserves transient grounding", async () => {
        const harness = createHarness([
            [
                {
                    type: "tool_start",
                    toolName: "Skill",
                    toolId: "tool-skill-first",
                    data: JSON.stringify({ input: { skill_name: "record-audit" } }),
                },
                {
                    type: "tool_end",
                    toolName: "Skill",
                    toolId: "tool-skill-first",
                    toolOutput: "skill instructions loaded",
                    exitCode: 0,
                },
                {
                    type: "tool_start",
                    toolName: "Skill",
                    toolId: "tool-skill-repeat",
                    data: JSON.stringify({ input: { skill_name: "record-audit" } }),
                },
            ],
            [
                { type: "text_delta", text: "基线已验证 [[K1:B-1]]" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 24 },
            ],
        ]);

        await harness.run("请执行 $record-audit", {
            skills: ["record-audit"],
        });

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(harness.session.cancelRun).toHaveBeenCalledTimes(1);
        expect(harness.session.cancelAndSettle).toHaveBeenCalledTimes(1);
        const firstTransient = harness.streamRequest.mock.calls[0]?.[0]?.transientContext;
        const secondTransient = harness.streamRequest.mock.calls[1]?.[0]?.transientContext;
        expect(JSON.stringify(firstTransient)).not.toContain("skill instructions loaded");
        expect(JSON.stringify(secondTransient)).toContain("skill instructions loaded");
        expect(JSON.stringify(secondTransient)).toContain("Replay of completed Skill: record-audit");
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
    });

    it("replays a completed Skill across turns in the same live session", async () => {
        const harness = createHarness([
            [
                {
                    type: "tool_start",
                    toolName: "Skill",
                    toolId: "tool-skill-turn-one",
                    data: JSON.stringify({ input: { skill_name: "record-audit" } }),
                },
                {
                    type: "tool_end",
                    toolName: "Skill",
                    toolId: "tool-skill-turn-one",
                    toolOutput: "persistent skill instructions",
                    exitCode: 0,
                },
                { type: "text_delta", text: "首轮基线 [[K1:B-1]]" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 24 },
            ],
            [
                {
                    type: "tool_start",
                    toolName: "Skill",
                    toolId: "tool-skill-turn-two-repeat",
                    data: JSON.stringify({ input: { skill_name: "record-audit" } }),
                },
            ],
            [
                { type: "text_delta", text: "次轮基线 [[K1:B-1]]" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 24 },
            ],
        ]);

        const overrides = { skills: ["record-audit"] };
        await harness.run("请执行 $record-audit 的第一问", overrides);
        await harness.run("请继续执行 $record-audit", overrides);

        expect(harness.streamRequest).toHaveBeenCalledTimes(3);
        expect(harness.session.cancelRun).toHaveBeenCalledTimes(1);
        const replayTransient = JSON.stringify(harness.streamRequest.mock.calls[2]?.[0]?.transientContext);
        expect(replayTransient).toContain("persistent skill instructions");
        expect(replayTransient).toContain("Replay of completed Skill: record-audit");
        const results = harness.emitted.filter(
            (message) =>
                Boolean(message) && typeof message === "object" && (message as { type?: unknown }).type === "result",
        );
        expect(results).toHaveLength(2);
        expect(results).toEqual([
            expect.objectContaining({ data: expect.objectContaining({ status: "succeeded" }) }),
            expect.objectContaining({ data: expect.objectContaining({ status: "succeeded" }) }),
        ]);
    });

    it("injects bounded observations without turning them into knowledge source cards", async () => {
        const observation = {
            version: 1,
            turnId: "msg-observation",
            recordedAt: "2026-08-14T10:00:00.000Z",
            actor: "值班负责人",
            authority: "authorized",
            statement: "值班负责人已确认 B-1 状态更新。",
        };
        const harness = createHarness(
            [
                [
                    { type: "text_delta", text: "基线 [[K1:B-1]]" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 18 },
                ],
            ],
            [observation],
        );

        await harness.run("请根据我的知识库回答");

        const transient = JSON.stringify(harness.streamRequest.mock.calls[0]?.[0]?.transientContext);
        expect(transient).toContain("conversationObservations");
        expect(transient).toContain(observation.statement);
        expect(transient).toContain("never create source cards");
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                knowledgeSources: [expect.objectContaining({ resource: BASE_RESOURCE })],
            }),
        );
    });

    it("buffers and replaces an over-limit ordinary response before events, hooks, or persistence", async () => {
        const rawAnswer = "一二三四五";
        const onStreamText = jest.fn();
        const onStreamEnd = jest.fn().mockResolvedValue(undefined);
        const harness = createHarness(
            [
                [
                    { type: "text_delta", text: rawAnswer },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 8 },
                ],
            ],
            [],
            null,
            { onStreamText, onStreamEnd },
        );

        await harness.run("答案控制在 4 字内");

        expect(runResult(harness.emitted)).toMatchObject({
            status: "incomplete",
            stopReason: "output_contract_violation",
        });
        const persisted = harness.conversationLog.recordAssistantMessage.mock.calls[0]?.[0] as {
            content: string;
            contentBlocks: unknown[];
        };
        expect(persisted.content).not.toBe(rawAnswer);
        expect(visibleKnowledgeAnswerCharacters(persisted.content)).toBeLessThanOrEqual(4);
        expect(JSON.stringify(persisted.contentBlocks)).not.toContain(rawAnswer);
        expect(JSON.stringify(harness.emitted)).not.toContain(rawAnswer);
        expect(onStreamText).not.toHaveBeenCalled();
        expect(onStreamEnd).toHaveBeenCalledWith(expect.anything(), persisted.content);
    });

    it("uses a non-empty deterministic notice for a one-character limit", async () => {
        const rawAnswer = "甲乙丙";
        const first = createHarness(
            [
                [
                    { type: "text_delta", text: rawAnswer },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 8 },
                ],
            ],
            [],
            null,
        );
        const second = createHarness(
            [
                [
                    { type: "text_delta", text: rawAnswer },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 8 },
                ],
            ],
            [],
            null,
        );

        await first.run("回答不超过 1 字");
        await second.run("回答不超过 1 字");

        const firstContent = first.conversationLog.recordAssistantMessage.mock.calls[0]?.[0]?.content as string;
        const secondContent = second.conversationLog.recordAssistantMessage.mock.calls[0]?.[0]?.content as string;
        expect(firstContent).toBe(secondContent);
        expect(firstContent).not.toBe("");
        expect(visibleKnowledgeAnswerCharacters(firstContent)).toBeLessThanOrEqual(1);
        expect(JSON.stringify(first.emitted)).not.toContain(rawAnswer);
    });

    it("retains verified source cards and non-text tool blocks while replacing over-limit prose", async () => {
        const detailsResource = "asset://asset-1/raw/sources/details.csv";
        const rawAnswer = "详情已经验证 [[K1:D-1]]";
        const harness = createHarness(
            [
                [
                    {
                        type: "tool_start",
                        toolName: KNOWLEDGE_READ_TOOL,
                        toolId: "tool-output-contract-read",
                        data: JSON.stringify({ input: { path: "raw/sources/details.csv" } }),
                    },
                    {
                        type: "tool_end",
                        toolName: KNOWLEDGE_READ_TOOL,
                        toolId: "tool-output-contract-read",
                        toolOutput: JSON.stringify({
                            kind: "source",
                            assetId: "asset-1",
                            path: "raw/sources/details.csv",
                            title: "details.csv",
                            mime: "text/csv",
                            content: "id,value\nD-1,verified",
                            resource: detailsResource,
                            citations: [detailsResource],
                        }),
                        exitCode: 0,
                    },
                    { type: "text_delta", text: rawAnswer },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 24 },
                ],
            ],
            [],
            null,
        );

        await harness.run("请使用知识库工具核对 D-1，答案控制在 4 字内");

        expect(runResult(harness.emitted)).toMatchObject({
            status: "incomplete",
            stopReason: "output_contract_violation",
        });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.not.stringContaining("详情已经验证"),
                contentBlocks: expect.arrayContaining([
                    expect.objectContaining({ type: "tool_use", name: KNOWLEDGE_READ_TOOL }),
                    expect.objectContaining({ type: "tool_result", toolUseId: "tool-output-contract-read" }),
                ]),
                knowledgeSources: expect.arrayContaining([expect.objectContaining({ resource: detailsResource })]),
            }),
        );
        expect(JSON.stringify(harness.emitted)).not.toContain("详情已经验证");
    });

    it("does not turn application-expanded citation labels into a false prose-length violation", async () => {
        const harness = createHarness([
            [
                { type: "text_delta", text: "已验证 [[K1:B-1]]" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
            ],
        ]);

        await harness.run("请根据我的知识库核对 B-1，答案控制在 3 字内");

        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining("[base.csv，记录 ID：B-1]"),
                knowledgeSources: [expect.objectContaining({ resource: BASE_RESOURCE })],
            }),
        );
    });

    it("isolates and scrubs agent-ui card text before citation and safety validation", async () => {
        const directive = [
            "可继续。",
            "```agent-ui",
            JSON.stringify({
                component: "quick-actions",
                props: {
                    actions: [{ label: "继续", prefill: "继续 [[K99:FAKE-1]]", autoSend: true }],
                },
            }),
            "```",
        ].join("\n");
        const harness = createHarness([
            [
                { type: "text_delta", text: directive },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 20 },
            ],
        ]);

        await harness.run("请根据我的知识库继续");

        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
        const persisted = harness.conversationLog.recordAssistantMessage.mock.calls[0]?.[0] as {
            content: string;
            contentBlocks: unknown[];
        };
        expect(persisted.content).toContain("```agent-ui");
        expect(persisted.content).not.toContain("K99");
        expect(persisted.content).not.toContain("来源引用未验证");
        expect(JSON.stringify(persisted.contentBlocks)).not.toContain("FAKE-1");
    });

    it("blocks unsafe grounded answer delivery", async () => {
        const safetyGrounding = baseGrounding([{ content: "record_id,state\nREC-100,active" }]);
        const safetyHarness = createHarness(
            [
                [
                    { type: "text_delta", text: "结论：应执行；记录 ID：REC-999。" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
                ],
            ],
            [],
            safetyGrounding,
        );
        await safetyHarness.run("请根据我的知识库核对 REC-100");
        expect(runResult(safetyHarness.emitted)).toMatchObject({
            status: "incomplete",
            stopReason: "knowledge_safety_violation",
        });
        expect(safetyHarness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining("已阻止展示"),
                contentBlocks: [expect.objectContaining({ type: "text", text: expect.stringContaining("已阻止展示") })],
            }),
        );
        expect(safetyHarness.conversationLog.recordAssistantMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("REC-999") }),
        );
        expect(JSON.stringify(safetyHarness.emitted)).not.toContain("结论：应执行；记录 ID：REC-999。");
    });

    it("validates and buffers answers grounded only by direct knowledge tools", async () => {
        const recordsResource = "asset://asset-1/raw/sources/records.csv";
        const unsafeText = "结论：应执行；记录 ID：REC-999。";
        const harness = createHarness(
            [
                [
                    {
                        type: "tool_start",
                        toolName: KNOWLEDGE_READ_TOOL,
                        toolId: "tool-records",
                        data: JSON.stringify({ input: { path: "raw/sources/records.csv" } }),
                    },
                    {
                        type: "tool_end",
                        toolName: KNOWLEDGE_READ_TOOL,
                        toolId: "tool-records",
                        toolOutput: JSON.stringify({
                            kind: "source",
                            assetId: "asset-1",
                            path: "raw/sources/records.csv",
                            title: "records.csv",
                            mime: "text/csv",
                            content: "record_id,state\nREC-100,active",
                            resource: recordsResource,
                            citations: [recordsResource],
                        }),
                        exitCode: 0,
                    },
                    { type: "text_delta", text: unsafeText },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 24 },
                ],
            ],
            [],
            null,
        );

        await harness.run("请使用知识库工具核对 REC-100");

        expect(runResult(harness.emitted)).toMatchObject({
            status: "incomplete",
            stopReason: "knowledge_safety_violation",
        });
        expect(JSON.stringify(harness.emitted)).not.toContain(unsafeText);
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("已阻止展示") }),
        );
        expect(harness.conversationLog.recordAssistantMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining(unsafeText) }),
        );
    });

    it("passes only the post-validation replacement to grounded stream hooks", async () => {
        const unsafeText = "结论：应执行；记录 ID：REC-999。";
        const onStreamText = jest.fn();
        const onStreamEnd = jest.fn().mockResolvedValue(undefined);
        const harness = createHarness(
            [
                [
                    { type: "text_delta", text: unsafeText },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
                ],
            ],
            [],
            baseGrounding([{ content: "record_id,state\nREC-100,active" }]),
            { onStreamText, onStreamEnd },
        );

        await harness.run("请根据我的知识库核对 REC-100");

        expect(onStreamText).not.toHaveBeenCalled();
        expect(onStreamEnd).toHaveBeenCalledTimes(1);
        expect(onStreamEnd.mock.calls[0]?.[1]).toContain("已阻止展示");
        expect(onStreamEnd.mock.calls[0]?.[1]).not.toContain(unsafeText);
    });

    it("corrects one unpublished grounded draft with the same session when a required identifier is missing", async () => {
        const firstDraft = "B-1 已验证 [[K1:B-1]]。";
        const correctedAnswer = "补充：必须保留 EXIT-W。";
        const harness = createHarness([
            [
                { type: "text_delta", text: firstDraft },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
            ],
            [
                { type: "text_delta", text: correctedAnswer },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 18 },
            ],
        ]);

        await harness.run("请根据我的知识库核对 B-1，并必须保留 `EXIT-W`。");

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(harness.streamRequest.mock.calls[1]?.[0]).toEqual(
            expect.objectContaining({
                history: [],
                prompt: expect.stringMatching(
                    /^Write only a concise additive correction block for the unpublished draft; do not repeat or rewrite the draft\./,
                ),
            }),
        );
        expect(harness.streamRequest.mock.calls[1]?.[0]?.prompt).toContain("Do not invoke or replay any tool");
        expect(harness.streamRequest.mock.calls[1]?.[0]?.prompt).not.toContain("complete replacement answer");
        expect(JSON.stringify(harness.streamRequest.mock.calls[1]?.[0]?.transientContext)).toContain(firstDraft);
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledTimes(1);
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining("EXIT-W"),
                contentBlocks: expect.arrayContaining([
                    expect.objectContaining({ type: "text", text: expect.stringContaining("B-1 已验证") }),
                ]),
            }),
        );
        expect(JSON.stringify(harness.emitted)).toContain("B-1 已验证");
        expect(JSON.stringify(harness.emitted)).toContain("base.csv");
        expect(harness.emitted).toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({ type: "knowledge_answer_completeness_corrected", attempt: 1 }),
            }),
        );
        const assistantFrame = harness.emitted.find(
            (message) =>
                Boolean(message) && typeof message === "object" && (message as { type?: unknown }).type === "assistant",
        ) as { runId?: string } | undefined;
        const persisted = harness.conversationLog.recordAssistantMessage.mock.calls[0]?.[0] as
            | { parentRunId?: string }
            | undefined;
        expect(assistantFrame?.runId).toEqual(expect.any(String));
        expect(persisted?.parentRunId).toBe(assistantFrame?.runId);
    });

    it("adds a bounded receipt when the correction still omits one uniquely read identifier", async () => {
        const requiredResource = "asset://asset-1/raw/sources/required.csv";
        const groundingWithRequiredIdentifier = baseGrounding([
            {
                kind: "source",
                assetId: "asset-1",
                path: "raw/sources/required.csv",
                title: "required.csv",
                mime: "text/csv",
                content: "id,status\nEXIT-W,verified",
                resource: requiredResource,
                citations: [requiredResource],
            },
        ]);
        const firstDraft = "B-1 已验证 [[K1:B-1]]。";
        const correctionPatch = "补充：已按本轮证据再次核对。";
        const harness = createHarness(
            [
                [
                    { type: "text_delta", text: firstDraft },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
                ],
                [
                    { type: "text_delta", text: correctionPatch },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 18 },
                ],
            ],
            [],
            groundingWithRequiredIdentifier,
        );

        await harness.run("请根据我的知识库核对 B-1，并必须保留 `EXIT-W`。");

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining("EXIT-W"),
                knowledgeSources: expect.arrayContaining([
                    expect.objectContaining({
                        resource: requiredResource,
                        locators: [expect.objectContaining({ kind: "record", value: "EXIT-W" })],
                    }),
                ]),
            }),
        );
        const persisted = harness.conversationLog.recordAssistantMessage.mock.calls[0]?.[0] as { content?: string };
        expect(persisted.content).toContain("B-1 已验证");
        expect(persisted.content).toContain("base.csv");
        expect(persisted.content).toContain(correctionPatch);
        expect(persisted.content).toContain("补充核验标识符");
    });

    it("fails closed without a correction retry when trusted restrictive evidence is ambiguous", async () => {
        const assetId = "asset-neutral-ambiguous";
        const revision = "revision-neutral-ambiguous";
        const trustedRead = (
            path: string,
            content: string,
            primaryKey: string,
            relations: Array<{
                sourceColumn: string;
                targetPath: string;
                targetColumn: string;
                confidence: "declared" | "high";
            }> = [],
        ) => {
            const resource = `asset://${assetId}/${path}`;
            return {
                assetId,
                path,
                title: path.split("/").at(-1) ?? path,
                mime: "text/csv",
                __knowledgePath: `source:${path}#0`,
                __knowledgeExpectedRevision: revision,
                indexSnapshot: { revision },
                resource,
                tableSummary: {
                    assetId,
                    path,
                    columns: content.split(/\r?\n/u)[0]?.split(",") ?? [],
                    primaryKey,
                    relations,
                    resource,
                },
                content,
            };
        };
        const reads = [
            trustedRead("raw/sources/links.csv", "link_id,from_location,to_location\nLINK-AB,ZONE-A,ZONE-B", "link_id"),
            trustedRead(
                "raw/sources/overrides.csv",
                [
                    "override_id,case_id,link_id,state",
                    "OVR-INTERNAL-77,CASE-INTERNAL-77,LINK-AB,blocked",
                    "OVR-INTERNAL-77,CASE-INTERNAL-77,LINK-AB,blocked",
                ].join("\n"),
                "override_id",
                [
                    {
                        sourceColumn: "case_id",
                        targetPath: "raw/sources/cases.csv",
                        targetColumn: "case_id",
                        confidence: "high",
                    },
                    {
                        sourceColumn: "link_id",
                        targetPath: "raw/sources/links.csv",
                        targetColumn: "link_id",
                        confidence: "high",
                    },
                ],
            ),
            trustedRead("raw/sources/cases.csv", "case_id,title\nCASE-INTERNAL-77,Internal case", "case_id"),
            trustedRead("raw/sources/locations.csv", "location_id,label\nZONE-A,Zone A\nZONE-B,Zone B", "location_id"),
        ];
        const grounding = JSON.stringify({
            status: "ok",
            reads,
            search: { tableSummaries: reads.map((read) => read.tableSummary) },
            coverage: { indexRevision: revision },
        });
        const unpublishedDraft = "ZONE-B remains unavailable because OVR-INTERNAL-77 is blocked.";
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: unpublishedDraft,
                grounding,
            }),
        ).toMatchObject({ unresolvedEvidence: true });
        expect(hasTrustedKnowledgeGrounding(grounding)).toBe(true);
        const harness = createHarness(
            [
                [
                    { type: "text_delta", text: unpublishedDraft },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
                ],
            ],
            [],
            grounding,
        );

        await harness.run("ZONE-B may reopen. Update the timeline and recompute the current state.");

        expect(harness.streamRequest).toHaveBeenCalledTimes(1);
        expect(harness.session.cancelRun).not.toHaveBeenCalled();
        expect(harness.session.cancelAndSettle).not.toHaveBeenCalled();
        expect(runResult(harness.emitted)).toMatchObject({
            status: "incomplete",
            stopReason: "knowledge_answer_incomplete",
        });
        expect(harness.emitted).toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({
                    type: "knowledge_answer_completeness_violation",
                    reason: "restrictive_evidence_ambiguous",
                }),
            }),
        );
        expect(harness.emitted).not.toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({ type: "knowledge_answer_completeness_correction" }),
            }),
        );
        const persisted = harness.conversationLog.recordAssistantMessage.mock.calls[0]?.[0] as
            | { content?: string; contentBlocks?: unknown[] }
            | undefined;
        expect(persisted?.content).toContain("无法形成唯一且完整的回答约束");
        for (const forbidden of [unpublishedDraft, "OVR-INTERNAL-77", "CASE-INTERNAL-77", "LINK-AB"]) {
            expect(JSON.stringify(harness.emitted)).not.toContain(forbidden);
            expect(JSON.stringify(persisted)).not.toContain(forbidden);
        }
        expect(JSON.stringify(harness.emitted)).not.toContain("missingIdentifiers");
        expect(
            (persisted?.contentBlocks ?? []).filter(
                (block) =>
                    Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "tool_use",
            ),
        ).toHaveLength(0);

        const multiScopeReads = [
            trustedRead("raw/sources/links.csv", "link_id,from_location,to_location\nLINK-AB,ZONE-A,ZONE-B", "link_id"),
            trustedRead(
                "raw/sources/overrides.csv",
                [
                    "override_id,case_id,link_id,state",
                    "OVR-SCOPE-7,CASE-7,LINK-AB,blocked",
                    "OVR-SCOPE-8,CASE-8,LINK-AB,blocked",
                ].join("\n"),
                "override_id",
                [
                    {
                        sourceColumn: "case_id",
                        targetPath: "raw/sources/cases.csv",
                        targetColumn: "case_id",
                        confidence: "high",
                    },
                    {
                        sourceColumn: "link_id",
                        targetPath: "raw/sources/links.csv",
                        targetColumn: "link_id",
                        confidence: "high",
                    },
                ],
            ),
            trustedRead("raw/sources/cases.csv", "case_id,title\nCASE-7,First case\nCASE-8,Second case", "case_id"),
        ];
        const multiScopeGrounding = JSON.stringify({
            status: "ok",
            reads: multiScopeReads,
            search: { tableSummaries: multiScopeReads.map((read) => read.tableSummary) },
            coverage: { indexRevision: revision },
        });
        const multiScopeDraft = "ZONE-B remains unavailable.";
        expect(
            analyzeKnowledgeAnswerCompleteness({
                userText: "ZONE-B may reopen. Update the timeline and recompute the current state.",
                answerText: multiScopeDraft,
                grounding: multiScopeGrounding,
            }),
        ).toEqual({ missingIdentifiers: [], unresolvedEvidence: true });
        const multiScopeHarness = createHarness(
            [
                [
                    { type: "text_delta", text: multiScopeDraft },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
                ],
            ],
            [],
            multiScopeGrounding,
        );

        await multiScopeHarness.run("ZONE-B may reopen. Update the timeline and recompute the current state.");

        expect(multiScopeHarness.streamRequest).toHaveBeenCalledTimes(1);
        expect(runResult(multiScopeHarness.emitted)).toMatchObject({
            status: "incomplete",
            stopReason: "knowledge_answer_incomplete",
        });
        expect(multiScopeHarness.emitted).toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({
                    type: "knowledge_answer_completeness_violation",
                    reason: "restrictive_evidence_ambiguous",
                }),
            }),
        );
        expect(multiScopeHarness.emitted).not.toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({ type: "knowledge_answer_completeness_correction" }),
            }),
        );
        expect(JSON.stringify(multiScopeHarness.emitted)).not.toMatch(/OVR-SCOPE-[78]|CASE-[78]|LINK-AB/u);
    });

    it("corrects a grounded route draft that omits the unique verified path core", async () => {
        const routeGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    kind: "source",
                    assetId: "asset-1",
                    path: "raw/sources/links.csv",
                    title: "links.csv",
                    mime: "text/csv",
                    content: [
                        "link_id,from_node,to_node,status",
                        "L-1,N-A,N-B,open",
                        "L-2,N-B,N-C,open",
                        "L-3,N-C,N-D,open",
                    ].join("\n"),
                    resource: "asset://asset-1/raw/sources/links.csv",
                },
            ],
        });
        const harness = createHarness(
            [
                [
                    { type: "text_delta", text: "从 N-A 前往 N-C [[K1:L-1]]。" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
                ],
                [
                    { type: "text_delta", text: "完整路径为 N-A -> N-B -> N-C -> N-D [[K1:L-1]]。" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 18 },
                ],
            ],
            [],
            routeGrounding,
        );

        await harness.run("请给出 `N-A` 的安全路径。");

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(harness.streamRequest.mock.calls[1]?.[0]?.prompt).toContain("N-B");
        expect(harness.streamRequest.mock.calls[1]?.[0]?.prompt).toContain("N-D");
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded" });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("N-A -> N-B -> N-C -> N-D") }),
        );
    });

    it("corrects a factual relation draft that omits directly verified required equipment", async () => {
        const relationGrounding = JSON.stringify({
            status: "ok",
            reads: [
                {
                    kind: "source",
                    assetId: "asset-1",
                    path: "raw/sources/jobs.csv",
                    title: "jobs.csv",
                    mime: "text/csv",
                    content: "job_id,location_id,required_equipment_id\nJOB-8,ZONE-C,EQ-LIFT-8",
                    resource: "asset://asset-1/raw/sources/jobs.csv",
                },
            ],
        });
        const harness = createHarness(
            [
                [
                    { type: "text_delta", text: "JOB-8 位于 ZONE-C，需要升降设备 [[K1:JOB-8]]。" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
                ],
                [
                    { type: "text_delta", text: "JOB-8 位于 ZONE-C，需使用 EQ-LIFT-8 [[K1:JOB-8]]。" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 18 },
                ],
            ],
            [],
            relationGrounding,
        );

        await harness.run("我记得 JOB-8 的设备在 ZONE-C，对吗？");

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(harness.streamRequest.mock.calls[1]?.[0]?.prompt).toContain("EQ-LIFT-8");
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded" });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("EQ-LIFT-8") }),
        );
    });

    it("does not correct a locally negated identifier requirement", async () => {
        const harness = createHarness([
            [
                { type: "text_delta", text: "B-1 已验证 [[K1:B-1]]。" },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
            ],
        ]);

        await harness.run("不要提及 `EXIT-W`，请根据我的知识库核对 B-1。");

        expect(harness.streamRequest).toHaveBeenCalledTimes(1);
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
        expect(harness.emitted).not.toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({ type: "knowledge_answer_completeness_correction" }),
            }),
        );
    });

    it("reuses trusted evidence for correction without replaying a completed knowledge tool", async () => {
        const detailsResource = "asset://asset-1/raw/sources/details.csv";
        const harness = createHarness(
            [
                [
                    {
                        type: "tool_start",
                        toolName: KNOWLEDGE_READ_TOOL,
                        toolId: "tool-completeness-read",
                        data: JSON.stringify({ input: { path: "raw/sources/details.csv" } }),
                    },
                    {
                        type: "tool_end",
                        toolName: KNOWLEDGE_READ_TOOL,
                        toolId: "tool-completeness-read",
                        toolOutput: JSON.stringify({
                            kind: "source",
                            assetId: "asset-1",
                            path: "raw/sources/details.csv",
                            title: "details.csv",
                            mime: "text/csv",
                            content: "id,value\nD-1,verified",
                            resource: detailsResource,
                            citations: [detailsResource],
                        }),
                        exitCode: 0,
                    },
                    { type: "text_delta", text: "D-1 已核对 [[K1:D-1]]。" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 20 },
                ],
                [
                    { type: "text_delta", text: "D-1 已核对，并保留 EXIT-W [[K1:D-1]]。" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 24 },
                ],
            ],
            [],
            null,
        );

        await harness.run("请使用知识库工具核对 D-1，并保留 `EXIT-W`。");

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(harness.streamRequest.mock.calls[1]?.[0]?.history).toEqual([]);
        expect(harness.session.cancelRun).not.toHaveBeenCalled();
        const persisted = harness.conversationLog.recordAssistantMessage.mock.calls[0]?.[0] as {
            contentBlocks: Array<{ type?: string; name?: string; toolUseId?: string }>;
        };
        expect(
            persisted.contentBlocks.filter((block) => block.type === "tool_use" && block.name === KNOWLEDGE_READ_TOOL),
        ).toHaveLength(1);
        expect(
            persisted.contentBlocks.filter(
                (block) => block.type === "tool_result" && block.toolUseId === "tool-completeness-read",
            ),
        ).toHaveLength(1);
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
    });

    it("fails closed with an observable diagnostic when the one correction still omits an identifier", async () => {
        const omittedDraft = "B-1 已验证 [[K1:B-1]]。";
        const harness = createHarness([
            [
                { type: "text_delta", text: omittedDraft },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
            ],
            [
                { type: "text_delta", text: omittedDraft },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 18 },
            ],
        ]);

        await harness.run("请根据我的知识库核对 B-1，并必须保留 `EXIT-W`。");

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(runResult(harness.emitted)).toMatchObject({
            status: "incomplete",
            stopReason: "knowledge_answer_incomplete",
        });
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledTimes(1);
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining("EXIT-W"),
                contentBlocks: [
                    expect.objectContaining({
                        type: "text",
                        text: expect.stringContaining("已阻止不完整草稿展示"),
                    }),
                ],
            }),
        );
        expect(harness.emitted).toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({
                    type: "knowledge_answer_completeness_violation",
                    reason: "required_identifiers_missing_after_correction",
                    missingIdentifiers: ["EXIT-W"],
                }),
            }),
        );
    });

    it("cancels a correction stream that attempts to invoke a tool", async () => {
        const firstDraft = "B-1 已验证 [[K1:B-1]]。";
        const harness = createHarness([
            [
                { type: "text_delta", text: firstDraft },
                { type: "turn_end", stopReason: "end_turn", totalTokens: 12 },
            ],
            [
                {
                    type: "tool_start",
                    toolName: KNOWLEDGE_READ_TOOL,
                    toolId: "tool-forbidden-during-correction",
                    data: JSON.stringify({ input: { path: "raw/sources/base.csv" } }),
                },
            ],
        ]);

        await harness.run("请根据我的知识库核对 B-1，并必须保留 `EXIT-W`。");

        expect(harness.streamRequest).toHaveBeenCalledTimes(2);
        expect(harness.session.cancelRun).toHaveBeenCalledTimes(1);
        expect(harness.session.cancelAndSettle).toHaveBeenCalledTimes(1);
        expect(runResult(harness.emitted)).toMatchObject({
            status: "incomplete",
            stopReason: "knowledge_answer_incomplete",
        });
        expect(JSON.stringify(harness.emitted)).not.toContain(firstDraft);
        expect(harness.conversationLog.recordAssistantMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                contentBlocks: expect.not.arrayContaining([
                    expect.objectContaining({ type: "tool_use", name: KNOWLEDGE_READ_TOOL }),
                ]),
            }),
        );
        expect(harness.emitted).toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({
                    type: "knowledge_answer_completeness_violation",
                    reason: "correction_tool_attempt",
                    toolName: KNOWLEDGE_READ_TOOL,
                }),
            }),
        );
    });

    it("keeps ordinary non-knowledge responses streaming", async () => {
        const harness = createHarness(
            [
                [
                    { type: "text_delta", text: "普通流式回复" },
                    { type: "turn_end", stopReason: "end_turn", totalTokens: 8 },
                ],
            ],
            [],
            null,
        );

        await harness.run("你好");

        expect(harness.emitted).toContainEqual(
            expect.objectContaining({
                type: "stream_event",
                event: expect.objectContaining({ type: "text_delta", text: "普通流式回复" }),
            }),
        );
        expect(runResult(harness.emitted)).toMatchObject({ status: "succeeded", stopReason: "end_turn" });
    });
});
