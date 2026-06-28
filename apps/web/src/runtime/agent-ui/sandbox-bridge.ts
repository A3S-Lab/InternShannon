/**
 * Security core for the agent-ui runtime.
 *
 * Agent-generated UI is UNTRUSTED code. The design rests on layered boundaries:
 *   1. It runs in a `sandbox="allow-scripts"` iframe WITHOUT `allow-same-origin`,
 *      so it sits at an opaque origin and cannot reach the host DOM/cookies/storage.
 *   2. A strict CSP blocks ACTIVE egress (fetch/XHR/WebSocket/WebRTC) and arbitrary
 *      passive resources, so the code cannot phone home — privileged actions go
 *      through the postMessage capability bridge, which the host whitelists AND
 *      rate-limits (the host is the authority; see AgentUI.tsx).
 *   3. We own the document wrapper so the CSP <meta> is provably the first node the
 *      parser sees — agent markup can never execute ahead of the policy.
 *
 * Residual risk (documented, not eliminated here): the allowlisted CDN origins are
 * a low-bandwidth PASSIVE exfiltration sink (an agent can encode data into a
 * `<img src="https://cdn.../?=...">` path/query). The durable closure is to
 * self-host React/Babel/Tailwind and shrink the allowlist to a first-party origin
 * that does not echo arbitrary paths. Until then, do not feed the sandbox secrets
 * you are unwilling to expose at that bandwidth.
 *
 * This module is pure (no React, no DOM calls) so the trust-boundary logic is
 * unit-testable in plain Node — see sandbox-bridge.selfcheck.ts.
 */

/** External origins the sandboxed document may load scripts/styles/fonts/images
 *  from — the single trust knob. Every entry is also a passive-exfil sink (above). */
export const DEFAULT_CDN_ALLOWLIST = [
	"https://cdn.jsdelivr.net",
	"https://unpkg.com",
	"https://esm.sh",
	"https://cdn.tailwindcss.com",
];

/** Max concurrent in-flight host.call() requests per sandbox. Advisory inside the
 *  sandbox; AUTHORITATIVELY enforced host-side in AgentUI (the sandbox copy shares
 *  a realm with untrusted code and is bypassable). */
export const MAX_PENDING_CALLS = 64;
/** Default host.call() timeout (enforced on both sides). */
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;
/** Hard ceiling on reported iframe height — bounds a malicious resize value. */
export const MAX_FRAME_HEIGHT = 100_000;
/** Max length of a forwarded sandbox error message — bounds per-message allocation. */
export const MAX_ERROR_LENGTH = 4096;

/** Wire protocol — every message is tagged `__af: 1` to avoid colliding with
 *  unrelated postMessage traffic. */
export type InboundMessage =
	| { kind: "ready" }
	| { kind: "resize"; height: number }
	| { kind: "error"; message: string }
	| { kind: "call"; id: string; method: string; args: unknown };

export type CapabilityResult =
	| { ok: true; value: unknown }
	| { ok: false; error: string };

/** A capability is a named host function the sandbox is allowed to invoke.
 *  Tokens/credentials live in the host closure — never passed into the iframe.
 *  Capabilities receive UNTRUSTED args and MUST validate their own input. */
export type CapabilityMap = Record<string, (args: unknown) => unknown>;

function buildCsp(cdnAllowlist: string[]): string {
	const src = cdnAllowlist.join(" ").trim();
	// ponytail: 'unsafe-inline' is required because generated UIs are inline
	// scripts/styles with no nonce. It is contained by the opaque-origin iframe
	// boundary + the egress locks below. Upgrade path: nonce the bootstrap and
	// force agents to emit nonce'd <script> if you ever drop the iframe boundary.
	return [
		"default-src 'none'",
		`script-src 'unsafe-inline' ${src}`.trim(),
		`style-src 'unsafe-inline' ${src}`.trim(),
		// No bare `https:` for passive resources: an arbitrary <img>/<audio>/font
		// URL exfiltrates data via the request URL even with connect-src 'none'.
		`img-src data: blob: ${src}`.trim(),
		`media-src data: blob: ${src}`.trim(),
		`font-src data: ${src}`.trim(),
		"connect-src 'none'", // active-egress lock — fetch/XHR/WebSocket/EventSource
		"webrtc 'block'", // Chromium-honored WebRTC egress lock (also neutered in JS below)
		"frame-src 'none'",
		"child-src 'none'",
		"worker-src 'none'",
		"manifest-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");
}

/** Runs INSIDE the sandbox. Neuters non-CSP egress (WebRTC), exposes
 *  `window.host.call(method, args, { timeoutMs })`, reports content height
 *  (rAF-debounced), forwards uncaught errors, and signals ready on load. */
