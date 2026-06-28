import { useEffect, useRef, useState } from "react";
import { subscribe } from "valtio";
import { sendToSession } from "@/hooks/use-agent-ws";
import { agentApi, type CreateSessionRequest, type SessionResponse } from "@/lib/agent-api";
import { registerCreatedSession } from "@/lib/session-bootstrap";
import type { AgentProcessInfo } from "@/lib/types";
import agentModel from "@/models/agent.model";

export interface LockedAgentSessionRef {
  sessionId: string;
  assetId?: string;
  agentPhase?: string;
  cwd?: string;
  title?: string;
}

interface LockedAgentSessionScope {
  pending: Map<string, Promise<LockedAgentSessionRef>>;
  resolved: Map<string, LockedAgentSessionRef & { expiresAt: number }>;
}

// Per-agent module-scoped caches so concurrent <StrictMode> renders, fast nav,
// or background refreshes don't all post duplicate kernel sessions.
const SCOPE_BY_AGENT = new Map<string, LockedAgentSessionScope>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getScope(agentId: string): LockedAgentSessionScope {
  let scope = SCOPE_BY_AGENT.get(agentId);
  if (!scope) {
    scope = { pending: new Map(), resolved: new Map() };
    SCOPE_BY_AGENT.set(agentId, scope);
  }
  return scope;
}

function valueToRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pruneResolved(scope: LockedAgentSessionScope, now = Date.now()): void {
  for (const [key, value] of scope.resolved) {
    if (value.expiresAt <= now) scope.resolved.delete(key);
  }
}

interface CreateLockedAgentSessionInput {
  agentId: string;
  request: CreateSessionRequest;
  dedupeKey: string;
  hideFromMainList: boolean;
  fallbackTitle: string;
}

async function createLockedAgentSession(input: CreateLockedAgentSessionInput): Promise<LockedAgentSessionRef> {
  const scope = getScope(input.agentId);
  const now = Date.now();
  pruneResolved(scope, now);

  const cached = scope.resolved.get(input.dedupeKey);
  if (cached && cached.expiresAt > now) return cached;

  const existing = scope.pending.get(input.dedupeKey);
  if (existing) return existing;

  const promise = agentApi
    .createSession(input.request)
    .then((res: SessionResponse) => {
      const created = res.session;
      const responseMetadata = valueToRecord(res.metadata) ?? {};
      const createdMetadata = valueToRecord(created?.metadata) ?? {};
      const metadata = { ...responseMetadata, ...createdMetadata };
      const sessionId = created?.sessionId || res.sessionId || res.id || "";
      if (!sessionId) throw new Error("创建会话失败");

      const assetId = stringValue(created?.assetId ?? res.assetId ?? metadata.assetId);
      const agentPhase = stringValue(created?.agentPhase ?? res.agentPhase ?? metadata.agentPhase);
      const title = created?.title || res.title || input.fallbackTitle;
      const cwd = created?.cwd || res.cwd || "";

      const sessionRecord: AgentProcessInfo = {
        sessionId,
        agentId: created?.agentId ?? res.agentId ?? input.agentId,
        state: "connected",
        model: created?.model ?? res.model,
        followDefaultModel: created?.followDefaultModel ?? res.followDefaultModel,
        permissionMode: created?.permissionMode ?? res.permissionMode,
        cwd,
        createdAt: Date.now(),
        name: title,
        assetId,
        agentPhase,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };

      registerCreatedSession(sessionRecord, {
        agentId: input.agentId,
        name: title,
        hideFromMainList: input.hideFromMainList,
      });
      if (assetId) agentModel.setSessionAssetId(sessionId, assetId);

      const ref: LockedAgentSessionRef = { sessionId, assetId, agentPhase, cwd, title };
      scope.resolved.set(input.dedupeKey, { ...ref, expiresAt: Date.now() + CACHE_TTL_MS });
      return ref;
    })
    .finally(() => {
      scope.pending.delete(input.dedupeKey);
    });

  scope.pending.set(input.dedupeKey, promise);
  return promise;
}

