import {
  Brain,
  Grip,
  Loader2,
  Maximize2,
  MessageCircle,
  MessageSquarePlus,
  Minimize2,
  Sparkles,
  X,
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useSnapshot } from "valtio";
import {
  INTERNSHANNON_ASSISTANT_OPEN_EVENT,
  INTERNSHANNON_ASSISTANT_QUERY_PARAM,
  INTERNSHANNON_ASSISTANT_QUERY_VALUE,
} from "@/components/agent-page/floating-internShannon-assistant-state";
import {
  type AssistantPoint,
  constrainAssistantBubblePosition,
  createDefaultAssistantBubblePosition,
  resolveAssistantPanelTransform,
  resolveStoredAssistantBubblePosition,
  INTERNSHANNON_ASSISTANT_BUBBLE_POSITION_STORAGE_KEY,
  INTERNSHANNON_ASSISTANT_BUBBLE_POSITION_VERSION,
  INTERNSHANNON_ASSISTANT_BUBBLE_SIZE,
} from "@/components/agent-page/floating-internShannon-assistant-position";
import { canStartAssistantBubbleDrag } from "@/components/agent-page/floating-internShannon-assistant-drag-state";
import { useAgentSessionBootstrap } from "@/components/agent-page/use-agent-session-bootstrap";
import { ErrorBoundary } from "@/components/custom/error-boundary";
import { DEFAULT_AGENT_ID, getAgentById } from "@/lib/builtins";
import { onUserStorageScopeChange, readUserJsonStorage, writeUserJsonStorage } from "@/lib/browser-storage";
import { cn } from "@/lib/utils";
import type { InternShannonMemoryConversationRef } from "@/lib/internShannon-memory-timeline";
import agentModel from "@/models/agent.model";
import assistantIdentityModel from "@/models/assistant-identity.model";
import { toast } from "sonner";
import { createAgentSession, refreshSessionsInBackground } from "@/lib/session-bootstrap";
import {
  buildAgentSessionCreateOptions,
  formatAgentSessionCreateError,
  shouldInitializeAgentDefaultsAfterCreate,
} from "./agent-session-create-state";
import agentRegistryModel from "@/models/agent-registry.model";
import platformBrandModel from "@/models/platform-brand.model";

