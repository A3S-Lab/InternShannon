/**
 * AgentUI — renders UNTRUSTED, agent-generated frontend code safely.
 *
 * It runs the code in an opaque-origin sandboxed iframe (no host DOM/cookie/token
 * access), denies active network egress + arbitrary passive resources via CSP, and
 * exposes only the host functions you list in `capabilities` through a postMessage
 * bridge that the host whitelists, rate-limits, and times out. The agent calls them
 * as `await host.call("getReport", { id })`.
 *
 * The HOST is the authority for the bridge: in-flight cap, per-call timeout, and
 * the capability whitelist are all enforced here, NOT in the sandbox bootstrap
 * (which shares a realm with untrusted code and is bypassable via raw postMessage).
 *
 * Usage:
 *   <AgentUI
 *     html={agentGeneratedHtml}
 *     capabilities={{ getReport: async ({ id }) => fetchReport(id) }}
 *     fallback={<Spinner />}
 *     onError={(e) => toast(e.message)}
 *     onCall={(c) => audit(c)}
 *   />
 *
 * Production hardening: serve from a dedicated usercontent origin (e.g. route a
 * subdomain through a3s-gateway) and deliver the CSP via an HTTP header, so even
 * the opaque-origin boundary is backed by a real cross-origin boundary.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	type CapabilityMap,
	type CapabilityResult,
	composeSandboxDocument,
	createCapabilityDispatcher,
	DEFAULT_CALL_TIMEOUT_MS,
	isTrustedMessage,
	MAX_FRAME_HEIGHT,
	MAX_PENDING_CALLS,
	parseInboundMessage,
} from "./sandbox-bridge";

export interface AgentCallAudit {
	method: string;
	args: unknown;
	ok: boolean;
}

export type AgentUIStatus = "loading" | "ready" | "error";

export interface AgentUIProps {
	/** Agent-generated HTML — a full document or a body fragment. */
	html: string;
	/** Named host functions the sandbox may invoke. Keep them narrow; never close
	 *  over raw credentials you don't want the agent to be able to trigger. Each
	 *  capability receives UNTRUSTED args and must validate its own input. */
	capabilities?: CapabilityMap;
	/** Override the script/style/font/img CDN allowlist baked into the CSP. */
	cdnAllowlist?: string[];
	/** Shown until the sandbox document signals ready. */
	fallback?: ReactNode;
	/** Rendered instead of the iframe once the sandbox reports an uncaught error. */
	errorFallback?: (error: Error) => ReactNode;
	/** Fired after every bridge call — use it for auditing. */
	onCall?: (audit: AgentCallAudit) => void;
	/** Fired once the sandbox document has loaded. */
	onReady?: () => void;
	/** Fired (once per error episode) when the sandbox reports an uncaught error. */
	onError?: (error: Error) => void;
	className?: string;
	title?: string;
}

function withTimeout(p: Promise<CapabilityResult>, ms: number): Promise<CapabilityResult> {
	return Promise.race([
		p,
		new Promise<CapabilityResult>((resolve) =>
			setTimeout(() => resolve({ ok: false, error: "host.call timed out" }), ms),
		),
	]);
}

