export interface MarkdownTocItem {
  id: string;
  level: number;
  text: string;
}

export interface MarkdownHeadingItem extends MarkdownTocItem {
  line: number;
}

function normalizeHeadingText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .trim();
}

export function createMarkdownHeadingBaseId(text: string) {
  return (
    normalizeHeadingText(text)
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section"
  );
}

function createHeadingId(text: string, counts: Map<string, number>) {
  const base = createMarkdownHeadingBaseId(text);
  const nextCount = (counts.get(base) ?? 0) + 1;
  counts.set(base, nextCount);
  return nextCount === 1 ? base : `${base}-${nextCount}`;
}

export function buildMarkdownHeadingItems(content: string): MarkdownHeadingItem[] {
  const headingCounts = new Map<string, number>();
  const items: MarkdownHeadingItem[] = [];
  let fenced = false;

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmedLine = line.trimStart();
    if (/^(```|~~~)/.test(trimmedLine)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(trimmedLine);
    if (!match) continue;

    const level = match[1].length;
    const text = normalizeHeadingText(match[2]);
    if (!text) continue;

    const id = createHeadingId(text, headingCounts);
    items.push({ id, level, text, line: index + 1 });
  }

  return items;
}

export function buildMarkdownToc(content: string): MarkdownTocItem[] {
  return buildMarkdownHeadingItems(content)
    .filter((item) => item.level >= 2)
    .map(({ line: _line, ...item }) => item);
}

export function buildMarkdownHeadingIdMap(content: string) {
  return new Map(buildMarkdownHeadingItems(content).map((item) => [item.line, item.id]));
}