const AgentChat = lazy(() => import("@/components/agent-page/agent-chat"));
const WorkspaceFileManagerPanel = lazy(() =>
  import("@/components/agent-page/workspace-file-manager-dialog").then((module) => ({
    default: module.WorkspaceFileManagerDialog,
  })),
);
const AgentSessionSidebar = lazy(() =>
  import("@/components/agent-page/agent-session-sidebar").then((module) => ({
    default: module.AgentSessionSidebar,
  })),
);
const FloatingAssistantMemoryTimeline = lazy(async () => {
  const { FloatingInternShannonMemoryTimeline } = await import("@/components/agent-page/floating-internShannon-memory-timeline");

  return {
    default: function FloatingAssistantMemoryPanel({ onBack, onOpenConversation }: FloatingAssistantMemoryPanelProps) {
      return (
        <div className="flex h-full min-h-0 flex-col bg-white">
          <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border-light bg-white px-2 py-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-[#eef4ff] text-primary">
                <Brain className="size-3" />
              </div>
              <div className="flex min-w-0 items-baseline gap-2">
                <div className="shrink-0 text-sm font-semibold leading-tight text-foreground">记忆</div>
                <div className="truncate text-[12px] leading-[1.5] text-muted-foreground">
                  InternShannon为你沉淀的记忆时间轴
                </div>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="关闭记忆"
              title="关闭记忆"
              onClick={onBack}
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <FloatingInternShannonMemoryTimeline onOpenConversation={onOpenConversation} />
          </div>
        </div>
      );
    },
  };
});

const apiBaseUrl = "/api/v1";
const PANEL_MARGIN = 8;
const PANEL_MOBILE_MARGIN = 4;
const PANEL_MIN_WIDTH = 560;
const PANEL_MIN_HEIGHT = 440;
// 默认按视口比例铺开(过小会让会话工作区显得局促),这两个值只作为视口异常时的兜底。
const PANEL_DEFAULT_WIDTH = 1720;
const PANEL_DEFAULT_HEIGHT = 1160;
const PANEL_DEFAULT_VIEWPORT_RATIO = 0.96;
const BUBBLE_DRAG_THRESHOLD = 4;

type AssistantPanelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type AssistantPanelAnimationPhase = "closed" | "open";
type AssistantPanelMotionMode = "idle" | "dragging" | "resizing";
type AssistantPanelResizeHandle =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-right"
  | "bottom-left";
type FloatingAssistantView = "chat" | "workspace" | "memory";
type FloatingAssistantSubViewProps = {
  onBack: () => void;
};
type FloatingAssistantMemoryPanelProps = FloatingAssistantSubViewProps & {
  onOpenConversation: (conversation: InternShannonMemoryConversationRef) => void;
};
type AssistantPanelResizeHandleConfig = {
  handle: AssistantPanelResizeHandle;
  ariaLabel: string;
  title: string;
  className: string;
  showGrip?: boolean;
};

function LoadingFallback({ label = "正在加载InternShannon..." }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[160px] items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function getDefaultAgentProfile() {
  return (
    agentRegistryModel.getAllAgents().find((item) => item.id === DEFAULT_AGENT_ID) ?? getAgentById(DEFAULT_AGENT_ID)
  );
}

function getViewportSize() {
  return {
    width: typeof window === "undefined" ? PANEL_DEFAULT_WIDTH + PANEL_MARGIN * 2 : window.innerWidth,
    height: typeof window === "undefined" ? PANEL_DEFAULT_HEIGHT + PANEL_MARGIN * 2 : window.innerHeight,
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolvePanelViewportMetrics(viewport = getViewportSize()) {
  const margin = viewport.width < 720 ? PANEL_MOBILE_MARGIN : PANEL_MARGIN;
  const maxWidth = Math.max(320, viewport.width - margin * 2);
  const maxHeight = Math.max(360, viewport.height - margin * 2);

  return {
    margin,
    maxWidth,
    maxHeight,
    minWidth: Math.min(PANEL_MIN_WIDTH, maxWidth),
    minHeight: Math.min(PANEL_MIN_HEIGHT, maxHeight),
  };
}

function constrainPanelRect(rect: AssistantPanelRect): AssistantPanelRect {
  const viewport = getViewportSize();
  const { margin, maxWidth, maxHeight, minWidth, minHeight } = resolvePanelViewportMetrics(viewport);
  const width = clampNumber(rect.width, minWidth, maxWidth);
  const height = clampNumber(rect.height, minHeight, maxHeight);

  // 取整:transform/宽高带小数会让面板落在非整数像素栅格上,合成层内文本整体发糊。
  return {
    width: Math.round(width),
    height: Math.round(height),
    x: Math.round(clampNumber(rect.x, margin, Math.max(margin, viewport.width - width - margin))),
    y: Math.round(clampNumber(rect.y, margin, Math.max(margin, viewport.height - height - margin))),
  };
}

function createDefaultPanelRect(): AssistantPanelRect {
  const viewport = getViewportSize();
  const { maxWidth, maxHeight } = resolvePanelViewportMetrics(viewport);
  const width = Math.min(PANEL_DEFAULT_WIDTH, viewport.width * PANEL_DEFAULT_VIEWPORT_RATIO, maxWidth);
  const height = Math.min(PANEL_DEFAULT_HEIGHT, viewport.height * PANEL_DEFAULT_VIEWPORT_RATIO, maxHeight);
  return constrainPanelRect({
    width,
    height,
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
  });
}

/**
 * 首次打开时把面板锚定在悬浮球旁:球在右半屏 → 面板贴其左侧,反之贴右侧;
 * 球在下半屏 → 面板底边与球底对齐,反之顶边对齐。再走 constrain 收进视口。
 */
function anchorPanelRectToBubble(bubble: AssistantPoint): AssistantPanelRect {
  const base = createDefaultPanelRect();
  const viewport = getViewportSize();
  const gap = 12;
  const ballCenterX = bubble.x + INTERNSHANNON_ASSISTANT_BUBBLE_SIZE / 2;
  const ballCenterY = bubble.y + INTERNSHANNON_ASSISTANT_BUBBLE_SIZE / 2;
  const x =
    ballCenterX > viewport.width / 2 ? bubble.x - base.width - gap : bubble.x + INTERNSHANNON_ASSISTANT_BUBBLE_SIZE + gap;
  const y = ballCenterY > viewport.height / 2 ? bubble.y + INTERNSHANNON_ASSISTANT_BUBBLE_SIZE - base.height : bubble.y;
  return constrainPanelRect({ ...base, x, y });
}

function fullscreenPanelRect(): AssistantPanelRect {
  const viewport = getViewportSize();
  const { margin } = resolvePanelViewportMetrics(viewport);
  return {
    x: margin,
    y: margin,
    width: Math.max(320, viewport.width - margin * 2),
    height: Math.max(360, viewport.height - margin * 2),
  };
}

function resizeCursorForHandle(handle: AssistantPanelResizeHandle): string {
  if (handle === "top" || handle === "bottom") return "ns-resize";
  if (handle === "left" || handle === "right") return "ew-resize";
  if (handle === "top-left" || handle === "bottom-right") return "nwse-resize";
  return "nesw-resize";
}

function resizePanelRectFromHandle(
  startRect: AssistantPanelRect,
  dx: number,
  dy: number,
  handle: AssistantPanelResizeHandle,
): AssistantPanelRect {
  const viewport = getViewportSize();
  const { margin, minWidth, minHeight, maxWidth, maxHeight } = resolvePanelViewportMetrics(viewport);
  let left = startRect.x;
  let right = startRect.x + startRect.width;
  let top = startRect.y;
  let bottom = startRect.y + startRect.height;

  if (handle.includes("left")) {
    left = clampNumber(startRect.x + dx, Math.max(margin, right - maxWidth), right - minWidth);
  }
  if (handle.includes("right")) {
    right = clampNumber(
      startRect.x + startRect.width + dx,
      left + minWidth,
      Math.min(viewport.width - margin, left + maxWidth),
    );
  }
  if (handle.includes("top")) {
    top = clampNumber(startRect.y + dy, Math.max(margin, bottom - maxHeight), bottom - minHeight);
  }
  if (handle.includes("bottom")) {
    bottom = clampNumber(
      startRect.y + startRect.height + dy,
      top + minHeight,
      Math.min(viewport.height - margin, top + maxHeight),
    );
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

const PANEL_RESIZE_HANDLES = [
  {
    handle: "top",
    ariaLabel: "从上边调整InternShannon窗口高度",
    title: "拖动上边调整高度",
    className:
      "absolute left-4 right-20 top-0 z-20 h-2 touch-none cursor-ns-resize bg-transparent transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none",
  },
  {
    handle: "right",
    ariaLabel: "从右边调整InternShannon窗口宽度",
    title: "拖动右边调整宽度",
    className:
      "absolute bottom-4 right-0 top-8 z-20 w-2 touch-none cursor-ew-resize bg-transparent transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none",
  },
  {
    handle: "bottom",
    ariaLabel: "从下边调整InternShannon窗口高度",
    title: "拖动下边调整高度",
    className:
      "absolute bottom-0 left-4 right-4 z-20 h-2 touch-none cursor-ns-resize bg-transparent transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none",
  },
  {
    handle: "left",
    ariaLabel: "从左边调整InternShannon窗口宽度",
    title: "拖动左边调整宽度",
    className:
      "absolute bottom-4 left-0 top-8 z-20 w-2 touch-none cursor-ew-resize bg-transparent transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none",
  },
  {
    handle: "top-left",
    ariaLabel: "从左上角调整InternShannon窗口大小",
    title: "拖动左上角调整大小",
    className:
      "absolute left-0 top-0 z-30 size-4 touch-none cursor-nwse-resize rounded-br-[4px] bg-transparent transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none",
  },
  {
    handle: "top-right",
    ariaLabel: "从右上角调整InternShannon窗口大小",
    title: "拖动右上角调整大小",
    className:
      "absolute right-0 top-0 z-30 size-2 touch-none cursor-nesw-resize rounded-bl-[4px] bg-transparent transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none",
  },
  {
    handle: "bottom-right",
    ariaLabel: "从右下角调整InternShannon窗口大小",
    title: "拖动右下角调整大小",
    className:
      "absolute bottom-0 right-0 z-30 flex size-8 touch-none cursor-nwse-resize items-end justify-end rounded-tl-[4px] bg-transparent p-1.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none",
    showGrip: true,
  },
  {
    handle: "bottom-left",
    ariaLabel: "从左下角调整InternShannon窗口大小",
    title: "拖动左下角调整大小",
    className:
      "absolute bottom-0 left-0 z-30 size-4 touch-none cursor-nesw-resize rounded-tr-[4px] bg-transparent transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none",
  },
] satisfies readonly AssistantPanelResizeHandleConfig[];

function constrainBubblePosition(position: AssistantPoint): AssistantPoint {
  return constrainAssistantBubblePosition(position, getViewportSize());
}

function createDefaultBubblePosition(): AssistantPoint {
  return createDefaultAssistantBubblePosition(getViewportSize());
}

function readStoredBubblePosition(): AssistantPoint {
  const storedPosition = readUserJsonStorage<unknown>(INTERNSHANNON_ASSISTANT_BUBBLE_POSITION_STORAGE_KEY, null);
  return resolveStoredAssistantBubblePosition(storedPosition, getViewportSize()) ?? createDefaultBubblePosition();
}

function writeStoredBubblePosition(position: AssistantPoint): void {
  writeUserJsonStorage(INTERNSHANNON_ASSISTANT_BUBBLE_POSITION_STORAGE_KEY, {
    ...position,
    version: INTERNSHANNON_ASSISTANT_BUBBLE_POSITION_VERSION,
  });
}

function resolvePanelTransform(bubblePosition: AssistantPoint, rect: AssistantPanelRect) {
  return resolveAssistantPanelTransform(bubblePosition, rect, "expanded");
}

function panelOpacityForPhase(phase: AssistantPanelAnimationPhase): number {
  return phase === "closed" ? 0 : 1;
}

function resolvePanelMotionStyle(motionMode: AssistantPanelMotionMode) {
  return {
    transitionProperty: "none",
    transitionDuration: "0ms",
    transitionTimingFunction: "linear",
    willChange: motionMode === "idle" ? "auto" : "transform, width, height",
  };
}

// 首屏/空状态欢迎页:介绍InternShannon能力 + 示例提示词一键开聊 + 「开始新对话」,
// 把「还没有会话,请去侧栏新建」的死胡同换成可直接上手的生产级首屏。
const INTERNSHANNON_WELCOME_PROMPTS = [
  "InternShannon 都能帮我做什么?",
  "在我的知识库里检索关于「部署流程」的内容",
  "帮我整理一份本地知识库摘要",
  "基于上一轮对话继续分析",
];

function InternShannonWelcome({ starting, onStart }: { starting: boolean; onStart: (prompt?: string) => void }) {
  return (
    <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-4 overflow-y-auto bg-[#f7f9fc] px-6 py-8 text-center">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="size-6" aria-hidden="true" />
      </div>
      <div>
        <p className="text-base font-semibold text-foreground">你好,我是InternShannon</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          我能与你进行智能体对话，也能结合你的「我的知识库」与本地文档检索作答。
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-1.5">
        {INTERNSHANNON_WELCOME_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={starting}
            onClick={() => onStart(prompt)}
            className="group flex items-center gap-2 rounded-lg border border-border-light bg-background px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/[0.03] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MessageCircle
              className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">{prompt}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={starting}
        onClick={() => onStart()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {starting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <MessageSquarePlus className="size-3.5" aria-hidden="true" />
        )}
        开始新对话
      </button>
    </div>
  );
}

function FloatingAssistantPanelBody() {
  const { ready } = useAgentSessionBootstrap({ apiUrl: apiBaseUrl });
  const { currentSessionId, sdkSessions } = useSnapshot(agentModel.state);
  const { revision: registryRevision } = useSnapshot(agentRegistryModel.state);
  const [activeView, setActiveView] = useState<FloatingAssistantView>("chat");
  const [starting, setStarting] = useState(false);
  const [messageFocus, setMessageFocus] = useState<{ messageId?: string; request: number }>({ request: 0 });

  const primaryAgentSessions = useMemo(() => {
    void registryRevision;
    return sdkSessions.filter(
      (session) =>
        agentRegistryModel.resolveSessionAgentId(session.sessionId, session.agentId ?? null) === DEFAULT_AGENT_ID,
    );
  }, [registryRevision, sdkSessions]);

  const activeSessionId =
    currentSessionId && primaryAgentSessions.some((session) => session.sessionId === currentSessionId)
      ? currentSessionId
      : null;
  const currentSession = primaryAgentSessions.find((session) => session.sessionId === activeSessionId);

  useEffect(() => {
    if (activeSessionId === currentSessionId && (currentSessionId || primaryAgentSessions.length === 0)) return;
    const nextSession =
      primaryAgentSessions.find((session) => session.state !== "exited") ?? primaryAgentSessions[0] ?? null;
    agentModel.setCurrentSession(nextSession?.sessionId ?? null);
  }, [activeSessionId, currentSessionId, primaryAgentSessions]);

  // 一键开始新对话(可选携带示例提示词直接发送)——首屏欢迎页/空状态用,免去手动去侧栏「新建」的摩擦。
  const startSession = useCallback(
    async (prompt?: string) => {
      if (starting) return;
      setStarting(true);
      try {
        const result = await createAgentSession(
          buildAgentSessionCreateOptions({
            agentId: DEFAULT_AGENT_ID,
            agent: getAgentById(DEFAULT_AGENT_ID) ?? null,
            apiUrl: apiBaseUrl,
            optimisticPlaceholder: true,
          }),
        );
        if (shouldInitializeAgentDefaultsAfterCreate(apiBaseUrl)) {
          const { initializeAgentDefaults } = await import("@/lib/workspace-utils");
          await initializeAgentDefaults(result.sessionId, DEFAULT_AGENT_ID);
        }
        agentModel.setCurrentSession(result.sessionId);
        setActiveView("chat");
        if (prompt?.trim()) agentModel.prefillChatInput(result.sessionId, prompt.trim(), { autoSend: true });
        await refreshSessionsInBackground(apiBaseUrl, { preserveExistingOnEmpty: true });
      } catch (error) {
        toast.error(formatAgentSessionCreateError(error));
      } finally {
        setStarting(false);
      }
    },
    [starting],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <div className="h-48 shrink-0 border-b border-border-light md:h-full md:w-[16rem] md:border-b-0">
        <Suspense fallback={<LoadingFallback label="正在加载会话列表..." />}>
          <AgentSessionSidebar
            apiUrl={apiBaseUrl}
            hideConfigEntry
            onMemoryOpen={() => setActiveView("memory")}
            currentSessionId={activeSessionId}
            onSessionChange={(sessionId) => {
              agentModel.setCurrentSession(sessionId);
              setActiveView("chat");
            }}
            optimisticPlaceholder
          />
        </Suspense>
      </div>
      <div className="min-h-0 min-w-0 flex-1 bg-[#f7f9fc]">
        {activeView === "memory" ? (
          <ErrorBoundary>
            <Suspense fallback={<LoadingFallback label="正在加载记忆时间轴..." />}>
              <FloatingAssistantMemoryTimeline
                onBack={() => setActiveView("chat")}
                onOpenConversation={(conversation) => {
                  agentModel.setCurrentSession(conversation.sessionId);
                  setMessageFocus((current) => ({
                    messageId: conversation.messageId,
                    request: current.request + 1,
                  }));
                  setActiveView("chat");
                }}
              />
            </Suspense>
          </ErrorBoundary>
        ) : activeView === "workspace" && activeSessionId ? (
          <Suspense fallback={<LoadingFallback label="正在加载会话工作区..." />}>
            <WorkspaceFileManagerPanel
              variant="embedded"
              open
              onOpenChange={(nextOpen) => {
                if (!nextOpen) setActiveView("chat");
              }}
              rootPath={currentSession?.cwd ?? ""}
            />
          </Suspense>
        ) : !ready && primaryAgentSessions.length === 0 ? (
          <LoadingFallback />
        ) : activeSessionId ? (
          <Suspense fallback={<LoadingFallback />}>
            <AgentChat
              key={activeSessionId}
              sessionId={activeSessionId}
              cwd={currentSession?.cwd}
              apiUrl={apiBaseUrl}
              showSessionManagement={false}
              messageLayout="compact-left"
              starterPrompts={INTERNSHANNON_WELCOME_PROMPTS}
              onWorkspaceOpen={() => setActiveView("workspace")}
              focusMessageId={messageFocus.messageId}
              focusMessageRequest={messageFocus.request}
            />
          </Suspense>
        ) : (
          <InternShannonWelcome starting={starting} onStart={startSession} />
        )}
      </div>
    </div>
  );
}

export function FloatingInternShannonAssistant() {
  const [panelAnimationPhase, setPanelAnimationPhase] = useState<AssistantPanelAnimationPhase>("closed");
  const [panelMotionMode, setPanelMotionModeState] = useState<AssistantPanelMotionMode>("idle");
  const [fullscreen, setFullscreen] = useState(false);
  const [panelRect, setPanelRect] = useState<AssistantPanelRect>(() => createDefaultPanelRect());
  const [bubblePosition, setBubblePosition] = useState<AssistantPoint>(() => readStoredBubblePosition());
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const bubblePositionRef = useRef(bubblePosition);
  // 本次会话内面板是否已定位过(首开锚定到悬浮球旁,之后保持用户位置)。
  const panelEverPlacedRef = useRef(false);
  const pendingBubblePositionRef = useRef<AssistantPoint | null>(null);
  const bubbleAnimationFrameRef = useRef<number | null>(null);
  const suppressBubbleClickRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelRectRef = useRef(panelRect);
  const pendingRectRef = useRef<AssistantPanelRect | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const panelAnimationPhaseRef = useRef(panelAnimationPhase);
  const panelMotionModeRef = useRef(panelMotionMode);
  const location = useLocation();
  const navigate = useNavigate();
  const { revision: registryRevision } = useSnapshot(agentRegistryModel.state);
  useSnapshot(platformBrandModel.state);
  // 订阅助手身份:applyOverrides 会把配置的名称注入 agent.name,这里订阅以便配置变更后标题/侧栏重渲染。
  const identitySnap = useSnapshot(assistantIdentityModel.state);
  const agent = useMemo(() => {
    void registryRevision;
    void identitySnap.name;
    return getDefaultAgentProfile();
  }, [registryRevision, identitySnap.name]);
  const logoUrl = platformBrandModel.effectiveLogoUrl();

  // 未读角标:面板关闭期间InternShannon产生的消息累积成气泡角标,生成完成时提醒用户回来看(生产级通知)。
  const { sdkSessions, unreadCounts, currentSessionId, sessionStatus, sessionNames } = useSnapshot(agentModel.state);
  const internShannonUnread = useMemo(() => {
    void registryRevision;
    return sdkSessions
      .filter(
        (session) =>
          agentRegistryModel.resolveSessionAgentId(session.sessionId, session.agentId ?? null) === DEFAULT_AGENT_ID,
      )
      .reduce((sum, session) => sum + (unreadCounts[session.sessionId] ?? 0), 0);
  }, [registryRevision, sdkSessions, unreadCounts]);

  // InternShannon运行状态:仅看默认 agent 的会话(与未读同口径)中正在 running/compacting 的那些会话 id。
  const runningSessionIds = useMemo(() => {
    void registryRevision;
    return sdkSessions
      .filter(
        (session) =>
          agentRegistryModel.resolveSessionAgentId(session.sessionId, session.agentId ?? null) === DEFAULT_AGENT_ID,
      )
      .filter((session) => {
        const status = sessionStatus[session.sessionId];
        return status === "running" || status === "compacting";
      })
      .map((session) => session.sessionId);
  }, [registryRevision, sdkSessions, sessionStatus]);

  // 忙碌→空闲的瞬态「刚完成任务」(亮 6s 后回落空闲),并记下刚结束的那个会话名,鼠标移入即知完成了什么。
  const [assistantStatus, setAssistantStatus] = useState<"idle" | "busy" | "done">("idle");
  const [doneTask, setDoneTask] = useState<string | null>(null);
  const prevRunningRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevRunningRef.current;
    prevRunningRef.current = [...runningSessionIds];
    if (runningSessionIds.length > 0) {
      setAssistantStatus("busy");
      return;
    }
    // 全部空闲:若上一帧还有在跑的会话,则它们刚完成——取最近一个的会话名作为「完成的任务」。
    const justFinished = prev.filter((id) => !runningSessionIds.includes(id));
    if (justFinished.length > 0) {
      const finishedId = justFinished[justFinished.length - 1];
      setDoneTask(sessionNames[finishedId]?.trim() || null);
      setAssistantStatus("done");
      const timer = window.setTimeout(() => {
        setAssistantStatus("idle");
        setDoneTask(null);
      }, 6000);
      return () => window.clearTimeout(timer);
    }
    setAssistantStatus("idle");
  }, [runningSessionIds, sessionNames]);
  const statusLabel =
    assistantStatus === "busy"
      ? "忙碌中"
      : assistantStatus === "done"
        ? doneTask
          ? `刚完成:${doneTask}`
          : "刚完成任务"
        : "空闲中";

  const applyPanelMotionStyle = useCallback((motionMode: AssistantPanelMotionMode) => {
    const panel = panelRef.current;
    if (!panel) return;
    const motionStyle = resolvePanelMotionStyle(motionMode);
    panel.style.transitionProperty = motionStyle.transitionProperty;
    panel.style.transitionDuration = motionStyle.transitionDuration;
    panel.style.transitionTimingFunction = motionStyle.transitionTimingFunction;
    panel.style.willChange = motionStyle.willChange;
  }, []);

  const updatePanelMotionMode = useCallback(
    (motionMode: AssistantPanelMotionMode) => {
      panelMotionModeRef.current = motionMode;
      applyPanelMotionStyle(motionMode);
      setPanelMotionModeState(motionMode);
    },
    [applyPanelMotionStyle],
  );

  const updatePanelAnimationPhase = useCallback((phase: AssistantPanelAnimationPhase) => {
    panelAnimationPhaseRef.current = phase;
    setPanelAnimationPhase(phase);
  }, []);

  const applyBubblePositionStyle = useCallback((position: AssistantPoint) => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    bubble.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
  }, []);

  const scheduleBubblePositionStyle = useCallback(
    (position: AssistantPoint) => {
      pendingBubblePositionRef.current = position;
      if (bubbleAnimationFrameRef.current !== null) return;
      bubbleAnimationFrameRef.current = window.requestAnimationFrame(() => {
        bubbleAnimationFrameRef.current = null;
        if (pendingBubblePositionRef.current) applyBubblePositionStyle(pendingBubblePositionRef.current);
      });
    },
    [applyBubblePositionStyle],
  );

  const commitBubblePosition = useCallback(
    (position: AssistantPoint) => {
      const nextPosition = constrainBubblePosition(position);
      bubblePositionRef.current = nextPosition;
      pendingBubblePositionRef.current = nextPosition;
      if (bubbleAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(bubbleAnimationFrameRef.current);
        bubbleAnimationFrameRef.current = null;
      }
      applyBubblePositionStyle(nextPosition);
      setBubblePosition(nextPosition);
      writeStoredBubblePosition(nextPosition);
    },
    [applyBubblePositionStyle],
  );

  const applyPanelRectStyle = useCallback((rect: AssistantPanelRect) => {
    const panel = panelRef.current;
    if (!panel) return;
    const panelTransform = resolvePanelTransform(bubblePositionRef.current, rect);
    panel.style.transform = panelTransform.transform;
    panel.style.transformOrigin = panelTransform.transformOrigin;
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
  }, []);

  const schedulePanelRectStyle = useCallback(
    (rect: AssistantPanelRect) => {
      pendingRectRef.current = rect;
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        if (pendingRectRef.current) applyPanelRectStyle(pendingRectRef.current);
      });
    },
    [applyPanelRectStyle],
  );

  const commitPanelRect = useCallback(
    (rect: AssistantPanelRect) => {
      const nextRect = constrainPanelRect(rect);
      panelRectRef.current = nextRect;
      pendingRectRef.current = nextRect;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      applyPanelRectStyle(nextRect);
      setPanelRect(nextRect);
    },
    [applyPanelRectStyle],
  );

  useEffect(() => {
    panelRectRef.current = panelRect;
  }, [panelRect]);

  useEffect(() => {
    bubblePositionRef.current = bubblePosition;
  }, [bubblePosition]);

  useEffect(() => {
    panelAnimationPhaseRef.current = panelAnimationPhase;
  }, [panelAnimationPhase]);

  useEffect(() => {
    panelMotionModeRef.current = panelMotionMode;
    applyPanelMotionStyle(panelMotionMode);
  }, [applyPanelMotionStyle, panelMotionMode]);

  useEffect(() => {
    return onUserStorageScopeChange(() => {
      const nextPosition = readStoredBubblePosition();
      bubblePositionRef.current = nextPosition;
      setBubblePosition(nextPosition);
      scheduleBubblePositionStyle(nextPosition);
    });
  }, [scheduleBubblePositionStyle]);

  const openAssistant = useCallback(() => {
    if (panelAnimationPhaseRef.current === "open") return;
    updatePanelMotionMode("idle");
    // 首次打开(本次会话内还没定过位):面板锚定在悬浮球旁,而非屏幕居中默认位。
    // 之后的开合保持用户最后的拖拽/缩放位置。
    if (!panelEverPlacedRef.current) {
      panelEverPlacedRef.current = true;
      commitPanelRect(anchorPanelRectToBubble(bubblePositionRef.current));
    }
    updatePanelAnimationPhase("open");
  }, [commitPanelRect, updatePanelAnimationPhase, updatePanelMotionMode]);

  const closeAssistant = useCallback(() => {
    if (panelAnimationPhaseRef.current === "closed") return;
    updatePanelMotionMode("idle");
    updatePanelAnimationPhase("closed");
    setFullscreen(false);
  }, [updatePanelAnimationPhase, updatePanelMotionMode]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (bubbleAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(bubbleAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    window.addEventListener(INTERNSHANNON_ASSISTANT_OPEN_EVENT, openAssistant);
    return () => window.removeEventListener(INTERNSHANNON_ASSISTANT_OPEN_EVENT, openAssistant);
  }, [openAssistant]);

  // 全局快捷键 ⌘/Ctrl + J 一键开合InternShannon(生产级快捷入口)。聚焦在输入框 / 文本域 / 富文本 /
  // 代码编辑器时不接管,避免劫持其自身快捷键 —— 仅在浏览态(非编辑)生效。
  useEffect(() => {
    const handleToggleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key !== "j" && event.key !== "J") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest?.(".monaco-editor"))
      ) {
        return;
      }
      event.preventDefault();
      if (panelAnimationPhaseRef.current === "open") closeAssistant();
      else openAssistant();
    };
    window.addEventListener("keydown", handleToggleShortcut);
    return () => window.removeEventListener("keydown", handleToggleShortcut);
  }, [openAssistant, closeAssistant]);

  // 面板打开后把焦点落到聊天输入框:键盘 / 读屏用户开屏即可输入(生产级无障碍)。
  // 仅当焦点尚不在面板内时才抢焦点 —— 避免打断用户已有操作(如刚切到工作区 / 记忆视图)。
  useEffect(() => {
    if (panelAnimationPhase !== "open") return;
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const input = panel.querySelector<HTMLElement>('[contenteditable="true"], textarea');
      input?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [panelAnimationPhase]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get(INTERNSHANNON_ASSISTANT_QUERY_PARAM) !== INTERNSHANNON_ASSISTANT_QUERY_VALUE) return;
    openAssistant();
    params.delete(INTERNSHANNON_ASSISTANT_QUERY_PARAM);
    const search = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: search ? `?${search}` : "",
        hash: location.hash,
      },
      { replace: true },
    );
  }, [location.hash, location.pathname, location.search, navigate, openAssistant]);

  const panelVisible = panelAnimationPhase !== "closed";

  // 面板打开且正在看某个InternShannon会话时,持续清掉它的未读 —— 气泡角标因此只反映「面板关闭期间」漏看的消息。
  useEffect(() => {
    if (!panelVisible || !currentSessionId) return;
    if (unreadCounts[currentSessionId]) agentModel.clearUnread(currentSessionId);
  }, [panelVisible, currentSessionId, unreadCounts]);

  useEffect(() => {
    if (!panelVisible) return undefined;
    const handleResize = () => {
      const nextRect = constrainPanelRect(panelRectRef.current);
      panelRectRef.current = nextRect;
      setPanelRect(nextRect);
      schedulePanelRectStyle(fullscreen ? fullscreenPanelRect() : nextRect);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [fullscreen, panelVisible, schedulePanelRectStyle]);

  useEffect(() => {
    if (panelVisible) return undefined;
    const handleResize = () => {
      const nextPosition = constrainBubblePosition(bubblePositionRef.current);
      bubblePositionRef.current = nextPosition;
      setBubblePosition(nextPosition);
      scheduleBubblePositionStyle(nextPosition);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [panelVisible, scheduleBubblePositionStyle]);

  useEffect(() => {
    if (!panelVisible) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAssistant();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeAssistant, panelVisible]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      openAssistant();
      return;
    }
    closeAssistant();
  };

  const startBubbleDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canStartAssistantBubbleDrag(event)) return;
    event.preventDefault();
    const dragTarget = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = bubblePositionRef.current;
    let latestPosition = startPosition;
    let moved = false;
    let finished = false;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    dragTarget.setPointerCapture(pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      moved = moved || Math.hypot(dx, dy) >= BUBBLE_DRAG_THRESHOLD;
      latestPosition = constrainBubblePosition({
        x: startPosition.x + dx,
        y: startPosition.y + dy,
      });
      scheduleBubblePositionStyle(latestPosition);
    };

    const cleanupDragListeners = () => {
      dragTarget.removeEventListener("pointermove", handleMove);
      dragTarget.removeEventListener("pointerup", handleEnd);
      dragTarget.removeEventListener("pointercancel", handleEnd);
      dragTarget.removeEventListener("lostpointercapture", handleLostPointerCapture);
    };

    const finishDrag = () => {
      if (finished) return;
      finished = true;
      cleanupDragListeners();
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (dragTarget.hasPointerCapture(pointerId)) {
        dragTarget.releasePointerCapture(pointerId);
      }
      commitBubblePosition(latestPosition);
      if (moved) {
        suppressBubbleClickRef.current = true;
        window.setTimeout(() => {
          suppressBubbleClickRef.current = false;
        }, 120);
      }
    };

    function handleEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return;
      finishDrag();
    }

    function handleLostPointerCapture(captureEvent: PointerEvent) {
      if (captureEvent.pointerId !== pointerId) return;
      finishDrag();
    }

    dragTarget.addEventListener("pointermove", handleMove);
    dragTarget.addEventListener("pointerup", handleEnd, { once: true });
    dragTarget.addEventListener("pointercancel", handleEnd, { once: true });
    dragTarget.addEventListener("lostpointercapture", handleLostPointerCapture, { once: true });
  };

  const handleBubbleClick = () => {
    if (suppressBubbleClickRef.current) {
      suppressBubbleClickRef.current = false;
      return;
    }
    if (panelAnimationPhaseRef.current === "open") {
      closeAssistant();
      return;
    }
    openAssistant();
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fullscreen || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-internshannon-window-control]")) return;
    event.preventDefault();
    const dragTarget = event.currentTarget;
    const pointerId = event.pointerId;
    dragTarget.setPointerCapture(pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = panelRectRef.current;
    let latestRect = startRect;
    let finished = false;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    updatePanelMotionMode("dragging");

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      latestRect = constrainPanelRect({
        ...startRect,
        x: startRect.x + moveEvent.clientX - startX,
        y: startRect.y + moveEvent.clientY - startY,
      });
      schedulePanelRectStyle(latestRect);
    };

    const cleanupDragListeners = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      dragTarget.removeEventListener("lostpointercapture", handleLostPointerCapture);
    };

    const finishDrag = () => {
      if (finished) return;
      finished = true;
      cleanupDragListeners();
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (dragTarget.hasPointerCapture(pointerId)) {
        dragTarget.releasePointerCapture(pointerId);
      }
      updatePanelMotionMode("idle");
      commitPanelRect(latestRect);
    };

    function handleEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return;
      finishDrag();
    }

    function handleLostPointerCapture(captureEvent: PointerEvent) {
      if (captureEvent.pointerId !== pointerId) return;
      finishDrag();
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd, { once: true });
    window.addEventListener("pointercancel", handleEnd, { once: true });
    dragTarget.addEventListener("lostpointercapture", handleLostPointerCapture, { once: true });
  };

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, handle: AssistantPanelResizeHandle) => {
    if (fullscreen || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const resizeTarget = event.currentTarget;
    const pointerId = event.pointerId;
    resizeTarget.setPointerCapture(pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = panelRectRef.current;
    let latestRect = startRect;
    let finished = false;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = resizeCursorForHandle(handle);
    updatePanelMotionMode("resizing");

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      latestRect = resizePanelRectFromHandle(startRect, moveEvent.clientX - startX, moveEvent.clientY - startY, handle);
      schedulePanelRectStyle(latestRect);
    };

    const cleanupResizeListeners = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      resizeTarget.removeEventListener("lostpointercapture", handleLostPointerCapture);
    };

    const finishResize = () => {
      if (finished) return;
      finished = true;
      cleanupResizeListeners();
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (resizeTarget.hasPointerCapture(pointerId)) {
        resizeTarget.releasePointerCapture(pointerId);
      }
      updatePanelMotionMode("idle");
      commitPanelRect(latestRect);
    };

    function handleEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return;
      finishResize();
    }

    function handleLostPointerCapture(captureEvent: PointerEvent) {
      if (captureEvent.pointerId !== pointerId) return;
      finishResize();
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd, { once: true });
    window.addEventListener("pointercancel", handleEnd, { once: true });
    resizeTarget.addEventListener("lostpointercapture", handleLostPointerCapture, { once: true });
  };

  const handleToggleFullscreen = () => {
    updatePanelMotionMode("idle");
    setFullscreen((value) => {
      const nextFullscreen = !value;
      schedulePanelRectStyle(nextFullscreen ? fullscreenPanelRect() : panelRectRef.current);
      return nextFullscreen;
    });
  };

  const activeRect = fullscreen ? fullscreenPanelRect() : panelRect;
  const panelTransform = resolvePanelTransform(bubblePosition, activeRect);
  const panelMotionStyle = resolvePanelMotionStyle(panelMotionMode);
  const panelInteractive = panelAnimationPhase === "open";
  const assistantTitle = agent?.name ?? "InternShannon";
  const panelPortal =
    typeof document === "undefined"
      ? null
      : createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-start p-0"
            style={{ pointerEvents: panelInteractive ? "auto" : "none" }}
          >
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="false"
              aria-hidden={!panelVisible}
              aria-labelledby="internShannon-floating-assistant-title"
              data-internshannon-panel-motion={panelMotionMode}
              data-internshannon-panel-phase={panelAnimationPhase}
              className={cn(
                "fixed left-0 top-0 flex max-w-none flex-col gap-0 overflow-hidden rounded-[8px] border border-border-light bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.24)]",
                fullscreen ? "rounded-[8px]" : "",
              )}
              style={{
                contain: "layout paint",
                visibility: panelVisible ? "visible" : "hidden",
                transform: panelTransform.transform,
                transformOrigin: panelTransform.transformOrigin,
                opacity: panelOpacityForPhase(panelAnimationPhase),
                // 开关、拖动和尺寸变化都直接应用,不做弹窗缩放动画和延迟。
                transitionProperty: panelMotionStyle.transitionProperty,
                transitionDuration: panelMotionStyle.transitionDuration,
                transitionTimingFunction: panelMotionStyle.transitionTimingFunction,
                willChange: panelMotionStyle.willChange,
                pointerEvents: panelInteractive ? "auto" : "none",
                width: activeRect.width,
                height: activeRect.height,
                backfaceVisibility: "hidden",
              }}
            >
              <div
                className={cn(
                  "flex h-8 shrink-0 touch-none select-none items-center gap-1.5 border-b border-border-light bg-white px-2",
                  fullscreen ? "cursor-default" : "cursor-grab active:cursor-grabbing",
                )}
                onPointerDown={startDrag}
              >
                <div id="internShannon-floating-assistant-title" className="sr-only">
                  {assistantTitle}
                </div>
                <div className="flex min-w-0 flex-1 items-center text-muted-foreground">
                  <span className="flex h-5 w-7 items-center justify-center rounded-full hover:bg-muted">
                    <Grip className="size-3.5" />
                  </span>
                </div>
                <button
                  type="button"
                  data-internshannon-window-control
                  aria-label={fullscreen ? "退出全屏" : "全屏显示"}
                  title={fullscreen ? "退出全屏" : "全屏显示"}
                  onClick={handleToggleFullscreen}
                  className="flex size-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                >
                  {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </button>
                <button
                  type="button"
                  data-internshannon-window-control
                  aria-label="关闭InternShannon"
                  title="关闭InternShannon"
                  onClick={() => handleOpenChange(false)}
                  className="flex size-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-1.5">
                <ErrorBoundary>
                  <FloatingAssistantPanelBody />
                </ErrorBoundary>
              </div>
              {!fullscreen ? (
                <>
                  {PANEL_RESIZE_HANDLES.map((resizeHandle) => (
                    <button
                      key={resizeHandle.handle}
                      type="button"
                      data-internshannon-window-control
                      data-internshannon-resize-handle={resizeHandle.handle}
                      aria-label={resizeHandle.ariaLabel}
                      title={resizeHandle.title}
                      onPointerDown={(event) => startResize(event, resizeHandle.handle)}
                      className={resizeHandle.className}
                    >
                      {resizeHandle.showGrip ? <Grip className="size-4 rotate-45" /> : null}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          </div>,
          document.body,
        );

  return (
    <>
      <button
        ref={bubbleRef}
        type="button"
        aria-label={
          panelVisible
            ? "隐藏InternShannon"
            : internShannonUnread > 0
              ? `打开InternShannon,有 ${internShannonUnread} 条未读消息`
              : "打开InternShannon"
        }
        title={`${panelVisible ? "隐藏InternShannon" : "打开InternShannon"} · ${statusLabel}  (⌘/Ctrl + J)`}
        onPointerDown={startBubbleDrag}
        onDragStart={(event) => event.preventDefault()}
        onClick={handleBubbleClick}
        className={cn(
          "fixed left-0 top-0 z-[60] flex size-14 touch-none select-none items-center justify-center rounded-full border border-white/70 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.22)] transition-[background-color,border-color,box-shadow] duration-200 hover:shadow-[0_22px_54px_rgba(15,23,42,0.26)] cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2",
          "dark:border-white/10 dark:bg-background dark:shadow-[0_18px_44px_rgba(0,0,0,0.45)]",
        )}
        style={{
          transform: `translate3d(${bubblePosition.x}px, ${bubblePosition.y}px, 0)`,
          willChange: "transform",
          // Stay interactive above modal dialogs: Radix Dialog sets
          // `pointer-events: none` on <body>, which cascades to this
          // body-portaled bubble and would otherwise block drag/click.
          pointerEvents: "auto",
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="InternShannon"
            draggable={false}
            className="size-11 rounded-full object-contain ring-1 ring-primary/10"
          />
        ) : (
          <MessageCircle className="size-6 text-primary" />
        )}
        {!panelVisible && internShannonUnread > 0 ? (
          <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm dark:border-background">
            {internShannonUnread > 99 ? "99+" : internShannonUnread}
          </span>
        ) : (
          <span
            title={statusLabel}
            aria-hidden
            className={cn(
              "absolute right-1 top-1 size-3 rounded-full border-2 border-white dark:border-background",
              assistantStatus === "busy"
                ? "animate-pulse bg-amber-500"
                : assistantStatus === "done"
                  ? "bg-emerald-500"
                  : "bg-slate-400",
            )}
          />
        )}
      </button>
      {/* 屏幕阅读器播报:面板关闭期间收到InternShannon新消息时,通过 live region 通知(气泡角标的无障碍补充)。 */}
      <span className="sr-only" aria-live="polite">
        {!panelVisible && internShannonUnread > 0 ? `InternShannon有 ${internShannonUnread} 条未读消息` : ""}
      </span>
      {/* 状态播报:任务刚完成时无障碍提示(忙碌/空闲来回切换不播报,避免噪声)。 */}
      <span className="sr-only" aria-live="polite">
        {assistantStatus === "done" ? `InternShannon已完成${doneTask ? `:${doneTask}` : "任务"}` : ""}
      </span>
      {panelPortal}
    </>
  );
}
