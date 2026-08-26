import type { AgentEvent } from "@a3s-lab/code";
import { isKnownEventType, normalizeStreamEvent } from "./kernel-stream-event-normalizer";

describe("kernel stream event normalizer", () => {
    it("preserves tool_end duration metadata for completed tool rendering", () => {
        const event = {
            type: "tool_end",
            data: JSON.stringify({
                type: "tool_end",
                tool_name: "ls",
                tool_id: "tool-list",
                output: "ok",
                duration_ms: 7,
            }),
        } as AgentEvent;

        expect(normalizeStreamEvent("tool_end", event, JSON.parse(event.data ?? "{}"))).toEqual({
            type: "tool_end",
            toolName: "ls",
            toolId: "tool-list",
            output: "ok",
            exitCode: undefined,
            durationMs: 7,
        });
    });

    it("recognizes SDK confirmation_received as a silent lifecycle event", () => {
        const event = {
            type: "confirmation_received",
            data: JSON.stringify({
                type: "confirmation_received",
                requestId: "confirm-1",
                approved: true,
            }),
        } as AgentEvent;

        expect(isKnownEventType("confirmation_received")).toBe(true);
        expect(normalizeStreamEvent("confirmation_received", event, JSON.parse(event.data ?? "{}"))).toBeNull();
    });

    it("normalizes the controlled A3S tool execution boundary", () => {
        const event = {
            type: "tool_execution_start",
            data: JSON.stringify({
                type: "tool_execution_start",
                id: "call-skill-1",
                name: "Skill",
                args: { skill_name: "fire-evacuation-simulation" },
            }),
        } as AgentEvent;

        expect(isKnownEventType("tool_execution_start")).toBe(true);
        expect(normalizeStreamEvent("tool_execution_start", event, JSON.parse(event.data ?? "{}"))).toEqual({
            type: "tool_execution_start",
            toolName: "Skill",
            toolId: "call-skill-1",
            input: { skill_name: "fire-evacuation-simulation" },
        });
    });

    it("normalizes compact aliases while stripping summary and secret payloads", () => {
        const event = {
            type: "context_compacted",
            data: JSON.stringify({
                before_messages: 29,
                after: 4,
                percent_before: 0.81,
                operation: "  rolling  ",
                summary: "private summary must not reach the client",
                content: "private conversation content",
                prompt: "private compaction prompt",
                apiKey: "secret-key",
            }),
        } as AgentEvent;

        expect(normalizeStreamEvent("context_compacted", event, JSON.parse(event.data ?? "{}"))).toEqual({
            type: "context_compacted",
            beforeMessages: 29,
            afterMessages: 4,
            percentBefore: 0.81,
            operation: "rolling",
        });
    });
});
