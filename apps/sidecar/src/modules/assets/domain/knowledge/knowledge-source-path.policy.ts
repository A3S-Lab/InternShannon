export const INTERNAL_KNOWLEDGE_PATH_SEGMENTS = new Set([".internshannon", ".shuan-os-snapshots", ".shuan-os-trash"]);

export function isInternalKnowledgePath(path: string): boolean {
    return path
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .some((segment) => INTERNAL_KNOWLEDGE_PATH_SEGMENTS.has(segment.toLowerCase()));
}

export function isPublicKnowledgeSourcePath(path: string): boolean {
    const normalized = path.replace(/\\/g, "/");
    const segments = normalized.split("/");
    return (
        segments.length >= 3 &&
        segments[0] === "raw" &&
        segments[1] === "sources" &&
        segments
            .slice(2)
            .every((segment) => Boolean(segment) && segment !== "." && segment !== ".." && !segment.includes("\0")) &&
        !isInternalKnowledgePath(normalized)
    );
}
