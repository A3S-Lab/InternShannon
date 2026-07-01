import dayjs from "dayjs";
import { io } from "socket.io-client";
import { waitForBackendReady } from "@/lib/backend-ready";
import { DEFAULT_AGENT_ID } from "@/lib/builtins";
import { readStorage } from "@/lib/browser-storage";
import { autoDecideAuthorization, recordAuthorizationDecision } from "@/lib/hitl-auth";
import { allowsLocalWorkspacePaths } from "@/lib/runtime-environment";
import type { AgentSocket } from "@/lib/socket-types";
import type {
  AgentChatMessage,
  AgentRuntimeTimelineEvent,
  AgentSessionState,
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  ContentBlock,
  KernelSessionSnapshot,
} from "@/lib/types";
import { exposeWorkspacePath as exposeRuntimeWorkspacePath } from "@/lib/workspace-path";
import { recordInternShannonMemoryEvent } from "@/lib/internShannon-memory-timeline";
import agentModel from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";
import { getGatewayUrls } from "@/models/settings.model";
import { normalizeAssistantSocketMessage } from "./assistant-message-normalization";
import { normalizeContextCompactActivity } from "./context-compact-activity";
import {
  normalizeHistoryAssistantMessageContentBlocks,
  normalizeHistoryFiniteNumber,
  normalizeHistoryId,
  normalizeHistoryOptionalString,
  normalizeHistoryRecord,
  normalizeHistoryResultErrorMessage,
  normalizeHistoryText,
  normalizeHistoryTimestamp,
  normalizeMessageHistoryItems,
} from "./history-message-normalization";
import { normalizeMemoryActivity } from "./memory-activity";
import { shouldApplyMessageHistoryReplay } from "./message-history-replay";
import { reducePlanningStateFromEvent } from "./planning-state";
import { normalizeResultMessageData } from "./result-message-normalization";
import { normalizeSessionStatusPatch } from "./session-status-normalization";
import {
  normalizeAgentMessageSocketPayload,
  normalizeAuthStatusSocketPayload,
  normalizeSocketBoolean,
  normalizeSocketOptionalText,
  normalizeSocketText,
  normalizeSocketTimestamp,
  normalizeToolConfirmationSocketPayload,
  normalizeToolProgressSocketPayload,
} from "./socket-message-normalization";
import {
  normalizeStreamToolEndEvent,
  normalizeStreamToolOutputDeltaEvent,
  normalizeStreamToolProgressEvent,
  normalizeStreamToolStartEvent,
} from "./stream-event-normalization";
import { computeToolInputStreamMs, inferStreamSlowStage } from "./stream-perf";
import { normalizeStreamStalledActivity } from "./stream-stalled-activity";
import { normalizeToolCircuitActivity } from "./tool-circuit-activity";
import { normalizeToolErrorActivity } from "./tool-error-activity";
import { canSendSessionSocketMessage, subscribedPayloadMatchesSession } from "./connection-readiness";

// Module-level state (outside Valtio to avoid proxy overhead)
const sockets = new Map<string, AgentSocket>();
const connectingSessions = new Set<string>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const reconnectAttempts = new Map<string, number>();
const transientAccessErrorAttempts = new Map<string, number>();
const transientAccessDisconnects = new Map<string, number>();
/** Temporarily store images from outgoing user messages to attach to the echo */
const pendingUserImages = new Map<string, { mediaType: string; data: string }[]>();
/** Cache diff data from tool_end events, keyed by sessionId → toolUseId */
const diffCache = new Map<string, Map<string, { before?: string; after?: string; filePath?: string }>>();
/** Cache tool input JSON captured during streaming, keyed by sessionId → toolUseId */
const toolInputCache = new Map<string, Map<string, string>>();
/** Synthetic tool ids for streams that omit toolUseId */
const anonymousToolIds = new Map<string, string>();
/** Local monotonically increasing sequence per session for stream ordering */
const streamSeq = new Map<string, number>();
/** Next expected seq per session for in-order stream processing */
const nextExpectedStreamSeq = new Map<string, number>();
/** Reorder buffer for out-of-order events (keyed by sessionId → seq → event) */
const reorderBuffer = new Map<string, Map<number, Record<string, unknown>>>();
const REORDER_BUFFER_MAX = 8;
const REORDER_FLUSH_TIMEOUT_MS = 300;
const reorderFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const RECENT_LOCAL_SESSION_ACCESS_GRACE_MS = 2 * 60 * 1000;
const MAX_CLIENT_TOOL_OUTPUT_BYTES = 64 * 1024;
const TOOL_OUTPUT_TRUNCATION_NOTICE =
  "\n\n[Tool output truncated in the UI after 64 KB. Use a narrower path, query, or filter to inspect more.]";
const toolOutputEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function utf8ByteLength(text: string): number {
  return toolOutputEncoder ? toolOutputEncoder.encode(text).length : text.length;
}

function truncateToolOutputForUi(text: string): string {
  if (!text || text.includes(TOOL_OUTPUT_TRUNCATION_NOTICE)) return text;
  if (utf8ByteLength(text) <= MAX_CLIENT_TOOL_OUTPUT_BYTES) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (utf8ByteLength(text.slice(0, mid)) <= MAX_CLIENT_TOOL_OUTPUT_BYTES) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${TOOL_OUTPUT_TRUNCATION_NOTICE}`;
}

function appendToolOutputForUi(existing: string | undefined, delta: string): string {
  const current = existing ?? "";
  if (current.includes(TOOL_OUTPUT_TRUNCATION_NOTICE)) return current;
  return truncateToolOutputForUi(current + delta);
}

function timestampMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value > 0 && value < 1e12 ? value * 1000 : value;
}

function isRecentLocalSession(sessionId: string, now = Date.now()): boolean {
  const session = agentModel.state.sdkSessions.find((item) => item.sessionId === sessionId);
  if (!session || session.state === "exited") return false;
  const createdAt = timestampMs(session.createdAt);
  return createdAt > 0 && now - createdAt >= 0 && now - createdAt <= RECENT_LOCAL_SESSION_ACCESS_GRACE_MS;
}

function consumeTransientAccessDisconnect(sessionId: string): boolean {
  const markedAt = transientAccessDisconnects.get(sessionId);
  if (!markedAt) return false;
  transientAccessDisconnects.delete(sessionId);
  return Date.now() - markedAt <= 5000;
}

type StreamStats = {
  received: number;
  processed: number;
  staleDrops: number;
  reanchors: number;
  gapRecoveries: number;
  reorders: number;
};
const streamStats = new Map<string, StreamStats>();

type TurnPerf = {
  turnId: number;
  startedAt: number;
  wsSentAt?: number;
  messageStartAt?: number;
  firstDeltaAt?: number;
  firstToolStartAt?: number;
  firstToolInputDeltaAt?: number;
  lastToolInputDeltaAt?: number;
  toolInputDeltaCount?: number;
  firstToolOutputAt?: number;
  firstToolEndAt?: number;
  assistantAt?: number;
  resultAt?: number;
  /** Whether we've already created a message from streaming segments for this turn */
  messageCreated?: boolean;
};
const turnPerfBySession = new Map<string, TurnPerf>();
let turnCounter = 0;
let streamDebugEnabled: boolean | null = null;

function isStreamDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (streamDebugEnabled === null) {
    streamDebugEnabled = readStorage("internshannon-stream-debug") === "true";
  }
  return streamDebugEnabled;
}

// Invalidate cache when localStorage changes (user toggles debug flag)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "internshannon-stream-debug") {
      streamDebugEnabled = e.newValue === "true";
    }
  });
}

function getStreamStats(sessionId: string): StreamStats {
  const existing = streamStats.get(sessionId);
  if (existing) return existing;
  const next = {
    received: 0,
    processed: 0,
    staleDrops: 0,
    reanchors: 0,
    gapRecoveries: 0,
    reorders: 0,
  };
  streamStats.set(sessionId, next);
  return next;
}

function logStreamDebug(sessionId: string, reason: string): void {
  if (!isStreamDebugEnabled()) return;
  const stats = getStreamStats(sessionId);
  const expected = nextExpectedStreamSeq.get(sessionId) || 1;
  console.debug(`[stream:${sessionId}] ${reason}`, {
    expected,
    buffered: 0,
    seq: streamSeq.get(sessionId) || 0,
    stats,
  });
}

function logToolDebug(sessionId: string, label: string, payload: Record<string, unknown>): void {
  if (!isStreamDebugEnabled()) return;
  console.info(`[stream:${sessionId}] ${label}`, payload);
  try {
    console.info(`[stream:${sessionId}] ${label} json`, JSON.stringify(payload, null, 2));
  } catch {
    // Best-effort debug logging only.
  }
}

function isPrimaryInternShannonSession(sessionId: string): boolean {
  const session = agentModel.state.sdkSessions.find((item) => item.sessionId === sessionId);
  return agentRegistryModel.resolveSessionAgentId(sessionId, session?.agentId ?? null) === DEFAULT_AGENT_ID;
}

function recordPrimaryInternShannonMemoryTimelineEvent(sessionId: string, event: Record<string, unknown>): void {
  if (event.type !== "memory_stored" && event.type !== "memory_recalled" && event.type !== "memory_cleared") {
    return;
  }
  if (!isPrimaryInternShannonSession(sessionId)) return;
  recordInternShannonMemoryEvent({
    sessionId,
    sessionName: agentModel.state.sessionNames[sessionId],
    event,
    messages: agentModel.state.messages[sessionId] ?? [],
  });
}

function markTurnPerf(sessionId: string, field: keyof TurnPerf): void {
  const perf = turnPerfBySession.get(sessionId);
  if (!perf) return;
  if (perf[field] == null) {
    (perf as Record<string, unknown>)[field] = performance.now();
  }
}

function markToolInputDeltaPerf(sessionId: string): void {
  const perf = turnPerfBySession.get(sessionId);
  if (!perf) return;
  const now = performance.now();
  if (perf.firstToolInputDeltaAt == null) {
    perf.firstToolInputDeltaAt = now;
  }
  perf.lastToolInputDeltaAt = now;
  perf.toolInputDeltaCount = (perf.toolInputDeltaCount ?? 0) + 1;
}

function perfToolInputStreamMs(sessionId: string): number | undefined {
  const perf = turnPerfBySession.get(sessionId);
  if (!perf) return undefined;
  const base = perf.wsSentAt ?? perf.startedAt;
  const ms = (t?: number) => (typeof t === "number" ? Math.round(t - base) : null);
  return computeToolInputStreamMs({
    firstToolStartMs: ms(perf.firstToolStartAt),
    firstToolInputDeltaMs: ms(perf.firstToolInputDeltaAt),
    lastToolInputDeltaMs: ms(perf.lastToolInputDeltaAt),
  });
}

function emitTurnPerf(sessionId: string, finalStage: "assistant" | "result"): void {
  if (!isStreamDebugEnabled()) return;
  const perf = turnPerfBySession.get(sessionId);
  if (!perf) return;

  const base = perf.wsSentAt ?? perf.startedAt;
  const ms = (t?: number) => (typeof t === "number" ? Math.round(t - base) : null);
  const firstDeltaMs = ms(perf.firstDeltaAt);
  const firstToolStartMs = ms(perf.firstToolStartAt);
  const firstToolInputDeltaMs = ms(perf.firstToolInputDeltaAt);
  const lastToolInputDeltaMs = ms(perf.lastToolInputDeltaAt);
  const toolInputStreamMs = computeToolInputStreamMs({
    firstToolStartMs,
    firstToolInputDeltaMs,
    lastToolInputDeltaMs,
  });
  const resultMs = ms(perf.resultAt);
  const transportOverheadMs = typeof perf.wsSentAt === "number" ? Math.round(perf.wsSentAt - perf.startedAt) : null;
  const inferredSlowStage = inferStreamSlowStage({
    transportOverheadMs,
    firstDeltaMs,
    firstToolStartMs,
    firstToolInputDeltaMs,
    lastToolInputDeltaMs,
    firstToolOutputMs: ms(perf.firstToolOutputAt),
    firstToolEndMs: ms(perf.firstToolEndAt),
    resultMs,
  });

  console.info(`[stream:${sessionId}] turn #${perf.turnId} timeline (${finalStage})`, {
    toMessageStartMs: ms(perf.messageStartAt),
    toFirstDeltaMs: firstDeltaMs,
    toFirstToolStartMs: firstToolStartMs,
    toFirstToolInputDeltaMs: firstToolInputDeltaMs,
    toolInputDeltaCount: perf.toolInputDeltaCount ?? 0,
    toolInputStreamMs,
    toFirstToolOutputMs: ms(perf.firstToolOutputAt),
    toFirstToolEndMs: ms(perf.firstToolEndAt),
    toAssistantMs: ms(perf.assistantAt),
    toResultMs: resultMs,
    transportOverheadMs,
    inferredSlowStage,
  });

  agentModel.setStreamPerfHint(sessionId, {
    turn_id: perf.turnId,
    slow_stage: inferredSlowStage,
    to_first_delta_ms: firstDeltaMs ?? undefined,
    to_first_tool_input_delta_ms: firstToolInputDeltaMs ?? undefined,
    tool_input_stream_ms: toolInputStreamMs,
    to_result_ms: resultMs ?? undefined,
    updatedAt: Date.now(),
  });
}

