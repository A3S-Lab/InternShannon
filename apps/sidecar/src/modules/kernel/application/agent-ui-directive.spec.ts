import {
    AGENT_UI_DEGRADED_NOTICE,
    isolateAgentUiDirectivesForCitation,
    normalizeAgentUiDirectives,
    parseAgentUiDirective,
    restoreAgentUiDirectivesAfterCitation,
} from "./agent-ui-directive";
import { finalizeKnowledgeAnswer } from "./knowledge-source-reference";

const VALID = JSON.stringify({
    component: "quick-actions",
    props: {
        title: "授权知识库",
        actions: [{ label: "授权并继续", icon: "book", prefill: "我授权你使用个人知识库并继续检索", autoSend: true }],
    },
});

const GROUNDING = JSON.stringify({
    reads: [
        {
            title: "people.csv",
            content: "id,name\nP-1,Alice",
            resource: "asset://asset-1/raw/sources/people.csv",
        },
    ],
});

const FIRST_PLACEHOLDER_CANDIDATE = "INTERNAL_AGENT_UI_DIRECTIVE_TOKEN_0_0_END";

describe("agent-ui terminal validation", () => {
    it("keeps a valid trusted quick-action directive", () => {
        expect(parseAgentUiDirective(VALID)?.status).toBe("valid");
        const normalized = normalizeAgentUiDirectives(`正文\n\`\`\`agent-ui\n${VALID}\n\`\`\``);
        expect(normalized.validCount).toBe(1);
        expect(normalized.invalidCount).toBe(0);
        expect(normalized.text).toContain('"component": "quick-actions"');
    });

    it("repairs only one missing final object brace", () => {
        const missingFinalBrace = VALID.slice(0, -1);
        expect(parseAgentUiDirective(missingFinalBrace)?.status).toBe("repaired");
        const normalized = normalizeAgentUiDirectives(`\`\`\`agent-ui\n${missingFinalBrace}\n\`\`\``);
        expect(normalized.repairedCount).toBe(1);
        expect(normalized.text).not.toContain(AGENT_UI_DEGRADED_NOTICE);
    });

    it("rejects malformed, external-route and dual-action directives without guessing", () => {
        for (const invalid of [
            '{"component":"quick-actions"',
            JSON.stringify({
                component: "quick-actions",
                props: { actions: [{ label: "外链", navigate: "//evil.test" }] },
            }),
            JSON.stringify({
                component: "quick-actions",
                props: { actions: [{ label: "冲突", navigate: "/knowledge", prefill: "继续" }] },
            }),
            JSON.stringify({
                component: "quick-actions",
                props: { actions: [{ label: "未知字段", prefill: "继续", command: "unsafe" }] },
            }),
        ]) {
            expect(parseAgentUiDirective(invalid)).toBeNull();
            const normalized = normalizeAgentUiDirectives(`正文\n\`\`\`agent-ui\n${invalid}\n\`\`\``);
            expect(normalized.invalidCount).toBe(1);
            expect(normalized.text).toContain(AGENT_UI_DEGRADED_NOTICE);
            expect(normalized.text).not.toContain("agent-ui");
        }
    });

    it("degrades an unclosed agent-ui fence instead of persisting raw instructions", () => {
        const normalized = normalizeAgentUiDirectives('正文\n```agent-ui\n{"component":"quick-actions"');

        expect(normalized.invalidCount).toBe(1);
        expect(normalized.text).toBe(`正文\n${AGENT_UI_DEGRADED_NOTICE}`);
        expect(normalized.text).not.toContain("agent-ui");
    });

    it("isolates card JSON from citation finalization and restores a scrubbed valid card", () => {
        const directive = JSON.stringify({
            component: "quick-actions",
            props: {
                title: "继续查看［people.csv｜K1］",
                actions: [
                    {
                        label: "继续 [[K1:P-1]]",
                        description: "依据 [people.csv，记录 ID：P-1]",
                        prefill: "读取 [people.csv，记录 ID：P-1] asset://asset-1/raw/sources/people.csv 后继续",
                        autoSend: true,
                    },
                ],
            },
        });
        const isolation = isolateAgentUiDirectivesForCitation(`正文 [[K1:P-1]]\n\`\`\`agent-ui\n${directive}\n\`\`\``);

        expect(isolation.invalidCount).toBe(0);
        expect(isolation.directives).toHaveLength(1);
        expect(isolation.text).toContain("[[K1:P-1]]");
        expect(isolation.text).not.toContain("people.csv，记录 ID");
        expect(isolation.text).not.toContain("asset://");

        const finalized = finalizeKnowledgeAnswer(isolation.text, GROUNDING);
        expect(finalized.sources).toHaveLength(1);
        expect(finalized.unverifiedCitationCount).toBe(0);
        const restored = restoreAgentUiDirectivesAfterCitation(finalized.text, isolation);
        expect(restored.validCount).toBe(0);
        expect(restored.repairedCount).toBe(1);
        expect(restored.invalidCount).toBe(0);
        expect(restored.text).toContain("```agent-ui");
        expect(restored.text).toContain("[people.csv，记录 ID：P-1]");
        expect(restored.text).not.toMatch(/K1/u);
        expect(restored.text).not.toContain("asset://");
    });

    it("chooses a visible collision-free token when user text pre-injects the first candidate", () => {
        const input = `用户原文保留 ${FIRST_PLACEHOLDER_CANDIDATE}\n正文 [[K1:P-1]]\n\`\`\`agent-ui\n${VALID}\n\`\`\``;
        const isolation = isolateAgentUiDirectivesForCitation(input);
        const placeholder = isolation.directives[0]?.placeholder;

        expect(placeholder).toBeDefined();
        expect(placeholder).not.toBe(FIRST_PLACEHOLDER_CANDIDATE);
        expect(placeholder).toMatch(/^[\x20-\x7e]+$/u);
        expect(placeholder).not.toMatch(/[\u0000-\u001f\u007f-\u009f\uE000-\uF8FF]/u);
        expect(isolation.text).toContain(FIRST_PLACEHOLDER_CANDIDATE);
        expect(isolation.text).toContain(placeholder);

        const finalized = finalizeKnowledgeAnswer(isolation.text, GROUNDING);
        expect(finalized.unverifiedCitationCount).toBe(0);
        expect(finalized.text).toContain(FIRST_PLACEHOLDER_CANDIDATE);
        expect(finalized.text).toContain(placeholder);

        const restored = restoreAgentUiDirectivesAfterCitation(finalized.text, isolation);
        expect(restored.validCount).toBe(1);
        expect(restored.invalidCount).toBe(0);
        expect(restored.text).toContain(FIRST_PLACEHOLDER_CANDIDATE);
        expect(restored.text).toContain("```agent-ui");
        expect(restored.text).not.toContain(placeholder);
    });

    it("restores multiple unique directives around a verified citation without using the private namespace", () => {
        const repaired = VALID.slice(0, -1);
        const isolation = isolateAgentUiDirectivesForCitation(
            `开始\n\`\`\`agent-ui\n${VALID}\n\`\`\`\n依据 [[K1:P-1]]\n\`\`\`agent-ui\n${repaired}\n\`\`\`\n结束`,
        );

        expect(isolation.invalidCount).toBe(0);
        expect(isolation.directives).toHaveLength(2);
        expect(new Set(isolation.directives.map(({ placeholder }) => placeholder)).size).toBe(2);
        for (const { placeholder } of isolation.directives) {
            expect(placeholder).toMatch(/^[\x20-\x7e]+$/u);
            expect(placeholder).not.toMatch(/[\uE000-\uF8FF]/u);
        }

        const finalized = finalizeKnowledgeAnswer(isolation.text, GROUNDING);
        expect(finalized.sources).toHaveLength(1);
        expect(finalized.unverifiedCitationCount).toBe(0);
        for (const { placeholder } of isolation.directives) expect(finalized.text).toContain(placeholder);

        const restored = restoreAgentUiDirectivesAfterCitation(finalized.text, isolation);
        expect(restored.validCount).toBe(1);
        expect(restored.repairedCount).toBe(1);
        expect(restored.invalidCount).toBe(0);
        expect(restored.text.match(/```agent-ui/gu)).toHaveLength(2);
        expect(restored.text).toContain("[people.csv，记录 ID：P-1]");
        expect(restored.text).not.toMatch(/[\uE000-\uF8FF]/u);
    });

    it("degrades a multi-brace malformed directive while independently restoring a valid sibling", () => {
        const missingTwoBraces = VALID.slice(0, -2);
        const isolation = isolateAgentUiDirectivesForCitation(
            `依据 [[K1:P-1]]\n\`\`\`agent-ui\n${missingTwoBraces}\n\`\`\`\n\`\`\`agent-ui\n${VALID}\n\`\`\``,
        );

        expect(parseAgentUiDirective(missingTwoBraces)).toBeNull();
        expect(isolation.invalidCount).toBe(1);
        expect(isolation.directives).toHaveLength(1);
        expect(isolation.text).toContain(AGENT_UI_DEGRADED_NOTICE);

        const finalized = finalizeKnowledgeAnswer(isolation.text, GROUNDING);
        expect(finalized.unverifiedCitationCount).toBe(0);
        const restored = restoreAgentUiDirectivesAfterCitation(finalized.text, isolation);
        expect(restored.validCount).toBe(1);
        expect(restored.repairedCount).toBe(0);
        expect(restored.invalidCount).toBe(1);
        expect(restored.text).toContain(AGENT_UI_DEGRADED_NOTICE);
        expect(restored.text.match(/```agent-ui/gu)).toHaveLength(1);
        expect(restored.text).not.toContain(missingTwoBraces);
    });

    it("degrades a directive when scrubbing empties a required field", () => {
        for (const unsafe of [
            {
                component: "quick-actions",
                props: { actions: [{ label: "[[K1]]", prefill: "继续" }] },
            },
            {
                component: "quick-actions",
                props: { actions: [{ label: "继续", prefill: "asset://asset-1/raw/source.md" }] },
            },
            {
                component: "quick-actions",
                props: { actions: [{ label: "继续", navigate: "/knowledge?from=asset://asset-1/source.md" }] },
            },
        ]) {
            const raw = JSON.stringify(unsafe);
            expect(parseAgentUiDirective(raw)).toBeNull();
            const normalized = normalizeAgentUiDirectives(`\`\`\`agent-ui\n${raw}\n\`\`\``);
            expect(normalized.invalidCount).toBe(1);
            expect(normalized.text).toBe(AGENT_UI_DEGRADED_NOTICE);
        }
    });

    it("cleans only independent dangerous URI schemes without corrupting metadata or profile text", () => {
        const directive = JSON.stringify({
            component: "quick-actions",
            props: {
                title: "metadata: 保留",
                actions: [
                    {
                        label: "查看 profile://avatar",
                        description: "查看asset://asset-1/raw/source.md 并保留 metadata: value",
                        prefill: "删除 file://tmp/a javascript:alert(1) data:text/plain,secret 后继续",
                    },
                ],
            },
        });

        const parsed = parseAgentUiDirective(directive);
        expect(parsed?.status).toBe("repaired");
        expect(JSON.stringify(parsed?.value)).toContain("metadata: 保留");
        expect(JSON.stringify(parsed?.value)).toContain("profile://avatar");
        expect(JSON.stringify(parsed?.value)).toContain("并保留 metadata: value");
        expect(JSON.stringify(parsed?.value)).not.toContain("asset://");
        expect((parsed?.value.props as { actions: Array<{ prefill: string }> }).actions[0]?.prefill).toBe(
            "删除 后继续",
        );
    });

    it("fails closed if citation processing removes or duplicates an isolated placeholder", () => {
        const isolation = isolateAgentUiDirectivesForCitation(`\`\`\`agent-ui\n${VALID}\n\`\`\``);
        const placeholder = isolation.directives[0]?.placeholder;
        expect(placeholder).toBeDefined();
        if (!placeholder) throw new Error("expected an isolated directive placeholder");

        for (const corrupted of [isolation.text.replace(placeholder, ""), `${isolation.text}${placeholder}`]) {
            const restored = restoreAgentUiDirectivesAfterCitation(corrupted, isolation);
            expect(restored.validCount).toBe(0);
            expect(restored.invalidCount).toBe(1);
            expect(restored.text).toContain(AGENT_UI_DEGRADED_NOTICE);
            expect(restored.text).not.toContain("agent-ui");
            expect(restored.text).not.toContain(placeholder);
        }
    });
});
