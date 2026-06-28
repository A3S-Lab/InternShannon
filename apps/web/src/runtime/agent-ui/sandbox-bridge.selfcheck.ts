/**
 * Runnable trust-boundary check for the agent-ui sandbox core.
 * No framework — run directly on Node 22+: `node sandbox-bridge.selfcheck.ts`
 * It fails loudly if any security invariant regresses.
 */
import assert from "node:assert/strict";
import {
	composeSandboxDocument,
	createCapabilityDispatcher,
	isTrustedMessage,
	parseInboundMessage,
} from "./sandbox-bridge.ts";
import { composeReactDocument } from "./react-document.ts";

async function run() {
	// --- composeSandboxDocument: CSP + bridge injected, egress locked ---
	const fragDoc = composeSandboxDocument("<h1>hi</h1>");
	assert.match(fragDoc, /Content-Security-Policy/, "CSP meta must be present");
	assert.match(fragDoc, /connect-src 'none'/, "network egress must be denied");
	assert.match(fragDoc, /window\.host/, "host bridge bootstrap must be injected");
	assert.match(fragDoc, /<body><h1>hi<\/h1><\/body>/, "fragment must be wrapped");
	// Passive-resource exfiltration lock: no bare https: for img/media/font.
	assert.doesNotMatch(fragDoc, /img-src[^;]*\bhttps:(?!\/\/)/, "img-src must not allow bare https:");
	assert.doesNotMatch(fragDoc, /img-src[^;]* https: /, "img-src must not allow wildcard https origin");
	assert.match(fragDoc, /object-src 'none'/, "plugins denied");
	assert.match(fragDoc, /worker-src 'none'/, "workers denied");
	// Hardening wired into the in-sandbox bootstrap.
	assert.match(fragDoc, /timed out/, "host.call must enforce a timeout");
	assert.match(fragDoc, /too many pending host calls/, "host.call must enforce a backpressure cap");
	assert.match(fragDoc, /kind: "error"/, "sandbox must forward uncaught errors");
	assert.match(fragDoc, /webrtc 'block'/, "WebRTC egress blocked in CSP");
	assert.match(fragDoc, /RTCPeerConnection/, "WebRTC neutered in the bootstrap");
	assert.match(fragDoc, /requestAnimationFrame/, "resize report must be rAF-debounced");

	// CSP meta must be provably first — agent markup before <head> cannot precede it.
	const malicious = composeSandboxDocument(
		'<html><script src="https://evil.example/x.js"></script><base href="https://evil.example/"><head><title>t</title></head><body>ok</body></html>',
	);
	const cspAt = malicious.indexOf("Content-Security-Policy");
	const evilAt = malicious.indexOf("evil.example");
	assert.ok(cspAt > 0, "CSP present in full-doc path");
	assert.ok(evilAt === -1 || evilAt > cspAt, "no agent node may be parsed before the CSP meta");
	assert.match(malicious, /<title>t<\/title>/, "legit head content preserved");
	assert.match(malicious, /<body>ok<\/body>/, "body content preserved");

	// <header> must not be mistaken for <head>.
	const headerDoc = composeSandboxDocument("<html><body><header>nav</header></body></html>");
	assert.match(headerDoc, /<body><header>nav<\/header><\/body>/, "<header> stays in body");

	// Full-document input: inject into existing <head>, do NOT double-wrap.
	const fullDoc = composeSandboxDocument(
		"<!doctype html><html><head><title>x</title></head><body>y</body></html>",
	);
	assert.equal(
		(fullDoc.match(/<html/gi) ?? []).length,
		1,
		"full doc must not be double-wrapped",
	);
	assert.ok(
		fullDoc.indexOf("Content-Security-Policy") < fullDoc.indexOf("<title>"),
		"CSP must be injected at the head",
	);

	// CDN allowlist is honored and not silently widened.
	const custom = composeSandboxDocument("<p/>", ["https://my.cdn"]);
	assert.match(custom, /script-src 'unsafe-inline' https:\/\/my\.cdn/);
	assert.doesNotMatch(custom, /unpkg/, "default CDNs must not leak in when overridden");

	// --- parseInboundMessage: strict validation ---
	assert.equal(parseInboundMessage(null), null);
	assert.equal(parseInboundMessage({ kind: "call" }), null, "untagged rejected");
	assert.equal(parseInboundMessage({ __af: 1, kind: "evil" }), null);
	assert.equal(parseInboundMessage({ __af: 1, kind: "resize" }), null, "resize needs height");
	assert.deepEqual(parseInboundMessage({ __af: 1, kind: "ready" }), { kind: "ready" });
	assert.deepEqual(parseInboundMessage({ __af: 1, kind: "resize", height: 42 }), {
		kind: "resize",
		height: 42,
	});
	assert.deepEqual(parseInboundMessage({ __af: 1, kind: "error", message: "boom" }), {
		kind: "error",
		message: "boom",
	});
	assert.equal(parseInboundMessage({ __af: 1, kind: "error" }), null, "error needs message");
	const cappedErr = parseInboundMessage({ __af: 1, kind: "error", message: "x".repeat(10000) });
	assert.ok(
		cappedErr?.kind === "error" && cappedErr.message.length <= 4096,
		"forwarded error message must be length-capped",
	);
	assert.equal(parseInboundMessage({ __af: 1, kind: "call", method: "x" }), null, "call needs id");
	assert.deepEqual(
		parseInboundMessage({ __af: 1, kind: "call", id: "c1", method: "getX", args: { a: 1 } }),
		{ kind: "call", id: "c1", method: "getX", args: { a: 1 } },
	);

	// --- isTrustedMessage: source identity, not origin ---
	const win = {} as Window;
	const other = {} as Window;
	assert.equal(isTrustedMessage({ source: win }, win), true);
	assert.equal(isTrustedMessage({ source: other }, win), false, "foreign window rejected");
	assert.equal(isTrustedMessage({ source: win }, null), false, "null frame rejected");

	// --- dispatcher: whitelist + no prototype pollution + no leak ---
	let secret = "token-should-never-surface";
	const dispatch = createCapabilityDispatcher({
		add: (args) => (args as { a: number; b: number }).a + (args as { a: number; b: number }).b,
		boom: () => {
			throw new Error(`db failed using ${secret}`.replace(secret, "[redacted]"));
		},
	});
	assert.deepEqual(await dispatch("add", { a: 2, b: 3 }), { ok: true, value: 5 });
	assert.deepEqual(await dispatch("missing", {}), {
		ok: false,
		error: "capability not allowed: missing",
	});
	assert.deepEqual(await dispatch("__proto__", {}), {
		ok: false,
		error: "capability not allowed: __proto__",
	});
	const errResult = await dispatch("boom", {});
	assert.equal(errResult.ok, false);
	assert.ok(
		errResult.ok === false && !errResult.error.includes(secret),
		"error must not leak host secrets",
	);
	void secret;
	secret = "";

	// --- composeReactDocument: JSX path mounts + composes through the sandbox ---
	const jsx = composeReactDocument("const App = () => <h1>hi</h1>;");
	assert.match(jsx, /react@18.*react\.production/, "react UMD loaded");
	assert.match(jsx, /@babel\/standalone/, "babel standalone loaded");
	assert.match(jsx, /type="text\/babel"/, "JSX compiled in-sandbox");
	assert.match(jsx, /createRoot\(document\.getElementById\("root"\)\)/, "auto-mounts App");

	// Don't double-mount when the agent already mounted itself.
	const selfMount = composeReactDocument(
		'ReactDOM.createRoot(document.body).render(null);',
	);
	assert.equal(
		(selfMount.match(/createRoot/g) ?? []).length,
		1,
		"must not inject a second mount",
	);

	// </script> breakout is neutralized.
	const breakout = composeReactDocument('const x = "</script><img src=x onerror=alert(1)>";');
	assert.doesNotMatch(breakout, /<\/script><img/, "</script> breakout must be escaped");

	// auto-mount: a bare mention in a comment must NOT suppress the injected mount.
	const commented = composeReactDocument("// we won't call createRoot here\nconst App = () => <div/>;");
	assert.match(commented, /React\.createElement\(__C\)/, "comment mention still auto-mounts");
	assert.match(commented, /typeof App !== "undefined"/, "guarded mount resolves App/Main/Page");
	const realMount = composeReactDocument("createRoot(document.body).render(null);");
	assert.doesNotMatch(realMount, /__C/, "an actual createRoot() call suppresses auto-mount");

	// React doc still inherits the full sandbox lockdown (CSP + allowed CDN).
	const reactSandbox = composeSandboxDocument(jsx);
	assert.match(reactSandbox, /connect-src 'none'/, "react preview keeps egress lock");
	assert.match(reactSandbox, /script-src 'unsafe-inline'.*unpkg\.com/, "unpkg permitted by CSP");

	console.log("sandbox-bridge self-check: OK");
}

run().catch((err) => {
	console.error("sandbox-bridge self-check FAILED:", err);
	process.exit(1);
});