function nextStreamSeq(sessionId: string): number {
  const next = (streamSeq.get(sessionId) || 0) + 1;
  streamSeq.set(sessionId, next);
  return next;
}

function resetStreamSeq(sessionId: string): void {
  streamSeq.delete(sessionId);
}

function resetStreamState(sessionId: string): void {
  resetStreamSeq(sessionId);
  nextExpectedStreamSeq.delete(sessionId);
  streamStats.delete(sessionId);
  toolInputCache.delete(sessionId);
  anonymousToolIds.delete(sessionId);
  reorderBuffer.delete(sessionId);
  const timer = reorderFlushTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    reorderFlushTimers.delete(sessionId);
  }
  agentModel.clearToolProgress(sessionId);
}

function exposeWorkspacePath(path: string | null | undefined): string {
  return exposeRuntimeWorkspacePath(path, { allowLocal: allowsLocalWorkspacePaths() });
}

function resolveExposedWorkspacePath(storageWorkspace: string, currentCwd: string, statusWorkspace: string): string {
  if (allowsLocalWorkspacePaths()) {
    return storageWorkspace || currentCwd || statusWorkspace;
  }
  return (
    exposeWorkspacePath(storageWorkspace) || exposeWorkspacePath(statusWorkspace) || exposeWorkspacePath(currentCwd)
  );
}

function exposeSessionUpdate(updates: Partial<AgentSessionState>): Partial<AgentSessionState> {
  if (!("cwd" in updates)) return updates;
  return {
    ...updates,
    cwd: exposeWorkspacePath(updates.cwd),
  };
}

function buildSessionStateFromBackend(
  fallbackSessionId: string,
  session: AgentSessionState | KernelSessionSnapshot,
): AgentSessionState {
  if ("sessionId" in session) {
    const existing = agentModel.state.sessions[session.sessionId || fallbackSessionId];
    return {
      ...session,
      cwd: exposeWorkspacePath(session.cwd),
      assetId: session.assetId ?? existing?.assetId,
      agentPhase: session.agentPhase ?? existing?.agentPhase,
    };
  }

  const sessionId = session.id || fallbackSessionId;
  const existing = agentModel.state.sessions[sessionId];
  return {
    sessionId,
    agentId: session.agentId ?? null,
    assetId: session.assetId ?? existing?.assetId,
    model: session.model || "",
    followDefaultModel: session.followDefaultModel ?? !session.model,
    cwd: exposeWorkspacePath(session.cwd),
    tools: [],
    permissionMode: session.permissionMode || "default",
    agentPhase: session.agentPhase ?? existing?.agentPhase,
    mcpServers: [],
    agents: [],
    slashCommands: [],
    skills: [],
    totalCostUsd: 0,
    numTurns: 0,
    contextUsedPercent: 0,
    isCompacting: false,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  };
}

function normalizeEventTimestamp(value: unknown): number | null {
  return normalizeHistoryTimestamp(value);
}

function normalizeRuntimeStatus(status: unknown): string {
  return typeof status === "string" && status.trim() ? status : "running";
}

function normalizeRuntimeTimelineEvent(event: Record<string, unknown>): AgentRuntimeTimelineEvent | null {
  const type = event.type;
  const timestamp =
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
  const phase = typeof event.phase === "string" && event.phase.trim() ? event.phase : "runtime";
  const baseId = typeof event.id === "string" && event.id.trim() ? event.id : "";
  const label =
    typeof event.label === "string" && event.label.trim()
      ? event.label
      : type === "tool_activity"
        ? "工具执行状态更新"
        : "主智能体状态更新";
  const displayLabel = label;
  const displayDetail = typeof event.detail === "string" && event.detail.trim() ? event.detail : undefined;
  const displaySource = typeof event.source === "string" && event.source.trim() ? event.source : undefined;

  if (type === "main_agent_activity") {
    return {
      id: baseId || `main:${phase}:${timestamp}`,
      kind: "main_agent",
      status: normalizeRuntimeStatus(event.status),
      phase,
      label: displayLabel,
      detail: displayDetail,
      source: displaySource,
      elapsedMs: typeof event.elapsedMs === "number" && Number.isFinite(event.elapsedMs) ? event.elapsedMs : undefined,
      activeToolCount:
        typeof event.activeToolCount === "number" && Number.isFinite(event.activeToolCount)
          ? event.activeToolCount
          : undefined,
      timestamp,
    };
  }

  if (type === "tool_activity") {
    const toolUseId = typeof event.toolUseId === "string" && event.toolUseId.trim() ? event.toolUseId : undefined;
    const toolName = typeof event.toolName === "string" && event.toolName.trim() ? event.toolName : undefined;
    return {
      id: baseId || `tool:${toolUseId || toolName || phase}:${normalizeRuntimeStatus(event.status)}:${timestamp}`,
      kind: "tool",
      status: normalizeRuntimeStatus(event.status),
      phase,
      label: displayLabel,
      detail: displayDetail,
      source: displaySource,
      toolUseId,
      toolName,
      elapsedMs: typeof event.elapsedMs === "number" && Number.isFinite(event.elapsedMs) ? event.elapsedMs : undefined,
      timestamp,
    };
  }

  if (type === "subagent_start" || type === "subagent_progress" || type === "subagent_end") {
    const parentSessionId =
      typeof event.parentSessionId === "string" && event.parentSessionId.trim() ? event.parentSessionId : undefined;
    const subStatus =
      typeof event.status === "string" && event.status.trim()
        ? event.status
        : type === "subagent_start"
          ? "running"
          : type === "subagent_progress"
            ? "running"
            : "completed";
    const subagentOutput = typeof event.output === "string" && event.output.trim() ? event.output : undefined;
    const subagentLabel =
      typeof event.label === "string" && event.label.trim()
        ? event.label
        : type === "subagent_start"
          ? "子智能体启动"
          : type === "subagent_end"
            ? "子智能体完成"
            : "子智能体进度";
    return {
      id: baseId || `subagent:${parentSessionId || phase}:${type}:${timestamp}`,
      kind: "subagent",
      status: normalizeRuntimeStatus(subStatus),
      phase: type,
      label: subagentLabel,
      detail: subagentOutput ?? displayDetail,
      source: parentSessionId ? `parent:${parentSessionId}` : displaySource,
      timestamp,
    };
  }

  if (type === "context_compacted") {
    return normalizeContextCompactActivity(event, { baseId, timestamp });
  }

  if (type === "memory_stored" || type === "memory_recalled" || type === "memory_cleared") {
    return normalizeMemoryActivity(event, { baseId, timestamp });
  }

  // Watchdog heartbeat from the kernel runtime: the SDK has not produced any
  // events for `stalledMs` ms. Surface it on the timeline so the user knows
  // the session is alive but waiting on a slow model response or tool.
  if (type === "stream_stalled") {
    return normalizeStreamStalledActivity(event, { baseId, timestamp });
  }

  // Explicit tool failure event (companion to tool_end with non-zero exit
  // code) — carries the structured reason, duration, and consecutive failure
  // counter so the UI can render "tool X failed after 30s: <reason>" without
  // scraping output.
  if (type === "tool_error") {
    return normalizeToolErrorActivity(event, { baseId, timestamp });
  }

  // Same-tool circuit breaker fired — the runner has cancelled the run to
  // stop a retry loop. Treat as a terminal failure surface so the user can
  // see why the message stopped.
  if (type === "tool_circuit_open") {
    return normalizeToolCircuitActivity(event, { baseId, timestamp });
  }

  return null;
}

function updatePlanningStateFromEvent(sessionId: string, event: Record<string, unknown>): void {
  const next = reducePlanningStateFromEvent(agentModel.state.planningStates[sessionId], event);
  if (next) agentModel.setPlanningState(sessionId, next);
}

function collapseAssistantTextParts(parts: string[]): string {
  const normalizedParts = parts.map((part) => part.trim()).filter((part) => part.length > 0);
  if (normalizedParts.length === 0) return "";

  const collapsed: string[] = [];
  for (const part of normalizedParts) {
    const previous = collapsed[collapsed.length - 1];
    if (!previous) {
      collapsed.push(part);
      continue;
    }
    if (part === previous) {
      continue;
    }
    if (part.startsWith(previous)) {
      collapsed[collapsed.length - 1] = part;
      continue;
    }
    collapsed.push(part);
  }

  return collapsed.join("\n\n");
}

function sanitizeAssistantContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks
    .filter((block) => block.type !== "thinking")
    .map((block) => {
      if (block.type === "tool_result" && typeof block.content === "string") {
        return {
          ...block,
          content: truncateToolOutputForUi(block.content),
        };
      }
      return block;
    });
}

function parseToolInputForContentBlock(rawInput: string): Record<string, unknown> {
  if (rawInput === "") {
    return {};
  }
  try {
    const parsed = JSON.parse(rawInput);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { __raw: rawInput };
  } catch {
    return { __raw: rawInput };
  }
}

function streamingToolSegmentsToContentBlocks(
  segments: import("@/models/agent.model").StreamingSegment[] | undefined,
): ContentBlock[] {
  if (!segments?.length) return [];

  const blocks: ContentBlock[] = [];
  for (const seg of segments) {
    if (seg.type !== "tool") continue;
    blocks.push({
      type: "tool_use",
      id: seg.call.toolUseId,
      name: seg.call.toolName,
      input: parseToolInputForContentBlock(seg.call.input),
    });
    blocks.push({
      type: "tool_result",
      toolUseId: seg.call.toolUseId,
      content: truncateToolOutputForUi(seg.call.output ?? ""),
      isError: seg.call.is_error,
      before: seg.call.before,
      after: seg.call.after,
      filePath: seg.call.filePath,
    });
  }
  return blocks;
}

function mergeFinalBlocksWithStreamingTools(
  finalBlocks: ContentBlock[],
  streamingSegments: import("@/models/agent.model").StreamingSegment[] | undefined,
): ContentBlock[] {
  const streamingToolBlocks = streamingToolSegmentsToContentBlocks(streamingSegments);
  if (streamingToolBlocks.length === 0) return finalBlocks;

  const existingToolUseIds = new Set(finalBlocks.filter((block) => block.type === "tool_use").map((block) => block.id));
  const missingToolBlocks: ContentBlock[] = [];
  for (let index = 0; index < streamingToolBlocks.length; index += 2) {
    const toolUse = streamingToolBlocks[index];
    const toolResult = streamingToolBlocks[index + 1];
    if (toolUse?.type !== "tool_use") continue;
    if (existingToolUseIds.has(toolUse.id)) continue;
    missingToolBlocks.push(toolUse);
    if (toolResult) missingToolBlocks.push(toolResult);
  }
  if (missingToolBlocks.length === 0) return finalBlocks;

  const firstTextIndex = finalBlocks.findIndex((block) => block.type === "text");
  if (firstTextIndex === -1) {
    return [...missingToolBlocks, ...finalBlocks];
  }
  return [...finalBlocks.slice(0, firstTextIndex), ...missingToolBlocks, ...finalBlocks.slice(firstTextIndex)];
}

function buildSyntheticToolUseId(sessionId: string, toolName: string, seq: number): string {
  return `anon:${sessionId}:${toolName}:${seq}`;
}

function resolveToolUseId(
  sessionId: string,
  toolUseId: string | undefined | null,
  toolName?: string,
  seq?: number,
): string {
  const normalized = typeof toolUseId === "string" ? toolUseId.trim() : "";
  if (normalized) {
    anonymousToolIds.set(sessionId, normalized);
    return normalized;
  }

  const active = agentModel.state.activeToolProgress[sessionId];
  if (active?.toolUseId) {
    if (!toolName || active.toolName === toolName) {
      anonymousToolIds.set(sessionId, active.toolUseId);
      return active.toolUseId;
    }
  }

  const lastKnown = anonymousToolIds.get(sessionId);
  if (lastKnown) {
    return lastKnown;
  }

  const synthetic = buildSyntheticToolUseId(sessionId, toolName || "tool", seq ?? nextStreamSeq(sessionId));
  anonymousToolIds.set(sessionId, synthetic);
  return synthetic;
}

function getToolInputMap(sessionId: string): Map<string, string> {
  const existing = toolInputCache.get(sessionId);
  if (existing) return existing;
  const next = new Map<string, string>();
  toolInputCache.set(sessionId, next);
  return next;
}

function cacheToolInput(sessionId: string, toolUseId: string, input?: string): void {
  if (!input) return;
  const normalized = input.trim();
  if (!normalized || normalized === "{}" || normalized === "[]") return;
  if (toolUseId) {
    getToolInputMap(sessionId).set(toolUseId, input);
  }
}

function parseCachedToolInput(input: string): Record<string, unknown> {
  // Handle empty string as special case - represents valid empty input for tools like ls
  if (input === "") {
    return {};
  }
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return { __display: input };
}

function enrichToolUseInput(
  sessionId: string,
  blocks: import("@/typings/agent").ContentBlock[],
): import("@/typings/agent").ContentBlock[] {
  const cachedInputs = toolInputCache.get(sessionId);
  if (!cachedInputs || cachedInputs.size === 0) {
    return blocks;
  }
  return blocks.map((block) => {
    if (block.type !== "tool_use") return block;
    const original = block.input ?? {};
    const isEmptyObject = typeof original === "object" && original !== null && Object.keys(original).length === 0;
    const isEmptyString =
      typeof original === "string" &&
      ((original as string).trim() === "" ||
        (original as string).trim() === "{}" ||
        (original as string).trim() === "[]");
    const isMissingInput = original == null || isEmptyObject || isEmptyString;
    if (!isMissingInput) return block;
    const cached = cachedInputs.get(block.id);
    if (!cached) return block;
    return {
      ...block,
      input: parseCachedToolInput(cached),
    };
  });
}

function hasUsefulToolInput(block: import("@/typings/agent").ContentBlock): boolean {
  if (block.type !== "tool_use") return false;
  const input = block.input;
  if (input == null) return false;
  if (typeof input === "string") {
    const normalized = (input as string).trim();
    return !!normalized && normalized !== "{}" && normalized !== "[]";
  }
  if (typeof input === "object") {
    return Object.keys(input).length > 0;
  }
  return false;
}

function seedToolInputCacheFromBlocks(sessionId: string, blocks: import("@/typings/agent").ContentBlock[]): void {
  for (const block of blocks) {
    if (block.type !== "tool_use") continue;
    if (!hasUsefulToolInput(block)) continue;
    cacheToolInput(sessionId, block.id, JSON.stringify(block.input, null, 2));
  }
}

function mergePreferRicherToolInputs(
  current: import("@/typings/agent").ContentBlock[],
  existing?: import("@/typings/agent").ContentBlock[],
): import("@/typings/agent").ContentBlock[] {
  if (!existing?.length) return current;
  const existingToolInputs = new Map<string, import("@/typings/agent").ContentBlock>();
  for (const block of existing) {
    if (block.type === "tool_use" && hasUsefulToolInput(block)) {
      existingToolInputs.set(block.id, block);
    }
  }
  if (existingToolInputs.size === 0) return current;
  return current.map((block) => {
    if (block.type !== "tool_use" || hasUsefulToolInput(block)) {
      return block;
    }
    return existingToolInputs.get(block.id) ?? block;
  });
}

/** Connect a Socket.IO socket for the given session */
export function connectSession(sessionId: string): void {
  if (isStreamDebugEnabled()) {
    console.log(
      `[WS] connectSession called for ${sessionId}, existing=${sockets.has(
        sessionId,
      )}, connecting=${connectingSessions.has(sessionId)}`,
    );
  }
  if (sockets.has(sessionId) || connectingSessions.has(sessionId)) return;
  connectingSessions.add(sessionId);
  agentModel.setConnectionStatus(sessionId, "connecting");
  void (async () => {
    try {
      await waitForBackendReady({ timeoutMs: 15000 });
      if (sockets.has(sessionId) || !connectingSessions.has(sessionId)) return;

      const urls = getGatewayUrls();
      let attempt = 0;
      let connected = false;

      const attach = (url: string) => {
        // Socket.IO connects to the namespace /ws/kernel
        if (isStreamDebugEnabled()) {
          console.log(`[Socket.IO] Connecting to ${url}/ws/kernel`);
        }
        try {
          const socket = io(`${url}/ws/kernel`, {
            transports: ["websocket", "polling"],
            forceNew: true,
            reconnection: false,
            timeout: 10000,
          });
          sockets.set(sessionId, socket);

          socket.on("subscribed", (payload: unknown) => {
            if (!subscribedPayloadMatchesSession(payload, sessionId)) return;
            if (isStreamDebugEnabled()) {
              console.log(`[Socket.IO] Subscribed to session room ${sessionId}`);
            }
            connected = true;
            connectingSessions.delete(sessionId);
            agentModel.setConnectionStatus(sessionId, "connected");
            reconnectAttempts.delete(sessionId);
            const timer = reconnectTimers.get(sessionId);
            if (timer) {
              clearTimeout(timer);
              reconnectTimers.delete(sessionId);
            }
            socket.emit("message", { sessionId, type: "session_status" });
          });

          socket.on("connect", () => {
            if (isStreamDebugEnabled()) {
              console.log(
                `[Socket.IO] Connected to ${url}/ws/kernel, socketId: ${socket.id}, socket.connected=${socket.connected}`,
              );
            }
            // Subscribe to the session room
            socket.emit("subscribe", { sessionId });
          });

          socket.on("disconnect", (reason: string) => {
            if (isStreamDebugEnabled()) {
              console.log(`[Socket.IO] Disconnected for session ${sessionId}, reason: ${reason}`);
            }
            connectingSessions.delete(sessionId);
            const skipNormalReconnect = consumeTransientAccessDisconnect(sessionId);
            if (!skipNormalReconnect && !connected && attempt + 1 < urls.length) {
              attempt += 1;
              socket.close();
              attach(urls[attempt]);
              return;
            }
            sockets.delete(sessionId);
            agentModel.setConnectionStatus(sessionId, "disconnected");
            turnPerfBySession.delete(sessionId);
            resetStreamState(sessionId);
            diffCache.delete(sessionId);
            pendingUserImages.delete(sessionId);
            if (!skipNormalReconnect) {
              scheduleReconnect(sessionId);
            }
          });

          socket.on("connect_error", (err: { message: string }) => {
            console.warn(`[Socket.IO] Connection error for session ${sessionId}:`, err.message);
            connected = false;
          });

          socket.on("connect_timeout", () => {
            console.warn(`[Socket.IO] Connection timeout for session ${sessionId}`);
          });

          // Handle all incoming messages from the gateway
          socket.on("message", (data: unknown) => {
            try {
              const msg = data as BrowserIncomingMessage;
              if (isStreamDebugEnabled()) {
                console.log(`[Socket.IO:msg] sessionId=${sessionId} type=${msg.type}`, msg);
              }
              if (msg && typeof msg === "object" && "type" in msg) {
                handleMessage(sessionId, msg);
              }
            } catch (err) {
              console.error("[Socket.IO] Error handling message:", err);
            }
          });

          socket.on("exception", (data: unknown) => {
            console.error(`[Socket.IO] Exception for session ${sessionId}:`, data);
            handleMessage(sessionId, normalizeSocketException(data));
          });

          // Handle tool confirmation requests
          socket.on("tool_confirmation_request", (data: unknown) => {
            try {
              const request = normalizeToolConfirmationSocketPayload(data, sessionId, nextMsgId());
              if (!request) {
                console.warn("[HITL] Ignoring malformed tool confirmation request", data);
                return;
              }
              if (request.sessionId !== sessionId) {
                console.warn("[HITL] Ignoring tool confirmation request for another session", {
                  currentSessionId: sessionId,
                  requestSessionId: request.sessionId,
                  requestId: request.requestId,
                });
                return;
              }
              console.log(`[HITL] Received tool_confirmation_request for session ${sessionId}`, {
                requestId: request.requestId,
                toolName: request.toolName,
                toolInput: request.toolInput,
              });

              // Check for auto-authorization first
              const autoDecision = autoDecideAuthorization(request);
              if (autoDecision?.approved && autoDecision.scope) {
                console.log(`[HITL] Auto-authorizing tool ${request.toolName} with scope ${autoDecision.scope}`);
                const response = {
                  requestId: request.requestId,
                  approved: true,
                  scope: autoDecision.scope,
                  toolName: request.toolName,
                };
                socket.emit("tool_confirmation_response", response);
                recordAuthorizationDecision(request.requestId, request.toolName, autoDecision);
                return;
              }

              // Not auto-approved, show confirmation dialog
              agentModel.setToolConfirmationRequest(sessionId, request);
              console.log(
                `[HITL] State updated, toolConfirmationRequests[${sessionId}] =`,
                agentModel.state.toolConfirmationRequests[sessionId],
              );
            } catch (err) {
              console.error("[HITL] Error handling tool confirmation request:", err);
            }
          });

          // Listen for any event (debug)
          socket.onAny((eventName: string, ...args: unknown[]) => {
            if (isStreamDebugEnabled()) {
              console.log(`[Socket.IO] Event: ${eventName}`, args.length > 0 ? args[0] : "");
            }
          });
        } catch (err) {
          console.error(`[Socket.IO] Failed to create socket:`, err);
          connectingSessions.delete(sessionId);
          agentModel.setConnectionStatus(sessionId, "disconnected");
        }
      };

      attach(urls[attempt]);
    } catch {
      connectingSessions.delete(sessionId);
      agentModel.setConnectionStatus(sessionId, "disconnected");
      scheduleReconnect(sessionId);
    }
  })();
}

