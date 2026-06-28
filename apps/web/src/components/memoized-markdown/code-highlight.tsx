import { useReactive } from "ahooks";
import { Loader2 } from "lucide-react";
import { type HTMLAttributes, memo, type ReactNode, useEffect } from "react";
import { createHighlighter, type Highlighter } from "shiki";
import { AgentUiBlock } from "@/components/agent-page/chat/agent-ui-block";
import { AssetProposalCard } from "@/components/agent-page/chat/asset-proposal-card";
import CopyButton from "@/components/custom/copy-button";
import MermaidRenderer from "./mermaid";
import VisChartRenderer from "./vis-chart";

// =============================================================================
// Singleton highlighter — avoids re-loading WASM + themes per code block
// =============================================================================

let _highlighter: Highlighter | null = null;
let _highlighterPromise: Promise<Highlighter> | null = null;
const _loadedLangs = new Set<string>();

// Common languages to pre-load; others are loaded on demand
const PRELOAD_LANGS = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "html",
  "css",
  "bash",
  "shell",
  "python",
  "rust",
  "toml",
  "yaml",
  "markdown",
  "sql",
  "diff",
];
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "shell",
  yml: "yaml",
  plain: "text",
  plaintext: "text",
  txt: "text",
};

function getHighlighter(): Promise<Highlighter> {
  if (_highlighter) return Promise.resolve(_highlighter);
  if (_highlighterPromise) return _highlighterPromise;
  _highlighterPromise = createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: PRELOAD_LANGS,
  }).then((h) => {
    _highlighter = h;
    for (const lang of PRELOAD_LANGS) _loadedLangs.add(lang);
    return h;
  });
  return _highlighterPromise;
}

// =============================================================================
// LRU highlight cache — avoids re-highlighting identical code blocks
// =============================================================================

const MAX_CACHE = 128;
const _cache = new Map<string, string>();

function cacheKey(code: string, lang: string): string {
  return `${lang}:${code}`;
}

function cacheGet(key: string): string | undefined {
  const val = _cache.get(key);
  if (val !== undefined) {
    // Move to end (most recently used)
    _cache.delete(key);
    _cache.set(key, val);
  }
  return val;
}

function cacheSet(key: string, val: string): void {
  if (_cache.size >= MAX_CACHE) {
    // Evict oldest entry
    const first = _cache.keys().next().value;
    if (first !== undefined) _cache.delete(first);
  }
  _cache.set(key, val);
}

async function highlight(code: string, lang: string): Promise<string> {
  const key = cacheKey(code, lang);
  const cached = cacheGet(key);
  if (cached) return cached;

  const highlighter = await getHighlighter();

  // Lazy-load unknown languages
  if (!_loadedLangs.has(lang)) {
    try {
      await highlighter.loadLanguage(lang as Parameters<Highlighter["loadLanguage"]>[0]);
      _loadedLangs.add(lang);
    } catch {
      // Unknown language — fall back to "text"
      if (!_loadedLangs.has("text")) {
        await highlighter.loadLanguage("text");
        _loadedLangs.add("text");
      }
      const html = highlighter.codeToHtml(code, {
        lang: "text",
        themes: { light: "github-light", dark: "github-dark" },
      });
      cacheSet(key, html);
      return html;
    }
  }

  const html = highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
  });
  cacheSet(key, html);
  return html;
}

function normalizeLanguage(language: string): string {
  return LANGUAGE_ALIASES[language] ?? language ?? "text";
}

// =============================================================================
// Component
// =============================================================================

interface CodeHighlightProps extends HTMLAttributes<HTMLElement> {
  className?: string;
  children?: ReactNode;
  node?: unknown;
}

interface ShikiCodeBlockProps extends Omit<CodeHighlightProps, "children"> {
  code: string;
  language: string;
  children?: ReactNode;
}

function ShikiCodeBlock({ code, language, className, children, ...props }: ShikiCodeBlockProps) {
  const key = cacheKey(code, language);
  const cachedHtml = cacheGet(key);
  const state = useReactive({
    html: cachedHtml || "",
    isHighlighting: !cachedHtml,
  });

  useEffect(() => {
    const k = cacheKey(code, language);
    const cached = cacheGet(k);
    if (cached) {
      state.html = cached;
      state.isHighlighting = false;
      return;
    }
    state.isHighlighting = true;
    let cancelled = false;
    highlight(code, language).then((result) => {
      if (!cancelled) {
        state.html = result;
        state.isHighlighting = false;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, state]);

  return (
    <div className="shiki-block group">
      <div className="shiki-header relative">
        <span className="language-label">{language}</span>
        <div className="flex items-center gap-1">
          {state.isHighlighting && <Loader2 className="size-3 animate-spin text-muted-foreground/50" />}
          <CopyButton text={code} />
        </div>
      </div>
      <div className="shiki-code">
        {state.html ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki escapes code before producing highlight markup.
          <div dangerouslySetInnerHTML={{ __html: state.html }} />
        ) : (
          <pre className={className} {...props}>
            <code>{children}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

const CodeHighlight = memo(
  ({ className, children, node: _node, ...props }: CodeHighlightProps) => {
    const code = String(children).trim();
    const language = normalizeLanguage(className?.match(/language-([\w-]+)/)?.[1] || "text");
    const isInline = !className;

    // Intercept vis-chart code blocks
    if (language === "vis-chart" && !isInline) {
      return <VisChartRenderer code={code} />;
    }

    // Intercept mermaid code blocks
    if (language === "mermaid" && !isInline) {
      return <MermaidRenderer code={code} />;
    }

    // Intercept the asset-proposal fence emitted by AssetAgent so the user
    // sees a confirmation card with 确认 / 修改 / 取消 buttons instead of a
    // raw JSON code block.
    if (language === "asset-proposal" && !isInline) {
      return <AssetProposalCard code={code} />;
    }

    // Intercept the agent-ui fence: InternShannon emits a `{ component, props }` directive
    // routed to a trusted action component (e.g. quick-actions) so users one-click
    // built-in features instead of reading steps. See agent-ui-block.tsx.
    if (language === "agent-ui" && !isInline) {
      return <AgentUiBlock code={code} />;
    }

    if (isInline) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] font-mono" {...props}>
          {children}
        </code>
      );
    }

    return (
      <ShikiCodeBlock className={className} code={code} language={language} {...props}>
        {children}
      </ShikiCodeBlock>
    );
  },
  (prev, next) => prev.className === next.className && String(prev.children).trim() === String(next.children).trim(),
);

CodeHighlight.displayName = "CodeHighlight";

export default CodeHighlight;