export interface UseLockedAgentSessionOptions {
  agentId: string;
  resumeSessionId?: string;
  initialPrompt?: string;
  requestId?: string;
  /** Extra parts mixed into the dedupe key when no requestId is supplied. */
  dedupeKeyExtras?: ReadonlyArray<string | undefined>;
  /** React Router `location.key` — scopes dedupe to this mount. */
  routeKey?: string;
  /** Build the createSession payload at bootstrap time. */
  buildCreateRequest: (prompt: string) => CreateSessionRequest;
  fallbackTitle: string;
  /** Toast title when bootstrap fails. */
  errorTitle?: string;
  hideFromMainList?: boolean;
  /** Optional async error notifier so the hook can stay UI-free. */
  onError?: (error: unknown, title: string) => void;
}

export interface UseLockedAgentSessionResult {
  sessionId: string | null;
  isCreating: boolean;
  ref: LockedAgentSessionRef | null;
}

/**
 * Shared bootstrap for kernel sessions that are pinned to a single locked asset agent.
 * Handles dedupe across concurrent renders, sends the initial prompt once the websocket
 * connects, and resets state when the caller navigates with a new prompt/sessionId.
 */
export function useLockedAgentSession(opts: UseLockedAgentSessionOptions): UseLockedAgentSessionResult {
  const initialPrompt = opts.initialPrompt ?? "";
  const dedupeKeyExtras = opts.dedupeKeyExtras ?? [];
  const dedupeExtrasKey = dedupeKeyExtras.map((part) => part ?? "").join("::");

  const [sessionId, setSessionId] = useState<string | null>(opts.resumeSessionId ?? null);
  const [isCreating, setIsCreating] = useState(!opts.resumeSessionId);
  const [ref, setRef] = useState<LockedAgentSessionRef | null>(null);
  const routeModeKeyRef = useRef("");
  const sentInitialPromptRef = useRef(false);

  useEffect(() => {
    const nextKey = [
      opts.resumeSessionId ?? "",
      initialPrompt,
      opts.requestId ?? "",
      dedupeExtrasKey,
    ].join("::");
    if (routeModeKeyRef.current === nextKey) return;
    routeModeKeyRef.current = nextKey;
    sentInitialPromptRef.current = false;
    setSessionId(opts.resumeSessionId ?? null);
    setIsCreating(!opts.resumeSessionId);
    setRef(null);
  }, [opts.resumeSessionId, initialPrompt, opts.requestId, dedupeExtrasKey]);

  useEffect(() => {
    if (sessionId) return;

    let cancelled = false;
    setIsCreating(true);

    const requestId = opts.requestId?.trim();
    const dedupeKey = requestId
      ? `request:${requestId}`
      : ["route", opts.routeKey ?? "default", initialPrompt.trim(), dedupeExtrasKey].join("::");

    createLockedAgentSession({
      agentId: opts.agentId,
      request: opts.buildCreateRequest(initialPrompt),
      dedupeKey,
      hideFromMainList: opts.hideFromMainList ?? true,
      fallbackTitle: opts.fallbackTitle,
    })
      .then((created) => {
        if (cancelled) return;
        setSessionId(created.sessionId);
        setRef(created);
        setIsCreating(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setIsCreating(false);
        const title = opts.errorTitle ?? "创建会话失败";
        if (opts.onError) {
          opts.onError(err, title);
        } else {
          console.error(`[${title}]`, err);
        }
      });

    return () => {
      cancelled = true;
    };
    // The bootstrap is intentionally driven by sessionId + the dedupe inputs.
    // We deliberately exclude `opts.buildCreateRequest` from deps because the
    // caller usually reconstructs it each render but its output is dedupe-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, opts.agentId, opts.requestId, opts.routeKey, initialPrompt, dedupeExtrasKey]);

  useEffect(() => {
    if (!sessionId || !initialPrompt || sentInitialPromptRef.current) return;

    const send = () => {
      if (sentInitialPromptRef.current) return;
      sentInitialPromptRef.current = true;
      sendToSession(sessionId, { type: "user_message", content: initialPrompt });
    };

    const unsubscribe = subscribe(agentModel.state, () => {
      if (agentModel.state.connectionStatus[sessionId] === "connected") {
        unsubscribe();
        send();
      }
    });

    if (agentModel.state.connectionStatus[sessionId] === "connected") {
      unsubscribe();
      send();
    }

    return unsubscribe;
  }, [sessionId, initialPrompt]);

  return { sessionId, isCreating, ref };
}