/** Disconnect a session's WebSocket */
export function disconnectSession(sessionId: string): void {
  connectingSessions.delete(sessionId);
  const timer = reconnectTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(sessionId);
  }
  reconnectAttempts.delete(sessionId);
  transientAccessErrorAttempts.delete(sessionId);
  const ws = sockets.get(sessionId);
  if (ws) {
    ws.close();
    sockets.delete(sessionId);
  }
  agentModel.setConnectionStatus(sessionId, "disconnected");
  turnPerfBySession.delete(sessionId);
  resetStreamState(sessionId);
  diffCache.delete(sessionId);
  pendingUserImages.delete(sessionId);
}

/** Disconnect all sessions */
export function disconnectAll(): void {
  connectingSessions.clear();
  transientAccessErrorAttempts.clear();
  transientAccessDisconnects.clear();
  for (const sessionId of sockets.keys()) {
    disconnectSession(sessionId);
  }
}

/** Send a message to a session's Socket.IO socket. Returns true if sent, false if socket not ready. */
export function sendToSession(sessionId: string, msg: BrowserOutgoingMessage): boolean {
  const socket = sockets.get(sessionId);
  if (isStreamDebugEnabled()) {
    console.log(`[WS] sendToSession: socketId=${socket?.id}, connected=${socket?.connected}, msg.type=${msg.type}`);
  }
  if (
    canSendSessionSocketMessage({
      socketConnected: socket?.connected,
      connectionStatus: agentModel.state.connectionStatus[sessionId],
    })
  ) {
    const now = performance.now();
    // Emit message to the gateway's 'message' event handler
    socket.emit("message", { sessionId, ...msg });

    if (msg.type === "user_message") {
      turnCounter += 1;
      turnPerfBySession.set(sessionId, {
        turnId: turnCounter,
        startedAt: now,
        wsSentAt: now,
      });
      agentModel.setStreamPerfHint(sessionId, null);
      // Start a fresh turn window immediately to avoid stale seq state
      // blocking new stream events when message_start is delayed or missing.
      resetStreamState(sessionId);
      agentModel.setSessionStatus(sessionId, "running");
      // Store user message locally with images (server echo won't include images)
      if (msg.images && msg.images.length > 0) {
        pendingUserImages.set(sessionId, msg.images);
      }
    }
    return true;
  }
  if (isStreamDebugEnabled()) {
    console.log(
      `[WS] sendToSession: socket not ready, socket.exists=${!!socket}, socket.connected=${socket?.connected}`,
    );
  }
  return false;
}

function scheduleReconnect(sessionId: string): void {
  if (reconnectTimers.has(sessionId)) return;

  const attempts = reconnectAttempts.get(sessionId) || 0;
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
  const delay = Math.min(1000 * 2 ** attempts, 30000);
  reconnectAttempts.set(sessionId, attempts + 1);

  const timer = setTimeout(() => {
    reconnectTimers.delete(sessionId);
    // Only reconnect if session still exists
    if (agentModel.state.sessions[sessionId]) {
      connectSession(sessionId);
    }
  }, delay);

  reconnectTimers.set(sessionId, timer);
}

function disconnectAfterTransientAccessError(sessionId: string): void {
  const accessAttempts = transientAccessErrorAttempts.get(sessionId) || 0;
  transientAccessDisconnects.set(sessionId, Date.now());
  disconnectSession(sessionId);
  transientAccessErrorAttempts.set(sessionId, accessAttempts);
}

function scheduleTransientAccessRetry(sessionId: string): void {
  if (reconnectTimers.has(sessionId)) return;
  if (!isRecentLocalSession(sessionId)) return;

  const attempts = transientAccessErrorAttempts.get(sessionId) || 0;
  const delay = Math.min(1000 * 2 ** attempts, 10000);
  transientAccessErrorAttempts.set(sessionId, attempts + 1);

  const timer = setTimeout(() => {
    reconnectTimers.delete(sessionId);
    if (agentModel.state.sessions[sessionId] && isRecentLocalSession(sessionId)) {
      connectSession(sessionId);
    }
  }, delay);

  reconnectTimers.set(sessionId, timer);
}

function normalizeSocketException(data: unknown): BrowserIncomingMessage {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const message =
    typeof record.message === "string" && record.message.trim() ? record.message : "Internal server error";
  const code = typeof record.status === "string" ? record.status : typeof record.code === "string" ? record.code : null;
  const cause = record.cause && typeof record.cause === "object" ? (record.cause as Record<string, unknown>) : null;
  return {
    type: "error",
    message,
    code,
    details: cause ?? record,
  };
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringifyToolInput(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractStreamText(event: Record<string, unknown>): string {
  if (typeof event.text === "string") return event.text;
  if (typeof event.content === "string") return event.content;
  if (typeof event.delta === "string") return event.delta;
  const delta = parseRecord(event.delta);
  if (delta) {
    if (typeof delta.text === "string") return delta.text;
    if (typeof delta.content === "string") return delta.content;
  }
  return "";
}

function syncStreamingTextFromSegments(sessionId: string): void {
  const segs = agentModel.state.streamingSegments[sessionId];
  if (!segs?.length) {
    agentModel.setStreaming(sessionId, "");
    return;
  }
  let text = "";
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].type === "text") {
      text += (segs[i] as { content: string }).content;
    }
  }
  agentModel.setStreaming(sessionId, text);
}

function appendAssistantTextDelta(sessionId: string, text: string, seq: number): void {
  if (!text) return;
  agentModel.appendStreamingText(sessionId, text, seq);
  syncStreamingTextFromSegments(sessionId);
}

