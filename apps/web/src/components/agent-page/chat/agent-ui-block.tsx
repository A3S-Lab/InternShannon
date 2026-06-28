import {
  ArrowRight,
  BookOpen,
  type LucideIcon,
  Package,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import agentModel from "@/models/agent.model";
import { useAgentSessionId } from "../agent-session-context";

/**
 * AgentUI — Channel 1 (trusted action components).
 *
 * InternShannon emits a fenced ```agent-ui``` block whose body is a JSON directive
 * `{ component, props }`. code-highlight.tsx routes the fence here; we look the
 * component up in a small TRUSTED registry and render it. The agent only chooses
 * WHICH component + supplies (validated) props — it never ships executable code,
 * so these cards can safely drive built-in features (navigate / prefill / — in a
 * later phase — confirmed capability calls). Untrusted/bespoke UI goes through the
 * separate sandboxed `<AgentUI>` runtime instead.
 *
 * Parse/registry failures degrade to a readable notice, never breaking the chat.
 */

interface AgentUiDirective {
  component: string;
  props?: Record<string, unknown>;
}

function parseDirective(code: string): AgentUiDirective | null {
  try {
    const obj = JSON.parse(code) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const component = (obj as Record<string, unknown>).component;
    if (typeof component !== "string" || !component.trim()) return null;
    const props = (obj as Record<string, unknown>).props;
    return {
      component: component.trim(),
      props: props && typeof props === "object" ? (props as Record<string, unknown>) : {},
    };
  } catch {
    return null;
  }
}

const ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  search: Search,
  plus: Plus,
  book: BookOpen,
  tool: Wrench,
  package: Package,
};

/** One quick-action: navigate to a built-in feature, or hand a follow-up back to InternShannon. */
interface QuickAction {
  label: string;
  description?: string;
  icon?: string;
  /** Internal route to open (must start with `/`). */
  navigate?: string;
  /** Text to drop into the chat input (the agent then acts on it). */
  prefill?: string;
  /** When prefilling, send immediately. */
  autoSend?: boolean;
}

function isQuickAction(value: unknown): value is QuickAction {
  return Boolean(value) && typeof value === "object" && typeof (value as QuickAction).label === "string";
}

/**
 * The "快捷" entry point: InternShannon surfaces N built-in features as one-click buttons
 * instead of describing the steps in prose.
 */
function QuickActionsCard({ title, actions }: { title?: string; actions: QuickAction[] }) {
  const sessionId = useAgentSessionId();
  const navigate = useNavigate();

  const run = (action: QuickAction) => {
    // Navigate is internal-only (whitelist: must be an app-relative path).
    const to = action.navigate;
    if (typeof to === "string" && to.startsWith("/")) {
      navigate(to);
      return;
    }
    if (action.prefill && sessionId) {
      agentModel.prefillChatInput(sessionId, action.prefill, action.autoSend ? { autoSend: true } : false);
    }
  };

  if (actions.length === 0) return null;
  return (
    <div className="not-prose my-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" />
        {title || "你可以快捷使用以下功能"}
      </div>
      <div className="flex flex-col gap-1.5">
        {actions.map((action) => {
          const Icon = (action.icon && ICONS[action.icon]) || Sparkles;
          return (
            <Button
              key={`${action.label}:${action.navigate ?? action.prefill ?? ""}`}
              variant="outline"
              size="sm"
              onClick={() => run(action)}
              className="h-auto w-full justify-start gap-2 px-2.5 py-2 text-left"
            >
              <Icon className="size-4 shrink-0 text-primary" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{action.label}</span>
                {action.description ? (
                  <span className="truncate text-xs font-normal text-muted-foreground">{action.description}</span>
                ) : null}
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** Trusted component registry. Add built-in-feature cards here (Phase 2: deploy, search-knowledge, …). */
const REGISTRY: Record<string, (props: Record<string, unknown>) => ReactElement | null> = {
  "quick-actions": (props) => {
    const rawActions = Array.isArray(props.actions) ? props.actions : [];
    const actions = rawActions.filter(isQuickAction);
    return <QuickActionsCard title={typeof props.title === "string" ? props.title : undefined} actions={actions} />;
  },
};

export function AgentUiBlock({ code }: { code: string }) {
  const directive = parseDirective(code);
  if (!directive) {
    return (
      <div className="not-prose my-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        无法解析 agent-ui 指令。
      </div>
    );
  }
  const render = REGISTRY[directive.component];
  if (!render) {
    return (
      <div className="not-prose my-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        暂不支持的 agent-ui 组件：<code className="font-mono">{directive.component}</code>
      </div>
    );
  }
  return render(directive.props ?? {});
}
