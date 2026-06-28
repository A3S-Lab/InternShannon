import {
  type AnchorHTMLAttributes,
  type ComponentProps,
  Fragment,
  type HTMLAttributes,
  isValidElement,
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ExtraProps } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import CodeHighlight from "@/components/memoized-markdown/code-highlight";
import {
  buildMarkdownHeadingIdMap,
  buildMarkdownHeadingItems,
  buildMarkdownToc,
  createMarkdownHeadingBaseId,
  type MarkdownHeadingItem,
  type MarkdownTocItem,
} from "@/lib/markdown-outline";
import "@/components/memoized-markdown/index.css";
import "@/components/custom/callouts.css";
import "katex/dist/katex.min.css";

export { buildMarkdownHeadingItems, buildMarkdownToc, type MarkdownHeadingItem, type MarkdownTocItem };

type RemarkPlugins = ComponentProps<typeof ReactMarkdown>["remarkPlugins"];
type RehypePlugins = ComponentProps<typeof ReactMarkdown>["rehypePlugins"];

/** Sanitize schema for untrusted wiki content (LLM-laundered from source docs).
 * Extends the default GitHub schema to (a) keep the internal `wiki:` protocol on
 * [[wikilink]] anchors and (b) preserve the math container classes so KaTeX
 * (which runs AFTER sanitize) can still render. Runs after rehypeRaw, so raw
 * <script>/onerror/javascript: HTML is stripped before reaching the DOM. */
const WIKI_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./, "math", "math-inline", "math-display"],
    ],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", "math", "math-inline", "math-display"]],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "math", "math-display", "md-callout", "md-callout-title", /^md-callout-[a-z]+$/],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "wiki", "wiki-embed"],
    // Allow inline `data:` image URIs so pasted/dropped images (stored as data
    // URLs in the markdown) render. Safe in <img>: browsers don't execute scripts
    // in image-loaded SVG, and non-image tags with src aren't in the allowlist.
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
} as typeof defaultSchema;

/** Minimal mdast shape used by the [[wikilink]] transform — avoids pulling a
 * unist-util-visit dependency for a small local rewrite. */
interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
  data?: Record<string, unknown>;
}

// Matches both `[[wikilink]]` and `![[embed]]` (the leading `!` is the embed
// marker, Obsidian transclusion syntax). Detected as text post-parse since
// commonmark leaves bracket-only syntax (no `(url)`) as literal text.
const WIKILINK_RE = /(!)?\[\[([^\]]+)\]\]/g;

function splitTextWithWikiLinks(value: string): MdastNode[] {
  const out: MdastNode[] = [];
  let last = 0;
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null = WIKILINK_RE.exec(value);
  while (match !== null) {
    if (match.index > last) out.push({ type: "text", value: value.slice(last, match.index) });
    const isEmbed = match[1] === "!";
    const [target, alias] = match[2].split("|");
    const cleanTarget = target.split("#")[0].trim();
    out.push({
      type: "link",
      url: `${isEmbed ? "wiki-embed" : "wiki"}:${encodeURIComponent(cleanTarget)}`,
      children: [{ type: "text", value: (alias || target).trim() }],
    });
    last = WIKILINK_RE.lastIndex;
    match = WIKILINK_RE.exec(value);
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

/** remark plugin: rewrite `[[Page|alias]]` → link (url `wiki:<target>`) and
 * `![[Page]]` → embed (url `wiki-embed:<target>`) text, skipping code spans. */
function remarkWikiLinks() {
  const walk = (node: MdastNode): void => {
    if (!Array.isArray(node.children)) return;
    const next: MdastNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && typeof child.value === "string" && child.value.includes("[[")) {
        next.push(...splitTextWithWikiLinks(child.value));
      } else {
        if (child.type !== "code" && child.type !== "inlineCode") walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: MdastNode): void => walk(tree);
}

/** Default header labels for `> [!TYPE]` callouts (Obsidian-compatible). Unknown
 * types fall back to a capitalised form of the raw type. */
const CALLOUT_LABELS: Record<string, string> = {
  note: "Note",
  info: "Info",
  tip: "Tip",
  hint: "Tip",
  important: "Important",
  success: "Success",
  check: "Success",
  done: "Success",
  question: "Question",
  help: "Question",
  faq: "Question",
  warning: "Warning",
  caution: "Warning",
  attention: "Warning",
  danger: "Danger",
  error: "Danger",
  bug: "Bug",
  failure: "Failure",
  fail: "Failure",
  missing: "Failure",
  example: "Example",
  quote: "Quote",
  cite: "Quote",
  abstract: "Abstract",
  summary: "Abstract",
  tldr: "Abstract",
  todo: "Todo",
};

const CALLOUT_MARKER_RE = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/;

/** Parses the `[!TYPE][+-] optional title` marker on the first line of a
 * callout blockquote. Returns null when the line is an ordinary blockquote. */
function parseCalloutMarker(firstLine: string): { type: string; fold: string; title: string } | null {
  const match = CALLOUT_MARKER_RE.exec(firstLine.trim());
  if (!match) return null;
  return { type: match[1].toLowerCase(), fold: match[2], title: match[3].trim() };
}

/** remark plugin: rewrite Obsidian/GitHub `> [!TYPE]` callout blockquotes into
 * `div.md-callout` boxes with a title header, styled via CSS. Strips the marker
 * text from the body so it never leaks into the rendered content. */
function remarkCallouts() {
  const walk = (node: MdastNode): void => {
    if (!Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child.type === "blockquote" && Array.isArray(child.children) && child.children.length > 0) {
        const firstPara = child.children[0];
        const firstText = firstPara?.type === "paragraph" ? firstPara.children?.[0] : undefined;
        if (firstText?.type === "text" && typeof firstText.value === "string") {
          const lines = firstText.value.split("\n");
          const marker = parseCalloutMarker(lines[0]);
          if (marker) {
            const body = lines.slice(1).join("\n");
            if (body) {
              firstText.value = body;
            } else {
              firstPara.children?.shift();
              if (firstPara.children?.length === 0) child.children.shift();
            }
            const titleText = marker.title || CALLOUT_LABELS[marker.type] || marker.type.replace(/^./, (c) => c.toUpperCase());
            child.data = {
              ...child.data,
              hName: "div",
              hProperties: { className: ["md-callout", `md-callout-${marker.type}`] },
            };
            child.children.unshift({
              type: "paragraph",
              data: { hName: "div", hProperties: { className: ["md-callout-title"] } },
              children: [{ type: "text", value: titleText }],
            });
          }
        }
      }
      walk(child);
    }
  };
  return (tree: MdastNode): void => walk(tree);
}

function extractNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractNodeText(node.props.children);
  return "";
}

