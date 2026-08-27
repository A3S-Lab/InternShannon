import { isNoopSystemPromptUpdate } from "./runtime-override-guard";

describe("runtime override guard", () => {
    it("accepts an exact repeated system prompt as an idempotent update", () => {
        expect(isNoopSystemPromptUpdate("same prompt", "same prompt")).toBe(true);
        expect(isNoopSystemPromptUpdate(undefined, undefined)).toBe(true);
    });

    it("does not weaken the busy guard for real prompt changes", () => {
        expect(isNoopSystemPromptUpdate("new prompt", "old prompt")).toBe(false);
        expect(isNoopSystemPromptUpdate("same prompt ", "same prompt")).toBe(false);
    });
});
