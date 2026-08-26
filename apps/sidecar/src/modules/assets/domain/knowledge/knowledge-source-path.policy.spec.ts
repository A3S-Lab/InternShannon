import { isInternalKnowledgePath, isPublicKnowledgeSourcePath } from "./knowledge-source-path.policy";

describe("knowledge source path policy", () => {
    it("keeps normal raw sources public", () => {
        expect(isPublicKnowledgeSourcePath("raw/sources/02-建筑布局.md")).toBe(true);
    });

    it.each([
        "raw/sources/.shuan-os-snapshots/old.md",
        "raw/sources/.shuan-os-trash/deleted.csv",
        "raw/sources/.SHUAN-OS-TRASH/deleted.csv",
        ".internshannon/knowledge/index/manifest.json",
        "raw\\sources\\.shuan-os-trash\\old.md",
    ])("blocks internal repository path %s", (path) => {
        expect(isInternalKnowledgePath(path)).toBe(true);
        expect(isPublicKnowledgeSourcePath(path)).toBe(false);
    });

    it.each([
        "raw/sources/../private.md",
        "raw/sources/./private.md",
        "raw/sources//private.md",
        "raw/sources/",
        "wiki/source.md",
    ])("rejects unsafe or non-source path %s", (path) => {
        expect(isPublicKnowledgeSourcePath(path)).toBe(false);
    });
});