function getMarkdownHeadingHref(id: string) {
  return `#${encodeURIComponent(id)}`;
}

type MarkdownCodeProps = HTMLAttributes<HTMLElement> & ExtraProps;

function MarkdownCode({ className, children, node: _node, ...props }: MarkdownCodeProps) {
  const code = (
    <CodeHighlight className={className} {...props}>
      {children}
    </CodeHighlight>
  );
  return className ? <div className="not-prose prose-chat">{code}</div> : code;
}

interface EmbedContext {
  resolveEmbed?: (target: string) => Promise<{ title: string; body: string } | null>;
  depth: number;
  enableMath: boolean;
  sanitize: boolean;
}

// Transclusion nesting cap: a page at depth 0 embeds at depth 1, whose embeds
// render at depth 2; deeper embeds degrade to the click-to-open card. Bounds
// runaway/cyclic `![[A]]`↔`![[B]]` without full cycle tracking.
// ponytail: depth cap, swap for a visited-set if cross-embed cycles matter.
const MAX_EMBED_DEPTH = 2;

/** Fetches a `![[embed]]` target and renders its markdown inline (recursively,
 * depth-capped). Loading/missing degrade to the placeholder card.
 * ponytail: block content nests inside the paragraph's <p>; the browser closes
 * the <p> and it renders fine (dev-only nesting warning). Promote `![[…]]` to a
 * block remark node if the warning becomes noise. */
function WikiEmbed({
  target,
  resolveEmbed,
  depth,
  onWikiLink,
  enableMath,
  sanitize,
}: {
  target: string;
  resolveEmbed: (target: string) => Promise<{ title: string; body: string } | null>;
  depth: number;
  onWikiLink?: (target: string) => void;
  enableMath: boolean;
  sanitize: boolean;
}) {
  const [state, setState] = useState<{ status: "loading" | "done" | "missing"; title?: string; body?: string }>({
    status: "loading",
  });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    resolveEmbed(target)
      .then((hit) => {
        if (alive) setState(hit ? { status: "done", title: hit.title, body: hit.body } : { status: "missing" });
      })
      .catch(() => {
        if (alive) setState({ status: "missing" });
      });
    return () => {
      alive = false;
    };
  }, [target, resolveEmbed]);

  if (state.status === "done" && state.body !== undefined) {
    return (
      <div className="not-prose my-2 overflow-hidden rounded-md border border-border bg-muted/15">
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <span aria-hidden="true">📄</span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{state.title ?? target}</span>
          {onWikiLink ? (
            <button
              type="button"
              onClick={() => onWikiLink(target)}
              className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-primary"
            >
              打开 →
            </button>
          ) : null}
        </div>
        <div className="px-3 py-2">
          <MarkdownViewerImpl
            content={state.body}
            onWikiLink={onWikiLink}
            enableMath={enableMath}
            sanitize={sanitize}
            resolveEmbed={depth + 1 < MAX_EMBED_DEPTH ? resolveEmbed : undefined}
            depth={depth + 1}
          />
        </div>
      </div>
    );
  }

  return (
    <span className="not-prose my-1 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
      <span aria-hidden="true">📄</span>
      <span className="min-w-0 flex-1 truncate">
        嵌入 · {target}
        {state.status === "missing" ? "(未找到)" : ""}
      </span>
      {onWikiLink ? (
        <button
          type="button"
          onClick={() => onWikiLink(target)}
          className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-primary"
        >
          打开 →
        </button>
      ) : null}
    </span>
  );
}