function handleStreamEventPayload(sessionId: string, event: Record<string, unknown>, seq: number): void {
  const eventType =
    typeof event.type === "string" ? event.type : typeof event.rawType === "string" ? event.rawType : "";

  // Always log key SDK events for debugging
  const text = event.text as string | undefined;
  const toolName = event.toolName as string | undefined;
  const toolId = event.toolId as string | undefined;
  const toolUseId = event.toolUseId as string | undefined;
  const data = event.data as string | undefined;

  if (isStreamDebugEnabled()) {
    console.log(
      `[Frontend:handleStreamEventPayload] session=${sessionId} seq=${seq} ` +
        `type="${eventType}" ` +
        `text="${text?.substring(0, 100) || ""}" ` +
        `toolName="${toolName || ""}" ` +
        `toolId="${toolId || toolUseId || ""}" ` +
        `data="${data?.substring(0, 80) || ""}"`,
    );
  }

  if (eventType === "message_start") {
    markTurnPerf(sessionId, "messageStartAt");
    resetStreamState(sessionId);
    nextExpectedStreamSeq.set(sessionId, seq + 1);
    streamSeq.set(sessionId, seq);
    agentModel.setStreamingStartedAt(sessionId, Date.now());
    agentModel.setStreaming(sessionId, "");
    agentModel.setSessionStatus(sessionId, "running");
    agentModel.clearCompletedTools(sessionId); // also clears streamingSegments
    diffCache.delete(sessionId);
    return;
  }

  if (eventType === "message_end") {
    // message_end signals the complete end of the message stream
    // Final state should already be handled by result or status_change events,
    // but we can use this for additional cleanup if needed
    if (isStreamDebugEnabled()) {
      const index = event.index as number | undefined;
      console.log(`[stream:${sessionId}] message_end index=${index}`);
    }
    return;
  }

  // SDK native tool_use_start event - create tool progress entry
  // Note: SDK may send "tool_start" or "tool_use_start" depending on version
  if (eventType === "tool_use_start" || eventType === "tool_use" || eventType === "tool_start") {
    markTurnPerf(sessionId, "firstToolStartAt");
    const toolStart = normalizeStreamToolStartEvent(event);
    if (!toolStart) return;
    const toolName = toolStart.toolName;
    const toolId = toolStart.toolUseId;

    if (agentModel.state.streaming[sessionId] === undefined) {
      agentModel.setStreaming(sessionId, "");
      agentModel.setSessionStatus(sessionId, "running");
      agentModel.setStreamingStartedAt(sessionId, Date.now());
    }

    // Check if there's already an active tool with the same tool name.
    // If content_block_start ran first and created a tool progress entry with a different
    // toolUseId, we should reuse that existing entry to ensure input_json_delta events
    // accumulate on the correct toolUseId that matches block.id in the assistant message.
    const existingActive = agentModel.state.activeToolProgress[sessionId];
    let resolvedToolUseId: string;
    if (existingActive?.toolUseId && existingActive.toolName === toolName) {
      // Reuse the existing toolUseId from content_block_start
      resolvedToolUseId = existingActive.toolUseId;
    } else {
      resolvedToolUseId = resolveToolUseId(sessionId, toolId, toolName, seq);
    }

    // Preserve existing input if already accumulated (from input_json_delta events)
    // since upsertToolProgress does a full assignment that would otherwise lose it.
    const existingInput = existingActive?.input;
    const progress = {
      toolUseId: resolvedToolUseId,
      toolName: toolName,
      elapsedTimeSeconds: 0,
      phase: "input_streaming" as const,
      input: existingInput ?? toolStart.input,
    };
    if (progress.input !== undefined) {
      cacheToolInput(sessionId, resolvedToolUseId, progress.input);
    }
    agentModel.upsertToolProgress(sessionId, progress);
    agentModel.upsertStreamingToolProgressSegment(sessionId, progress, seq);
    logToolDebug(sessionId, "tool_use_start", {
      toolUseId: resolvedToolUseId,
      toolName,
      toolId,
    });
    return;
  }

  // SDK native tool_end event - finalize tool call with input/output
  if (eventType === "tool_end") {
    markTurnPerf(sessionId, "firstToolEndAt");
    const toolEnd = normalizeStreamToolEndEvent(event, {
      fallbackToolName: agentModel.state.activeToolProgress[sessionId]?.toolName,
    });
    if (!toolEnd) return;
    const toolName = toolEnd.toolName;
    const toolId = toolEnd.toolUseId;
    const output = truncateToolOutputForUi(toolEnd.output);
    const isError = toolEnd.isError;
    const before = toolEnd.before;
    const after = toolEnd.after;
    const filePath = toolEnd.filePath;

    if (before != null || after != null) {
      const sessionDiffs =
        diffCache.get(sessionId) ?? new Map<string, { before?: string; after?: string; filePath?: string }>();
      sessionDiffs.set(toolId || toolName, { before, after, filePath: filePath });
      diffCache.set(sessionId, sessionDiffs);
    }

    const resolvedToolUseId = resolveToolUseId(sessionId, toolId, toolName, seq);
    const tp =
      agentModel.getToolProgress(sessionId, resolvedToolUseId, toolName) ??
      agentModel.state.activeToolProgress[sessionId];

    const completedTool = {
      toolUseId: resolvedToolUseId,
      toolName: toolName,
      input: tp?.input || "",
      output,
      is_error: isError,
      before,
      after,
      filePath: filePath,
      durationMs: toolEnd.durationMs,
    };

    cacheToolInput(sessionId, resolvedToolUseId, completedTool.input);
    agentModel.addCompletedTool(sessionId, completedTool);
    agentModel.replaceStreamingToolProgressWithCompleted(sessionId, resolvedToolUseId, completedTool, seq);
    agentModel.removeToolProgress(sessionId, resolvedToolUseId);

    const active = agentModel.state.activeToolProgress[sessionId];
    if (!active?.toolUseId || active.toolUseId !== resolvedToolUseId) {
      anonymousToolIds.delete(sessionId);
    }
    logToolDebug(sessionId, "tool_end", {
      toolUseId: resolvedToolUseId,
      toolName,
      hasInput: !!tp?.input,
    });
    return;
  }

  // SDK native content_block_start - similar to tool_use_start
  if (eventType === "content_block_start") {
    const block = event.content_block as Record<string, unknown> | undefined;
    if (block?.type === "tool_use" && typeof block.name === "string") {
      markTurnPerf(sessionId, "firstToolStartAt");
      const toolName = block.name as string;
      const toolId = block.id as string | undefined;

      if (agentModel.state.streaming[sessionId] === undefined) {
        agentModel.setStreaming(sessionId, "");
        agentModel.setSessionStatus(sessionId, "running");
        agentModel.setStreamingStartedAt(sessionId, Date.now());
      }

      // Check if there's already an active tool with the same tool name.
      // If tool_use_start ran first and created a tool progress entry with a different
      // toolUseId, we should reuse that existing entry to ensure input_json_delta events
      // accumulate on the correct toolUseId.
      const existingActive = agentModel.state.activeToolProgress[sessionId];
      const blockInput = stringifyToolInput(block.input);
      let resolvedToolUseId: string;
      if (existingActive?.toolUseId && existingActive.toolName === toolName) {
        // Reuse the existing toolUseId from tool_use_start
        resolvedToolUseId = existingActive.toolUseId;
      } else if (anonymousToolIds.has(sessionId)) {
        // tool_use_start ran first and set anonymousToolIds - reuse that toolUseId
        // if the tool names match (same tool), otherwise create a new entry
        const existingId = anonymousToolIds.get(sessionId);
        if (existingId) {
          const existingTp = agentModel.getToolProgress(sessionId, existingId, toolName);
          resolvedToolUseId =
            existingTp?.toolName === toolName ? existingId : resolveToolUseId(sessionId, toolId, toolName, seq);
        } else {
          resolvedToolUseId = resolveToolUseId(sessionId, toolId, toolName, seq);
        }
      } else {
        resolvedToolUseId = resolveToolUseId(sessionId, toolId, toolName, seq);
      }

      // Preserve existing input if already accumulated (from input_json_delta events)
      // since upsertToolProgress does a full assignment that would otherwise lose it.
      const existingInput = existingActive?.input;
      const progress = {
        toolUseId: resolvedToolUseId,
        toolName: toolName,
        elapsedTimeSeconds: 0,
        phase: "input_streaming" as const,
        input: existingInput ?? blockInput,
      };
      if (progress.input !== undefined) {
        cacheToolInput(sessionId, resolvedToolUseId, progress.input);
      }
      agentModel.upsertToolProgress(sessionId, progress);
      agentModel.upsertStreamingToolProgressSegment(sessionId, progress, seq);
    }
    return;
  }

  // SDK native content_block_delta with nested delta
  if (eventType === "content_block_delta") {
    const delta = parseRecord(event.delta);
    if (!delta) return;

    if (agentModel.state.streaming[sessionId] === undefined) {
      agentModel.setStreaming(sessionId, "");
      agentModel.setSessionStatus(sessionId, "running");
      agentModel.setStreamingStartedAt(sessionId, Date.now());
    }

    // text_delta inside content_block_delta
    if ((delta.type === "text_delta" || delta.type === "output_text_delta") && typeof delta.text === "string") {
      markTurnPerf(sessionId, "firstDeltaAt");
      appendAssistantTextDelta(sessionId, delta.text, seq);
    }
    // thinking_delta is internal reasoning content; never append it to user-visible text.
    else if (delta.type === "thinking_delta") {
      return;
    }
    // input_json_delta inside content_block_delta - tool input streaming
    else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      markToolInputDeltaPerf(sessionId);
      const tp = agentModel.state.activeToolProgress[sessionId];
      if (tp) {
        const inputDeltaCount = (tp.inputDeltaCount ?? 0) + 1;
        const next = {
          ...tp,
          phase: "input_streaming" as const,
          input: (tp.input || "") + delta.partial_json,
          inputDeltaCount,
          inputStreamingMs: perfToolInputStreamMs(sessionId),
        };
        cacheToolInput(sessionId, tp.toolUseId, next.input);
        agentModel.upsertToolProgress(sessionId, next);
        agentModel.upsertStreamingToolProgressSegment(sessionId, next, seq);
      }
    }
    return;
  }

  // SDK native input_json_delta as a direct event (not nested in content_block_delta)
  if (eventType === "input_json_delta") {
    const partialJson = event.partial_json as string | undefined;
    if (typeof partialJson !== "string" || !partialJson) return;

    if (agentModel.state.streaming[sessionId] === undefined) {
      agentModel.setStreaming(sessionId, "");
      agentModel.setSessionStatus(sessionId, "running");
      agentModel.setStreamingStartedAt(sessionId, Date.now());
    }

    const tp = agentModel.state.activeToolProgress[sessionId];
    if (tp) {
      markToolInputDeltaPerf(sessionId);
      const inputDeltaCount = (tp.inputDeltaCount ?? 0) + 1;
      const next = {
        ...tp,
        phase: "input_streaming" as const,
        input: (tp.input || "") + partialJson,
        inputDeltaCount,
        inputStreamingMs: perfToolInputStreamMs(sessionId),
      };
      cacheToolInput(sessionId, tp.toolUseId, next.input);
      agentModel.upsertToolProgress(sessionId, next);
      agentModel.upsertStreamingToolProgressSegment(sessionId, next, seq);
    }
    return;
  }

  // SDK native tool_input_delta - sent with text field containing partial JSON string
  if (eventType === "tool_input_delta") {
    const text = event.text as string | undefined;
    if (typeof text !== "string" || !text) return;

    if (agentModel.state.streaming[sessionId] === undefined) {
      agentModel.setStreaming(sessionId, "");
      agentModel.setSessionStatus(sessionId, "running");
      agentModel.setStreamingStartedAt(sessionId, Date.now());
    }

    const tp = agentModel.state.activeToolProgress[sessionId];
    if (tp) {
      markToolInputDeltaPerf(sessionId);
      const inputDeltaCount = (tp.inputDeltaCount ?? 0) + 1;
      const next = {
        ...tp,
        phase: "input_streaming" as const,
        input: (tp.input || "") + text,
        inputDeltaCount,
        inputStreamingMs: perfToolInputStreamMs(sessionId),
      };
      cacheToolInput(sessionId, tp.toolUseId, next.input);
      agentModel.upsertToolProgress(sessionId, next);
      agentModel.upsertStreamingToolProgressSegment(sessionId, next, seq);
    }
    return;
  }

  // Direct text_delta events (not wrapped in content_block_delta)
  if (eventType === "text_delta" || eventType === "text" || eventType === "output_text_delta") {
    if (agentModel.state.streaming[sessionId] === undefined) {
      agentModel.setStreaming(sessionId, "");
      agentModel.setSessionStatus(sessionId, "running");
      agentModel.setStreamingStartedAt(sessionId, Date.now());
    }
    const text = extractStreamText(event);
    if (text) {
      markTurnPerf(sessionId, "firstDeltaAt");
      appendAssistantTextDelta(sessionId, text, seq);
    }
    return;
  }

  // Direct reasoning/thinking events are internal; never expose them in chat.
  if (eventType === "reasoning_delta" || eventType === "thinking_delta") {
    return;
  }

  if (eventType === "btw_answer") {
    const question = typeof event.question === "string" ? event.question.trim() : "";
    const answer = typeof event.answer === "string" ? event.answer.trim() : "";
    agentModel.setBypassTurn(sessionId, false);
    if (!answer) return;
    const existingTurns = agentModel.state.bypassConversations[sessionId] || [];
    const pendingTurn = [...existingTurns].reverse().find((turn) => !turn.answer);
    if (pendingTurn) {
      agentModel.updateBypassConversation(sessionId, pendingTurn.id, {
        question: question || pendingTurn.question,
        answer,
        timestamp: Date.now(),
      });
    } else {
      agentModel.addBypassConversation(sessionId, {
        id: nextMsgId(),
        question,
        answer,
        timestamp: Date.now(),
      });
    }
    agentModel.appendMessage(sessionId, {
      id: nextMsgId(),
      role: "assistant",
      content: answer,
      timestamp: Date.now(),
      source: "command:/btw",
    });
    agentModel.setLastAssistantText(sessionId, answer);
    agentModel.setStreaming(sessionId, null);
    agentModel.clearCompletedTools(sessionId);
    agentModel.setSessionStatus(sessionId, "idle");
    return;
  }

  if (eventType === "turn_end") {
    if (isStreamDebugEnabled()) {
      const turn = event.turn as number | undefined;
      const totalTokens = event.totalTokens as number | undefined;
      console.log(`[stream:${sessionId}] turn_end turn=${turn} totalTokens=${totalTokens}`);
    }
    return;
  }

  if (eventType === "tool_output_delta") {
    markTurnPerf(sessionId, "firstToolOutputAt");
    const outputDelta = normalizeStreamToolOutputDeltaEvent(event, {
      fallbackToolName: agentModel.state.activeToolProgress[sessionId]?.toolName,
    });
    if (!outputDelta) return;
    const toolName = outputDelta.toolName;
    const toolUseId = resolveToolUseId(sessionId, outputDelta.toolUseId, toolName, seq);
    if (toolName) {
      const deltaText = outputDelta.delta;
      const tp =
        agentModel.getToolProgress(sessionId, toolUseId, toolName) ?? agentModel.state.activeToolProgress[sessionId];
      if (tp) {
        const elapsed = outputDelta.elapsedTimeSeconds ?? tp.elapsedTimeSeconds;
        const next = {
          ...tp,
          phase: "output" as const,
          output: appendToolOutputForUi(tp.output, deltaText),
          elapsedTimeSeconds: elapsed,
        };
        agentModel.upsertToolProgress(sessionId, next);
        agentModel.upsertStreamingToolProgressSegment(sessionId, next, seq);
      }
    }
    return;
  }

  if (eventType === "tool_progress") {
    const progress = normalizeStreamToolProgressEvent(event, {
      fallbackToolName: agentModel.state.activeToolProgress[sessionId]?.toolName,
    });
    if (!progress) return;
    const toolName = progress.toolName;
    const toolUseId = resolveToolUseId(sessionId, progress.toolUseId, toolName, seq);
    const existing =
      agentModel.getToolProgress(sessionId, toolUseId, toolName) ?? agentModel.state.activeToolProgress[sessionId];
    const next = {
      toolUseId: toolUseId,
      toolName: toolName,
      elapsedTimeSeconds: progress.elapsedTimeSeconds,
      phase: progress.phase ?? "executing",
      input: progress.input ?? (existing?.toolUseId === toolUseId ? existing.input : undefined),
      output: progress.output ?? (existing?.toolUseId === toolUseId ? existing.output : undefined),
      inputDeltaCount: progress.inputDeltaCount ?? existing?.inputDeltaCount,
      inputStreamingMs: progress.inputStreamingMs ?? existing?.inputStreamingMs,
    };
    agentModel.upsertToolProgress(sessionId, next);
    agentModel.upsertStreamingToolProgressSegment(sessionId, next, seq);
    return;
  }
}

