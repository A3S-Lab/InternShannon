/**
 * Decide whether a file should open in the WYSIWYG Markdown editor (TipTap)
 * or the source-code editor (Monaco).
 *
 * Rules:
 *   - Rich markdown must be explicitly enabled by the host. The default is
 *     false so raw assets and SKILL.md files never round-trip through
 *     TipTap's tiptap-markdown serializer (which strips YAML frontmatter —
 *     see PR #7 Bug 1).
 *   - Path must end in `.md`, `.markdown`, or `.mkd`. `.mdx` is excluded on
 *     purpose: it can embed JSX, which TipTap cannot represent faithfully.
 *
 * Extracted as a pure function so the contract can be unit-tested.
 */
export function shouldUseRichMarkdownEditor(
  enableRichMarkdown: boolean | undefined,
  path: string | undefined,
): boolean {
  if (enableRichMarkdown !== true) return false;
  return /\.(md|markdown|mkd)$/i.test(path ?? "");
}

/**
 * Monaco already exposes the source text that must be persisted. Keep this
 * boundary explicit so source-mode saves cannot accidentally start using the
 * TipTap markdown serializer in a future editor refactor.
 */
export function sourceModeContentForSave(content: string): string {
  return content;
}