function createMarkdownComponents(
  headingIdsByLine: Map<number, string>,
  onWikiLink?: (target: string) => void,
  embed?: EmbedContext,
) {
  const MarkdownHeading = ({
    level,
    children,
    className,
    node,
    ...props
  }: HTMLAttributes<HTMLHeadingElement> & ExtraProps & { level: 1 | 2 | 3 | 4 }) => {
    const text = extractNodeText(children);
    const id =
      (typeof node?.position?.start?.line === "number" ? headingIdsByLine.get(node.position.start.line) : undefined) ??
      createMarkdownHeadingBaseId(text);
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
    const headingClassName = ["group scroll-mt-24", className].filter(Boolean).join(" ");

    return (
      <Tag id={id} className={headingClassName} {...props}>
        <a
          href={getMarkdownHeadingHref(id)}
          aria-label={`定位到 ${text}`}
          className="not-prose mr-2 inline-flex text-[#c0c7d2] opacity-0 transition group-hover:opacity-100 hover:text-[#1456f0]"
        >
          #
        </a>
        {children}
      </Tag>
    );
  };

  return {
    a: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
      if (href?.startsWith("wiki-embed:")) {
        const target = decodeURIComponent(href.slice("wiki-embed:".length));
        const label = extractNodeText(children) || target;
        // Transclusion: fetch + render the target inline (depth-capped). Without a
        // resolver (or past the depth cap) fall back to the click-to-open card.
        if (embed?.resolveEmbed && embed.depth < MAX_EMBED_DEPTH) {
          return (
            <WikiEmbed
              target={target}
              resolveEmbed={embed.resolveEmbed}
              depth={embed.depth}
              onWikiLink={onWikiLink}
              enableMath={embed.enableMath}
              sanitize={embed.sanitize}
            />
          );
        }
        const card = (
          <span className="not-prose my-1 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
            <span aria-hidden="true">📄</span>
            <span className="min-w-0 flex-1 truncate">嵌入 · {label}</span>
            {onWikiLink ? <span className="shrink-0 text-xs text-primary">打开 →</span> : null}
          </span>
        );
        if (onWikiLink) {
          return (
            <button
              type="button"
              onClick={() => onWikiLink(target)}
              className="not-prose block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
            >
              {card}
            </button>
          );
        }
        return card;
      }
      if (href?.startsWith("wiki:")) {
        const target = decodeURIComponent(href.slice("wiki:".length));
        if (onWikiLink) {
          return (
            <button
              type="button"
              onClick={() => onWikiLink(target)}
              className="not-prose inline cursor-pointer border-b border-dashed border-primary/50 bg-transparent p-0 text-primary hover:border-primary"
            >
              {children}
            </button>
          );
        }
        return <span className="text-primary">{children}</span>;
      }
      const external = href?.startsWith("http://") || href?.startsWith("https://");
      return (
        <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...props}>
          {children}
        </a>
      );
    },
    h1: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading level={1} {...props} />,
    h2: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading level={2} {...props} />,
    h3: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading level={3} {...props} />,
    h4: (props: HTMLAttributes<HTMLHeadingElement>) => <MarkdownHeading level={4} {...props} />,
    pre: ({ children }: HTMLAttributes<HTMLPreElement>) => <>{children}</>,
    code: MarkdownCode,
  } as const;
}

interface FrontmatterProperty {
  key: string;
  values: string[];
}

function stripYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parses a leading YAML front-matter block (`---\n…\n---`) into a flat list of
 * key → value(s). Handles scalars, inline `[a, b]` arrays, and `- ` list items.
 * ponytail: shallow YAML only (no nested maps); returns null when absent so the
 * body renders unchanged. */