function enqueueStreamEvent(sessionId: string, event: Record<string, unknown>): void {
  const stats = getStreamStats(sessionId);
  stats.received += 1;

  const raw = event.seq;
  const seq = typeof raw === "number" && Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : nextStreamSeq(sessionId);
  const eventType = event.type as string | undefined;
  if (eventType === "message_start") {
    // Turn boundary should always re-anchor ordering.
    stats.reanchors += 1;
    resetStreamState(sessionId);
    nextExpectedStreamSeq.set(sessionId, seq);
    streamSeq.set(sessionId, Math.max(0, seq - 1));
    logStreamDebug(sessionId, `message_start reanchor seq=${seq}`);
  }

  let expected = nextExpectedStreamSeq.get(sessionId) || 1;
  if (seq < expected) {
    // Stale event: received seq is behind expected
    // Re-anchor if: (1) seq=1 (new turn), or (2) gap > 20 (major desync)
    // Otherwise drop to avoid duplicate processing
    const staleness = expected - seq;
    if (seq === 1 || staleness > 20) {
      stats.reanchors += 1;
      resetStreamState(sessionId);
      nextExpectedStreamSeq.set(sessionId, seq);
      streamSeq.set(sessionId, Math.max(0, seq - 1));
      logStreamDebug(sessionId, `stale expected reanchor seq=${seq} (staleness=${staleness})`);
      expected = seq;
    } else {
      stats.staleDrops += 1;
      if (stats.staleDrops % 10 === 0) {
        logStreamDebug(sessionId, `stale drop x${stats.staleDrops} (staleness=${staleness})`);
      }
      return;
    }
  }

  // If there is a gap, buffer the event and wait briefly for missing events.
  // Small gaps (≤ REORDER_BUFFER_MAX) are buffered; larger gaps flush immediately.
  if (seq > expected) {
    const gap = seq - expected;
    if (gap <= REORDER_BUFFER_MAX) {
      // Buffer this event and schedule a flush timeout
      let buf = reorderBuffer.get(sessionId);
      if (!buf) {
        buf = new Map();
        reorderBuffer.set(sessionId, buf);
      }
      buf.set(seq, event);
      stats.reorders += 1;
      logStreamDebug(sessionId, `buffered seq=${seq} (waiting for expected=${expected})`);

      // Schedule flush after timeout to avoid indefinite blocking
      if (!reorderFlushTimers.has(sessionId)) {
        reorderFlushTimers.set(
          sessionId,
          setTimeout(() => {
            reorderFlushTimers.delete(sessionId);
            flushReorderBuffer(sessionId);
          }, REORDER_FLUSH_TIMEOUT_MS),
        );
      }
      return;
    }
    // Large gap: skip ahead immediately
    stats.gapRecoveries += 1;
    nextExpectedStreamSeq.set(sessionId, seq);
    logStreamDebug(sessionId, `gap skip expected=${expected} -> seq=${seq} (gap=${gap})`);
  }

  streamSeq.set(sessionId, seq);
  handleStreamEventPayload(sessionId, event, seq);
  stats.processed += 1;
  nextExpectedStreamSeq.set(sessionId, seq + 1);

  // After processing, drain any buffered events that are now in-order
  drainReorderBuffer(sessionId);

  if (stats.received % 40 === 0) {
    logStreamDebug(sessionId, "periodic");
  }
}

function drainReorderBuffer(sessionId: string): void {
  const buf = reorderBuffer.get(sessionId);
  if (!buf || buf.size === 0) return;

  const stats = getStreamStats(sessionId);
  let expected = nextExpectedStreamSeq.get(sessionId) || 1;

  while (buf.has(expected)) {
    const event = buf.get(expected);
    if (!event) break;
    buf.delete(expected);
    streamSeq.set(sessionId, expected);
    handleStreamEventPayload(sessionId, event, expected);
    stats.processed += 1;
    expected += 1;
    nextExpectedStreamSeq.set(sessionId, expected);
  }

  if (buf.size === 0) {
    reorderBuffer.delete(sessionId);
    const timer = reorderFlushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      reorderFlushTimers.delete(sessionId);
    }
  }
}

function flushReorderBuffer(sessionId: string): void {
  const buf = reorderBuffer.get(sessionId);
  if (!buf || buf.size === 0) {
    reorderBuffer.delete(sessionId);
    return;
  }

  const stats = getStreamStats(sessionId);
  const sortedSeqs = [...buf.keys()].sort((a, b) => a - b);

  // Skip ahead to the lowest buffered seq and process all in order
  const lowestSeq = sortedSeqs[0];
  stats.gapRecoveries += 1;
  nextExpectedStreamSeq.set(sessionId, lowestSeq);
  logStreamDebug(sessionId, `flush reorder buffer: ${sortedSeqs.length} events, jumping to seq=${lowestSeq}`);

  for (const seq of sortedSeqs) {
    const event = buf.get(seq);
    if (!event) continue;
    streamSeq.set(sessionId, seq);
    handleStreamEventPayload(sessionId, event, seq);
    stats.processed += 1;
    nextExpectedStreamSeq.set(sessionId, seq + 1);
  }

  reorderBuffer.delete(sessionId);
}

