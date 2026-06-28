/**
 * Render agent-generated React/JSX (not just plain HTML) in the sandbox.
 *
 * Instead of pulling a transpiler into the host bundle, we load React + Babel
 * from the CDN and transpile INSIDE the sandbox via Babel's <script type="text/babel">
 * path (it executes compiled code by appending an inline <script> — covered by the
 * CSP's 'unsafe-inline', so no 'unsafe-eval' needed). Pipe the result straight to
 * the existing component:
 *
 *   <AgentUI html={composeReactDocument(jsx)} capabilities={...} />
 *
 * composeSandboxDocument then wraps it with the locked-down CSP + host bridge.
 * The agent code still has no network and no host access — only `host.call(...)`.
 *
 * Convention: the code defines a top-level component named `App` (or `Main`/`Page`).
 * If it doesn't mount anything itself, we mount it into #root. The code runs as a
 * classic script, so use a top-level `const App = ...` — `export default` won't work.
 */
export interface ReactDocumentOptions {
	/** UMD CDN base. MUST be covered by the AgentUI `cdnAllowlist` (default
	 *  allowlist already includes unpkg). */
	cdnBase?: string;
	/** React major/exact version to load. */
	reactVersion?: string;
}

export function composeReactDocument(
	code: string,
	{ cdnBase = "https://unpkg.com", reactVersion = "18" }: ReactDocumentOptions = {},
): string {
	// ponytail: neutralize a `</script>` breakout so agent code can't escape the
	// babel block. Blast radius is only the sandbox, but a broken preview is worse
	// than a one-line guard. `<\/script` is still valid JS, inert to the HTML parser.
	const safe = code.replace(/<\/script/gi, "<\\/script");
	// Call-shaped match so a bare mention of `createRoot` in a comment/string does
	// not suppress the injected mount.
	const autoMount = !/\b(?:createRoot|hydrateRoot)\s*\(|ReactDOM\.render\s*\(/.test(code);
	return [
		`<div id="root"></div>`,
		`<script src="${cdnBase}/react@${reactVersion}/umd/react.production.min.js"></script>`,
		`<script src="${cdnBase}/react-dom@${reactVersion}/umd/react-dom.production.min.js"></script>`,
		`<script src="${cdnBase}/@babel/standalone/babel.min.js"></script>`,
		`<script type="text/babel" data-presets="react">`,
		safe,
		autoMount
			? `var __C = typeof App !== "undefined" ? App : typeof Main !== "undefined" ? Main : typeof Page !== "undefined" ? Page : null;
if (__C) ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(__C));
else throw new Error("agent JSX defined no mountable component (expected a top-level App/Main/Page, or call ReactDOM.createRoot(...).render(...) yourself)");`
			: "",
		`</script>`,
	].join("\n");
}