const BOOTSTRAP = `(function(){
	// Neuter WebRTC egress for engines that don't honor CSP 'webrtc'.
	try { ["RTCPeerConnection","webkitRTCPeerConnection","RTCDataChannel"].forEach(function(k){ window[k] = undefined; }); } catch(e){}
	var P = window.parent, calls = {}, n = 0, pending = 0;
	window.host = { call: function(method, args, opts){
		opts = opts || {};
		var timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : ${DEFAULT_CALL_TIMEOUT_MS};
		return new Promise(function(res, rej){
			if (pending >= ${MAX_PENDING_CALLS}) { rej(new Error("too many pending host calls")); return; }
			var id = "c" + (++n);
			var t = setTimeout(function(){
				if (calls[id]) { delete calls[id]; pending--; rej(new Error("host.call timed out: " + method)); }
			}, timeoutMs);
			calls[id] = { res: res, rej: rej, t: t };
			pending++;
			P.postMessage({ __af: 1, kind: "call", id: id, method: method, args: args }, "*");
		});
	}};
	window.addEventListener("message", function(e){
		var m = e.data;
		if (!m || m.__af !== 1 || m.kind !== "result") return;
		var c = calls[m.id]; if (!c) return;
		clearTimeout(c.t); delete calls[m.id]; pending--;
		if (m.ok) c.res(m.value); else c.rej(new Error(m.error));
	});
	var rafPending = false, raf = window.requestAnimationFrame || function(cb){ return setTimeout(cb, 16); };
	function report(){
		if (rafPending) return;
		rafPending = true;
		raf(function(){ rafPending = false; P.postMessage({ __af: 1, kind: "resize", height: document.documentElement.scrollHeight }, "*"); });
	}
	function fail(message){ P.postMessage({ __af: 1, kind: "error", message: String(message) }, "*"); }
	window.addEventListener("error", function(e){ fail(e.message || "script error"); });
	window.addEventListener("unhandledrejection", function(e){ fail((e.reason && e.reason.message) || e.reason || "unhandled rejection"); });
	if (window.ResizeObserver) new ResizeObserver(report).observe(document.documentElement);
	window.addEventListener("load", function(){ P.postMessage({ __af: 1, kind: "ready" }, "*"); report(); });
})();`;

/**
 * Split agent output into head/body inner HTML WITHOUT trusting its structure.
 * Anything outside <head>/<body> (e.g. a `<script>` placed before <head> to beat
 * the CSP meta) is discarded. A fragment (no <html>) becomes the body verbatim.
 */
function splitAgentDocument(html: string): { headInner: string; bodyInner: string } {
	if (!/<html[\s>]/i.test(html)) return { headInner: "", bodyInner: html };
	// `(?=[\s>])` so `<header>` is never mistaken for `<head>`.
	const headInner = html.match(/<head(?=[\s>])[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
	const bodyMatch = html.match(/<body(?=[\s>])[^>]*>([\s\S]*?)<\/body>/i);
	if (bodyMatch) return { headInner, bodyInner: bodyMatch[1] };
	const afterHead = html.replace(/[\s\S]*?<\/head>/i, "");
	const bodyInner = (afterHead !== html ? afterHead : html)
		.replace(/<\/?html[^>]*>/gi, "")
		.replace(/<head(?=[\s>])[^>]*>[\s\S]*?<\/head>/gi, "")
		.replace(/<\/?body[^>]*>/gi, "");
	return { headInner, bodyInner };
}

/**
 * Build the sandbox document. We ALWAYS own the wrapper, emitting the CSP <meta>
 * and bridge bootstrap as the first head nodes, then the agent's head/body content
 * after them. This guarantees no agent-authored token is parsed before the policy
 * (closes the "markup before <head> escapes the meta-CSP" class of bypass).
 *
 * Production defense-in-depth: also serve a real HTTP `Content-Security-Policy`
 * header from the usercontent origin so the policy doesn't depend on meta ordering.
 */
export function composeSandboxDocument(
	html: string,
	cdnAllowlist: string[] = DEFAULT_CDN_ALLOWLIST,
): string {
	const trustedHead = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(cdnAllowlist)}"><meta charset="utf-8"><script>${BOOTSTRAP}</script>`;
	const { headInner, bodyInner } = splitAgentDocument(html);
	return `<!doctype html><html><head>${trustedHead}${headInner}</head><body>${bodyInner}</body></html>`;
}

/**
 * A message is trusted only if it came from the exact iframe window we created.
 * The sandbox is at an opaque origin, so `event.origin` is the string "null" and
 * useless for validation — source identity is the real check.
 */
export function isTrustedMessage(
	event: Pick<MessageEvent, "source">,
	frameWindow: Window | null,
): boolean {
	return frameWindow != null && event.source === frameWindow;
}

/** Validate + narrow an inbound message; returns null for anything malformed. */
export function parseInboundMessage(data: unknown): InboundMessage | null {
	if (!data || typeof data !== "object") return null;
	const m = data as Record<string, unknown>;
	if (m.__af !== 1) return null;
	switch (m.kind) {
		case "ready":
			return { kind: "ready" };
		case "resize":
			return typeof m.height === "number" && Number.isFinite(m.height)
				? { kind: "resize", height: m.height }
				: null;
		case "error":
			return typeof m.message === "string"
				? { kind: "error", message: m.message.slice(0, MAX_ERROR_LENGTH) }
				: null;
		case "call":
			return typeof m.id === "string" && typeof m.method === "string"
				? { kind: "call", id: m.id, method: m.method, args: m.args }
				: null;
		default:
			return null;
	}
}

/**
 * Build the whitelist dispatcher. Only own, named capabilities are invokable —
 * `Object.hasOwn` also blocks prototype-pollution probes like `__proto__`.
 * Errors are reduced to their message so host internals/tokens never leak back.
 */
export function createCapabilityDispatcher(capabilities: CapabilityMap) {
	return async function dispatch(
		method: string,
		args: unknown,
	): Promise<CapabilityResult> {
		if (typeof method !== "string" || !Object.hasOwn(capabilities, method)) {
			return { ok: false, error: `capability not allowed: ${String(method)}` };
		}
		try {
			return { ok: true, value: await capabilities[method](args) };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	};
}