function handleMessage(sessionId: string, msg: BrowserIncomingMessage): void {
  if (isStreamDebugEnabled()) {
    const msgType = msg.type;
    const eventType = (msg as Record<string, unknown>).type as string | undefined;
    console.log(
      `[WS:handleMessage] session=${sessionId} msgType="${msgType}" ` +
        (eventType ? `eventType="${eventType}" ` : "") +
        `data=${JSON.stringify(msg).substring(0, 200)}`,
    );
  }

  switch (msg.type) {
    case "session_init": {
      transientAccessErrorAttempts.delete(sessionId);
      transientAccessDisconnects.delete(sessionId);
      const sessionState = buildSessionStateFromBackend(sessionId, msg.session);
      agentModel.addSession(sessionState);
      agentRegistryModel.ensureSessionAgent(sessionId, sessionState.agentId ?? null);
      agentModel.setCliConnected(sessionId, true);
      agentModel.setSessionStatus(sessionId, "idle");
      break;
    }

    case "session_update":
      agentModel.updateSession(sessionId, exposeSessionUpdate(msg.session));
      break;

    case "session_status":
      {
        const currentCwd = agentModel.state.sessions[sessionId]?.cwd ?? "";
        const sessionPatch = normalizeSessionStatusPatch(msg.data, {
          currentAgentId: agentModel.state.sessions[sessionId]?.agentId,
          currentCwd,
          resolveWorkspacePath: resolveExposedWorkspacePath,
        });
        if (Object.keys(sessionPatch).length === 0) {
          break;
        }
        agentModel.updateSession(sessionId, sessionPatch);
        agentRegistryModel.ensureSessionAgent(sessionId, sessionPatch.agentId ?? null);
      }
      break;

    case "assistant": {
      markTurnPerf(sessionId, "assistantAt");
      const assistantMessage = normalizeAssistantSocketMessage(msg.message, nextMsgId());
      if (!assistantMessage) {
        agentModel.setStreaming(sessionId, null);
        agentModel.setToolProgress(sessionId, null);
        agentModel.clearCompletedTools(sessionId);
        resetStreamState(sessionId);
        break;
      }
      const visibleContentBlocks = sanitizeAssistantContentBlocks(assistantMessage.contentBlocks);
      logToolDebug(sessionId, "assistant content blocks", {
        content: visibleContentBlocks
          .filter((b) => b.type === "tool_use")
          .map((b) => ({
            type: b.type,
            id: "id" in b ? b.id : undefined,
            name: "name" in b ? b.name : undefined,
            input: "input" in b ? b.input : undefined,
          })),
      });
      const textParts = collapseAssistantTextParts(
        visibleContentBlocks.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text),
      );
      if (isStreamDebugEnabled()) {
        console.log(
          `[WS:assistant] sessionId=${sessionId} textParts="${textParts.substring(
            0,
            500,
          )}${textParts.length > 500 ? "..." : ""}"`,
          { textParts, contentBlocks: visibleContentBlocks },
        );
      }

      // Inject cached diff data into tool_result blocks
      const sessionDiffs = diffCache.get(sessionId);
      const enrichedBlocks = sessionDiffs
        ? visibleContentBlocks.map((b) => {
            if (b.type === "tool_result") {
              const diff = sessionDiffs.get(b.toolUseId);
              if (diff) {
                return { ...b, ...diff };
              }
            }
            return b;
          })
        : visibleContentBlocks;
      const finalBlocks = mergeFinalBlocksWithStreamingTools(
        enrichToolUseInput(sessionId, enrichedBlocks),
        agentModel.state.streamingSegments[sessionId],
      );
      seedToolInputCacheFromBlocks(sessionId, finalBlocks);
      agentModel.setStreaming(sessionId, null);
      agentModel.setToolProgress(sessionId, null);
      agentModel.clearCompletedTools(sessionId);

      const chatMsg: AgentChatMessage = {
        id: assistantMessage.id,
        role: "assistant",
        content: textParts,
        contentBlocks: finalBlocks,
        timestamp: Date.now(),
        model: assistantMessage.model,
        stopReason: assistantMessage.stopReason,
        durationMs: assistantMessage.durationMs,
        meta: assistantMessage.meta,
        usage: assistantMessage.usage,
      };
      agentModel.appendMessage(sessionId, chatMsg);
      const perf = turnPerfBySession.get(sessionId);
      if (perf) perf.messageCreated = true;
      emitTurnPerf(sessionId, "assistant");
      resetStreamState(sessionId);
      if (textParts.trim()) {
        agentModel.setLastAssistantText(sessionId, textParts);
      }
      break;
    }

    case "result": {
      if (isStreamDebugEnabled()) {
        console.log(`[stream:${sessionId}] result event received:`, msg.data);
      }
      markTurnPerf(sessionId, "resultAt");
      const resultMessage = normalizeResultMessageData(msg.data);
      if (Object.keys(resultMessage.sessionPatch).length > 0) {
        agentModel.updateSession(sessionId, resultMessage.sessionPatch);
      }
      agentModel.setSessionStatus(sessionId, "idle");
      emitTurnPerf(sessionId, "result");

      if (resultMessage.isError) {
        agentModel.setStreaming(sessionId, null);
        agentModel.setToolProgress(sessionId, null);
        agentModel.clearCompletedTools(sessionId);
        turnPerfBySession.delete(sessionId);
        resetStreamState(sessionId);
        if (resultMessage.shouldAppendErrorMessage !== false) {
          agentModel.appendMessage(sessionId, {
            id: nextMsgId(),
            role: "system",
            content: resultMessage.errorContent,
            timestamp: Date.now(),
          });
        }
        break;
      }

      const hasStreamingSegments = (agentModel.state.streamingSegments[sessionId]?.length || 0) > 0;
      if (!hasStreamingSegments) {
        agentModel.setStreaming(sessionId, null);
        agentModel.setToolProgress(sessionId, null);
        agentModel.clearCompletedTools(sessionId);
        turnPerfBySession.delete(sessionId);
        resetStreamState(sessionId);
      }
      break;
    }

    case "stream_event":
      if (msg.event && typeof msg.event === "object") {
        const event = msg.event as Record<string, unknown>;
        updatePlanningStateFromEvent(sessionId, event);
        const runtimeTimelineEvent = normalizeRuntimeTimelineEvent(event);
        if (runtimeTimelineEvent) {
          if (
            runtimeTimelineEvent.kind === "main_agent" &&
            (runtimeTimelineEvent.status === "queued" || runtimeTimelineEvent.phase === "intake")
          ) {
            agentModel.clearRuntimeTimeline(sessionId);
          }
          agentModel.addRuntimeTimelineEvent(sessionId, runtimeTimelineEvent);
        }
        recordPrimaryInternShannonMemoryTimelineEvent(sessionId, event);
        agentModel.emitStreamEvent(sessionId, event);
        if (
          event.type !== "main_agent_activity" &&
          event.type !== "tool_activity" &&
          event.type !== "subagent_start" &&
          event.type !== "subagent_progress" &&
          event.type !== "subagent_end" &&
          event.type !== "context_compacted" &&
          event.type !== "memory_stored" &&
          event.type !== "memory_recalled" &&
          event.type !== "memory_cleared" &&
          event.type !== "stream_stalled" &&
          event.type !== "tool_error" &&
          event.type !== "tool_circuit_open"
        ) {
          enqueueStreamEvent(sessionId, event);
        }
      }
      break;

    case "cancelled":
      agentModel.flushStreamingToMessage(sessionId);
      agentModel.setStreaming(sessionId, null);
      agentModel.setToolProgress(sessionId, null);
      agentModel.clearCompletedTools(sessionId);
      agentModel.setSessionStatus(sessionId, "idle");
      agentModel.setCliConnected(sessionId, true);
      turnPerfBySession.delete(sessionId);
      resetStreamState(sessionId);
      break;

    case "status_change":
      if (msg.status === "compacting") {
        agentModel.setSessionStatus(sessionId, "compacting");
        agentModel.updateSession(sessionId, { isCompacting: true });
      } else if (msg.status === "running" || msg.status === "processing") {
        // "processing" is sent by backend when the agent starts thinking
        agentModel.setSessionStatus(sessionId, "running");
        agentModel.updateSession(sessionId, { isCompacting: false });
      } else {
        // Finalize streaming - create message from accumulated segments if no result event arrived
        // Only create if we have segments AND we haven't already created a message this turn
        const perf = turnPerfBySession.get(sessionId);
        const segments = agentModel.state.streamingSegments[sessionId];
        const hasSegments = segments && segments.length > 0;

        if (perf?.messageCreated) {
          // Already created a message via result event, just clean up
          agentModel.setStreaming(sessionId, null);
          agentModel.clearCompletedTools(sessionId);
          agentModel.setSessionStatus(sessionId, "idle");
          agentModel.updateSession(sessionId, { isCompacting: false });
          break;
        }
        if (hasSegments) {
          if (perf) perf.messageCreated = true;

          // Build text from text segments
          const textParts = segments.filter((s) => s.type === "text").map((s) => s.content);
          const finalText = collapseAssistantTextParts(textParts);

          // Build contentBlocks from user-visible segments only.
          const contentBlocks: ContentBlock[] = [];

          for (const seg of segments) {
            if (seg.type === "text") {
              contentBlocks.push({
                type: "text",
                text: seg.content,
              });
            } else if (seg.type === "tool") {
              contentBlocks.push({
                type: "tool_use",
                id: seg.call.toolUseId,
                name: seg.call.toolName,
                input: parseToolInputForContentBlock(seg.call.input),
              });
              contentBlocks.push({
                type: "tool_result",
                toolUseId: seg.call.toolUseId,
                content: truncateToolOutputForUi(seg.call.output ?? ""),
                isError: seg.call.is_error,
                before: seg.call.before,
                after: seg.call.after,
                filePath: seg.call.filePath,
              });
            }
          }

          const messageId = nextMsgId();
          const timestamp = Date.now();
          agentModel.appendMessage(sessionId, {
            id: messageId,
            role: "assistant",
            content: finalText,
            contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
            timestamp,
          });
          if (isStreamDebugEnabled()) {
            console.log(
              `[stream:${sessionId}] Created message from streaming segments: text="${finalText.substring(
                0,
                50,
              )}..." blocks=${contentBlocks.length}`,
            );
          }
          // Clear streaming state since we created a message from segments
          agentModel.setStreaming(sessionId, null);
          agentModel.clearCompletedTools(sessionId);
          agentModel.setSessionStatus(sessionId, "idle");
          agentModel.updateSession(sessionId, { isCompacting: false });
          turnPerfBySession.delete(sessionId);
          resetStreamState(sessionId);
        }
        // If no segments and no messageCreated, don't clear streaming state.
        // This keeps the thinking indicator visible when status_change: null arrives
        // but no content events have arrived yet. The thinking state will be cleared
        // when a result event arrives or when actual content starts streaming.
      }
      break;

    case "error":
      if (isSessionAccessError(msg.message)) {
        if (isRecentLocalSession(sessionId)) {
          console.warn(
            `[Socket.IO] Session ${sessionId} is not visible to the gateway yet; preserving recent local session and retrying`,
          );
          disconnectAfterTransientAccessError(sessionId);
          agentModel.setSessionStatus(sessionId, "idle");
          scheduleTransientAccessRetry(sessionId);
          return;
        }
        disconnectSession(sessionId);
        agentRegistryModel.removeSessionAgent(sessionId);
        agentModel.removeSession(sessionId);
        return;
      }
      agentModel.appendMessage(sessionId, {
        id: nextMsgId(),
        role: "system",
        content: normalizeSocketText(msg.message, "An error occurred"),
        timestamp: Date.now(),
        source: normalizeSocketOptionalText(msg.code) ? `error:${normalizeSocketText(msg.code)}` : "error",
      });
      agentModel.setStreaming(sessionId, null);
      agentModel.setToolProgress(sessionId, null);
      agentModel.clearCompletedTools(sessionId);
      agentModel.setSessionStatus(sessionId, "idle");
      turnPerfBySession.delete(sessionId);
      resetStreamState(sessionId);
      break;

    case "cli_connected":
      agentModel.setCliConnected(sessionId, true);
      break;

    case "cli_disconnected":
      agentModel.setCliConnected(sessionId, false);
      agentModel.setSessionStatus(sessionId, null);
      break;

    case "user_message": {
      // Echo from server — attach any pending images from the outgoing message
      const images = pendingUserImages.get(sessionId);
      if (images) pendingUserImages.delete(sessionId);
      agentModel.appendMessage(sessionId, {
        id: nextMsgId(),
        role: "user",
        content: normalizeSocketText(msg.content),
        timestamp: normalizeSocketTimestamp(msg.timestamp, Date.now()),
        images,
      });
      break;
    }

    case "message_history": {
      // Backend sends full history on connect — always use it as source of truth.
      const historyMessages = normalizeMessageHistoryItems(msg.messages);
      logToolDebug(sessionId, "message history tool blocks", {
        items: historyMessages
          .filter((m) => m.type === "assistant")
          .flatMap((m) =>
            normalizeHistoryAssistantMessageContentBlocks(normalizeHistoryRecord(m.message))
              .filter((b) => b.type === "tool_use")
              .map((b) => ({
                type: b.type,
                id: "id" in b ? b.id : undefined,
                name: "name" in b ? b.name : undefined,
                input: "input" in b ? b.input : undefined,
              })),
          ),
      });
      const chatMessages = convertHistoryMessages(sessionId, historyMessages);
      const existingMessages = agentModel.state.messages[sessionId] || [];
      const bypassTurns = mergeBypassConversations(
        agentModel.state.bypassConversations[sessionId] || [],
        extractBypassConversations(historyMessages),
      );
      for (const historyMessage of historyMessages) {
        if (
          historyMessage.type === "stream_event" &&
          historyMessage.event &&
          typeof historyMessage.event === "object"
        ) {
          updatePlanningStateFromEvent(sessionId, historyMessage.event as Record<string, unknown>);
        }
      }
      if (
        shouldApplyMessageHistoryReplay({
          existingMessages,
          replayMessages: chatMessages,
        })
      ) {
        agentModel.setMessages(sessionId, chatMessages);
      }
      agentModel.setBypassConversations(sessionId, bypassTurns);
      break;
    }

    case "session_name_update": {
      agentModel.setSessionName(sessionId, msg.name);
      break;
    }

    case "agent_message": {
      const agentMessage = normalizeAgentMessageSocketPayload(msg, nextMsgId());
      if (!agentMessage) break;
      agentModel.addAgentMessage(sessionId, agentMessage);
      agentModel.incrementUnread(sessionId);
      break;
    }

    case "command_response":
      // /clear command: wipe UI messages before showing the response
      if (normalizeSocketText(msg.command) === "/clear" && normalizeSocketBoolean(msg.stateChanged)) {
        agentModel.setMessages(sessionId, []);
      }
      agentModel.appendMessage(sessionId, {
        id: nextMsgId(),
        role: "assistant",
        content: normalizeSocketText(msg.text),
        timestamp: Date.now(),
        source: `command:${normalizeSocketText(msg.command, "unknown")}`,
      });
      // Slash commands don't trigger LLM generation — clear running state
      agentModel.setSessionStatus(sessionId, "idle");
      break;

    case "tool_progress": {
      const progress = normalizeToolProgressSocketPayload(msg);
      if (!progress) break;
      enqueueStreamEvent(sessionId, {
        type: "tool_progress",
        toolUseId: progress.toolUseId,
        toolName: progress.toolName,
        elapsedTimeSeconds: progress.elapsedTimeSeconds,
        input: progress.input,
        output: progress.output,
        seq: progress.seq,
      });
      break;
    }

    case "tool_use_summary":
      // Clear active tool progress when a summary arrives
      agentModel.setToolProgress(sessionId, null);
      // Insert a system message summarising the tool calls
      agentModel.appendMessage(sessionId, {
        id: nextMsgId(),
        role: "system",
        content: normalizeSocketText(msg.summary, "工具调用已完成。"),
        timestamp: Date.now(),
      });
      break;

    case "auth_status": {
      const authStatus = normalizeAuthStatusSocketPayload(msg);
      if (!authStatus) break;
      agentModel.setAuthStatus(sessionId, authStatus);
      break;
    }

    case "asset_binding":
      if (typeof msg.assetId === "string") {
        agentModel.setSessionAssetId(sessionId, msg.assetId);
      }
      break;

    case "asset_agent_lock_violation": {
      if (typeof msg.lockedAssetId === "string") {
        agentModel.setSessionAssetId(sessionId, msg.lockedAssetId);
      }
      const content =
        typeof msg.message === "string" && msg.message.trim()
          ? msg.message.trim()
          : "当前开发会话已绑定一个数字资产，已忽略后续资产创建标记。";
      agentModel.appendMessage(sessionId, {
        id: nextMsgId(),
        role: "system",
        content,
        timestamp: normalizeEventTimestamp(msg.timestamp) ?? Date.now(),
        source: "asset_agent_lock_violation",
      });
      break;
    }

    case "file_attached":
      if (typeof msg.uploadId === "string" && typeof msg.fileName === "string") {
        agentModel.addSessionFile(sessionId, {
          uploadId: msg.uploadId as string,
          fileName: msg.fileName as string,
          mimeType: (msg.mimeType as string) || undefined,
        });
      }
      break;

    default:
      break;
  }
}