export function AgentUI({
	html,
	capabilities,
	cdnAllowlist,
	fallback = null,
	errorFallback,
	onCall,
	onReady,
	onError,
	className,
	title = "Agent preview",
}: AgentUIProps) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(0);
	const [status, setStatus] = useState<AgentUIStatus>("loading");
	const [error, setError] = useState<Error | null>(null);

	// Per-document state that must NOT live in React state (mutated from the async
	// message handler): in-flight call count, error-once latch, pending height + rAF.
	const inFlight = useRef(0);
	const errored = useRef(false);
	const pendingHeight = useRef<number | null>(null);
	const rafId = useRef(0);
	// Bumped on every document swap. A call captures the generation at receipt;
	// the WindowProxy is stable across srcDoc navigations, so generation — not
	// contentWindow identity — is what tells a stale call from a live one.
	const docGen = useRef(0);

	// Latest-handlers refs so the message listener never goes stale across renders.
	const handlers = useRef({ capabilities, onCall, onReady, onError });
	handlers.current = { capabilities, onCall, onReady, onError };

	const srcDoc = useMemo(
		() => composeSandboxDocument(html, cdnAllowlist),
		[html, cdnAllowlist],
	);

	// Reset lifecycle whenever the document changes.
	useEffect(() => {
		setStatus("loading");
		setError(null);
		setHeight(0);
		inFlight.current = 0;
		errored.current = false;
		pendingHeight.current = null;
		docGen.current++;
	}, [srcDoc]);

	useEffect(() => {
		async function onMessage(event: MessageEvent) {
			const frame = frameRef.current;
			if (!frame || !isTrustedMessage(event, frame.contentWindow)) return;
			const msg = parseInboundMessage(event.data);
			if (!msg) return;
			// Capture the document generation so a call that outlives a swap neither
			// corrupts the new document's in-flight count nor replies into it.
			const target = frame.contentWindow;
			const callGen = docGen.current;

			if (msg.kind === "ready") {
				setStatus((s) => (s === "error" ? s : "ready"));
				handlers.current.onReady?.();
				return;
			}
			if (msg.kind === "resize") {
				// rAF-coalesce + clamp so alternating/huge heights can't drive reflow DoS.
				pendingHeight.current = Math.min(Math.max(0, msg.height), MAX_FRAME_HEIGHT);
				if (!rafId.current) {
					rafId.current = requestAnimationFrame(() => {
						rafId.current = 0;
						const h = pendingHeight.current;
						if (h != null) setHeight((prev) => (prev === h ? prev : h));
					});
				}
				return;
			}
			if (msg.kind === "error") {
				if (errored.current) return; // fire once per error episode
				errored.current = true;
				const err = new Error(msg.message);
				setError(err);
				setStatus("error");
				handlers.current.onError?.(err);
				return;
			}
			// kind === "call": HOST-enforced backpressure + timeout + whitelist.
			if (inFlight.current >= MAX_PENDING_CALLS) {
				target?.postMessage(
					{ __af: 1, kind: "result", id: msg.id, ok: false, error: "too many pending host calls" },
					"*",
				);
				return;
			}
			inFlight.current++;
			let result: CapabilityResult;
			try {
				const live = createCapabilityDispatcher(handlers.current.capabilities ?? {});
				result = await withTimeout(live(msg.method, msg.args), DEFAULT_CALL_TIMEOUT_MS);
			} finally {
				// Only the call's own generation may decrement — a swapped-out call
				// must not underflow the fresh document's counter.
				if (callGen === docGen.current) {
					inFlight.current = Math.max(0, inFlight.current - 1);
				}
			}
			handlers.current.onCall?.({ method: msg.method, args: msg.args, ok: result.ok });
			// Drop the reply if the document was swapped during dispatch. Ids restart
			// per document, so a stale reply could otherwise resolve a colliding id in
			// the new doc. (WindowProxy identity is stable across swaps, so generation
			// is the only reliable discriminator.)
			if (callGen !== docGen.current) return;
			// targetOrigin "*" is correct here: the recipient is our own opaque-origin
			// iframe (whose origin can't be named), and we only reply to calls it made.
			target?.postMessage(
				result.ok
					? { __af: 1, kind: "result", id: msg.id, ok: true, value: result.value }
					: { __af: 1, kind: "result", id: msg.id, ok: false, error: result.error },
				"*",
			);
		}

		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			if (rafId.current) cancelAnimationFrame(rafId.current);
		};
	}, []);

	if (status === "error" && error && errorFallback) {
		return <>{errorFallback(error)}</>;
	}

	return (
		<>
			{status === "loading" && fallback}
			<iframe
				ref={frameRef}
				title={title}
				className={className}
				sandbox="allow-scripts"
				srcDoc={srcDoc}
				style={{
					width: "100%",
					height: height || undefined,
					border: 0,
					display: status === "loading" ? "none" : "block",
				}}
			/>
		</>
	);
}
