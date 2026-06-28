/**
 * Detects whether a position in assistant-stream text falls inside a
 * markdown code context (fenced block / inline code span / blockquote
 * line). Used by agent marker parsers to reject control markers that arrive
 * embedded in quoted user content,
 * file excerpts, or other untrusted material the model is paraphrasing.
 *
 * Threat model: control markers like `[PHASE:complete]` or `[PLAN:apply]`
 * are an implicit DSL the parsers honor verbatim. Without this guard, a
 * user could paste the marker into a chat message and have the assistant
 * echo it (often inside a code fence when the assistant cites the user),
 * triggering a state transition or planner run.
 */

/**
 * Conservative heuristic. Returns true if the position appears to be
 * inside any of:
 *   - a triple-backtick fenced block (` ``` ... ``` `, including longer fences)
 *   - an inline code span on the same line (` `...` `)
 *   - a blockquote line starting with `>` (ignoring leading whitespace)
 *
 * Edge cases not handled (acceptable for the threat model):
 *   - double-backtick inline spans (``` `` ``foo`` `` ```) — rarely emitted
 *   - escaped backticks (`\\``) — markdown does not escape backticks this way
 */
export function isInsideMarkdownCodeContext(text: string, position: number): boolean {
    if (position <= 0) return false;
    const before = text.slice(0, position);

    // Fenced block: any sequence of three-or-more backticks counts as
    // one fence delimiter; an odd number of delimiters before the
    // position means we are between an open and a close.
    const fenceMatches = before.match(/```+/g);
    if (fenceMatches && fenceMatches.length % 2 === 1) return true;

    // Current-line analysis. `lineBefore` is the text after the most
    // recent newline up to the position.
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineBefore = before.slice(lineStart);

    // Blockquote: line starts with `>` (with optional indent).
    if (/^\s*>/.test(lineBefore)) return true;

    // Inline backticks on the same line. Triple-fence delimiters were
    // already accounted for above (and if any existed before the line
    // start they'd have been counted). Single backticks remaining on
    // this line indicate an open inline span if their count is odd.
    const inlineBackticks = (lineBefore.match(/`/g) || []).length;
    if (inlineBackticks % 2 === 1) return true;

    return false;
}