function parseFrontmatter(raw: string): { properties: FrontmatterProperty[] | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!match) return { properties: null, body: raw };
  const properties: FrontmatterProperty[] = [];
  let current: FrontmatterProperty | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && current) {
      current.values.push(stripYamlScalar(listItem[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_][\w .-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = kv[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      current = {
        key: kv[1].trim(),
        values: value
          .slice(1, -1)
          .split(",")
          .map((part) => stripYamlScalar(part))
          .filter(Boolean),
      };
    } else {
      current = { key: kv[1].trim(), values: value ? [stripYamlScalar(value)] : [] };
    }
    properties.push(current);
  }
  return { properties: properties.length ? properties : null, body: raw.slice(match[0].length) };
}

/** Obsidian-style "Properties" panel rendered above the page body. */
function FrontmatterPanel({ properties }: { properties: FrontmatterProperty[] }) {
  return (
    <div className="not-prose mb-4 rounded-md border border-border bg-muted/30 px-3 py-2">
      <dl className="grid grid-cols-[minmax(80px,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">
        {properties.map((property) => (
          <Fragment key={property.key}>
            <dt className="truncate font-medium text-muted-foreground" title={property.key}>
              {property.key}
            </dt>
            <dd className="min-w-0 text-foreground">
              {property.values.length === 0 ? (
                <span className="text-muted-foreground/60">—</span>
              ) : property.values.length === 1 ? (
                property.values[0]
              ) : (
                <span className="flex flex-wrap gap-1">
                  {property.values.map((value) => (
                    <span
                      key={`${property.key}:${value}`}
                      className="rounded bg-primary/10 px-1.5 py-0.5 text-primary"
                    >
                      {value}
                    </span>
                  ))}
                </span>
              )}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

export interface MarkdownViewerProps {
  content: string;
  /** Enables `[[wikilink]]` rendering; clicking a link calls this handler. */
  onWikiLink?: (target: string) => void;
  /** Enables KaTeX math rendering ($…$, $$…$$). Off by default to keep other
   * markdown surfaces byte-for-byte unchanged. */
  enableMath?: boolean;
  /** Sanitizes raw HTML (rehype-sanitize) for untrusted content such as the
   * knowledge wiki. Off by default so trusted surfaces render unchanged. */
  sanitize?: boolean;
  /** Resolves `![[embed]]` transclusions to the target page's markdown. When
   * set, embeds render the fetched content inline (recursively, depth-capped)
   * instead of a placeholder card. Must be stable (useCallback). */
  resolveEmbed?: (target: string) => Promise<{ title: string; body: string } | null>;
  /** Internal: current transclusion nesting depth (cycle/runaway guard). */
  depth?: number;
}

function MarkdownViewerImpl({
  content,
  onWikiLink,
  enableMath = false,
  sanitize = false,
  resolveEmbed,
  depth = 0,
}: MarkdownViewerProps) {
  const wikiLinksEnabled = Boolean(onWikiLink);
  // Front-matter → Properties panel, knowledge surface only. Feed the body (sans
  // front-matter) to ReactMarkdown AND the heading-id map so anchors stay aligned.
  const { properties, body } = useMemo(
    () => (wikiLinksEnabled ? parseFrontmatter(content) : { properties: null, body: content }),
    [content, wikiLinksEnabled],
  );
  const headingIdsByLine = useMemo(() => buildMarkdownHeadingIdMap(body), [body]);
  const components = useMemo(
    () => createMarkdownComponents(headingIdsByLine, onWikiLink, { resolveEmbed, depth, enableMath, sanitize }),
    [headingIdsByLine, onWikiLink, resolveEmbed, depth, enableMath, sanitize],
  );
  const remarkPlugins = useMemo(
    () =>
      [
        remarkGfm,
        ...(enableMath ? [remarkMath] : []),
        ...(wikiLinksEnabled ? [remarkWikiLinks, remarkCallouts] : []),
      ] as RemarkPlugins,
    [enableMath, wikiLinksEnabled],
  );
  const rehypePlugins = useMemo(
    () =>
      [
        rehypeRaw,
        ...(sanitize ? [[rehypeSanitize, WIKI_SANITIZE_SCHEMA]] : []),
        ...(enableMath ? [rehypeKatex] : []),
      ] as RehypePlugins,
    [enableMath, sanitize],
  );

  return (
    <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-foreground prose-h1:text-[30px] prose-h2:mt-10 prose-h2:border-b prose-h2:border-border prose-h2:pb-2 prose-a:text-primary prose-table:block prose-table:w-full prose-table:overflow-x-auto prose-th:border prose-th:border-border prose-th:bg-muted/50 prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-img:rounded-md prose-img:border prose-img:border-[#edf0f2]">
      {properties && properties.length > 0 && <FrontmatterPanel properties={properties} />}
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  );
}

/** Memoized: markdown render is heavy (remark/rehype + KaTeX + callouts). Skips
 * re-render when props are unchanged — effective where hosts pass a stable
 * `onWikiLink` (most do via useCallback). */
export const MarkdownViewer = memo(MarkdownViewerImpl);

export default MarkdownViewer;