function isSessionAccessError(message: unknown): boolean {
  if (typeof message !== "string") return false;
  return /session not found or access denied|kernel session not found/i.test(message);
}

/** Monotonic ID counter to avoid Date.now() collisions */
let _msgIdCounter = 0;
function nextMsgId(): string {
  return `${Date.now()}-${++_msgIdCounter}`;
}

/** Convert message history from server format to chat messages */
function convertHistoryMessages(sessionId: string, messages: unknown): AgentChatMessage[] {
  const result: AgentChatMessage[] = [];
  const existingMessages = agentModel.state.messages[sessionId] || [];
  const existingAssistantBlocks = new Map(
    existingMessages.flatMap((msg) =>
      msg.role === "assistant" && msg.contentBlocks?.length ? [[msg.id, msg.contentBlocks] as const] : [],
    ),
  );
  for (const [messageId, blocks] of Object.entries(agentModel.getPersistedAssistantBlocks(sessionId))) {
    if (!existingAssistantBlocks.has(messageId)) {
      existingAssistantBlocks.set(messageId, blocks);
    }
  }
  // Start with 0; the first user_message with a valid server timestamp
  // will anchor the timeline. Messages before that get Date.now() fallback.
  let lastTimestamp = 0;

  for (const msg of normalizeMessageHistoryItems(messages)) {
    if (msg.type === "assistant") {
      const message = normalizeHistoryRecord(msg.message);
      if (!message) continue;
      const messageId = normalizeHistoryId(message.id, nextMsgId());
      const visibleContentBlocks = sanitizeAssistantContentBlocks(
        normalizeHistoryAssistantMessageContentBlocks(message),
      );
      if (visibleContentBlocks.length === 0) continue;
      const durationMs = normalizeHistoryFiniteNumber(message.durationMs ?? message.duration_ms);
      const textParts = collapseAssistantTextParts(
        visibleContentBlocks.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text),
      );
      const mergedBlocks = mergePreferRicherToolInputs(visibleContentBlocks, existingAssistantBlocks.get(messageId));
      const finalBlocks = enrichToolUseInput(sessionId, sanitizeAssistantContentBlocks(mergedBlocks));
      seedToolInputCacheFromBlocks(sessionId, finalBlocks);

      const serverTs = normalizeHistoryTimestamp(msg.timestamp) ?? 0;
      if (serverTs > 0 && dayjs(serverTs).isAfter("2000-01-01")) {
        lastTimestamp = serverTs;
      } else {
        // Inherit from last known timestamp (user message or previous assistant)
        // so messages in the same turn stay on the same day.
        if (lastTimestamp === 0) lastTimestamp = Date.now();
        lastTimestamp = lastTimestamp + 1;
      }
      result.push({
        id: messageId,
        role: "assistant",
        content: textParts,
        contentBlocks: finalBlocks,
        timestamp: lastTimestamp,
        model: normalizeHistoryOptionalString(message.model),
        stopReason: normalizeHistoryOptionalString(message.stopReason ?? message.stop_reason) ?? null,
        durationMs,
        meta: normalizeHistoryRecord(message.meta) || undefined,
        usage: normalizeHistoryRecord(message.usage) || undefined,
      });
    } else if (msg.type === "stream_event") {
      const event = normalizeHistoryRecord(msg.event);
      if (!event) continue;
      if (event.type === "btw_answer") {
        const answer = typeof event.answer === "string" ? event.answer.trim() : "";
        if (!answer) continue;
        if (lastTimestamp === 0) lastTimestamp = Date.now();
        lastTimestamp = lastTimestamp + 1;
        result.push({
          id: nextMsgId(),
          role: "assistant",
          content: answer,
          timestamp: lastTimestamp,
          source: "command:/btw",
        });
      }
    } else if (msg.type === "result") {
      const errorContent = normalizeHistoryResultErrorMessage(msg.data);
      if (!errorContent) continue;
      if (lastTimestamp === 0) lastTimestamp = Date.now();
      lastTimestamp = lastTimestamp + 1;
      result.push({
        id: nextMsgId(),
        role: "system",
        content: errorContent,
        timestamp: lastTimestamp,
      });
    } else if (msg.type === "user_message") {
      // user_message has a server-provided timestamp — use it to anchor the timeline
      // Normalize: backend may send seconds instead of milliseconds
      const serverTs = normalizeEventTimestamp(msg.timestamp) ?? 0;
      if (serverTs > 0 && dayjs(serverTs).isAfter("2000-01-01")) {
        lastTimestamp = serverTs;
      } else {
        if (lastTimestamp === 0) lastTimestamp = Date.now();
        lastTimestamp = lastTimestamp + 1;
      }
      result.push({
        id: normalizeHistoryId(msg.id, nextMsgId()),
        role: "user",
        content: normalizeHistoryText(msg.content),
        timestamp: lastTimestamp,
      });
    }
  }

  return result;
}

function mergeBypassConversations(
  existing: import("@/models/agent.model").BypassConversationTurn[],
  incoming: import("@/models/agent.model").BypassConversationTurn[],
): import("@/models/agent.model").BypassConversationTurn[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;

  const merged = [...existing];
  for (const turn of incoming) {
    const duplicate = merged.some(
      (existingTurn) =>
        existingTurn.question.trim() === turn.question.trim() && existingTurn.answer.trim() === turn.answer.trim(),
    );
    if (!duplicate) {
      merged.push(turn);
    }
  }

  return merged;
}

function extractBypassConversations(messages: unknown): import("@/models/agent.model").BypassConversationTurn[] {
  const turns: import("@/models/agent.model").BypassConversationTurn[] = [];

  for (const msg of normalizeMessageHistoryItems(messages)) {
    if (msg.type !== "stream_event") continue;
    const event = normalizeHistoryRecord(msg.event);
    if (!event) continue;
    if (event.type !== "btw_answer") continue;
    const question = typeof event.question === "string" ? event.question.trim() : "";
    const answer = typeof event.answer === "string" ? event.answer.trim() : "";
    if (!answer) continue;
    turns.push({
      id: nextMsgId(),
      question,
      answer,
      timestamp: Date.now() + turns.length,
    });
  }

  return turns;
}
